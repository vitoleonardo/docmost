import { Injectable } from '@nestjs/common';
import { User } from '@docmost/db/types/entity.types';
import { AiBridgeError } from '../ai-bridge.errors';
import { AgentBlock } from './agent-document';
import { AiLiveDocumentService } from './ai-live-document.service';
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
    private readonly aiLiveDocumentService: AiLiveDocumentService,
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
    const { fingerprint, blocks } = await this.aiLiveDocumentService.readBlocks(
      page.id,
    );
    return {
      id: page.id,
      title: page.title,
      spaceId: page.spaceId,
      fingerprint,
      blocks,
    };
  }
}
