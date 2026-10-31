import api from "@/lib/api-client";
import { IAiAssistantStatus } from "@/features/ai-assistant/types/ai-assistant.types.ts";

export async function getAiAssistantStatus(): Promise<IAiAssistantStatus> {
  const req = await api.post<IAiAssistantStatus>("/ai/status");
  return req.data;
}
