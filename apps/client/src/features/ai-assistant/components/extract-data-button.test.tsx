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
import { Editor, EditorContent, JSONContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import {
  Attachment,
  Callout,
  CustomTable,
  Details,
  DetailsContent,
  DetailsSummary,
  MathBlock,
  Subpages,
  TableCell,
  TableHeader,
  TableRow,
  TiptapAudio,
  TiptapImage,
  TiptapPdf,
  TiptapVideo,
} from "@docmost/editor-ext";
import deDE from "../../../../public/locales/de-DE/translation.json";
import ExtractDataButton from "./extract-data-button.tsx";
import ExtractionDialogHost from "./extraction-dialog-host.tsx";
import AttachmentView from "@/features/editor/components/attachment/attachment-view.tsx";
import PdfView from "@/features/editor/components/pdf/pdf-view.tsx";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom.ts";
import type { ICurrentUser } from "@/features/user/types/user.types.ts";
import api from "@/lib/api-client";
import { extractContract } from "@/features/ai-assistant/services/ai-assistant-service.ts";
import { extractionRequestAtom } from "@/features/ai-assistant/atoms/extraction-atom.ts";
import type {
  AiAssistantStatus,
  ExtractResult,
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

vi.mock("@/lib/api-client", () => ({ default: { post: vi.fn() } }));

vi.mock(
  "@/features/ai-assistant/services/ai-assistant-service.ts",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@/features/ai-assistant/services/ai-assistant-service.ts")
    >()),
    extractContract: vi.fn(),
  }),
);

const statusMock = vi.mocked(api.post);
const extractMock = vi.mocked(extractContract);

const BUTTON_NAME = "Daten extrahieren";
const INSERT_NAME = "Als Tabelle einfügen";
const FILE_NAME = "Vertrag.pdf";
const DIALOG_TITLE = `Daten extrahieren: ${FILE_NAME}`;
const ATTACHMENT_ID = "att-1";

const EXTRACTED: ExtractResult = {
  outcome: "extracted",
  fields: (
    ["parties", "term", "noticePeriod", "value", "renewal"] as const
  ).map((key) => ({
    key,
    value: `Wert ${key}`,
    quote: `Zitat ${key}`,
    pdfPage: 1,
  })),
};

const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const pdfAttachment = (mime = "application/pdf", name = FILE_NAME) => ({
  type: "attachment",
  attrs: {
    attachmentId: ATTACHMENT_ID,
    name,
    url: "/api/files/att-1/vertrag.pdf",
    size: 10,
    mime,
  },
});

const embeddedPdf = {
  type: "pdf",
  attrs: {
    attachmentId: ATTACHMENT_ID,
    name: FILE_NAME,
    src: "/api/files/att-1/vertrag.pdf",
  },
};

let editor: Editor;

function makeEditor(content: JSONContent[] = [pdfAttachment()]) {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Attachment.configure({ view: AttachmentView }),
      TiptapPdf.configure({ view: PdfView }),
      CustomTable,
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem,
      Callout,
      TiptapImage,
      TiptapVideo,
      TiptapAudio,
      Subpages,
      MathBlock,
      Details,
      DetailsContent,
      DetailsSummary,
    ],
    content: { type: "doc", content },
  });
  Object.assign(editor.storage, { pageId: "page-1" });
  return editor;
}

function answerWith(status: AiAssistantStatus) {
  statusMock.mockResolvedValue({ data: { status } });
}

function renderInProviders(ui: React.ReactNode) {
  const store = createStore();
  store.set(currentUserAtom, {
    user: { id: "u1", name: "Gerda Fischer" },
    workspace: { id: "w1" },
  } as ICurrentUser);
  const rendered = render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <Provider store={store}>
          {ui}
          <ExtractionDialogHost />
        </Provider>
      </QueryClientProvider>
    </MantineProvider>,
  );
  return { ...rendered, store };
}

function renderButton() {
  return renderInProviders(
    <ExtractDataButton
      editor={editor}
      attachmentId={ATTACHMENT_ID}
      fileName={FILE_NAME}
    />,
  );
}

function renderPage(content?: JSONContent[]) {
  makeEditor(content);
  return renderInProviders(<EditorContent editor={editor} />);
}

const findButton = () => screen.findByRole("button", { name: BUTTON_NAME });
const queryButton = () => screen.queryByRole("button", { name: BUTTON_NAME });

async function attachmentCard(name = FILE_NAME): Promise<HTMLElement> {
  const card = (await screen.findByText(name)).closest<HTMLElement>(
    ".mantine-Paper-root",
  );
  if (!card) throw new Error("attachment card not rendered");
  return card;
}

function attachmentPosition(): number {
  let position = -1;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === "attachment") position = pos;
    return position < 0;
  });
  return position;
}

const topLevelTypes = () =>
  (editor.getJSON().content ?? []).map((node) => node.type);

async function openReviewFromHoveredAttachment() {
  fireEvent.mouseEnter(await attachmentCard());
  fireEvent.click(await findButton());
  return screen.findByRole("button", { name: INSERT_NAME });
}

