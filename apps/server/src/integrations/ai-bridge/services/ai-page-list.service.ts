import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { AiPageListRepo } from '@docmost/db/repos/page/ai-page-list.repo';
import { EnvironmentService } from '../../environment/environment.service';
import { AiBridgeError } from '../ai-bridge.errors';
import { toIsoTimestamp } from './ai-content.service';

const PAGE_LIST_SIZE = 500;
const CURSOR_SEPARATOR = '.';

export interface AiPageList {
  pages: { id: string; spaceId: string; updatedAt: string }[];
  nextCursor: string | null;
}

const invalidCursor = () =>
  new AiBridgeError(
    'invalid_request',
    'cursor was not returned by the page list',
  );

@Injectable()
export class AiPageListService {
  constructor(
    private readonly aiPageListRepo: AiPageListRepo,
    private readonly environmentService: EnvironmentService,
  ) {}

  async listPages(cursor: string | null | undefined): Promise<AiPageList> {
    const afterId = cursor == null ? undefined : this.pageIdOfCursor(cursor);
    const { pages, hasNextPage } = await this.aiPageListRepo.listIndexablePages(
      afterId,
      PAGE_LIST_SIZE,
    );
    return {
      pages: pages.map((page) => ({
        id: page.id,
        spaceId: page.spaceId,
        updatedAt: toIsoTimestamp(page.updatedAt),
      })),
      nextCursor: hasNextPage
        ? this.cursorAfter(pages[pages.length - 1].id)
        : null,
    };
  }

  private cursorAfter(pageId: string): string {
    return `${pageId}${CURSOR_SEPARATOR}${this.signature(pageId)}`;
  }

  private pageIdOfCursor(cursor: string): string {
    const parts = cursor.split(CURSOR_SEPARATOR);
    if (parts.length !== 2) throw invalidCursor();
    const [pageId, given] = parts;
    const expected = Buffer.from(this.signature(pageId));
    const actual = Buffer.from(given);
    const signed =
      actual.length === expected.length && timingSafeEqual(actual, expected);
    if (!signed || !isUUID(pageId)) throw invalidCursor();
    return pageId;
  }

  private signature(pageId: string): string {
    const secret = this.environmentService.getAiBridgeSecret();
    if (!secret) {
      throw new AiBridgeError(
        'assistant_disabled',
        'AI bridge secret is not configured',
      );
    }
    return createHmac('sha256', secret).update(pageId).digest('base64url');
  }
}
