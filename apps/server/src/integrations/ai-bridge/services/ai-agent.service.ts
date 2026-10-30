import { Injectable, Logger } from '@nestjs/common';
import { User } from '@docmost/db/types/entity.types';
import { EnvironmentService } from '../../environment/environment.service';
import { AiBridgeError, assertAssistantEnabled } from '../ai-bridge.errors';
import { AiAgentRunDto } from '../dto/ai-agent.dto';
import { describeError } from './ai-content.service';
import { AiPageAccessService } from './ai-page-access.service';
import {
  AiServiceAgentEvent,
  AiServiceClient,
  AiServiceUnreachableError,
} from './ai-service.client';
import { AiTokenService } from './ai-token.service';

@Injectable()
export class AiAgentService {
  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly aiTokenService: AiTokenService,
    private readonly aiServiceClient: AiServiceClient,
    private readonly aiPageAccessService: AiPageAccessService,
  ) {}

  private readonly logger = new Logger(AiAgentService.name);

  async run(
    user: User,
    { spaceId, task }: AiAgentRunDto,
    signal: AbortSignal,
  ): Promise<AsyncGenerator<AiServiceAgentEvent> | null> {
    assertAssistantEnabled(this.environmentService.isAiBridgeConfigured());
    const readableSpaceIds = await this.aiPageAccessService.readableSpaceIds(
      user.id,
      user.workspaceId,
    );
    if (!readableSpaceIds.includes(spaceId)) {
      throw new AiBridgeError('space_not_found', 'Space not found');
    }
    const userToken = await this.aiTokenService.issueUserToken(user);
    const upstream = await this.aiServiceClient
      .agentRun(userToken, { spaceId, task }, signal)
      .catch((error: unknown) => {
        if (signal.aborted) return null;
        if (!(error instanceof AiServiceUnreachableError)) throw error;
        this.logger.warn(`AI service refused the run: ${error.message}`);
        throw new AiBridgeError(
          'assistant_unavailable',
          'The AI service is not available',
        );
      });
    if (!upstream) return null;
    return this.relay(upstream, signal);
  }

  private async *relay(
    upstream: AsyncGenerator<AiServiceAgentEvent>,
    signal: AbortSignal,
  ): AsyncGenerator<AiServiceAgentEvent> {
    try {
      yield* upstream;
    } catch (error) {
      if (signal.aborted) return;
      this.logger.warn(`Relaying the run failed: ${describeError(error)}`);
    }
  }
}
