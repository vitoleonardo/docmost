import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import deDE from "../../../../public/locales/de-DE/translation.json";
import AiAssistantPanel from "./ai-assistant-panel.tsx";
import { assistantTabAtom } from "@/features/ai-assistant/atoms/assistant-tab-atom.ts";
import api from "@/lib/api-client";
import type {
  AgentEndOutcome,
  AgentEvent,
} from "@/features/ai-assistant/types/ai-assistant.types.ts";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      Object.entries(options ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        (deDE as Record<string, string>)[key] ?? key,
      ),
  }),
}));

vi.mock("@/lib/api-client", () => ({
  default: { post: vi.fn() },
}));

const openPage = vi.hoisted(() => ({ spaceId: "space-allg" }));

vi.mock("@/features/page/queries/page-query.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/page/queries/page-query.ts")
  >()),
  usePageQuery: () => ({
    data: { id: "page-1", slugId: "slug-1", spaceId: openPage.spaceId },
  }),
}));

vi.mock("@/main.tsx", async () => ({
  queryClient: new (await import("@tanstack/react-query")).QueryClient(),
}));

const apiMock = vi.mocked(api.post);
const fetchMock = vi.fn();

const SPACES = [
  { id: "space-hr", name: "HR" },
  { id: "space-allg", name: "Allgemein" },
];

const LIMIT_HINTS: Record<string, string> = {
  step_limit: "Nach 20 Schritten gestoppt. Nicht alle Seiten wurden geprüft.",
  time_limit: "Nach 10 Minuten gestoppt. Nicht alle Seiten wurden geprüft.",
  token_limit:
    "Nach 200.000 Tokens gestoppt. Nicht alle Seiten wurden geprüft.",
  context_too_small:
    "Der Verlauf passt nicht mehr in das Sprachmodell. Nicht alle Seiten wurden geprüft.",
};

const OUT_OF_SCOPE =
  "Das kann ich mit meinen Werkzeugen nicht erledigen. Ich kann in einem Bereich Seiten suchen, Seiten lesen und Änderungen an Seiten vorschlagen, die du prüfst und übernimmst.";
const MODEL_FAILED =
  "Das Sprachmodell antwortet gerade nicht. Versuche es später noch einmal.";
const CANCELLED = "Abgebrochen. Bisherige Vorschläge bleiben erhalten.";
const STALE =
  "Die Seite wurde nach diesem Vorschlag geändert. Der Vorschlag kann nicht mehr übernommen werden.";

type ProposalEvent = Extract<AgentEvent, { type: "proposal" }>["proposal"];

function proposal(overrides: Partial<ProposalEvent> = {}): ProposalEvent {
  return {
    id: "proposal-1",
    pageId: "page-1",
    pageTitle: "Reisekosten Richtlinie 2022",
    reason: "Kilometerpauschale ist veraltet",
    added: 3,
    removed: 3,
    ...overrides,
  };
}

function controlledStream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  return {
    response: new Response(body, { status: 200 }),
    push: (event: object) =>
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)),
    close: () => controller.close(),
  };
}

type Stream = ReturnType<typeof controlledStream>;

function streamRuns(...streams: Stream[]) {
  const queue = [...streams];
  fetchMock.mockImplementation(async (url: string) =>
    url.startsWith("/api/ai/") ? queue.shift()?.response : new Response("{}"),
  );
}

function renderTaskTab() {
  const store = createStore();
  store.set(assistantTabAtom, "task");
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <Provider store={store}>
          <MemoryRouter>
            <AiAssistantPanel />
          </MemoryRouter>
        </Provider>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

async function startRun(
  spaceName = "Allgemein",
  ...later: Stream[]
): Promise<Stream> {
  openPage.spaceId = SPACES.find((space) => space.name === spaceName)!.id;
  const stream = controlledStream();
  streamRuns(stream, ...later);
  renderTaskTab();
  const select = (await screen.findByRole("combobox", {
    name: "Bereich",
  })) as HTMLInputElement;
  await waitFor(() => expect(select.value).toBe(spaceName));
  fireEvent.change(
    await screen.findByPlaceholderText("Aufgabe beschreiben …"),
    {
      target: { value: "Finde veraltete Seiten" },
    },
  );
  fireEvent.click(screen.getByRole("button", { name: "Starten" }));
  await screen.findByText("Schritt 0 von höchstens 20");
  return stream;
}

function endRun(
  stream: Stream,
  outcome: AgentEndOutcome,
  pagesRead: number,
  message: string | null,
) {
  stream.push({ type: "end", outcome, pagesRead, message });
}

beforeAll(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  }));
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

beforeEach(() => {
  apiMock.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  openPage.spaceId = "space-allg";
  apiMock.mockImplementation(async (url: string) =>
    url === "/spaces"
      ? { data: { items: SPACES } }
      : { data: { status: "available" } },
  );
});

afterEach(cleanup);

