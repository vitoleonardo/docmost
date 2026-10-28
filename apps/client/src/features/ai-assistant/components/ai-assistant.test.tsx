import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
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
import Aside from "@/components/layouts/global/aside.tsx";
import { asideStateAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import AiAssistantPanel from "./ai-assistant-panel.tsx";
import AiAssistantTrigger from "./ai-assistant-trigger.tsx";
import api from "@/lib/api-client";
import PageHeaderMenu from "@/features/page/components/header/page-header-menu.tsx";
import type { AiAssistantStatus } from "@/features/ai-assistant/types/ai-assistant.types.ts";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string) => (deDE as Record<string, string>)[key] ?? key,
  }),
}));

vi.mock("@/lib/api-client", () => ({
  default: { post: vi.fn() },
}));

vi.mock("@/features/page/queries/page-query.ts", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/features/page/queries/page-query.ts")
  >()),
  usePageQuery: () => ({
    data: {
      id: "page-1",
      slugId: "slug-1",
      title: "Seite",
      spaceId: "space-1",
      createdAt: "2026-09-01T08:30:00.000Z",
      updatedAt: "2026-10-01T08:30:00.000Z",
      lastUpdatedBy: { name: "Test User" },
    },
  }),
}));

vi.mock("@/main.tsx", async () => ({
  queryClient: new (await import("@tanstack/react-query")).QueryClient(),
}));

vi.mock("@/ee/page-permission", () => ({ PageShareModal: () => null }));

vi.mock("@/ee/page-verification", () => ({
  PageVerificationMenuItem: () => null,
  PageVerificationModal: () => null,
}));

const statusMock = vi.mocked(api.post);

const UNAVAILABLE_TEXT =
  "Der Assistent ist gerade nicht erreichbar. Das Wiki funktioniert normal weiter.";

function answerWith(status: AiAssistantStatus) {
  statusMock.mockResolvedValueOnce({ data: { status } });
}

function renderAssistant() {
  const store = createStore();
  const client = new QueryClient();
  render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <Provider store={store}>
          <MemoryRouter>
            <AiAssistantTrigger />
            <Aside />
          </MemoryRouter>
        </Provider>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return store;
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
  statusMock.mockReset();
});

