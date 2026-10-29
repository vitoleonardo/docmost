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
import deDE from "../../../../public/locales/de-DE/translation.json";
import ExtractionDialog from "./extraction-dialog.tsx";
import {
  extractContract,
  ExtractRequestError,
} from "@/features/ai-assistant/services/ai-assistant-service.ts";
import type {
  ExtractedFieldKey,
  ExtractResult,
  IExtractedField,
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
    extractContract: vi.fn(),
  }),
);

const extractMock = vi.mocked(extractContract);

const FILE_NAME = "Vertrag.pdf";
const LIMITS =
  "Extrahiert werden Dateien bis 10 Seiten, 10 MB und 30.000 Zeichen Text.";

const found = (
  key: ExtractedFieldKey,
  value: string,
  pdfPage = 2,
): IExtractedField => ({ key, value, quote: `Zitat ${key}`, pdfPage });

const missing = (key: ExtractedFieldKey): IExtractedField => ({
  key,
  value: null,
  quote: null,
  pdfPage: null,
});

const ALL_FOUND: IExtractedField[] = [
  found("parties", "Acme GmbH und Beta AG", 1),
  found("term", "24 Monate", 2),
  found("noticePeriod", "3 Monate", 3),
  found("value", "1.200.000,00 EUR", 4),
  found("renewal", "12 Monate", 5),
];

const ONE_MISSING: IExtractedField[] = [
  ...ALL_FOUND.slice(0, 4),
  missing("renewal"),
];

const THREE_MISSING: IExtractedField[] = [
  ALL_FOUND[0],
  ALL_FOUND[1],
  missing("noticePeriod"),
  missing("value"),
  missing("renewal"),
];

const extracted = (fields: IExtractedField[]): ExtractResult => ({
  outcome: "extracted",
  fields,
});

const refused = (
  reason: Extract<ExtractResult, { outcome: "refused" }>["reason"],
  counts: Partial<{
    pageCount: number;
    fileSize: number;
    characterCount: number;
  }> = {},
): ExtractResult => ({
  outcome: "refused",
  reason,
  pageCount: counts.pageCount ?? null,
  fileSize: counts.fileSize ?? null,
  characterCount: counts.characterCount ?? null,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof ExtractionDialog>> = {},
) {
  const props = {
    opened: true,
    fileName: FILE_NAME,
    pageId: "page-1",
    attachmentId: "att-1",
    editable: true,
    onInsert: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(
    <MantineProvider>
      <ExtractionDialog {...props} />
    </MantineProvider>,
  );
  return props;
}

async function renderWith(result: ExtractResult | Error) {
  if (result instanceof Error) extractMock.mockRejectedValueOnce(result);
  else extractMock.mockResolvedValueOnce(result);
  return renderDialog();
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
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { addEventListener() {}, removeEventListener() {} },
  });
});