beforeAll(() => {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as typeof window.matchMedia;
  window.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { addEventListener() {}, removeEventListener() {} },
  });
});

beforeEach(() => {
  statusMock.mockReset();
  extractMock.mockReset();
  extractMock.mockReturnValue(new Promise(() => {}));
  makeEditor();
});

afterEach(() => {
  cleanup();
  editor.destroy();
  vi.useRealTimers();
});

describe("extract data button", () => {
  it("EXTRACT-AC1: shows the button when the assistant is available and the editor is editable", async () => {
    answerWith("available");
    renderButton();
    expect(await findButton()).toBeTruthy();
  });

  it("EXTRACT-AC3: shows no button for a viewer whose editor is not editable", async () => {
    answerWith("available");
    editor.setEditable(false);
    renderButton();
    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    await act(async () => {});
    expect(queryButton()).toBeNull();
  });

  it("EXTRACT-AC4: the button disappears when the page switches to read mode", async () => {
    answerWith("available");
    renderButton();
    await findButton();
    act(() => editor.setEditable(false));
    await waitFor(() => expect(queryButton()).toBeNull());
    act(() => editor.setEditable(true));
    expect(await findButton()).toBeTruthy();
  });

  it.each(["unavailable", "disabled"] as const)(
    "EXTRACT-AC5: shows no button while the assistant is %s",
    async (status) => {
      answerWith(status);
      renderButton();
      await waitFor(() => expect(statusMock).toHaveBeenCalled());
      await act(async () => {});
      expect(queryButton()).toBeNull();
    },
  );

  it("EXTRACT-AC5: shows no button while the status is still loading", () => {
    statusMock.mockReturnValue(new Promise(() => {}));
    renderButton();
    expect(queryButton()).toBeNull();
  });

  it("EXTRACT-AC1: a click opens the dialog titled with the file name", async () => {
    answerWith("available");
    renderButton();
    fireEvent.click(await findButton());
    expect(await screen.findByText(DIALOG_TITLE)).toBeTruthy();
    expect(extractMock).toHaveBeenCalledWith(
      "page-1",
      ATTACHMENT_ID,
      expect.anything(),
    );
  });
});

