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
} from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import deDE from "../../../../public/locales/de-DE/translation.json";
import ProposalDialog from "./proposal-dialog.tsx";
import {
  AgentProposalError,
  applyAgentProposal,
  discardAgentProposal,
  getAgentProposal,
} from "@/features/ai-assistant/services/ai-assistant-service.ts";
import type {
  AgentProposalStatus,
  IAgentProposalView,
  IAgentRunProposal,
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

vi.mock(
  "@/features/ai-assistant/services/ai-assistant-service.ts",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/features/ai-assistant/services/ai-assistant-service.ts")
    >()),
    getAgentProposal: vi.fn(),
    applyAgentProposal: vi.fn(),
    discardAgentProposal: vi.fn(),
  }),
);

vi.mock("@mantine/notifications", () => ({
  notifications: { show: vi.fn() },
}));

const getMock = vi.mocked(getAgentProposal);
const applyMock = vi.mocked(applyAgentProposal);
const discardMock = vi.mocked(discardAgentProposal);
const showMock = vi.mocked(notifications.show);

const UNREACHABLE =
  "Der Assistent ist gerade nicht erreichbar. Das Wiki funktioniert normal weiter.";
const STALE =
  "Die Seite wurde nach diesem Vorschlag geändert. Der Vorschlag kann nicht mehr übernommen werden.";
const WRITE_FAILED =
  "Die Änderung konnte nicht übernommen werden. Versuche es noch einmal.";

const SUMMARY: IAgentRunProposal = {
  id: "proposal-1",
  pageId: "page-1",
  pageTitle: "Reisekosten Richtlinie 2022",
  reason: "Kilometerpauschale ist veraltet",
  added: 1,
  removed: 1,
  status: "open",
};

function view(overrides: Partial<IAgentProposalView> = {}): IAgentProposalView {
  return {
    id: "proposal-1",
    runId: "run-1",
    pageId: "page-1",
    pageTitle: "Reisekosten Richtlinie 2022",
    reason: "Kilometerpauschale ist veraltet",
    status: "open",
    canEdit: true,
    added: 1,
    removed: 1,
    changes: [
      {
        heading: "Kilometerpauschale",
        ops: [
          { op: "keep", text: "Die Pauschale beträgt" },
          { op: "remove", text: "0,30" },
          { op: "add", text: "0,38" },
          { op: "keep", text: "€ pro Kilometer" },
        ],
      },
    ],
    ...overrides,
  };
}

const handlers = {
  onClose: vi.fn(),
  onStatus: vi.fn<(status: AgentProposalStatus) => void>(),
  onNewProposal: vi.fn(),
};

function renderDialog(proposal: IAgentRunProposal = SUMMARY) {
  render(
    <MantineProvider>
      <ProposalDialog opened proposal={proposal} {...handlers} />
    </MantineProvider>,
  );
}

function button(name: string) {
  return screen.getByRole("button", { name }) as HTMLButtonElement;
}

async function openWith(v: IAgentProposalView) {
  getMock.mockResolvedValue(v);
  renderDialog({
    ...SUMMARY,
    status: v.status,
    pageTitle: v.pageTitle,
    reason: v.reason,
  });
  await screen.findByText(/Begründung:|nicht mehr|nicht erreichbar/);
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
  getMock.mockReset();
  applyMock.mockReset();
  discardMock.mockReset();
  showMock.mockReset();
  handlers.onClose.mockReset();
  handlers.onStatus.mockReset();
  handlers.onNewProposal.mockReset();
});

afterEach(cleanup);

