import { afterEach, describe, expect, it } from "vitest";
import { Editor, JSONContent } from "@tiptap/core";
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
  TiptapAudio,
  TiptapImage,
  TiptapVideo,
  TableCell,
  TableHeader,
  TableRow,
  TiptapPdf,
} from "@docmost/editor-ext";
import {
  buildContractTableContent,
  insertContractTable,
} from "@/features/ai-assistant/services/contract-table.ts";
import {
  ExtractedFieldKey,
  IExtractedField,
} from "@/features/ai-assistant/types/ai-assistant.types.ts";

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

const fields: IExtractedField[] = [
  found("parties", "Acme GmbH und Beta AG"),
  found("term", "24 Monate"),
  found("noticePeriod", "3 Monate"),
  missing("value"),
  missing("renewal"),
];

const unchangedValues: Record<ExtractedFieldKey, string> = {
  parties: "Acme GmbH und Beta AG",
  term: "24 Monate",
  noticePeriod: "3 Monate",
  value: "",
  renewal: "",
};

const build = (values = unchangedValues, input = fields) =>
  buildContractTableContent({
    fileName: "vertrag.pdf",
    reviewerName: "Gerda Fischer",
    date: new Date(2026, 2, 5, 23, 30),
    fields: input,
    values,
  });

const cellTexts = (content: JSONContent[]): string[][] =>
  content[2].content.map((row) =>
    row.content.map((cell) => cell.content[0].content?.[0]?.text ?? ""),
  );

let editor: Editor;

const makeEditor = (content: JSONContent[]) => {
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
    content: { type: "doc", content },
  });
  return editor;
};

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const attachmentNode = (attachmentId: string) => ({
  type: "attachment",
  attrs: { attachmentId, name: "vertrag.pdf", url: "/x" },
});

const topLevelTypes = () =>
  editor.state.doc.content.content.map((node) => node.type.name);

afterEach(() => editor?.destroy());

describe("contract table content", () => {
  it("EXTRACT-AC21: builds heading, line and table with exact texts", () => {
    const content = build();
    expect(content[0]).toEqual({
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Vertragsdaten" }],
    });
    expect(content[1].content[0].text).toBe(
      "Aus vertrag.pdf, geprüft von Gerda Fischer am 05.03.2026.",
    );
    expect(content[2].type).toBe("table");
    expect(content[2].content[0].content.map((c) => c.type)).toEqual([
      "tableHeader",
      "tableHeader",
      "tableHeader",
    ]);
    expect(cellTexts(content)).toEqual([
      ["Feld", "Wert", "Quelle"],
      [
        "Vertragsparteien",
        "Acme GmbH und Beta AG",
        "„Zitat parties“, Seite 2",
      ],
      ["Laufzeit", "24 Monate", "„Zitat term“, Seite 2"],
      ["Kündigungsfrist", "3 Monate", "„Zitat noticePeriod“, Seite 2"],
      ["Vertragswert", "Nicht gefunden", "Keine Fundstelle im Dokument."],
      ["Verlängerung", "Nicht gefunden", "Keine Fundstelle im Dokument."],
    ]);
  });

  it("EXTRACT-AC23: typed value for a missing field gets the manual marker", () => {
    const rows = cellTexts(build({ ...unchangedValues, value: " 48.000 EUR " }));
    expect(rows[4]).toEqual([
      "Vertragswert",
      "48.000 EUR (manuell)",
      "Keine Fundstelle im Dokument.",
    ]);
  });

  it("EXTRACT-AC24: changed found value gets the marker and keeps the source", () => {
    const rows = cellTexts(build({ ...unchangedValues, term: "36 Monate" }));
    expect(rows[2]).toEqual([
      "Laufzeit",
      "36 Monate (manuell)",
      "„Zitat term“, Seite 2",
    ]);
  });

  it("EXTRACT-AC25: empty or whitespace value reads Nicht gefunden", () => {
    const rows = cellTexts(
      build({ ...unchangedValues, term: "   ", value: "" }),
    );
    expect(rows[2][1]).toBe("Nicht gefunden");
    expect(rows[4][1]).toBe("Nicht gefunden");
    expect(rows[2][2]).toBe("„Zitat term“, Seite 2");
  });

  it("EXTRACT-AC26: unchanged values carry no marker", () => {
    const rows = cellTexts(build({ ...unchangedValues, term: " 24 Monate " }));
    expect(rows.flat().some((text) => text.includes("(manuell)"))).toBe(false);
  });

  it("EXTRACT-AC60: markup in values stays literal text without marks", () => {
    const hostile = "<b>fett</b> **fett** [x](javascript:alert(1))";
    const content = build({ ...unchangedValues, value: hostile });
    const valueCell = content[2].content[4].content[1];
    expect(valueCell.content).toEqual([
      {
        type: "paragraph",
        content: [{ type: "text", text: `${hostile} (manuell)` }],
      },
    ]);
    makeEditor(content);
    const marks: string[] = [];
    editor.state.doc.descendants((node) => {
      node.marks.forEach((mark) => marks.push(mark.type.name));
    });
    expect(marks).toEqual([]);
    expect(editor.getText()).toContain(hostile);
  });
});

describe("contract table insertion", () => {
  it("EXTRACT-AC21: inserts heading, line and table directly after the attachment", () => {
    makeEditor([
      paragraph("davor"),
      attachmentNode("a1"),
      paragraph("danach"),
    ]);
    expect(insertContractTable(editor, "a1", build())).toBe(true);
    expect(topLevelTypes()).toEqual([
      "paragraph",
      "attachment",
      "heading",
      "paragraph",
      "table",
      "paragraph",
    ]);
    expect(editor.state.doc.child(2).textContent).toBe("Vertragsdaten");
    expect(editor.state.doc.child(5).textContent).toBe("danach");
  });

  it("EXTRACT-AC22: inserts after a pdf node", () => {
    makeEditor([
      {
        type: "pdf",
        attrs: { attachmentId: "p1", name: "vertrag.pdf", src: "/x" },
      },
      attachmentNode("a1"),
      paragraph("ende"),
    ]);
    insertContractTable(editor, "p1", build());
    expect(topLevelTypes()).toEqual([
      "pdf",
      "heading",
      "paragraph",
      "table",
      "attachment",
      "paragraph",
    ]);
  });

  it("EXTRACT-AC29: appends at the end when the attachment is gone", () => {
    makeEditor([paragraph("a"), paragraph("b")]);
    expect(insertContractTable(editor, "missing", build())).toBe(true);
    const types = topLevelTypes();
    expect(types.slice(0, 2)).toEqual(["paragraph", "paragraph"]);
    expect(types.slice(2, 5)).toEqual(["heading", "paragraph", "table"]);
    expect(editor.state.doc.child(2).textContent).toBe("Vertragsdaten");
  });

  it("EXTRACT-AC31: one undo removes heading, line and table", () => {
    makeEditor([attachmentNode("a1"), paragraph("danach")]);
    insertContractTable(editor, "a1", build());
    expect(topLevelTypes()).toContain("table");
    editor.commands.undo();
    expect(topLevelTypes()).toEqual(["attachment", "paragraph"]);
  });
});