beforeEach(() => {
  extractMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("extraction dialog loading", () => {
  it("EXTRACT-AC7: shows the title, the reading text and Abbrechen while the service works", async () => {
    extractMock.mockReturnValueOnce(new Promise(() => {}));
    renderDialog();

    expect(
      await screen.findByText("Daten extrahieren: Vertrag.pdf"),
    ).toBeTruthy();
    expect(screen.getByText("Lese Vertrag.pdf …")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Abbrechen" })).toBeTruthy();
    expect(extractMock).toHaveBeenCalledWith(
      "page-1",
      "att-1",
      expect.any(AbortSignal),
    );
  });

  it("EXTRACT-AC8: Abbrechen aborts the request, closes and ignores a late answer", async () => {
    const pending = deferred<ExtractResult>();
    extractMock.mockReturnValueOnce(pending.promise);
    const props = renderDialog();
    const signal = extractMock.mock.calls[0][2];

    fireEvent.click(await screen.findByRole("button", { name: "Abbrechen" }));
    expect(signal.aborted).toBe(true);
    expect(props.onClose).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve(extracted(ALL_FOUND)));
    expect(props.onInsert).not.toHaveBeenCalled();
    expect(screen.queryByText("Schema: Vertrag")).toBeNull();
  });

  it("EXTRACT-AC8: an aborted request that rejects shows no error", async () => {
    const pending = deferred<ExtractResult>();
    extractMock.mockReturnValueOnce(pending.promise);
    renderDialog();

    fireEvent.click(await screen.findByRole("button", { name: "Abbrechen" }));
    await act(async () =>
      pending.reject(new ExtractRequestError("unreachable")),
    );

    expect(screen.queryByText(/nicht erreichbar/)).toBeNull();
  });
});

describe("extraction dialog review", () => {
  it("EXTRACT-AC9: lists the five fields in order with value, quote and page, and no missing-source line", async () => {
    await renderWith(extracted(ALL_FOUND));

    expect(await screen.findByText("Schema: Vertrag")).toBeTruthy();
    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent);
    expect(headers).toEqual(["Feld", "Wert", "Quelle"]);
    const rows = screen.getAllByRole("row").slice(1);
    expect(
      rows.map((row) => within(row).getAllByRole("cell")[0].textContent),
    ).toEqual([
      "Vertragsparteien",
      "Laufzeit",
      "Kündigungsfrist",
      "Vertragswert",
      "Verlängerung",
    ]);
    const first = rows[0];
    expect(
      (within(first).getByRole("textbox") as HTMLTextAreaElement).value,
    ).toBe("Acme GmbH und Beta AG");
    expect(within(first).getByText(/„Zitat parties“/)).toBeTruthy();
    expect(within(first).getByText(/Seite 1/)).toBeTruthy();
    expect(within(rows[4]).getByText(/Seite 5/)).toBeTruthy();
    expect(screen.queryByText(/ohne Quelle/)).toBeNull();
  });

  it("EXTRACT-AC69: every Wert input keeps a minimum width beside long quotes", async () => {
    await renderWith(extracted(ONE_MISSING));

    await screen.findByText("Schema: Vertrag");
    const inputs = screen.getAllByRole("textbox");
    expect(inputs).toHaveLength(5);
    for (const input of inputs) {
      const root = input.closest(".mantine-Textarea-root") as HTMLElement;
      const minWidth = root.style.minWidth;
      const rems = minWidth.match(/([\d.]+)rem/);
      expect(rems, `min-width "${minWidth}"`).not.toBeNull();
      expect(Number(rems![1]) * 16).toBeGreaterThanOrEqual(140);
    }
  });

  it("EXTRACT-AC10: rounds the seconds from the start to the answer up (17.2 s gives 18)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-29T10:00:00.000Z"));
    const pending = deferred<ExtractResult>();
    extractMock.mockReturnValueOnce(pending.promise);
    renderDialog();

    vi.setSystemTime(new Date("2026-10-29T10:00:17.200Z"));
    await act(async () => pending.resolve(extracted(ALL_FOUND)));

    expect(await screen.findByText("Fertig in 18 s")).toBeTruthy();
  });

  it("EXTRACT-AC14: a field not found shows an empty input with placeholder, badge and no-source text", async () => {
    await renderWith(extracted(ONE_MISSING));

    await screen.findByText("Schema: Vertrag");
    const row = screen.getAllByRole("row")[5];
    const input = within(row).getByRole("textbox") as HTMLTextAreaElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Wert manuell eintragen");
    expect(within(row).getByText("Nicht gefunden")).toBeTruthy();
    expect(within(row).getByText("Keine Fundstelle im Dokument.")).toBeTruthy();
  });

  it("EXTRACT-AC18: one field without source reads '1 Feld ohne Quelle'", async () => {
    await renderWith(extracted(ONE_MISSING));
    expect(await screen.findByText("1 Feld ohne Quelle")).toBeTruthy();
  });

  it("EXTRACT-AC19: three fields without source read '3 Felder ohne Quelle'", async () => {
    await renderWith(extracted(THREE_MISSING));
    expect(await screen.findByText("3 Felder ohne Quelle")).toBeTruthy();
  });

  it("EXTRACT-AC20: Abbrechen in the review closes and does not insert", async () => {
    const props = await renderWith(extracted(ALL_FOUND));

    await screen.findByText("Schema: Vertrag");
    fireEvent.click(screen.getByRole("button", { name: "Abbrechen" }));

    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onInsert).not.toHaveBeenCalled();
  });

  it("EXTRACT-AC28: a double click on Als Tabelle einfügen inserts once, with the edited values", async () => {
    const props = await renderWith(extracted(ONE_MISSING));

    await screen.findByText("Schema: Vertrag");
    const row = screen.getAllByRole("row")[5];
    fireEvent.change(within(row).getByRole("textbox"), {
      target: { value: "Stillschweigend" },
    });
    const insert = screen.getByRole("button", { name: "Als Tabelle einfügen" });
    fireEvent.click(insert);
    fireEvent.click(insert);

    expect(props.onInsert).toHaveBeenCalledTimes(1);
    expect(props.onInsert).toHaveBeenCalledWith(
      {
        parties: "Acme GmbH und Beta AG",
        term: "24 Monate",
        noticePeriod: "3 Monate",
        value: "1.200.000,00 EUR",
        renewal: "Stillschweigend",
      },
      ONE_MISSING,
    );
  });

  it("EXTRACT-AC30: Als Tabelle einfügen is disabled when the editor is not editable", async () => {
    extractMock.mockResolvedValueOnce(extracted(ALL_FOUND));
    const props = renderDialog({ editable: false });

    await screen.findByText("Schema: Vertrag");
    const insert = screen.getByRole("button", { name: "Als Tabelle einfügen" });
    expect((insert as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(insert);
    expect(props.onInsert).not.toHaveBeenCalled();
  });
});

