import { Injectable, Logger } from '@nestjs/common';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { User } from '@docmost/db/types/entity.types';
import { CollaborationGateway } from '../../../collaboration/collaboration.gateway';
import { AiBridgeError } from '../ai-bridge.errors';
import {
  AgentApplyResult,
  AgentBlockRead,
  readAgentBlocks,
  storedPageDocument,
} from './agent-document';
import { describeError } from './ai-content.service';
import { AiServiceAgentProposal } from './ai-service.client';

@Injectable()
export class AiLiveDocumentService {
  constructor(
    private readonly collaborationGateway: CollaborationGateway,
    private readonly pageRepo: PageRepo,
  ) {}

  private readonly logger = new Logger(AiLiveDocumentService.name);

  async readBlocks(pageId: string): Promise<AgentBlockRead> {
    const live = await this.readHeldBlocks(pageId);
    return live ?? this.readStoredBlocks(pageId);
  }

  private async readHeldBlocks(
    pageId: string,
  ): Promise<AgentBlockRead | null | undefined> {
    try {
      return await this.collaborationGateway.handleYjsEvent(
        'readAgentBlocks',
        `page.${pageId}`,
        undefined,
        true,
      );
    } catch (error) {
      throw new AiBridgeError(
        'assistant_unavailable',
        `Reading the live document failed: ${describeError(error)}`,
      );
    }
  }

  private async readStoredBlocks(pageId: string): Promise<AgentBlockRead> {
    const page = await this.pageRepo.findById(pageId, {
      includeContent: true,
      includeYdoc: true,
    });
    if (!page) throw new AiBridgeError('page_not_found', 'Page not found');
    const doc = storedPageDocument(page);
    try {
      return readAgentBlocks(doc);
    } finally {
      doc.destroy();
    }
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
