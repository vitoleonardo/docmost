import { Injectable } from '@nestjs/common';
import { EnvironmentService } from '../../environment/environment.service';
import { AiBridgeError } from '../ai-bridge.errors';

const AI_SERVICE_TIMEOUT_MS = 3000;
export const AI_EXTRACT_TIMEOUT_MS = 200_000;

export class AiServiceUnreachableError extends Error {}
export class AiServiceTimeoutError extends Error {}
export class AiServiceMalformedResponseError extends Error {}

interface AiServiceAskRequest {
  question: string;
  conversationId: string;
  spaceId?: string;
  pageId?: string;
}

export interface AiServiceCitation {
  number: number;
  pageId: string;
  headingPath: string[];
  attachmentId: string | null;
  fileName: string | null;
  pdfPage: number | null;
}

interface AiServiceTurnConfirmation {
  conversationId: string;
  turnId: string;
}

interface AiServiceExtractRequest {
  attachmentId: string;
  fileSize: number;
}

const EXTRACT_FIELD_KEYS = [
  'parties',
  'term',
  'noticePeriod',
  'value',
  'renewal',
] as const;
const REFUSED_REASONS = [
  'no_text_layer',
  'too_many_pages',
  'too_large',
  'too_much_text',
  'unreadable',
] as const;

export interface AiServiceExtractField {
  key: (typeof EXTRACT_FIELD_KEYS)[number];
  value: string | null;
  quote: string | null;
  pdfPage: number | null;
}

export type AiServiceExtractResult =
  | { outcome: 'extracted'; fields: AiServiceExtractField[] }
  | {
      outcome: 'refused';
      reason: (typeof REFUSED_REASONS)[number];
      pageCount: number | null;
      fileSize: number | null;
      characterCount: number | null;
    }
  | { outcome: 'failed'; reason: 'model_unavailable' };

export type AiServiceAskEvent =
  | { type: 'delta'; text: string }
  | { type: 'citations'; turnId: string; citations: AiServiceCitation[] }
  | { type: 'no_source' }
  | { type: 'error'; code: string };

function isNamedError(error: unknown, name: string): error is Error {
  return (error as Error | undefined)?.name === name;
}

@Injectable()
export class AiServiceClient {
  constructor(private readonly environmentService: EnvironmentService) {}

  async checkSession(userToken: string): Promise<boolean> {
    try {
      const response = await this.post('/v1/session', {
        'x-user-token': userToken,
      });
      return response.status === 200;
    } catch (error) {
      if (error instanceof AiServiceUnreachableError) return false;
      throw error;
    }
  }

  async enqueueJob(name: string, data: object): Promise<void> {
    const response = await this.post(
      '/v1/jobs',
      { 'content-type': 'application/json' },
      JSON.stringify({ name, data }),
    ).catch((error: unknown) => {
      if (error instanceof AiServiceUnreachableError) {
        throw new Error(`AI service unreachable: ${error.message}`);
      }
      throw error;
    });
    if (response.status !== 202) {
      throw new Error(`AI service answered HTTP ${response.status}`);
    }
  }

  async ask(
    userToken: string,
    request: AiServiceAskRequest,
    signal: AbortSignal,
  ): Promise<AsyncGenerator<AiServiceAskEvent>> {
    const upstream = new AbortController();
    const abortUpstream = () => upstream.abort(signal.reason);
    signal.addEventListener('abort', abortUpstream, { once: true });
    const release = () => {
      upstream.abort();
      signal.removeEventListener('abort', abortUpstream);
    };
    if (signal.aborted) abortUpstream();
    const headTimeout = setTimeout(
      () => upstream.abort(new DOMException('timeout', 'TimeoutError')),
      AI_SERVICE_TIMEOUT_MS,
    );
    try {
      const response = await this.send(
        '/v1/ask',
        { 'content-type': 'application/json', 'x-user-token': userToken },
        upstream.signal,
        JSON.stringify(request),
      );
      if (response.status !== 200 || !response.body) {
        throw new AiServiceUnreachableError(`HTTP ${response.status}`);
      }
      return readAskEvents(response.body, release);
    } catch (error) {
      release();
      throw error;
    } finally {
      clearTimeout(headTimeout);
    }
  }

