import { z } from "zod";

export type AiAssistantStatus = "available" | "unavailable" | "disabled";

export interface IAiAssistantStatus {
  status: AiAssistantStatus;
}

export interface IAskRequest {
  question: string;
  conversationId: string;
  spaceId?: string;
  pageId?: string;
}

const askSourceSchema = z.object({
  number: z.number(),
  pageId: z.string(),
  title: z.string(),
  spaceName: z.string(),
  headingPath: z.array(z.string()),
  fileName: z.string().nullable(),
  pdfPage: z.number().nullable(),
  url: z.string(),
});

export type IAskSource = z.infer<typeof askSourceSchema>;

export type AskRequestErrorCode =
  | "invalid_request"
  | "space_not_found"
  | "page_not_found"
  | "assistant_disabled"
  | "assistant_unavailable"
  | "unauthorized";

export const askEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({ type: z.literal("sources"), sources: z.array(askSourceSchema) }),
  z.object({ type: z.literal("no_source") }),
  z.object({ type: z.literal("error"), code: z.enum(["model_unavailable"]) }),
]);

export type AskEvent = z.infer<typeof askEventSchema>;

export type AskScope =
  | { kind: "all" }
  | { kind: "page"; pageId: string }
  | { kind: "space"; spaceId: string };

export type AskTurnStatus =
  | "streaming"
  | "done"
  | "no_source"
  | "stopped"
  | "error";

export interface IAskTurn {
  id: string;
  question: string;
  answer: string;
  status: AskTurnStatus;
  sources: IAskSource[];
}

export interface IAskConversation {
  conversationId: string;
  scope: AskScope;
  turns: IAskTurn[];
  unavailable: boolean;
}

const extractedFieldKeySchema = z.enum([
  "parties",
  "term",
  "noticePeriod",
  "value",
  "renewal",
]);

export type ExtractedFieldKey = z.infer<typeof extractedFieldKeySchema>;

const extractedFieldSchema = z.object({
  key: extractedFieldKeySchema,
  value: z.string().nullable(),
  quote: z.string().nullable(),
  pdfPage: z.number().nullable(),
});

export type IExtractedField = z.infer<typeof extractedFieldSchema>;

export const extractResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("extracted"),
    fields: z
      .array(extractedFieldSchema)
      .length(extractedFieldKeySchema.options.length)
      .refine(
        (fields) =>
          new Set(fields.map((field) => field.key)).size === fields.length,
      ),
  }),
  z.object({
    outcome: z.literal("refused"),
    reason: z.enum([
      "no_text_layer",
      "too_many_pages",
      "too_large",
      "too_much_text",
      "unreadable",
    ]),
    pageCount: z.number().nullable(),
    fileSize: z.number().nullable(),
    characterCount: z.number().nullable(),
  }),
  z.object({
    outcome: z.literal("failed"),
    reason: z.literal("model_unavailable"),
  }),
]);

export type ExtractResult = z.infer<typeof extractResultSchema>;

export type ExtractRequestErrorCode = "not_available" | "unreachable" | "model";