describe("extraction dialog refusals and failures", () => {
  it.each([
    [
      "EXTRACT-AC32",
      refused("no_text_layer"),
      "Diese PDF enthält keinen Text (vermutlich eingescannt). Texterkennung ist in dieser Version nicht enthalten.",
    ],
    [
      "EXTRACT-AC33",
      refused("too_many_pages", { pageCount: 11 }),
      `Die Datei hat 11 Seiten. ${LIMITS}`,
    ],
    [
      "EXTRACT-AC35",
      refused("too_large", { fileSize: 12163481 }),
      `Die Datei ist 11,6 MB groß. ${LIMITS}`,
    ],
    [
      "EXTRACT-AC65",
      refused("too_large", { fileSize: 10485761 }),
      `Die Datei ist 10,1 MB groß. ${LIMITS}`,
    ],
    [
      "EXTRACT-AC35",
      refused("too_large", { fileSize: 20971520 }),
      `Die Datei ist 20,0 MB groß. ${LIMITS}`,
    ],
    [
      "EXTRACT-AC64",
      refused("too_much_text", { characterCount: 30001 }),
      `Die Datei enthält 30.001 Zeichen Text. ${LIMITS}`,
    ],
    [
      "EXTRACT-AC64",
      refused("too_much_text", { characterCount: 1234567 }),
      `Die Datei enthält 1.234.567 Zeichen Text. ${LIMITS}`,
    ],
    [
      "EXTRACT-AC37",
      refused("unreadable"),
      "Diese PDF kann nicht gelesen werden.",
    ],
    [
      "EXTRACT-AC38",
      { outcome: "failed", reason: "model_unavailable" } as ExtractResult,
      "Das Sprachmodell antwortet gerade nicht. Versuche es später noch einmal.",
    ],
    [
      "EXTRACT-AC40",
      new ExtractRequestError("model"),
      "Das Sprachmodell antwortet gerade nicht. Versuche es später noch einmal.",
    ],
    [
      "EXTRACT-AC41",
      new ExtractRequestError("unreachable"),
      "Der Assistent ist gerade nicht erreichbar. Das Wiki funktioniert normal weiter.",
    ],
    [
      "EXTRACT-AC42",
      new ExtractRequestError("not_available"),
      "Der Anhang ist nicht mehr verfügbar oder du darfst die Seite nicht bearbeiten.",
    ],
  ])(
    "%s, EXTRACT-AC43: shows the text and only Schließen, which closes without inserting",
    async (_id, result, text) => {
      const props = await renderWith(result);

      expect(await screen.findByText(text)).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "Als Tabelle einfügen" }),
      ).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Schließen" }));
      expect(props.onClose).toHaveBeenCalledTimes(1);
      expect(props.onInsert).not.toHaveBeenCalled();
    },
  );

  it("EXTRACT-AC65: a file of exactly 10 MB plus one byte rounds up to 10,1 MB, not 10,0 MB", async () => {
    await renderWith(refused("too_large", { fileSize: 10485761 }));
    expect(await screen.findByText(/10,1 MB groß/)).toBeTruthy();
  });

  it("EXTRACT-AC64: 30,001 characters get a dot as thousands separator", async () => {
    await renderWith(refused("too_much_text", { characterCount: 30001 }));
    await waitFor(() =>
      expect(screen.getByText(/30\.001 Zeichen/)).toBeTruthy(),
    );
  });
});
