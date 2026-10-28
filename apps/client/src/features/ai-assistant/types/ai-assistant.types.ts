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

export interface IAskSource {
  number: number;
  pageId: string;
  title: string;
  spaceName: string;
  headingPath: string[];
  fileName: string | null;
  pdfPage: number | null;
  url: string;
}

export type AskStreamErrorCode = "model_unavailable";

export type AskRequestErrorCode =
  | "invalid_request"
  | "space_not_found"
  | "page_not_found"
  | "assistant_disabled"
  | "assistant_unavailable"
  | "unauthorized";

export type AskEvent =
  | { type: "delta"; text: string }
  | { type: "sources"; sources: IAskSource[] }
  | { type: "no_source" }
  | { type: "error"; code: AskStreamErrorCode };

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
