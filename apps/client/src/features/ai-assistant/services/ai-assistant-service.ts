import { z } from "zod";
import api from "@/lib/api-client";
import {
  agentEventSchema,
  agentProposalViewSchema,
  AgentEvent,
  AgentProposalErrorCode,
  AgentRequestErrorCode,
  IAgentProposalView,
  IAgentRunRequest,
  askEventSchema,
  AskEvent,
  ExtractRequestErrorCode,
  ExtractResult,
  extractResultSchema,
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

export class AgentRequestError extends Error {
  constructor(readonly code: AgentRequestErrorCode) {
    super(code);
    this.name = "AgentRequestError";
  }
}

const ASK_REQUEST_ERROR_CODES: readonly AskRequestErrorCode[] = [
  "invalid_request",
  "space_not_found",
  "page_not_found",
  "assistant_disabled",
  "assistant_unavailable",
];

const AGENT_REQUEST_ERROR_CODES: readonly AgentRequestErrorCode[] = [
  "invalid_request",
  "space_not_found",
  "run_in_progress",
  "assistant_disabled",
  "assistant_unavailable",
];

async function requestErrorCodeFrom<C extends string>(
  response: Response,
  knownCodes: readonly C[],
): Promise<C | "unauthorized" | "assistant_unavailable"> {
  if (response.status === 401) return "unauthorized";
  const payload = await response.json().catch(() => null);
  return (
    knownCodes.find((known) => known === payload?.code) ??
    "assistant_unavailable"
  );
}

const ASK_MODEL_UNAVAILABLE: AskEvent = {
  type: "error",
  code: "model_unavailable",
};

const AGENT_MODEL_FAILED: AgentEvent = {
  type: "end",
  outcome: "model_failed",
  pagesRead: 0,
  message: null,
};

interface EventStreamKind<E> {
  schema: z.ZodType<E>;
  failure: E;
  isTerminal: (event: E) => boolean;
}

const ASK_STREAM: EventStreamKind<AskEvent> = {
  schema: askEventSchema,
  failure: ASK_MODEL_UNAVAILABLE,
  isTerminal: (event) => event.type !== "delta",
};

const AGENT_STREAM: EventStreamKind<AgentEvent> = {
  schema: agentEventSchema,
  failure: AGENT_MODEL_FAILED,
  isTerminal: (event) => event.type === "end",
};

function parseFrame<E>(frame: string, kind: EventStreamKind<E>): E | null {
  const data = frame
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trimStart())
    .join("\n");
  if (!data) return null;
  try {
    const parsed = kind.schema.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : kind.failure;
  } catch {
    return kind.failure;
  }
}

async function openEventStream<C extends string>(
  path: string,
  body: unknown,
  signal: AbortSignal,
  knownCodes: readonly C[],
  toError: (code: C | "unauthorized" | "assistant_unavailable") => Error,
): Promise<ReadableStream<Uint8Array>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (signal.aborted) throw error;
    throw toError("assistant_unavailable");
  }
  if (!response.ok || !response.body) {
    throw toError(await requestErrorCodeFrom(response, knownCodes));
  }
  return response.body;
}

async function readEvents<E>(
  stream: ReadableStream<Uint8Array>,
  kind: EventStreamKind<E>,
  onEvent: (event: E) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;

  const emitFrames = (frames: string[]) => {
    for (const frame of frames) {
      if (finished) return;
      const event = parseFrame(frame, kind);
      if (!event) continue;
      if (kind.isTerminal(event)) finished = true;
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

  if (!finished) onEvent(kind.failure);
}

export async function askQuestion(
  body: IAskRequest,
  onEvent: (event: AskEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const stream = await openEventStream(
    "/api/ai/ask",
    body,
    signal,
    ASK_REQUEST_ERROR_CODES,
    (code) => new AskRequestError(code),
  );
  await readEvents(stream, ASK_STREAM, onEvent);
}

export async function runAgentTask(
  body: IAgentRunRequest,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const stream = await openEventStream(
    "/api/ai/agent/run",
    body,
    signal,
    AGENT_REQUEST_ERROR_CODES,
    (code) => new AgentRequestError(code),
  );
  await readEvents(stream, AGENT_STREAM, onEvent);
}

export class AgentProposalError extends Error {
  constructor(readonly code: AgentProposalErrorCode) {
    super(code);
    this.name = "AgentProposalError";
  }
}

const PROPOSAL_ERROR_BY_CODE: Record<string, AgentProposalErrorCode> = {
  proposal_not_found: "not_found",
  page_not_found: "page_gone",
  page_not_editable: "not_editable",
  proposal_not_open: "not_open",
  proposal_stale: "stale",
  write_failed: "write_failed",
};

function proposalErrorFrom(error: unknown): AgentProposalError {
  const response = (
    error as { response?: { status?: number; data?: { code?: unknown } } }
  ).response;
  const code = response?.data?.code;
  const mapped =
    typeof code === "string" ? PROPOSAL_ERROR_BY_CODE[code] : undefined;
  if (mapped) return new AgentProposalError(mapped);
  if (response?.status === 403) return new AgentProposalError("not_editable");
  return new AgentProposalError("unreachable");
}

async function postProposal(
  path: string,
  proposalId: string,
): Promise<unknown> {
  try {
    const body = (await api.post(path, { proposalId })) as { data: unknown };
    return body.data;
  } catch (error) {
    throw proposalErrorFrom(error);
  }
}

export async function getAgentProposal(
  proposalId: string,
): Promise<IAgentProposalView> {
  const parsed = agentProposalViewSchema.safeParse(
    await postProposal("/ai/agent/proposal", proposalId),
  );
  if (!parsed.success) throw new AgentProposalError("unreachable");
  return parsed.data;
}

export async function applyAgentProposal(proposalId: string): Promise<void> {
  await postProposal("/ai/agent/proposal/apply", proposalId);
}

export async function discardAgentProposal(proposalId: string): Promise<void> {
  await postProposal("/ai/agent/proposal/discard", proposalId);
}

export class ExtractRequestError extends Error {
  constructor(readonly code: ExtractRequestErrorCode) {
    super(code);
    this.name = "ExtractRequestError";
  }
}

function extractErrorFrom(error: unknown): ExtractRequestError {
  const status = (error as { response?: { status?: number } }).response?.status;
  if (status === 403 || status === 404) {
    return new ExtractRequestError("not_available");
  }
  if (status === undefined || status === 503) {
    return new ExtractRequestError("unreachable");
  }
  return new ExtractRequestError("model");
}

export async function extractContract(
  pageId: string,
  attachmentId: string,
  signal: AbortSignal,
): Promise<ExtractResult> {
  let body: { data: unknown };
  try {
    body = (await api.post(
      "/ai/extract",
      { pageId, attachmentId },
      { signal },
    )) as {
      data: unknown;
    };
  } catch (error) {
    if (signal.aborted) throw error;
    throw extractErrorFrom(error);
  }
  const parsed = extractResultSchema.safeParse(body.data);
  if (!parsed.success) throw new ExtractRequestError("model");
  return parsed.data;
}
