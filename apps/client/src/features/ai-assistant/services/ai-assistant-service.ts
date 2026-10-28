import api from "@/lib/api-client";
import {
  askEventSchema,
  AskEvent,
  AskRequestErrorCode,
  IAiAssistantStatus,
  IAskRequest,
} from "@/features/ai-assistant/types/ai-assistant.types.ts";

export async function getAiAssistantStatus(): Promise<IAiAssistantStatus> {
  const req = await api.post<IAiAssistantStatus>("/ai/status");
  return req.data;
}

export class AskRequestError extends Error {
  constructor(readonly code: AskRequestErrorCode) {
    super(code);
    this.name = "AskRequestError";
  }
}

const REQUEST_ERROR_CODES: AskRequestErrorCode[] = [
  "invalid_request",
  "space_not_found",
  "page_not_found",
  "assistant_disabled",
  "assistant_unavailable",
];

async function requestErrorFrom(response: Response): Promise<AskRequestError> {
  if (response.status === 401) return new AskRequestError("unauthorized");
  const payload = await response.json().catch(() => null);
  const code = REQUEST_ERROR_CODES.find((known) => known === payload?.code);
  return new AskRequestError(code ?? "assistant_unavailable");
}

const MODEL_UNAVAILABLE: AskEvent = { type: "error", code: "model_unavailable" };

function parseFrame(frame: string): AskEvent | null {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    const parsed = askEventSchema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : MODEL_UNAVAILABLE;
  } catch {
    return MODEL_UNAVAILABLE;
  }
}

export async function askQuestion(
  body: IAskRequest,
  onEvent: (event: AskEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch("/api/ai/ask", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new AskRequestError("assistant_unavailable");
  }
  if (!response.ok || !response.body) throw await requestErrorFrom(response);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  const emitFrames = (frames: string[]) => {
    for (const frame of frames) {
      if (finished) return;
      const event = parseFrame(frame);
      if (!event) continue;
      if (event.type !== "delta") finished = true;
      onEvent(event);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const frames = buffer.split("\n\n");
    const unfinished = frames.pop() ?? "";
    emitFrames(done ? [...frames, unfinished] : frames);
    if (done) break;
    buffer = unfinished;
  }

  if (!finished) onEvent(MODEL_UNAVAILABLE);
}