  async extract(
    userToken: string,
    request: AiServiceExtractRequest,
    signal: AbortSignal,
  ): Promise<AiServiceExtractResult> {
    const deadline = new AbortController();
    const timer = setTimeout(
      () => deadline.abort(new DOMException('timeout', 'TimeoutError')),
      AI_EXTRACT_TIMEOUT_MS,
    );
    try {
      const response = await this.send(
        '/v1/extract',
        { 'content-type': 'application/json', 'x-user-token': userToken },
        AbortSignal.any([signal, deadline.signal]),
        JSON.stringify(request),
      );
      return await readExtractResult(response).catch((error: unknown) => {
        throw this.toUnreachable(error);
      });
    } catch (error) {
      if (deadline.signal.aborted && !signal.aborted) {
        throw new AiServiceTimeoutError(
          `no extraction result within ${AI_EXTRACT_TIMEOUT_MS} ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async confirmTurn(
    userToken: string,
    confirmation: AiServiceTurnConfirmation,
  ): Promise<void> {
    const response = await this.post(
      '/v1/conversations/confirm',
      { 'content-type': 'application/json', 'x-user-token': userToken },
      JSON.stringify(confirmation),
    );
    if (response.status !== 204) {
      throw new Error(`AI service answered HTTP ${response.status}`);
    }
  }

  private async post(
    path: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<Response> {
    const response = await this.send(
      path,
      headers,
      AbortSignal.timeout(AI_SERVICE_TIMEOUT_MS),
      body,
    );
    try {
      await response.arrayBuffer();
    } catch (error) {
      throw this.toUnreachable(error);
    }
    return response;
  }

  private async send(
    path: string,
    headers: Record<string, string>,
    signal: AbortSignal,
    body?: string,
  ): Promise<Response> {
    const url = new URL(path, this.environmentService.getAiServiceUrl());
    try {
      return await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'x-service-token': this.environmentService.getAiServiceToken() ?? '',
        },
        body,
        signal,
      });
    } catch (error) {
      throw this.toUnreachable(error);
    }
  }

  private toUnreachable(error: unknown): unknown {
    if (isNamedError(error, 'TimeoutError')) {
      return new AiServiceUnreachableError('timeout');
    }
    if (isNamedError(error, 'TypeError') && error.message === 'fetch failed') {
      const code = (error as { cause?: { code?: string } }).cause?.code;
      return new AiServiceUnreachableError(
        `connection error (${code ?? 'unknown'})`,
      );
    }
    return error;
  }
}

async function readExtractResult(
  response: Response,
): Promise<AiServiceExtractResult> {
  const text = await response.text();
  if (response.status === 404 && errorCodeOf(text) === 'attachment_not_found') {
    throw new AiBridgeError('attachment_not_found', 'Attachment not found');
  }
  if (response.status !== 200) {
    throw new AiServiceUnreachableError(`HTTP ${response.status}`);
  }
  const result = toExtractResult(parseJson(text));
  if (!result) {
    throw new AiServiceMalformedResponseError(
      'AI service sent a malformed extraction result',
    );
  }
  return result;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function errorCodeOf(text: string): unknown {
  const body = parseJson(text);
  return isRecord(body) ? body.code : undefined;
}

async function* readAskEvents(
  body: ReadableStream<Uint8Array>,
  release: () => void,
): AsyncGenerator<AiServiceAskEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n');
      pending = done ? '' : lines.pop()!;
      for (const line of lines) {
        if (line.trim()) yield parseAskEvent(line);
      }
      if (done) return;
    }
  } finally {
    release();
  }
}

function parseAskEvent(line: string): AiServiceAskEvent {
  let event: unknown;
  try {
    event = JSON.parse(line);
  } catch {
    throw new Error('AI service sent a line that is not JSON');
  }
  if (!isAskEvent(event)) {
    throw new Error('AI service sent a malformed ask event');
  }
  return event;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullable<T>(
  value: unknown,
  check: (value: unknown) => value is T,
): value is T | null {
  return value === null || check(value);
}

const isString = (value: unknown): value is string => typeof value === 'string';
const isNumber = (value: unknown): value is number => typeof value === 'number';

function isCitation(value: unknown): value is AiServiceCitation {
  return (
    isRecord(value) &&
    isNumber(value.number) &&
    isString(value.pageId) &&
    Array.isArray(value.headingPath) &&
    value.headingPath.every(isString) &&
    isNullable(value.attachmentId, isString) &&
    isNullable(value.fileName, isString) &&
    isNullable(value.pdfPage, isNumber)
  );
}

const isOneOf =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    values.includes(value as T);

const isNullableString = (value: unknown) => isNullable(value, isString);
const isNullableNumber = (value: unknown) => isNullable(value, isNumber);

function toExtractField(
  value: unknown,
  key: AiServiceExtractField['key'],
): AiServiceExtractField | null {
  if (
    !isRecord(value) ||
    value.key !== key ||
    !isNullableString(value.value) ||
    !isNullableString(value.quote) ||
    !isNullableNumber(value.pdfPage)
  ) {
    return null;
  }
  return {
    key,
    value: value.value,
    quote: value.quote,
    pdfPage: value.pdfPage,
  };
}

function toExtractedFields(value: unknown): AiServiceExtractField[] | null {
  if (!Array.isArray(value) || value.length !== EXTRACT_FIELD_KEYS.length) {
    return null;
  }
  const fields = EXTRACT_FIELD_KEYS.map((key, index) =>
    toExtractField(value[index], key),
  ).filter((field): field is AiServiceExtractField => field !== null);
  return fields.length === EXTRACT_FIELD_KEYS.length ? fields : null;
}

function toExtractResult(value: unknown): AiServiceExtractResult | null {
  if (!isRecord(value)) return null;
  switch (value.outcome) {
    case 'extracted': {
      const fields = toExtractedFields(value.fields);
      return fields ? { outcome: 'extracted', fields } : null;
    }
    case 'refused':
      if (
        !isOneOf(REFUSED_REASONS)(value.reason) ||
        !isNullableNumber(value.pageCount) ||
        !isNullableNumber(value.fileSize) ||
        !isNullableNumber(value.characterCount)
      ) {
        return null;
      }
      return {
        outcome: 'refused',
        reason: value.reason,
        pageCount: value.pageCount,
        fileSize: value.fileSize,
        characterCount: value.characterCount,
      };
    case 'failed':
      return value.reason === 'model_unavailable'
        ? { outcome: 'failed', reason: 'model_unavailable' }
        : null;
    default:
      return null;
  }
}

function isAskEvent(value: unknown): value is AiServiceAskEvent {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'delta':
      return isString(value.text);
    case 'citations':
      return (
        isString(value.turnId) &&
        Array.isArray(value.citations) &&
        value.citations.every(isCitation)
      );
    case 'no_source':
      return true;
    case 'error':
      return isString(value.code);
    default:
      return false;
  }
}
