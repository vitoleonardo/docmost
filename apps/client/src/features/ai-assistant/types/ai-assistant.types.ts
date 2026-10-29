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

export type ExtractedFieldKey =
  | "parties"
  | "term"
  | "noticePeriod"
  | "value"
  | "renewal";

export interface IExtractedField {
  key: ExtractedFieldKey;
  value: string | null;
  quote: string | null;
  pdfPage: number | null;
}
