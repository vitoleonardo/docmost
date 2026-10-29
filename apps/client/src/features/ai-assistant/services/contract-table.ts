import type { Editor, JSONContent } from "@tiptap/core";
import {
  ExtractedFieldKey,
  IExtractedField,
} from "@/features/ai-assistant/types/ai-assistant.types.ts";

export const CONTRACT_FIELD_LABELS: Record<ExtractedFieldKey, string> = {
  parties: "Vertragsparteien",
  term: "Laufzeit",
  noticePeriod: "Kündigungsfrist",
  value: "Vertragswert",
  renewal: "Verlängerung",
};

export const CONTRACT_FIELD_KEYS = Object.keys(
  CONTRACT_FIELD_LABELS,
) as ExtractedFieldKey[];

const NOT_FOUND_TEXT = "Nicht gefunden";
const NO_SOURCE_TEXT = "Keine Fundstelle im Dokument.";
const MANUAL_MARKER = "(manuell)";
const REFERENCE_NODE_TYPES = ["attachment", "pdf"];

interface ContractTableInput {
  fileName: string;
  reviewerName: string;
  date: Date;
  fields: IExtractedField[];
  values: Record<ExtractedFieldKey, string>;
}

function formatGermanDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()}`;
}

function textParagraph(text: string): JSONContent {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

function cell(type: "tableHeader" | "tableCell", text: string): JSONContent {
  return { type, content: [textParagraph(text)] };
}

function valueText(typed: string, field: IExtractedField | undefined): string {
  const trimmed = typed.trim();
  if (!trimmed) return NOT_FOUND_TEXT;
  if (trimmed === field?.value) return trimmed;
  return `${trimmed} ${MANUAL_MARKER}`;
}

function sourceText(field: IExtractedField | undefined): string {
  if (!field || field.value === null || field.quote === null) {
    return NO_SOURCE_TEXT;
  }
  return `„${field.quote}“, Seite ${field.pdfPage}`;
}

export function buildContractTableContent(
  input: ContractTableInput,
): JSONContent[] {
  const header: JSONContent = {
    type: "tableRow",
    content: ["Feld", "Wert", "Quelle"].map((text) =>
      cell("tableHeader", text),
    ),
  };
  const rows = CONTRACT_FIELD_KEYS.map((key): JSONContent => {
    const field = input.fields.find((candidate) => candidate.key === key);
    return {
      type: "tableRow",
      content: [
        cell("tableCell", CONTRACT_FIELD_LABELS[key]),
        cell("tableCell", valueText(input.values[key] ?? "", field)),
        cell("tableCell", sourceText(field)),
      ],
    };
  });

  return [
    {
      type: "heading",
      attrs: { level: 3 },
      content: [{ type: "text", text: "Vertragsdaten" }],
    },
    textParagraph(
      `Aus ${input.fileName}, geprüft von ${input.reviewerName} am ${formatGermanDate(input.date)}.`,
    ),
    { type: "table", content: [header, ...rows] },
  ];
}

export function insertContractTable(
  editor: Editor,
  attachmentId: string,
  content: JSONContent[],
): boolean {
  let position = editor.state.doc.content.size;
  editor.state.doc.descendants((node, pos) => {
    if (
      REFERENCE_NODE_TYPES.includes(node.type.name) &&
      node.attrs.attachmentId === attachmentId
    ) {
      position = pos + node.nodeSize;
      return false;
    }
    return true;
  });
  return editor.chain().insertContentAt(position, content).run();
}
