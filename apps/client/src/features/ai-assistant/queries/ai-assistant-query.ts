import { useQuery, UseQueryResult } from "@tanstack/react-query";
import { getAiAssistantStatus } from "@/features/ai-assistant/services/ai-assistant-service.ts";
import { IAiAssistantStatus } from "@/features/ai-assistant/types/ai-assistant.types.ts";

export function useAiAssistantStatusQuery(): UseQueryResult<
  IAiAssistantStatus,
  Error
> {
  return useQuery({
    queryKey: ["ai-assistant-status"],
    queryFn: getAiAssistantStatus,
    staleTime: 60 * 1000,
    retry: false,
  });
}
