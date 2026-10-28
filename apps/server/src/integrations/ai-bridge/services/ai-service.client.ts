import { Injectable } from '@nestjs/common';
import { EnvironmentService } from '../../environment/environment.service';

const AI_SERVICE_TIMEOUT_MS = 3000;

export class AiServiceUnreachableError extends Error {}

export interface AiServiceAskRequest {
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

export type AiServiceAskEvent =
  | { type: 'delta'; text: string }
  | { type: 'citations'; citations: AiServiceCitation[] }
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
  const event: unknown = JSON.parse(line);
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

function isAskEvent(value: unknown): value is AiServiceAskEvent {
  if (!isRecord(value)) return false;
  switch (value.type) {
    case 'delta':
      return isString(value.text);
    case 'citations':
      return (
        Array.isArray(value.citations) && value.citations.every(isCitation)
      );
    case 'no_source':
      return true;
    case 'error':
      return isString(value.code);
    default:
      return false;
  }
}
