import { Injectable } from '@nestjs/common';
import { EnvironmentService } from '../../environment/environment.service';

const AI_SERVICE_TIMEOUT_MS = 3000;

class AiServiceUnreachableError extends Error {}

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

  private async post(
    path: string,
    headers: Record<string, string>,
    body?: string,
  ): Promise<Response> {
    const url = new URL(path, this.environmentService.getAiServiceUrl());
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'x-service-token': this.environmentService.getAiServiceToken() ?? '',
        },
        body,
        signal: AbortSignal.timeout(AI_SERVICE_TIMEOUT_MS),
      });
      await response.arrayBuffer();
      return response;
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
