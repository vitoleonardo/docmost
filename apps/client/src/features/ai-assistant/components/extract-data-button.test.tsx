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
} from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider } from "jotai";
import { Editor } from "@tiptap/core";
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
import AttachmentView from "@/features/editor/components/attachment/attachment-view.tsx";
import PdfMenu from "@/features/editor/components/pdf/pdf-menu.tsx";
import { currentUserAtom } from "@/features/user/atoms/current-user-atom.ts";
import type { ICurrentUser } from "@/features/user/types/user.types.ts";
import api from "@/lib/api-client";
import { extractContract } from "@/features/ai-assistant/services/ai-assistant-service.ts";
import type { AiAssistantStatus } from "@/features/ai-assistant/types/ai-assistant.types.ts";

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

vi.mock("@tiptap/react/menus", () => ({
  BubbleMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
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
const FILE_NAME = "Vertrag.pdf";
const ATTACHMENT_ID = "att-1";

let editor: Editor;

function makeEditor() {
  editor = new Editor({
    extensions: [
      StarterKit.configure({ link: false }),
      Attachment,
      TiptapPdf,
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
    content: {
      type: "doc",
      content: [
        {
          type: "attachment",
          attrs: {
            attachmentId: ATTACHMENT_ID,
            name: FILE_NAME,
            url: "/x",
            mime: "application/pdf",
          },
        },
      ],
    },
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
  return render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <Provider store={store}>{ui}</Provider>
      </QueryClientProvider>
    </MantineProvider>,
  );
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

const findButton = () => screen.findByRole("button", { name: BUTTON_NAME });
const queryButton = () => screen.queryByRole("button", { name: BUTTON_NAME });

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
    expect(
      await screen.findByText(`Daten extrahieren: ${FILE_NAME}`),
    ).toBeTruthy();
    expect(extractMock).toHaveBeenCalledWith(
      "page-1",
      ATTACHMENT_ID,
      expect.anything(),
    );
  });

  it("EXTRACT-AC1: inserting writes the reviewer name and today's date and closes the dialog", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 9, 29, 12) });
    answerWith("available");
    extractMock.mockResolvedValue({
      outcome: "extracted",
      fields: (
        ["parties", "term", "noticePeriod", "value", "renewal"] as const
      ).map((key) => ({
        key,
        value: `Wert ${key}`,
        quote: `Zitat ${key}`,
        pdfPage: 1,
      })),
    });
    renderButton();
    fireEvent.click(await findButton());
    fireEvent.click(
      await screen.findByRole("button", { name: "Als Tabelle einfügen" }),
    );
    await waitFor(() =>
      expect(screen.queryByText(`Daten extrahieren: ${FILE_NAME}`)).toBeNull(),
    );
    const doc = editor.getJSON().content ?? [];
    expect(doc.slice(0, 4).map((node) => node.type)).toEqual([
      "attachment",
      "heading",
      "paragraph",
      "table",
    ]);
    expect(doc[2].content).toEqual([
      {
        type: "text",
        text: `Aus ${FILE_NAME}, geprüft von Gerda Fischer am 29.10.2026.`,
      },
    ]);
  });
});

describe("extract data wiring", () => {
  const attachmentProps = (attrs: Record<string, unknown>) =>
    ({
      editor,
      node: { attrs: { url: "/x", size: 10, ...attrs }, nodeSize: 1 },
      getPos: () => 0,
      selected: true,
    }) as unknown as React.ComponentProps<typeof AttachmentView>;

  it("EXTRACT-AC1: an attachment with content type application/pdf offers the button", async () => {
    answerWith("available");
    renderInProviders(
      <AttachmentView
        {...attachmentProps({
          attachmentId: ATTACHMENT_ID,
          name: FILE_NAME,
          mime: "application/pdf",
        })}
      />,
    );
    expect(await findButton()).toBeTruthy();
  });

  it("EXTRACT-AC6: a text/plain attachment named x.pdf offers no button", async () => {
    answerWith("available");
    renderInProviders(
      <AttachmentView
        {...attachmentProps({
          attachmentId: ATTACHMENT_ID,
          name: "x.pdf",
          mime: "text/plain",
        })}
      />,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(
      screen.queryByRole("button", { name: "Als PDF einbetten" }),
    ).toBeTruthy();
    expect(queryButton()).toBeNull();
  });

  it("EXTRACT-AC2: the menu of a selected embedded PDF offers the button", async () => {
    answerWith("available");
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "pdf",
          attrs: { attachmentId: ATTACHMENT_ID, name: FILE_NAME, src: "/x" },
        },
      ],
    });
    editor.commands.setNodeSelection(0);
    renderInProviders(<PdfMenu editor={editor} />);
    expect(await findButton()).toBeTruthy();
  });
});