describe("proposal dialog: open proposal", () => {
  it("AGENT-AC71: shows title, reason, save hint and both buttons", async () => {
    await openWith(view());
    expect(
      screen.getByText("Vorschlag: Reisekosten Richtlinie 2022"),
    ).toBeTruthy();
    expect(
      screen.getByText("Begründung: Kilometerpauschale ist veraltet"),
    ).toBeTruthy();
    expect(
      screen.getByText("Wird als deine Änderung gespeichert."),
    ).toBeTruthy();
    expect(button("Verwerfen").disabled).toBe(false);
    expect(button("Übernehmen").disabled).toBe(false);
    expect(getMock).toHaveBeenCalledWith("proposal-1");
  });

  it("AGENT-AC72: removed words are struck, added highlighted, kept plain", async () => {
    await openWith(view());
    const removed = screen.getByText("0,30");
    const added = screen.getByText("0,38");
    expect(removed.tagName).toBe("DEL");
    expect(added.tagName).toBe("INS");
    const kept = screen.getByText(/€ pro Kilometer/);
    expect(kept.closest("del, ins")).toBeNull();
  });

  it("AGENT-AC73: the heading is shown above the change", async () => {
    await openWith(view());
    const heading = screen.getByText("Kilometerpauschale");
    const change = screen.getByText("0,30");
    expect(
      heading.compareDocumentPosition(change) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("AGENT-AC73: a change without a heading shows none", async () => {
    await openWith(
      view({ changes: [{ heading: null, ops: [{ op: "add", text: "neu" }] }] }),
    );
    expect(screen.queryByText("Kilometerpauschale")).toBeNull();
  });

  it("AGENT-AC53: reason, title and new text are shown literally", async () => {
    await openWith(
      view({
        reason: "<b>x</b>",
        pageTitle: "<b>x</b>",
        changes: [{ heading: null, ops: [{ op: "add", text: "**x**" }] }],
      }),
    );
    const reason = screen.getByText("Begründung: <b>x</b>");
    const title = screen.getByText("Vorschlag: <b>x</b>");
    const added = screen.getByText("**x**");
    expect(reason.querySelector("b")).toBeNull();
    expect(title.querySelector("b")).toBeNull();
    expect(added.querySelector("strong")).toBeNull();
  });

  it("AGENT-AC83: Verwerfen closes, marks discarded and never applies", async () => {
    discardMock.mockResolvedValue(undefined);
    await openWith(view());
    fireEvent.click(button("Verwerfen"));
    await waitFor(() => expect(handlers.onClose).toHaveBeenCalled());
    expect(discardMock).toHaveBeenCalledWith("proposal-1");
    expect(handlers.onStatus).toHaveBeenCalledWith("discarded");
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("AGENT-AC77: Übernehmen closes, marks applied and notifies", async () => {
    applyMock.mockResolvedValue(undefined);
    await openWith(view());
    fireEvent.click(button("Übernehmen"));
    await waitFor(() => expect(handlers.onClose).toHaveBeenCalled());
    expect(applyMock).toHaveBeenCalledWith("proposal-1");
    expect(handlers.onStatus).toHaveBeenCalledWith("applied");
    expect(showMock).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Änderung übernommen." }),
    );
  });

  it("AGENT-AC86: a failed write shows the text and keeps the proposal open", async () => {
    applyMock.mockRejectedValue(new AgentProposalError("write_failed"));
    await openWith(view());
    fireEvent.click(button("Übernehmen"));
    expect(await screen.findByText(WRITE_FAILED)).toBeTruthy();
    expect(button("Übernehmen").disabled).toBe(false);
    expect(handlers.onClose).not.toHaveBeenCalled();
    expect(handlers.onStatus).not.toHaveBeenCalled();
  });

  it("AGENT-AC87: a retry after a failed write applies", async () => {
    applyMock
      .mockRejectedValueOnce(new AgentProposalError("write_failed"))
      .mockResolvedValueOnce(undefined);
    await openWith(view());
    fireEvent.click(button("Übernehmen"));
    await screen.findByText(WRITE_FAILED);
    fireEvent.click(button("Übernehmen"));
    await waitFor(() =>
      expect(handlers.onStatus).toHaveBeenCalledWith("applied"),
    );
    expect(applyMock).toHaveBeenCalledTimes(2);
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it("AGENT-AC88: an unreachable service on apply shows the unreachable text", async () => {
    applyMock.mockRejectedValue(new AgentProposalError("unreachable"));
    await openWith(view());
    fireEvent.click(button("Übernehmen"));
    expect(await screen.findByText(UNREACHABLE)).toBeTruthy();
    expect(button("Schließen")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Übernehmen" })).toBeNull();
  });

  it("AGENT-AC89: a stale error on apply shows G5 and marks the card stale", async () => {
    applyMock.mockRejectedValue(new AgentProposalError("stale"));
    await openWith(view());
    fireEvent.click(button("Übernehmen"));
    expect(await screen.findByText(STALE)).toBeTruthy();
    expect(button("Schließen")).toBeTruthy();
    expect(button("Neuen Vorschlag erstellen")).toBeTruthy();
    expect(handlers.onStatus).toHaveBeenCalledWith("stale");
  });

  it("AGENT-AC89: a not_open error on apply reloads the view", async () => {
    applyMock.mockRejectedValue(new AgentProposalError("not_open"));
    await openWith(view());
    getMock.mockResolvedValue(view({ status: "applied" }));
    fireEvent.click(button("Übernehmen"));
    await waitFor(() => expect(getMock).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Übernommen")).toBeTruthy();
  });
});

describe("proposal dialog: other states", () => {
  it("AGENT-AC89: a stale view shows G5, marks the card and offers a new proposal", async () => {
    getMock.mockResolvedValue(view({ status: "stale" }));
    renderDialog();
    expect(await screen.findByText(STALE)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Übernehmen" })).toBeNull();
    expect(handlers.onStatus).toHaveBeenCalledWith("stale");
    fireEvent.click(button("Neuen Vorschlag erstellen"));
    expect(handlers.onNewProposal).toHaveBeenCalled();
    expect(handlers.onClose).toHaveBeenCalled();
  });

  it("AGENT-AC74: an applied proposal shows diff, badge and only Schließen", async () => {
    await openWith(view({ status: "applied" }));
    expect(screen.getByText("0,38").tagName).toBe("INS");
    expect(screen.getByText("Übernommen")).toBeTruthy();
    expect(button("Schließen")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Übernehmen" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Verwerfen" })).toBeNull();
  });

  it("AGENT-AC74: a discarded proposal shows the badge Verworfen", async () => {
    await openWith(view({ status: "discarded" }));
    expect(screen.getByText("Verworfen")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Verwerfen" })).toBeNull();
  });

  it("AGENT-AC75: an unreachable service on opening shows the text and Schließen", async () => {
    getMock.mockRejectedValue(new AgentProposalError("unreachable"));
    renderDialog();
    expect(await screen.findByText(UNREACHABLE)).toBeTruthy();
    expect(button("Schließen")).toBeTruthy();
  });

  it("AGENT-AC97: a reader sees the diff, the hint and a disabled Übernehmen", async () => {
    await openWith(view({ canEdit: false }));
    expect(screen.getByText("0,30").tagName).toBe("DEL");
    expect(
      screen.getByText(
        "Du hast nur Leserechte für diese Seite und kannst den Vorschlag nicht übernehmen.",
      ),
    ).toBeTruthy();
    expect(button("Übernehmen").disabled).toBe(true);
    expect(button("Verwerfen").disabled).toBe(false);
  });

  it("AGENT-AC99: a gone page shows the text, Schließen and no proposal text", async () => {
    getMock.mockRejectedValue(new AgentProposalError("page_gone"));
    renderDialog();
    expect(
      await screen.findByText("Diese Seite ist nicht mehr verfügbar."),
    ).toBeTruthy();
    expect(button("Schließen")).toBeTruthy();
    expect(screen.queryByText(/Begründung/)).toBeNull();
  });

  it("AGENT-AC99: a page that vanishes on apply shows the same text", async () => {
    applyMock.mockRejectedValue(new AgentProposalError("page_gone"));
    await openWith(view());
    fireEvent.click(button("Übernehmen"));
    expect(
      await screen.findByText("Diese Seite ist nicht mehr verfügbar."),
    ).toBeTruthy();
    expect(screen.queryByText(/Begründung/)).toBeNull();
  });

  it("AGENT-AC71: shows a loading state before the view arrives", async () => {
    getMock.mockReturnValue(new Promise(() => {}));
    renderDialog();
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Übernehmen" })).toBeNull();
  });
});