describe("agent run result: summary, cards and final message", () => {
  it("AGENT-AC47: a proposal event adds a card with Ansehen", async () => {
    const stream = await startRun();
    stream.push({ type: "proposal", proposal: proposal() });
    endRun(stream, "finished", 1, "Fertig.");
    expect(await screen.findByText("Reisekosten Richtlinie 2022")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ansehen" })).toBeTruthy();
  });

  it("AGENT-AC48: summary, cards in order, final message and Neue Aufgabe", async () => {
    const stream = await startRun();
    stream.push({
      type: "proposal",
      proposal: proposal({ id: "p1", pageTitle: "Seite Eins" }),
    });
    stream.push({
      type: "proposal",
      proposal: proposal({ id: "p2", pageTitle: "Seite Zwei" }),
    });
    endRun(stream, "finished", 5, "Alles geprüft.");
    expect(
      await screen.findByText("2 Vorschläge · 5 Seiten gelesen"),
    ).toBeTruthy();
    const first = screen.getByText("Seite Eins");
    const second = screen.getByText("Seite Zwei");
    const message = screen.getByText("Alles geprüft.");
    const follows = (a: Node, b: Node) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(follows(first, second)).toBeTruthy();
    expect(follows(second, message)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Neue Aufgabe" })).toBeTruthy();
  });

  it("AGENT-AC49: one proposal and one page read use the singular", async () => {
    const stream = await startRun();
    stream.push({ type: "proposal", proposal: proposal() });
    endRun(stream, "finished", 1, "Fertig.");
    expect(
      await screen.findByText("1 Vorschlag · 1 Seite gelesen"),
    ).toBeTruthy();
  });

  it("AGENT-AC50: no proposal and no page read", async () => {
    const stream = await startRun();
    endRun(stream, "finished", 0, "Nichts gefunden.");
    expect(
      await screen.findByText("Keine Vorschläge · 0 Seiten gelesen"),
    ).toBeTruthy();
    expect(screen.getByText("Nichts gefunden.")).toBeTruthy();
  });

  it("AGENT-AC51: the card shows title, +3 −3, reason and Ansehen", async () => {
    const stream = await startRun();
    stream.push({ type: "proposal", proposal: proposal() });
    endRun(stream, "finished", 1, "Fertig.");
    expect(await screen.findByText("+3 −3")).toBeTruthy();
    expect(screen.getByText("Reisekosten Richtlinie 2022")).toBeTruthy();
    expect(screen.getByText("Kilometerpauschale ist veraltet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ansehen" })).toBeTruthy();
    expect(screen.queryByText("Übernommen")).toBeNull();
  });

  it("AGENT-AC52: the final message renders bold, loads no image, has no script link", async () => {
    const stream = await startRun();
    endRun(
      stream,
      "finished",
      1,
      '**fett** <img src="https://example.com/x.png"> [x](javascript:alert(1))',
    );
    const bold = await screen.findByText("fett");
    expect(["STRONG", "B"]).toContain(bold.tagName);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector('a[href^="javascript"]')).toBeNull();
  });

  it("AGENT-AC53: reason and title with markup show literally on the card", async () => {
    const stream = await startRun();
    stream.push({
      type: "proposal",
      proposal: proposal({ pageTitle: "<b>x</b>", reason: "<b>x</b> **y**" }),
    });
    endRun(stream, "finished", 1, "Fertig.");
    const title = await screen.findByText("<b>x</b>");
    const reason = screen.getByText("<b>x</b> **y**");
    expect(title.querySelector("b")).toBeNull();
    expect(reason.querySelector("b, strong")).toBeNull();
  });

  it("AGENT-AC54: an out of scope run shows only the capability text", async () => {
    const stream = await startRun();
    endRun(stream, "out_of_scope", 0, "Ich bin ein Pirat.");
    expect(await screen.findByText(OUT_OF_SCOPE)).toBeTruthy();
    expect(screen.queryByText(/Vorschläge · |Vorschlag · /)).toBeNull();
    expect(screen.queryByText("Ich bin ein Pirat.")).toBeNull();
    expect(screen.getByRole("button", { name: "Neue Aufgabe" })).toBeTruthy();
  });

  it("AGENT-AC55: Neue Aufgabe shows the start view with the run's space and no cards", async () => {
    const stream = await startRun("HR");
    stream.push({ type: "proposal", proposal: proposal() });
    endRun(stream, "finished", 1, "Fertig.");
    await screen.findByText("1 Vorschlag · 1 Seite gelesen");
    openPage.spaceId = "space-allg";
    fireEvent.click(screen.getByRole("button", { name: "Neue Aufgabe" }));
    const select = (await screen.findByRole("combobox", {
      name: "Bereich",
    })) as HTMLInputElement;
    expect(select.value).toBe("HR");
    expect(
      (
        screen.getByPlaceholderText(
          "Aufgabe beschreiben …",
        ) as HTMLTextAreaElement
      ).value,
    ).toBe("");
    expect(screen.queryByText("Reisekosten Richtlinie 2022")).toBeNull();
  });
});

