import { Injectable, Logger } from '@nestjs/common';
import { User } from '@docmost/db/types/entity.types';
import { CollaborationGateway } from '../../../collaboration/collaboration.gateway';
import { AiBridgeError } from '../ai-bridge.errors';
import { AgentApplyResult, AgentBlockRead } from './agent-document';
import { describeError } from './ai-content.service';
import { AiServiceAgentProposal } from './ai-service.client';

@Injectable()
export class AiLiveDocumentService {
  constructor(private readonly collaborationGateway: CollaborationGateway) {}

  private readonly logger = new Logger(AiLiveDocumentService.name);

  async readBlocks(pageId: string): Promise<AgentBlockRead> {
    let read: AgentBlockRead | undefined;
    try {
      read = await this.collaborationGateway.handleYjsEvent(
        'readAgentBlocks',
        `page.${pageId}`,
        undefined,
      );
    } catch (error) {
      throw new AiBridgeError(
        'assistant_unavailable',
        `Reading the live document failed: ${describeError(error)}`,
      );
    }
    if (!read) {
      throw new AiBridgeError(
        'assistant_unavailable',
        'The live document cannot be reached: collaboration events need Redis',
      );
    }
    return read;
  }

  async writeChanges(
    user: User,
    { id, pageId, fingerprint, changes }: AiServiceAgentProposal,
  ): Promise<AgentApplyResult | 'failed'> {
    try {
      const result = await this.collaborationGateway.handleYjsEvent(
        'applyAgentChanges',
        `page.${pageId}`,
        {
          fingerprint,
          changes: changes.map(({ block, oldText, ops }) => ({
            block,
            oldText,
            ops,
          })),
          user,
        },
      );
      if (result) return result;
      this.logger.warn(
        `Writing proposal ${id} failed: the live document cannot be reached, collaboration events need Redis`,
      );
    } catch (error) {
      this.logger.warn(
        `Writing proposal ${id} failed: ${describeError(error)}`,
      );
    }
    return 'failed';
  }
}
