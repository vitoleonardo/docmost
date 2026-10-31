import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import { User } from '@docmost/db/types/entity.types';

export const AI_BRIDGE_USER_TOKEN_KEY = 'aiBridgeUserToken';

export interface AiBridgeUserTokenOptions {
  allowTask: boolean;
}

export interface AiBridgeRequest {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  aiBridgeUser?: User;
}

export const AiBridgeUserToken = (options: AiBridgeUserTokenOptions) =>
  SetMetadata(AI_BRIDGE_USER_TOKEN_KEY, options);

export const AiBridgeUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): User => {
    const user = ctx.switchToHttp().getRequest<AiBridgeRequest>().aiBridgeUser;
    if (!user) {
      throw new Error(
        'AiBridgeUser used on a route without @AiBridgeUserToken',
      );
    }
    return user;
  },
);
