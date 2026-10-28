import { Injectable } from '@nestjs/common';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { User } from '@docmost/db/types/entity.types';
import { isUserDisabled } from '../../../common/helpers/utils';
import { EnvironmentService } from '../../environment/environment.service';
import { AiBridgeError } from '../ai-bridge.errors';
import { AiPageAccessService } from './ai-page-access.service';

const AI_TOKEN_AUDIENCE = 'ai-service';
const AI_TOKEN_ALGORITHM = 'HS256';
const USER_TOKEN_LIFETIME_SECONDS = 60;
const TASK_TOKEN_LIFETIME_SECONDS = 900;

type AiTokenType = 'user' | 'task';

interface AiTokenClaims {
  sub?: unknown;
  workspaceId?: unknown;
  type?: unknown;
  exp?: number;
}

@Injectable()
export class AiTokenService {
  constructor(
    private readonly jwtService: JwtService,
    private readonly userRepo: UserRepo,
    private readonly aiPageAccessService: AiPageAccessService,
    private readonly environmentService: EnvironmentService,
  ) {}

  async issueUserToken(user: User): Promise<string> {
    const spaceIds = await this.aiPageAccessService.readableSpaceIds(
      user.id,
      user.workspaceId,
    );
    return this.sign(
      { sub: user.id, workspaceId: user.workspaceId, spaceIds, type: 'user' },
      USER_TOKEN_LIFETIME_SECONDS,
    );
  }

  async issueTaskToken(
    user: User,
    runId: string,
  ): Promise<{ taskToken: string; expiresAt: string }> {
    const taskToken = await this.sign(
      { sub: user.id, workspaceId: user.workspaceId, runId, type: 'task' },
      TASK_TOKEN_LIFETIME_SECONDS,
    );
    const { exp } = this.jwtService.decode<AiTokenClaims>(taskToken);
    return { taskToken, expiresAt: new Date(exp * 1000).toISOString() };
  }

  async verifyToken(
    token: string,
    opts: { allowTask: boolean },
  ): Promise<User> {
    const claims = await this.verifySignature(token);
    const allowedTypes: AiTokenType[] = opts.allowTask
      ? ['user', 'task']
      : ['user'];
    if (!allowedTypes.includes(claims.type as AiTokenType)) {
      throw invalidToken('token type is not accepted here');
    }
    if (
      typeof claims.sub !== 'string' ||
      typeof claims.workspaceId !== 'string'
    ) {
      throw invalidToken('token lacks the user or workspace');
    }

    const user = await this.userRepo.findById(claims.sub, claims.workspaceId);
    if (!user || isUserDisabled(user)) {
      throw invalidToken('token user is unknown or disabled');
    }
    return user;
  }

  private async sign(
    payload: Record<string, unknown>,
    expiresIn: number,
  ): Promise<string> {
    const secret = this.environmentService.getAiBridgeSecret();
    if (!secret) {
      throw new AiBridgeError(
        'assistant_disabled',
        'AI bridge secret is not configured',
      );
    }
    return this.jwtService.signAsync(payload, {
      secret,
      algorithm: AI_TOKEN_ALGORITHM,
      audience: AI_TOKEN_AUDIENCE,
      expiresIn,
    });
  }

  private async verifySignature(token: string): Promise<AiTokenClaims> {
    const secret = this.environmentService.getAiBridgeSecret();
    if (!secret) {
      throw invalidToken('AI bridge secret is not configured');
    }
    try {
      return await this.jwtService.verifyAsync<AiTokenClaims>(token, {
        secret,
        algorithms: [AI_TOKEN_ALGORITHM],
        audience: AI_TOKEN_AUDIENCE,
      });
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        throw new AiBridgeError('user_token_expired', 'User token has expired');
      }
      throw invalidToken(error instanceof Error ? error.message : 'unknown');
    }
  }
}

function invalidToken(reason: string): AiBridgeError {
  return new AiBridgeError(
    'user_token_invalid',
    `User token is invalid: ${reason}`,
  );
}
