export type AiAssistantStatus = "available" | "unavailable" | "disabled";

export interface IAiAssistantStatus {
  status: AiAssistantStatus;
}
