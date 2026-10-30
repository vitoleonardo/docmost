import { Injectable } from '@nestjs/common';
import { User } from '@docmost/db/types/entity.types';
import { CollaborationGateway } from '../../../collaboration/collaboration.gateway';
import { AiBridgeError } from '../ai-bridge.errors';
import { AgentBlock, AgentBlockRead } from './agent-document';
import { describeError } from './ai-content.service';
import { AiPageAccessService } from './ai-page-access.service';

export interface AiReadBlocksResult {
  id: string;
  title: string;
  spaceId: string;
  fingerprint: string;
  blocks: AgentBlock[];
}

@Injectable()
export class AiAgentToolsService {
  constructor(
    private readonly aiPageAccessService: AiPageAccessService,
    private readonly collaborationGateway: CollaborationGateway,
  ) {}

  async readBlocks(
    user: User,
    pageId: string,
    spaceId: string,
  ): Promise<AiReadBlocksResult> {
    const page = await this.aiPageAccessService.findViewablePage(user, pageId);
    if (!page || page.spaceId !== spaceId) {
      throw new AiBridgeError('page_not_found', 'Page not found');
    }
    const { fingerprint, blocks } = await this.readLiveBlocks(page.id);
    return {
      id: page.id,
      title: page.title,
      spaceId: page.spaceId,
      fingerprint,
      blocks,
    };
  }

  private async readLiveBlocks(pageId: string): Promise<AgentBlockRead> {
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
}
