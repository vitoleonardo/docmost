import { timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EnvironmentService } from '../../environment/environment.service';
import { AiBridgeError } from '../ai-bridge.errors';
import {
  AI_BRIDGE_USER_TOKEN_KEY,
  AiBridgeRequest,
  AiBridgeUserTokenOptions,
} from '../decorators/ai-bridge-auth.decorator';
import { AiTokenService } from '../services/ai-token.service';

const SERVICE_TOKEN_HEADER = 'x-service-token';
const USER_TOKEN_HEADER = 'x-user-token';

@Injectable()
export class AiInternalAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly environmentService: EnvironmentService,
    private readonly aiTokenService: AiTokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AiBridgeRequest>();
    if (!this.environmentService.isAiBridgeConfigured()) {
      throw new AiBridgeError('assistant_disabled', 'Assistant is disabled');
    }
    this.checkServiceToken(request.headers[SERVICE_TOKEN_HEADER]);

    const userTokenOptions =
      this.reflector.getAllAndOverride<AiBridgeUserTokenOptions>(
        AI_BRIDGE_USER_TOKEN_KEY,
        [context.getHandler(), context.getClass()],
      );
    if (!userTokenOptions) {
      rejectUserIdInBody(request.body);
      return true;
    }

    const userToken = request.headers[USER_TOKEN_HEADER];
    if (!userToken) {
      throw new AiBridgeError('user_token_missing', 'User token is missing');
    }
    rejectUserIdInBody(request.body);
    if (typeof userToken !== 'string') {
      throw new AiBridgeError('user_token_invalid', 'User token is repeated');
    }
    request.aiBridgeUser = await this.aiTokenService.verifyToken(
      userToken,
      userTokenOptions,
    );
    return true;
  }

  private checkServiceToken(given: string | string[] | undefined): void {
    if (!given) {
      throw new AiBridgeError(
        'service_token_missing',
        'Service token is missing',
      );
    }
    const expected = Buffer.from(
      this.environmentService.getAiServiceToken() ?? '',
    );
    const actual = Buffer.from(typeof given === 'string' ? given : '');
    const matches =
      actual.length === expected.length && timingSafeEqual(actual, expected);
    if (!matches) {
      throw new AiBridgeError(
        'service_token_invalid',
        'Service token is invalid',
      );
    }
  }
}

function rejectUserIdInBody(body: unknown): void {
  if (body !== null && typeof body === 'object' && 'userId' in body) {
    throw new AiBridgeError(
      'user_id_not_allowed',
      'Requests must not carry a user id; the user comes from the token',
    );
  }
}
