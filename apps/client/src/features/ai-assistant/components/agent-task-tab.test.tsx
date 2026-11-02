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
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import deDE from "../../../../public/locales/de-DE/translation.json";
import AiAssistantPanel from "./ai-assistant-panel.tsx";
import { assistantTabAtom } from "@/features/ai-assistant/atoms/assistant-tab-atom.ts";
import api from "@/lib/api-client";

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

const openPage = vi.hoisted(() => ({ spaceId: "space-hr" }));

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

const PROJEKTLEITERIN_SPACES = [
  { id: "space-it", name: "IT" },
  { id: "space-proj", name: "Projekte" },
  { id: "space-hr", name: "HR" },
  { id: "space-allg", name: "Allgemein" },
];

const UNAVAILABLE_TEXT =
  "Der Assistent ist gerade nicht erreichbar. Das Wiki funktioniert normal weiter.";
const EXAMPLE = "Finde veraltete Seiten zu Reisekosten und schlage Updates vor";

function mockWiki(spaces = PROJEKTLEITERIN_SPACES) {
  apiMock.mockImplementation(async (url: string) =>
    url === "/spaces"
      ? { data: { items: spaces } }
      : { data: { status: "available" } },
  );
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
  };
}

function streamRun(stream: { response: Response }) {
  fetchMock.mockImplementation(async (url: string) =>
    url.startsWith("/api/ai/") ? stream.response : new Response("{}"),
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

async function taskInput() {
  return (await screen.findByPlaceholderText(
    "Aufgabe beschreiben …",
  )) as HTMLTextAreaElement;
}

function startButton() {
  return screen.getByRole("button", { name: "Starten" }) as HTMLButtonElement;
}

async function spaceSelect() {
  return (await screen.findByRole("combobox", {
    name: "Bereich",
  })) as HTMLInputElement;
}

async function startRun(task: string, spaceName = "Allgemein") {
  openPage.spaceId = "space-allg";
  const stream = controlledStream();
  streamRun(stream);
  renderTaskTab();
  await waitFor(async () =>
    expect((await spaceSelect()).value).toBe(spaceName),
  );
  fireEvent.change(await taskInput(), { target: { value: task } });
  fireEvent.click(startButton());
  return stream;
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
  openPage.spaceId = "space-hr";
  mockWiki();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("agent task tab: start", () => {
  it("AGENT-AC2: shows the selector, hint, examples and the input", async () => {
    renderTaskTab();
    expect(await spaceSelect()).toBeTruthy();
    expect(
      screen.getByText(
        "Der Assistent kann Seiten suchen, lesen und Änderungen vorschlagen. Nichts wird ohne deine Bestätigung geändert.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Beispiele")).toBeTruthy();
    expect(screen.getByRole("button", { name: EXAMPLE })).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Prüfe, ob sich Seiten zum Urlaubsantrag widersprechen",
      }),
    ).toBeTruthy();
    expect(await taskInput()).toBeTruthy();
    expect(startButton()).toBeTruthy();
  });

  it("AGENT-AC4: lists the user's spaces alphabetically and no other", async () => {
    renderTaskTab();
    await waitFor(async () => expect((await spaceSelect()).value).toBe("HR"));
    fireEvent.click(await spaceSelect());
    const options = await screen.findAllByRole("option", { hidden: true });
    expect(options.map((option) => option.textContent)).toEqual([
      "Allgemein",
      "HR",
      "IT",
      "Projekte",
    ]);
  });

  it("AGENT-AC5: preselects the space of the open page", async () => {
    openPage.spaceId = "space-hr";
    renderTaskTab();
    await waitFor(async () => expect((await spaceSelect()).value).toBe("HR"));
  });

  it("AGENT-AC6: falls back to the first space when the page's space is not listed", async () => {
    openPage.spaceId = "space-foreign";
    renderTaskTab();
    await waitFor(async () =>
      expect((await spaceSelect()).value).toBe("Allgemein"),
    );
  });

  it("AGENT-AC7: an example fills the input and starts nothing", async () => {
    renderTaskTab();
    fireEvent.click(await screen.findByRole("button", { name: EXAMPLE }));
    expect((await taskInput()).value).toBe(EXAMPLE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("AGENT-AC8: 2,001 characters disable Starten and show the limit hint", async () => {
    renderTaskTab();
    fireEvent.change(await taskInput(), {
      target: { value: "a".repeat(2001) },
    });
    expect(startButton().disabled).toBe(true);
    expect(screen.getByText("Höchstens 2.000 Zeichen")).toBeTruthy();
  });

  it("AGENT-AC8: 2,000 characters surrounded by whitespace can start", async () => {
    renderTaskTab();
    fireEvent.change(await taskInput(), {
      target: { value: ` ${"a".repeat(2000)} ` },
    });
    await waitFor(() => expect(startButton().disabled).toBe(false));
    expect(screen.queryByText("Höchstens 2.000 Zeichen")).toBeNull();
  });

  it("AGENT-AC9: whitespace only disables Starten", async () => {
    renderTaskTab();
    fireEvent.change(await taskInput(), { target: { value: "   \n " } });
    expect(startButton().disabled).toBe(true);
  });

  it("AGENT-AC10: a user without spaces sees Kein Bereich and cannot start", async () => {
    mockWiki([]);
    renderTaskTab();
    await waitFor(async () =>
      expect((await spaceSelect()).value).toBe("Kein Bereich"),
    );
    fireEvent.change(await taskInput(), { target: { value: "Aufgabe" } });
    expect(startButton().disabled).toBe(true);
  });

  it("AGENT-AC11: Enter starts the run with the trimmed task in the chosen space", async () => {
    openPage.spaceId = "space-allg";
    streamRun(controlledStream());
    renderTaskTab();
    await waitFor(async () =>
      expect((await spaceSelect()).value).toBe("Allgemein"),
    );
    const input = await taskInput();
    fireEvent.change(input, { target: { value: "  Finde Seiten  " } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      spaceId: "space-allg",
      task: "Finde Seiten",
    });
  });
});

describe("agent task tab: running", () => {
  it("AGENT-AC16: shows task and space, step 0 and Abbrechen before the first step", async () => {
    await startRun("Finde veraltete Seiten zu Reisekosten");
    expect(
      await screen.findByText(
        "Finde veraltete Seiten zu Reisekosten · Allgemein",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Schritt 0 von höchstens 20")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Abbrechen" })).toBeTruthy();
  });

  it("AGENT-AC17: a search step shows its line and counts the step", async () => {
    const stream = await startRun("Aufgabe");
    await screen.findByText("Schritt 0 von höchstens 20");
    stream.push({
      type: "step",
      steps: 1,
      label: { kind: "search", query: "Reisekosten", count: 2 },
    });
    expect(
      await screen.findByText("Gesucht: „Reisekosten“: 2 Seiten"),
    ).toBeTruthy();
    expect(screen.getByText("Schritt 1 von höchstens 20")).toBeTruthy();
  });

  it("AGENT-AC18: a search with one or no page ends in 1 Seite or keine Seiten", async () => {
    const stream = await startRun("Aufgabe");
    await screen.findByText("Schritt 0 von höchstens 20");
    stream.push({
      type: "step",
      steps: 1,
      label: { kind: "search", query: "eins", count: 1 },
    });
    stream.push({
      type: "step",
      steps: 2,
      label: { kind: "search", query: "nichts", count: 0 },
    });
    expect(await screen.findByText("Gesucht: „eins“: 1 Seite")).toBeTruthy();
    expect(
      await screen.findByText("Gesucht: „nichts“: keine Seiten"),
    ).toBeTruthy();
  });

  it("AGENT-AC19: a read step shows the page title", async () => {
    const stream = await startRun("Aufgabe");
    await screen.findByText("Schritt 0 von höchstens 20");
    stream.push({
      type: "step",
      steps: 1,
      label: { kind: "read", title: "Reisekosten Richtlinie 2022" },
    });
    expect(
      await screen.findByText("Gelesen: „Reisekosten Richtlinie 2022“"),
    ).toBeTruthy();
  });

  it("AGENT-AC20: a propose step shows Vorschlag erstellt", async () => {
    const stream = await startRun("Aufgabe");
    await screen.findByText("Schritt 0 von höchstens 20");
    stream.push({
      type: "step",
      steps: 1,
      label: { kind: "propose", title: "Reisekosten Richtlinie 2022" },
    });
    expect(
      await screen.findByText(
        "Vorschlag erstellt: „Reisekosten Richtlinie 2022“",
      ),
    ).toBeTruthy();
  });

  it("AGENT-AC21: shows the run time since the start and ticks every second", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
    await startRun("Aufgabe");
    expect(await screen.findByText("0:00 min")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(72_000);
    });
    expect(screen.getByText("1:12 min")).toBeTruthy();
  });

  it("AGENT-AC22: a refused step reads Schritt ohne Ergebnis", async () => {
    const stream = await startRun("Aufgabe");
    await screen.findByText("Schritt 0 von höchstens 20");
    stream.push({ type: "step", steps: 1, label: { kind: "refused" } });
    expect(await screen.findByText("Schritt ohne Ergebnis")).toBeTruthy();
  });

  it("AGENT-AC24: two steps show in order and count 2", async () => {
    const stream = await startRun("Aufgabe");
    await screen.findByText("Schritt 0 von höchstens 20");
    stream.push({
      type: "step",
      steps: 1,
      label: { kind: "search", query: "Urlaub", count: 3 },
    });
    stream.push({
      type: "step",
      steps: 2,
      label: { kind: "read", title: "Urlaubsregelung" },
    });
    const read = await screen.findByText("Gelesen: „Urlaubsregelung“");
    const search = screen.getByText("Gesucht: „Urlaub“: 3 Seiten");
    expect(
      search.compareDocumentPosition(read) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText("Schritt 2 von höchstens 20")).toBeTruthy();
  });

  it("AGENT-AC53: a query with markup shows literally", async () => {
    const stream = await startRun("Aufgabe");
    await screen.findByText("Schritt 0 von höchstens 20");
    stream.push({
      type: "step",
      steps: 1,
      label: { kind: "search", query: "<b>x</b>", count: 1 },
    });
    const line = await screen.findByText("Gesucht: „<b>x</b>“: 1 Seite");
    expect(line.querySelector("b")).toBeNull();
  });

  it("AGENT-AC16: Abbrechen stops the run and keeps header and step lines", async () => {
    const stream = await startRun("Meine Aufgabe");
    await screen.findByText("Schritt 0 von höchstens 20");
    stream.push({
      type: "step",
      steps: 1,
      label: { kind: "read", title: "Seite A" },
    });
    await screen.findByText("Gelesen: „Seite A“");
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Abbrechen" })).toBeNull(),
    );
    expect(screen.getByText("Meine Aufgabe · Allgemein")).toBeTruthy();
    expect(screen.getByText("Gelesen: „Seite A“")).toBeTruthy();
  });

  it("AGENT-AC16: an ended run keeps header and step lines", async () => {
    const stream = await startRun("Meine Aufgabe");
    await screen.findByText("Schritt 0 von höchstens 20");
    stream.push({
      type: "step",
      steps: 1,
      label: { kind: "read", title: "Seite A" },
    });
    stream.push({
      type: "end",
      outcome: "finished",
      pagesRead: 1,
      message: "Fertig",
    });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Abbrechen" })).toBeNull(),
    );
    expect(screen.getByText("Meine Aufgabe · Allgemein")).toBeTruthy();
    expect(screen.getByText("Gelesen: „Seite A“")).toBeTruthy();
  });
});