describe("extract data in the page editor", () => {
  it("EXTRACT-AC1: hovering a PDF attachment shows the button in its toolbar", async () => {
    answerWith("available");
    renderPage();
    fireEvent.mouseEnter(await attachmentCard());
    expect(await findButton()).toBeTruthy();
  });

  it("EXTRACT-AC6: a text/plain attachment named x.pdf offers no button", async () => {
    answerWith("available");
    renderPage([pdfAttachment("text/plain", "x.pdf")]);
    fireEvent.mouseEnter(await attachmentCard("x.pdf"));
    expect(
      await screen.findByRole("button", { name: "Als PDF einbetten" }),
    ).toBeTruthy();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(queryButton()).toBeNull();
  });

  it("EXTRACT-AC2: a selected embedded PDF shows the button in its menu next to its other actions", async () => {
    answerWith("available");
    renderPage([embeddedPdf]);
    act(() => {
      editor.commands.setNodeSelection(0);
    });
    const button = await findButton();
    const menu =
      button.closest<HTMLElement>(
        "div:has(> * [aria-label='Löschen'], > [aria-label='Löschen'])",
      ) ?? button.parentElement!;
    expect(
      within(menu.parentElement ?? menu).getByRole("button", {
        name: "In Anhang umwandeln",
      }),
    ).toBeTruthy();
  });

  it("EXTRACT-AC2: the embedded PDF shows no button while the assistant is unavailable", async () => {
    answerWith("unavailable");
    renderPage([embeddedPdf]);
    await waitFor(() => expect(statusMock).toHaveBeenCalled());
    await act(async () => {});
    expect(
      await screen.findByRole("button", { name: "In Anhang umwandeln" }),
    ).toBeTruthy();
    expect(queryButton()).toBeNull();
  });

  it("EXTRACT-AC21: inserting writes the reviewer name and today's date directly after the attachment and closes the dialog", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 29, 12) });
    answerWith("available");
    extractMock.mockResolvedValue(EXTRACTED);
    renderPage([pdfAttachment(), paragraph("Schluss")]);
    fireEvent.click(await openReviewFromHoveredAttachment());
    await waitFor(() => expect(screen.queryByText(DIALOG_TITLE)).toBeNull());
    expect(topLevelTypes()).toEqual([
      "attachment",
      "heading",
      "paragraph",
      "table",
      "paragraph",
    ]);
    expect(editor.getJSON().content?.[2].content).toEqual([
      {
        type: "text",
        text: `Aus ${FILE_NAME}, geprüft von Gerda Fischer am 29.10.2026.`,
      },
    ]);
  });

  it("EXTRACT-AC22: inserting from the embedded PDF's menu puts the table directly after it", async () => {
    answerWith("available");
    extractMock.mockResolvedValue(EXTRACTED);
    renderPage([embeddedPdf, paragraph("Schluss")]);
    fireEvent.click(await findButton());
    fireEvent.click(await screen.findByRole("button", { name: INSERT_NAME }));
    await waitFor(() => expect(screen.queryByText(DIALOG_TITLE)).toBeNull());
    expect(topLevelTypes()).toEqual([
      "pdf",
      "heading",
      "paragraph",
      "table",
      "paragraph",
    ]);
  });

  it("EXTRACT-AC21: the review stays open when the pointer leaves the attachment", async () => {
    answerWith("available");
    extractMock.mockResolvedValue(EXTRACTED);
    renderPage([pdfAttachment(), paragraph("Schluss")]);
    await openReviewFromHoveredAttachment();
    fireEvent.mouseLeave(await attachmentCard());
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    });
    await waitFor(() => expect(queryButton()).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: INSERT_NAME }));
    await waitFor(() => expect(screen.queryByText(DIALOG_TITLE)).toBeNull());
    expect(topLevelTypes().slice(0, 2)).toEqual(["attachment", "heading"]);
  });

  it("EXTRACT-AC30: the review stays with Als Tabelle einfügen disabled when the editor stops being editable", async () => {
    answerWith("available");
    extractMock.mockResolvedValue(EXTRACTED);
    renderPage();
    await openReviewFromHoveredAttachment();
    act(() => editor.setEditable(false));
    await waitFor(() =>
      expect(
        screen
          .getByRole("button", { name: INSERT_NAME })
          .hasAttribute("disabled"),
      ).toBe(true),
    );
    expect(screen.getByText(DIALOG_TITLE)).toBeTruthy();
  });

  it("EXTRACT-AC29: with the attachment removed during the review, inserting appends the table at the end of the page", async () => {
    answerWith("available");
    extractMock.mockResolvedValue(EXTRACTED);
    renderPage([paragraph("Anfang"), pdfAttachment(), paragraph("Schluss")]);
    await openReviewFromHoveredAttachment();
    act(() => {
      const from = attachmentPosition();
      editor.commands.deleteRange({
        from,
        to: from + editor.state.doc.nodeAt(from)!.nodeSize,
      });
    });
    expect(topLevelTypes()).toEqual(["paragraph", "paragraph"]);
    await waitFor(() => expect(screen.queryByText(FILE_NAME)).toBeNull());
    expect(screen.getByText(DIALOG_TITLE)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: INSERT_NAME }));
    await waitFor(() => expect(screen.queryByText(DIALOG_TITLE)).toBeNull());
    const types = topLevelTypes();
    expect(types.slice(0, 5)).toEqual([
      "paragraph",
      "paragraph",
      "heading",
      "paragraph",
      "table",
    ]);
    const afterTable = editor.state.doc.content.content.slice(5);
    expect(
      afterTable.map((node) => [node.type.name, node.textContent]),
    ).toEqual(afterTable.map(() => ["paragraph", ""]));
  });
});

describe("extraction dialog host", () => {
  const OTHER_FILE = "Nachtrag.pdf";

  const requestFor = (attachmentId: string, fileName: string) => ({
    editor,
    pageId: "page-1",
    attachmentId,
    fileName,
  });

  const signalOfCall = (call: number) => {
    const signal = extractMock.mock.calls[call][2];
    if (!signal) throw new Error("extraction started without a signal");
    return signal;
  };

  it("EXTRACT-AC21: unmounting the host with a review open clears the request and aborts it", async () => {
    answerWith("available");
    extractMock.mockResolvedValue(EXTRACTED);
    const { store, unmount } = renderPage();
    await openReviewFromHoveredAttachment();
    const signal = signalOfCall(0);

    unmount();

    expect(store.get(extractionRequestAtom)).toBeNull();
    expect(signal.aborted).toBe(true);
  });

  it("EXTRACT-AC7: replacing the request while the review is open shows the new file's extraction", async () => {
    answerWith("available");
    extractMock.mockResolvedValueOnce(EXTRACTED);
    const { store } = renderButton();
    act(() =>
      store.set(extractionRequestAtom, requestFor(ATTACHMENT_ID, FILE_NAME)),
    );
    await screen.findByRole("button", { name: INSERT_NAME });

    act(() =>
      store.set(extractionRequestAtom, requestFor("att-2", OTHER_FILE)),
    );

    expect(
      await screen.findByText(`Daten extrahieren: ${OTHER_FILE}`),
    ).toBeTruthy();
    expect(screen.getByText(`Lese ${OTHER_FILE} …`)).toBeTruthy();
    expect(screen.queryByRole("button", { name: INSERT_NAME })).toBeNull();
    expect(screen.queryByDisplayValue("Wert parties")).toBeNull();
    expect(extractMock).toHaveBeenLastCalledWith(
      "page-1",
      "att-2",
      expect.anything(),
    );
    expect(signalOfCall(0).aborted).toBe(true);
  });
});