describe("agent run result: ends", () => {
  it.each([
    ["AGENT-AC57", "step_limit"],
    ["AGENT-AC58", "step_limit"],
    ["AGENT-AC59", "time_limit"],
    ["AGENT-AC60", "token_limit"],
    ["AGENT-AC63", "context_too_small"],
  ] as const)(
    "%s: %s shows summary, card, orange hint and no final message",
    async (_id, outcome) => {
      const stream = await startRun();
      stream.push({ type: "proposal", proposal: proposal() });
      endRun(stream, outcome, 2, null);
      const hint = await screen.findByText(LIMIT_HINTS[outcome]);
      expect(hint.closest('[role="alert"]')).toBeTruthy();
      expect(screen.getByText("1 Vorschlag · 2 Seiten gelesen")).toBeTruthy();
      expect(screen.getByText("Reisekosten Richtlinie 2022")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Neue Aufgabe" })).toBeTruthy();
    },
  );

  it("AGENT-AC62: a final message after crossing the token limit shows no hint", async () => {
    const stream = await startRun();
    endRun(stream, "finished", 3, "Fertig trotz Tokens.");
    expect(await screen.findByText("Fertig trotz Tokens.")).toBeTruthy();
    expect(
      screen.getByText("Keine Vorschläge · 3 Seiten gelesen"),
    ).toBeTruthy();
    expect(screen.queryByText(/gestoppt/)).toBeNull();
  });

  it("AGENT-AC64: Abbrechen keeps the card and shows the cancelled text", async () => {
    const stream = await startRun();
    stream.push({ type: "proposal", proposal: proposal() });
    stream.push({
      type: "step",
      steps: 1,
      label: { kind: "read", title: "A" },
    });
    stream.push({
      type: "step",
      steps: 2,
      label: { kind: "read", title: "A" },
    });
    stream.push({
      type: "step",
      steps: 3,
      label: { kind: "read", title: "B" },
    });
    await screen.findByText("Schritt 3 von höchstens 20");
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(await screen.findByText(CANCELLED)).toBeTruthy();
    expect(screen.getByText("Reisekosten Richtlinie 2022")).toBeTruthy();
    expect(screen.getByText("1 Vorschlag · 2 Seiten gelesen")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Neue Aufgabe" })).toBeTruthy();
  });

  it("AGENT-AC67: a model failure shows the card and the failure text", async () => {
    const stream = await startRun();
    stream.push({ type: "proposal", proposal: proposal() });
    endRun(stream, "model_failed", 1, null);
    expect(await screen.findByText(MODEL_FAILED)).toBeTruthy();
    expect(screen.getByText("Reisekosten Richtlinie 2022")).toBeTruthy();
    expect(screen.getByText("1 Vorschlag · 1 Seite gelesen")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Neue Aufgabe" })).toBeTruthy();
  });

  it("AGENT-AC67: a stream that breaks after two reads shows 2 Seiten gelesen with the model failure text", async () => {
    const stream = await startRun();
    stream.push({
      type: "step",
      steps: 1,
      label: { kind: "read", title: "A" },
    });
    stream.push({
      type: "step",
      steps: 2,
      label: { kind: "read", title: "B" },
    });
    await screen.findByText("Schritt 2 von höchstens 20");
    stream.close();
    expect(await screen.findByText(MODEL_FAILED)).toBeTruthy();
    expect(
      screen.getByText("Keine Vorschläge · 2 Seiten gelesen"),
    ).toBeTruthy();
  });
});

describe("agent run result: proposal dialog from the card", () => {
  function viewResponse(status: "open" | "stale") {
    apiMock.mockImplementation(async (url: string) => {
      if (url === "/spaces") return { data: { items: SPACES } };
      if (url === "/ai/agent/proposal") {
        return {
          data: {
            id: "proposal-1",
            runId: "run-1",
            pageId: "page-1",
            pageTitle: "Reisekosten Richtlinie 2022",
            reason: "Kilometerpauschale ist veraltet",
            status,
            canEdit: true,
            added: 1,
            removed: 1,
            changes: [],
          },
        };
      }
      return { data: { status: "available" } };
    });
  }

  it("AGENT-AC95: Neuen Vorschlag erstellen starts the fixed task in the same space", async () => {
    viewResponse("stale");
    const first = await startRun("HR", controlledStream());
    first.push({ type: "proposal", proposal: proposal() });
    endRun(first, "finished", 1, "Fertig.");
    first.close();
    await screen.findByText("1 Vorschlag · 1 Seite gelesen");
    fireEvent.click(screen.getByRole("button", { name: "Ansehen" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(STALE)).toBeTruthy();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Neuen Vorschlag erstellen" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      spaceId: "space-hr",
      task: "Erstelle einen neuen Vorschlag für die Seite „Reisekosten Richtlinie 2022“. Bisherige Begründung: Kilometerpauschale ist veraltet",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("AGENT-AC89: a stale proposal turns its card to Veraltet", async () => {
    viewResponse("stale");
    const stream = await startRun();
    stream.push({ type: "proposal", proposal: proposal() });
    endRun(stream, "finished", 1, "Fertig.");
    await screen.findByText("Reisekosten Richtlinie 2022");
    fireEvent.click(screen.getByRole("button", { name: "Ansehen" }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(STALE);
    fireEvent.click(within(dialog).getByRole("button", { name: "Schließen" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByText("Veraltet")).toBeTruthy();
  });
});