describe("agent task tab: refusals", () => {
  it("AGENT-AC17: run_in_progress shows the hint in the start state", async () => {
    openPage.spaceId = "space-allg";
    fetchMock.mockImplementation(
      async () =>
        new Response(JSON.stringify({ code: "run_in_progress" }), {
          status: 409,
        }),
    );
    renderTaskTab();
    await waitFor(async () =>
      expect((await spaceSelect()).value).toBe("Allgemein"),
    );
    fireEvent.change(await taskInput(), { target: { value: "Aufgabe" } });
    fireEvent.click(startButton());
    expect(
      await screen.findByText(
        "Es läuft bereits eine Aufgabe. Warte, bis sie fertig ist, oder brich sie ab.",
      ),
    ).toBeTruthy();
    expect(await taskInput()).toBeTruthy();
  });

  it("AGENT-AC3: an unreachable service during the start shows state A4 and retry clears it", async () => {
    openPage.spaceId = "space-allg";
    fetchMock.mockImplementation(
      async () => new Response("{}", { status: 503 }),
    );
    renderTaskTab();
    await waitFor(async () =>
      expect((await spaceSelect()).value).toBe("Allgemein"),
    );
    fireEvent.change(await taskInput(), { target: { value: "Aufgabe" } });
    fireEvent.click(startButton());
    expect(await screen.findByText(UNAVAILABLE_TEXT)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    expect(await taskInput()).toBeTruthy();
    expect(screen.queryByText(UNAVAILABLE_TEXT)).toBeNull();
  });
});