describe("ai assistant", () => {
  it("BRIDGE-AC2: shows no trigger while the assistant is disabled", async () => {
    answerWith("disabled");
    renderAssistant();
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("button", { name: "Assistent" })).toBeNull();
  });

  it("BRIDGE-AC2: shows no trigger while the status is still loading", () => {
    statusMock.mockReturnValueOnce(new Promise(() => {}));
    renderAssistant();
    expect(screen.queryByRole("button", { name: "Assistent" })).toBeNull();
  });

  it("BRIDGE-AC5: the trigger opens the assistant in the aside and shows the empty state", async () => {
    statusMock.mockResolvedValue({ data: { status: "available" } });
    const store = renderAssistant();
    fireEvent.click(await screen.findByRole("button", { name: "Assistent" }));
    expect(store.get(asideStateAtom)).toEqual({
      tab: "ai-assistant",
      isAsideOpen: true,
    });
    expect((await screen.findByRole("heading", { level: 2 })).textContent).toBe(
      "Assistent",
    );
    expect(await screen.findByText("Frag das Wiki")).toBeTruthy();
    expect(
      screen.getByText(
        "Antworten stützen sich nur auf Seiten, die du sehen darfst, und nennen ihre Quellen.",
      ),
    ).toBeTruthy();
  });

  it("BRIDGE-AC6: an unavailable assistant shows the notice and a retry button", async () => {
    statusMock.mockResolvedValue({ data: { status: "unavailable" } });
    const store = renderAssistant();
    fireEvent.click(await screen.findByRole("button", { name: "Assistent" }));
    expect(store.get(asideStateAtom).tab).toBe("ai-assistant");
    expect(await screen.findByText(UNAVAILABLE_TEXT)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Erneut versuchen" }),
    ).toBeTruthy();
  });

  it("BRIDGE-AC6: a failed status request counts as unavailable", async () => {
    statusMock.mockRejectedValue(new Error("Network Error"));
    renderAssistant();
    fireEvent.click(await screen.findByRole("button", { name: "Assistent" }));
    expect(await screen.findByText(UNAVAILABLE_TEXT)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Erneut versuchen" }),
    ).toBeTruthy();
  });

  it("BRIDGE-AC7: retry recovers once the assistant is available", async () => {
    answerWith("unavailable");
    renderAssistant();
    fireEvent.click(await screen.findByRole("button", { name: "Assistent" }));
    const retry = await screen.findByRole("button", {
      name: "Erneut versuchen",
    });
    answerWith("available");
    fireEvent.click(retry);
    expect(await screen.findByText("Frag das Wiki")).toBeTruthy();
    expect(screen.queryByText(UNAVAILABLE_TEXT)).toBeNull();
  });

  it("BRIDGE-AC42: retry while still down shows the notice again, one request per click", async () => {
    statusMock.mockResolvedValue({ data: { status: "unavailable" } });
    renderAssistant();
    fireEvent.click(await screen.findByRole("button", { name: "Assistent" }));
    const retry = await screen.findByRole("button", {
      name: "Erneut versuchen",
    });
    expect(statusMock).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);
    await waitFor(() => expect(statusMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(UNAVAILABLE_TEXT)).toBeTruthy();
    await waitFor(() =>
      expect(
        (
          screen.getByRole("button", {
            name: "Erneut versuchen",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
    expect(statusMock).toHaveBeenCalledTimes(2);
  });

  it("BRIDGE-AC42: extra clicks while the retry is running send no further request", async () => {
    answerWith("unavailable");
    renderAssistant();
    fireEvent.click(await screen.findByRole("button", { name: "Assistent" }));
    const retry = await screen.findByRole("button", {
      name: "Erneut versuchen",
    });
    let finish: (value: {
      data: { status: AiAssistantStatus };
    }) => void = () => {};
    statusMock.mockReturnValueOnce(
      new Promise((resolve) => (finish = resolve)),
    );
    fireEvent.click(retry);
    fireEvent.click(retry);
    fireEvent.click(retry);
    expect(statusMock).toHaveBeenCalledTimes(2);
    finish({ data: { status: "unavailable" } });
    expect(await screen.findByText(UNAVAILABLE_TEXT)).toBeTruthy();
  });

  it("BRIDGE-AC5: the trigger sits right before the comments button", async () => {
    statusMock.mockResolvedValue({ data: { status: "available" } });
    const client = new QueryClient();
    render(
      <MantineProvider>
        <QueryClientProvider client={client}>
          <Provider store={createStore()}>
            <MemoryRouter>
              <PageHeaderMenu />
            </MemoryRouter>
          </Provider>
        </QueryClientProvider>
      </MantineProvider>,
    );
    const trigger = await screen.findByRole("button", { name: "Assistent" });
    const comments = screen.getByRole("button", { name: "Kommentare" });
    expect(trigger.nextElementSibling).toBe(comments);
  });
});

const SPACES = [
  { id: "space-it", name: "IT" },
  { id: "space-allg", name: "Allgemein" },
  { id: "space-proj", name: "Projekte" },
];

function mockWiki(status: AiAssistantStatus, spaces = SPACES) {
  statusMock.mockImplementation(async (url: string) =>
    url === "/spaces" ? { data: { items: spaces } } : { data: { status } },
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
    close: () => controller.close(),
  };
}

function renderPanel() {
  const client = new QueryClient();
  render(
    <MantineProvider>
      <QueryClientProvider client={client}>
        <Provider store={createStore()}>
          <MemoryRouter>
            <AiAssistantPanel />
          </MemoryRouter>
        </Provider>
      </QueryClientProvider>
    </MantineProvider>,
  );
}

const fetchMock = vi.fn();

function questionInput() {
  return screen.findByPlaceholderText(
    "Frage stellen …",
  ) as Promise<HTMLTextAreaElement>;
}

function type(input: HTMLTextAreaElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

const FIRST_EXAMPLE = "Wer beantwortet Rückfragen zur Reisekostenabrechnung?";

describe("ai assistant panel: ask", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("ASK-AC1: available panel shows heading, hint and the input placeholder", async () => {
    mockWiki("available");
    renderPanel();
    expect(await screen.findByText("Frag das Wiki")).toBeTruthy();
    expect(
      screen.getByText(
        "Antworten stützen sich nur auf Seiten, die du sehen darfst, und nennen ihre Quellen.",
      ),
    ).toBeTruthy();
    expect(await questionInput()).toBeTruthy();
  });

  it("ASK-AC2: shows both example questions", async () => {
    mockWiki("available");
    renderPanel();
    expect(await screen.findByText(FIRST_EXAMPLE)).toBeTruthy();
    expect(screen.getByText("Wann ist die Kernarbeitszeit?")).toBeTruthy();
  });

  it("ASK-AC3: scope options are sorted with Alle Bereiche selected", async () => {
    mockWiki("available");
    renderPanel();
    const select = (await screen.findByRole("combobox", {
      name: "Bereich",
    })) as HTMLInputElement;
    await waitFor(() =>
      expect(statusMock).toHaveBeenCalledWith("/spaces", expect.anything()),
    );
    expect(select.value).toBe("Alle Bereiche");
    fireEvent.click(select);
    await waitFor(() =>
      expect(
        screen
          .getAllByRole("option", { hidden: true })
          .map((option) => option.textContent),
      ).toEqual([
        "Alle Bereiche",
        "Diese Seite",
        "Allgemein",
        "IT",
        "Projekte",
      ]),
    );
  });

  it("ASK-AC4: clicking an example sends it and shows it as the question", async () => {
    mockWiki("available");
    const stream = controlledStream();
    fetchMock.mockResolvedValue(stream.response);
    renderPanel();
    fireEvent.click(await screen.findByText(FIRST_EXAMPLE));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).question).toBe(
      FIRST_EXAMPLE,
    );
    stream.push({ type: "delta", text: "Frau Meier" });
    expect(await screen.findByText("Frau Meier")).toBeTruthy();
    expect(screen.getByText(FIRST_EXAMPLE)).toBeTruthy();
  });

  it("ASK-AC7: unavailable status disables input and send", async () => {
    mockWiki("unavailable");
    renderPanel();
    expect(await screen.findByText(UNAVAILABLE_TEXT)).toBeTruthy();
    expect((await questionInput()).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Senden" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("ASK-AC10: the button reads Stoppen from send until the answer ends and stops it", async () => {
    mockWiki("available");
    const stream = controlledStream();
    fetchMock.mockResolvedValue(stream.response);
    renderPanel();
    const input = await questionInput();
    type(input, "Frage eins");
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    const stop = await screen.findByRole("button", { name: "Stoppen" });
    expect(screen.queryByRole("button", { name: "Senden" })).toBeNull();
    stream.push({ type: "delta", text: "Teil" });
    await screen.findByText("Teil");
    fireEvent.click(stop);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Stoppen" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "Senden" })).toBeTruthy();
  });

  it("ASK-AC10: the button returns to Senden when the answer ends", async () => {
    mockWiki("available");
    const stream = controlledStream();
    fetchMock.mockResolvedValue(stream.response);
    renderPanel();
    type(await questionInput(), "Frage eins");
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    await screen.findByRole("button", { name: "Stoppen" });
    stream.push({ type: "no_source" });
    stream.close();
    expect(await screen.findByRole("button", { name: "Senden" })).toBeTruthy();
  });

  it("ASK-AC14: shows no Quellen while the answer streams", async () => {
    mockWiki("available");
    const stream = controlledStream();
    fetchMock.mockResolvedValue(stream.response);
    renderPanel();
    type(await questionInput(), "Frage eins");
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    stream.push({ type: "delta", text: "Antwort [1]" });
    await screen.findByText(/Antwort/);
    expect(screen.queryByText(/Quellen/i)).toBeNull();
  });

  it("ASK-AC49: Neue Unterhaltung returns to the empty state", async () => {
    mockWiki("available");
    const stream = controlledStream();
    fetchMock.mockResolvedValue(stream.response);
    renderPanel();
    expect(
      screen.queryByRole("button", { name: "Neue Unterhaltung" }),
    ).toBeNull();
    type(await questionInput(), "Frage eins");
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    stream.push({ type: "delta", text: "Antwort" });
    await screen.findByText("Antwort");
    fireEvent.click(screen.getByRole("button", { name: "Neue Unterhaltung" }));
    expect(await screen.findByText("Frag das Wiki")).toBeTruthy();
    expect(screen.queryByText("Frage eins")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Neue Unterhaltung" }),
    ).toBeNull();
  });

  it("ASK-AC58: empty and whitespace-only input keep send disabled", async () => {
    mockWiki("available");
    renderPanel();
    const input = await questionInput();
    const send = screen.getByRole("button", {
      name: "Senden",
    }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    type(input, "   \n ");
    expect(send.disabled).toBe(true);
    type(input, "Hallo");
    expect(send.disabled).toBe(false);
  });

  it("ASK-AC59: 2,001 characters disable send and show the limit text", async () => {
    mockWiki("available");
    renderPanel();
    const input = await questionInput();
    type(input, "a".repeat(2001));
    expect(screen.getByText("Höchstens 2.000 Zeichen")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Senden" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ASK-AC59: 2,001 characters with surrounding whitespace trimmed to 2,000 are allowed", async () => {
    mockWiki("available");
    renderPanel();
    type(await questionInput(), ` ${"a".repeat(2000)} `);
    expect(screen.queryByText("Höchstens 2.000 Zeichen")).toBeNull();
    expect(
      (screen.getByRole("button", { name: "Senden" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("ASK-AC60: exactly 2,000 characters are sent", async () => {
    mockWiki("available");
    const stream = controlledStream();
    fetchMock.mockResolvedValue(stream.response);
    renderPanel();
    type(await questionInput(), "a".repeat(2000));
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).question).toHaveLength(
      2000,
    );
    stream.push({ type: "delta", text: "Erster Teil" });
    expect(await screen.findByText("Erster Teil")).toBeTruthy();
  });

  it("ASK-AC58: Enter sends, Shift+Enter does not, and the input is cleared", async () => {
    mockWiki("available");
    fetchMock.mockResolvedValue(controlledStream().response);
    renderPanel();
    const input = await questionInput();
    type(input, "Hallo");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(input.value).toBe("");
  });

  it("ASK-AC66: assistant_unavailable shows state A4 with input and send disabled until retry succeeds", async () => {
    mockWiki("available");
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    renderPanel();
    type(await questionInput(), "Frage eins");
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    expect(await screen.findByText(UNAVAILABLE_TEXT)).toBeTruthy();
    expect(screen.queryByText("Frage eins")).toBeNull();
    expect((await questionInput()).disabled).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Senden" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Erneut versuchen" }));
    await waitFor(() => expect(screen.queryByText(UNAVAILABLE_TEXT)).toBeNull());
    expect((await questionInput()).disabled).toBe(false);
    expect(await screen.findByText("Frag das Wiki")).toBeTruthy();
  });
});
