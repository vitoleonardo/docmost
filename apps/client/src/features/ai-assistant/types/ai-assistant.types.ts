import { z } from "zod";
import type { Editor } from "@tiptap/core";

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

export interface IExtractionRequest {
  editor: Editor;
  pageId: string;
  attachmentId: string;
  fileName: string;
}

export interface IAgentRunRequest {
  spaceId: string;
  task: string;
}

export type AgentRequestErrorCode =
  | "invalid_request"
  | "space_not_found"
  | "run_in_progress"
  | "assistant_disabled"
  | "assistant_unavailable"
  | "unauthorized";

const agentStepLabelSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("search"),
    query: z.string(),
    count: z.number(),
  }),
  z.object({ kind: z.literal("read"), title: z.string() }),
  z.object({ kind: z.literal("propose"), title: z.string() }),
  z.object({ kind: z.literal("refused") }),
]);

export type AgentStepLabel = z.infer<typeof agentStepLabelSchema>;

const agentProposalSummarySchema = z.object({
  id: z.string(),
  pageId: z.string(),
  pageTitle: z.string(),
  reason: z.string(),
  added: z.number(),
  removed: z.number(),
});

export type IAgentProposalSummary = z.infer<typeof agentProposalSummarySchema>;

const agentEndOutcomeSchema = z.enum([
  "finished",
  "out_of_scope",
  "step_limit",
  "time_limit",
  "token_limit",
  "context_too_small",
  "model_failed",
]);

export type AgentEndOutcome = z.infer<typeof agentEndOutcomeSchema>;

export const agentEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("run"), runId: z.string() }),
  z.object({
    type: z.literal("step"),
    steps: z.number(),
    label: agentStepLabelSchema,
  }),
  z.object({
    type: z.literal("proposal"),
    proposal: agentProposalSummarySchema,
  }),
  z.object({
    type: z.literal("end"),
    outcome: agentEndOutcomeSchema,
    pagesRead: z.number(),
    message: z.string().nullable(),
  }),
]);

export type AgentEvent = z.infer<typeof agentEventSchema>;

const agentProposalStatusSchema = z.enum([
  "open",
  "applied",
  "discarded",
  "stale",
]);

export type AgentProposalStatus = z.infer<typeof agentProposalStatusSchema>;

export const agentProposalViewSchema = z.object({
  id: z.string(),
  runId: z.string(),
  pageId: z.string(),
  pageTitle: z.string(),
  reason: z.string(),
  status: agentProposalStatusSchema,
  canEdit: z.boolean(),
  added: z.number(),
  removed: z.number(),
  changes: z.array(
    z.object({
      heading: z.string().nullable(),
      ops: z.array(
        z.object({
          op: z.enum(["keep", "remove", "add"]),
          text: z.string(),
        }),
      ),
    }),
  ),
});

export type IAgentProposalView = z.infer<typeof agentProposalViewSchema>;

export type AgentProposalErrorCode =
  | "not_found"
  | "page_gone"
  | "not_editable"
  | "not_open"
  | "stale"
  | "write_failed"
  | "unreachable";

export type AgentRunStatus =
  | "running"
  | "ended"
  | "cancelled"
  | "failed"
  | "in_progress_refused";

export interface IAgentRunProposal extends IAgentProposalSummary {
  status: AgentProposalStatus;
}

export interface IAgentRun {
  runId?: string;
  spaceId: string;
  spaceName: string;
  task: string;
  startedAt: number;
  steps: AgentStepLabel[];
  stepCount: number;
  proposals: IAgentRunProposal[];
  status: AgentRunStatus;
  end?: { outcome: AgentEndOutcome; pagesRead: number; message: string | null };
}
