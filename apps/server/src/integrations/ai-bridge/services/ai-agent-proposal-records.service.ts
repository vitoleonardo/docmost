import { Injectable, Logger } from '@nestjs/common';
import { User } from '@docmost/db/types/entity.types';
import { EnvironmentService } from '../../environment/environment.service';
import { AiBridgeError, assertAssistantEnabled } from '../ai-bridge.errors';
import {
  AiAgentProposalStatus,
  AiServiceAgentProposal,
  AiServiceClient,
  AiServiceMalformedResponseError,
  AiServiceUnreachableError,
} from './ai-service.client';
import { AiTokenService } from './ai-token.service';

@Injectable()
export class AiAgentProposalRecords {
  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly aiTokenService: AiTokenService,
    private readonly aiServiceClient: AiServiceClient,
  ) {}

  private readonly logger = new Logger(AiAgentProposalRecords.name);

  async get(user: User, proposalId: string): Promise<AiServiceAgentProposal> {
    const userToken = await this.userTokenOf(user);
    return this.fromAiService(
      this.aiServiceClient.agentProposal(userToken, proposalId),
    );
  }

  async transition(
    user: User,
    proposalId: string,
    to: AiAgentProposalStatus,
  ): Promise<AiServiceAgentProposal> {
    const userToken = await this.userTokenOf(user);
    return this.fromAiService(
      this.aiServiceClient.transitionAgentProposal(userToken, proposalId, to),
    );
  }

  private userTokenOf(user: User): Promise<string> {
    assertAssistantEnabled(this.environmentService.isAiBridgeConfigured());
    return this.aiTokenService.issueUserToken(user);
  }

  private fromAiService<T>(call: Promise<T>): Promise<T> {
    return call.catch((error: unknown) => {
      if (
        !(error instanceof AiServiceUnreachableError) &&
        !(error instanceof AiServiceMalformedResponseError)
      ) {
        throw error;
      }
      this.logger.warn(
        `AI service did not answer the proposal request: ${error.message}`,
      );
      throw new AiBridgeError(
        'assistant_unavailable',
        'The AI service is not available',
      );
    });
  }
}
