import { Injectable } from '@nestjs/common';
import { AiPageListRepo } from '@docmost/db/repos/page/ai-page-list.repo';
import { toIsoTimestamp } from './ai-content.service';

const PAGE_LIST_SIZE = 500;

export interface AiPageList {
  pages: { id: string; spaceId: string; updatedAt: string }[];
  nextCursor: string | null;
}

@Injectable()
export class AiPageListService {
  constructor(private readonly aiPageListRepo: AiPageListRepo) {}

  async listPages(cursor: string | undefined): Promise<AiPageList> {
    const { pages, hasNextPage } = await this.aiPageListRepo.listIndexablePages(
      cursor,
      PAGE_LIST_SIZE,
    );
    return {
      pages: pages.map((page) => ({
        id: page.id,
        spaceId: page.spaceId,
        updatedAt: toIsoTimestamp(page.updatedAt),
      })),
      nextCursor: hasNextPage ? pages[pages.length - 1].id : null,
    };
  }
}
