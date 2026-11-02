import { Injectable } from '@nestjs/common';
import { User } from '@docmost/db/types/entity.types';
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
    const page = await this.aiPageAccessService.requireViewablePage(
      user,
      pageId,
      spaceId,
    );
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
