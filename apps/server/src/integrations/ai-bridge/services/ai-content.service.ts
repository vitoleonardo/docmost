import { Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { Page, User } from '@docmost/db/types/entity.types';
import { jsonToMarkdown } from '../../../collaboration/collaboration.util';
import { SearchService } from '../../../core/search/search.service';
import { StorageService } from '../../storage/storage.service';
import { AiBridgeError } from '../ai-bridge.errors';
import { AiPageAccessService } from './ai-page-access.service';

export const PDF_MIME_TYPE = 'application/pdf';
const ATTACHMENT_PAGE_SIZE = 100;
const MAX_SEARCH_RESULTS = 20;
const SEARCH_WINDOW_SIZE = 100;
const MAX_SEARCH_WINDOWS = 5;

export interface AiPageContent {
  id: string;
  title: string;
  spaceId: string;
  workspaceId: string;
  updatedAt: string;
  markdown: string;
  attachments: AiPageAttachment[];
}

interface AiPageAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

interface AiAttachmentFile {
  stream: Readable;
  mimeType: string;
}

export interface AiReadPageResult {
  id: string;
  title: string;
  spaceId: string;
  markdown: string;
}

export interface AiSearchResults {
  results: { id: string; title: string; spaceId: string }[];
}

@Injectable()
export class AiContentService {
  constructor(
    private readonly pageRepo: PageRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly attachmentRepo: AttachmentRepo,
    private readonly storageService: StorageService,
    private readonly searchService: SearchService,
    private readonly aiPageAccessService: AiPageAccessService,
  ) {}

  async getPageContent(pageId: string): Promise<AiPageContent> {
    const page = await this.pageRepo.findById(pageId, { includeContent: true });
    if (!page || page.deletedAt) throw pageNotFound();
    const space = await this.spaceRepo.findById(page.spaceId, page.workspaceId);
    if (!space || space.deletedAt) throw pageNotFound();

    return {
      id: page.id,
      title: page.title,
      spaceId: page.spaceId,
      workspaceId: page.workspaceId,
      updatedAt: toIsoTimestamp(page.updatedAt),
      markdown: toMarkdown(page),
      attachments: await this.listPdfAttachments(page.id),
    };
  }

  async getAttachmentFile(attachmentId: string): Promise<AiAttachmentFile> {
    const attachment = await this.attachmentRepo.findById(attachmentId);
    if (!attachment || attachment.deletedAt || !attachment.pageId) {
      throw attachmentNotFound();
    }
    const page = await this.pageRepo.findById(attachment.pageId);
    if (!page || page.deletedAt) throw attachmentNotFound();

    return {
      stream: await this.openStoredFile(attachment.id, attachment.filePath),
      mimeType: attachment.mimeType,
    };
  }

  private async openStoredFile(
    attachmentId: string,
    filePath: string,
  ): Promise<Readable> {
    try {
      return await this.storageService.readStream(filePath);
    } catch (error) {
      const reason = describeError(error);
      let exists: boolean;
      try {
        exists = await this.storageService.exists(filePath);
      } catch (existsError) {
        throw new Error(
          `Reading the stored file of attachment ${attachmentId} failed: ${reason}; checking that it exists failed: ${describeError(existsError)}`,
        );
      }
      if (!exists) throw attachmentNotFound();
      throw new Error(
        `Reading the stored file of attachment ${attachmentId} failed: ${reason}`,
      );
    }
  }

  async readPage(user: User, pageId: string): Promise<AiReadPageResult> {
    const page = await this.aiPageAccessService.findViewablePage(user, pageId);
    if (!page) throw pageNotFound();

    return {
      id: page.id,
      title: page.title,
      spaceId: page.spaceId,
      markdown: toMarkdown(page),
    };
  }

  async searchSpace(
    user: User,
    spaceId: string,
    query: string,
  ): Promise<AiSearchResults> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) {
      throw new AiBridgeError('invalid_request', 'query must not be empty');
    }
    const readableSpaceIds = await this.aiPageAccessService.readableSpaceIds(
      user.id,
      user.workspaceId,
    );
    if (!readableSpaceIds.includes(spaceId)) {
      throw new AiBridgeError('space_not_found', 'Space not found');
    }

    const results: AiSearchResults['results'] = [];
    const collectedIds = new Set<string>();
    for (
      let window = 0;
      window < MAX_SEARCH_WINDOWS && results.length < MAX_SEARCH_RESULTS;
      window++
    ) {
      const { items } = await this.searchService.searchPage(
        {
          query: trimmedQuery,
          spaceId,
          limit: SEARCH_WINDOW_SIZE,
          offset: window * SEARCH_WINDOW_SIZE,
        },
        { userId: user.id, workspaceId: user.workspaceId },
      );
      const inSpace = items.filter((item) => item.space?.id === spaceId);
      const viewableIds = new Set(
        await this.aiPageAccessService.filterViewablePageIds(
          user,
          inSpace.map((item) => item.id),
        ),
      );
      for (const item of inSpace) {
        if (!viewableIds.has(item.id) || collectedIds.has(item.id)) continue;
        collectedIds.add(item.id);
        results.push({ id: item.id, title: item.title, spaceId });
      }
    }
    return { results: results.slice(0, MAX_SEARCH_RESULTS) };
  }

  private async listPdfAttachments(
    pageId: string,
  ): Promise<AiPageAttachment[]> {
    const pdfs: AiPageAttachment[] = [];
    let cursor: string | undefined;
    do {
      const { items, meta } = await this.attachmentRepo.findPageAttachments(
        pageId,
        Object.assign(new PaginationOptions(), {
          limit: ATTACHMENT_PAGE_SIZE,
          cursor,
        }),
      );
      for (const attachment of items) {
        if (attachment.mimeType !== PDF_MIME_TYPE) continue;
        pdfs.push({
          id: attachment.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          fileSize: Number(attachment.fileSize),
        });
      }
      cursor = meta.hasNextPage ? meta.nextCursor : undefined;
    } while (cursor);
    return pdfs;
  }
}

function toMarkdown(page: Page): string {
  return page.content ? jsonToMarkdown(page.content) : '';
}

export function toIsoTimestamp(value: Date): string {
  return new Date(value).toISOString();
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pageNotFound(): AiBridgeError {
  return new AiBridgeError('page_not_found', 'Page not found');
}

function attachmentNotFound(): AiBridgeError {
  return new AiBridgeError('attachment_not_found', 'Attachment not found');
}
