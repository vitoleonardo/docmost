import { Injectable, Logger } from '@nestjs/common';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { Page, Space, User } from '@docmost/db/types/entity.types';
import { jsonToMarkdown } from '../../../collaboration/collaboration.util';
import { EnvironmentService } from '../../environment/environment.service';
import { AiBridgeError } from '../ai-bridge.errors';
import { AiAskDto } from '../dto/ai-ask.dto';
import { describeError } from './ai-content.service';
import { AiPageAccessService } from './ai-page-access.service';
import {
  AiServiceAskEvent,
  AiServiceCitation,
  AiServiceClient,
  AiServiceUnreachableError,
} from './ai-service.client';
import { AiTokenService } from './ai-token.service';

const MARKDOWN_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;

export interface AiAskSource {
  number: number;
  pageId: string;
  title: string;
  spaceName: string;
  headingPath: string[];
  fileName: string | null;
  pdfPage: number | null;
  url: string;
}

export type AiAskEvent =
  | { type: 'delta'; text: string }
  | { type: 'sources'; sources: AiAskSource[] }
  | { type: 'no_source' }
  | { type: 'error'; code: 'model_unavailable' };

const NO_SOURCE: AiAskEvent = { type: 'no_source' };
const MODEL_UNAVAILABLE: AiAskEvent = {
  type: 'error',
  code: 'model_unavailable',
};

interface ProseMirrorNode {
  type?: string;
  attrs?: { id?: unknown; level?: unknown };
  content?: ProseMirrorNode[];
}

@Injectable()
export class AiAskService {
  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly aiTokenService: AiTokenService,
    private readonly aiServiceClient: AiServiceClient,
    private readonly aiPageAccessService: AiPageAccessService,
    private readonly spaceRepo: SpaceRepo,
  ) {}

  private readonly logger = new Logger(AiAskService.name);

  async ask(
    user: User,
    dto: AiAskDto,
    signal: AbortSignal,
  ): Promise<AsyncGenerator<AiAskEvent>> {
    if (!this.environmentService.isAiBridgeConfigured()) {
      throw new AiBridgeError(
        'assistant_disabled',
        'The assistant is switched off',
      );
    }
    await this.checkScope(user, dto);
    const userToken = await this.aiTokenService.issueUserToken(user);
    const upstream = await this.aiServiceClient
      .ask(
        userToken,
        {
          question: dto.question,
          conversationId: dto.conversationId,
          ...(dto.spaceId ? { spaceId: dto.spaceId } : {}),
          ...(dto.pageId ? { pageId: dto.pageId } : {}),
        },
        signal,
      )
      .catch((error: unknown) => {
        if (!(error instanceof AiServiceUnreachableError)) throw error;
        this.logger.warn(`AI service refused the question: ${error.message}`);
        throw new AiBridgeError(
          'assistant_unavailable',
          'The AI service is not available',
        );
      });
    return this.relay(user, upstream, signal);
  }

  private async checkScope(user: User, dto: AiAskDto): Promise<void> {
    if (dto.spaceId) {
      const readableSpaceIds = await this.aiPageAccessService.readableSpaceIds(
        user.id,
        user.workspaceId,
      );
      if (!readableSpaceIds.includes(dto.spaceId)) {
        throw new AiBridgeError('space_not_found', 'Space not found');
      }
    }
    if (dto.pageId) {
      const page = await this.aiPageAccessService.findViewablePage(
        user,
        dto.pageId,
      );
      if (!page) throw new AiBridgeError('page_not_found', 'Page not found');
    }
  }

  private async *relay(
    user: User,
    upstream: AsyncGenerator<AiServiceAskEvent>,
    signal: AbortSignal,
  ): AsyncGenerator<AiAskEvent> {
    try {
      for await (const event of upstream) {
        if (event.type === 'delta') {
          yield { type: 'delta', text: event.text };
          continue;
        }
        yield await this.finalEvent(user, event);
        return;
      }
      this.logger.warn('AI service ended the answer without a final event');
    } catch (error) {
      if (signal.aborted) return;
      this.logger.warn(`Relaying the answer failed: ${describeError(error)}`);
    }
    yield MODEL_UNAVAILABLE;
  }

  private async finalEvent(
    user: User,
    event: Exclude<AiServiceAskEvent, { type: 'delta' }>,
  ): Promise<AiAskEvent> {
    switch (event.type) {
      case 'citations':
        return this.checkedSources(user, event.citations);
      case 'no_source':
        return NO_SOURCE;
      case 'error':
        return MODEL_UNAVAILABLE;
    }
  }

  private async checkedSources(
    user: User,
    citations: AiServiceCitation[],
  ): Promise<AiAskEvent> {
    const pageIds = [...new Set(citations.map((cited) => cited.pageId))];
    if (pageIds.length === 0) return NO_SOURCE;

    const pages = new Map<string, Page>();
    const spaces = new Map<string, Space>();
    for (const pageId of pageIds) {
      const page = await this.aiPageAccessService.findViewablePage(
        user,
        pageId,
      );
      if (!page) return NO_SOURCE;
      pages.set(pageId, page);
      if (spaces.has(page.spaceId)) continue;
      const space = await this.spaceRepo.findById(
        page.spaceId,
        user.workspaceId,
      );
      if (!space) return NO_SOURCE;
      spaces.set(page.spaceId, space);
    }

    return {
      type: 'sources',
      sources: citations.map((cited) => {
        const page = pages.get(cited.pageId)!;
        const space = spaces.get(page.spaceId)!;
        const anchor = cited.attachmentId
          ? undefined
          : headingAnchor(page.content, cited.headingPath);
        return {
          number: cited.number,
          pageId: page.id,
          title: page.title ?? '',
          spaceName: space.name,
          headingPath: cited.headingPath,
          fileName: cited.fileName,
          pdfPage: cited.pdfPage,
          url: pageUrl(space.slug, page.slugId, anchor),
        };
      }),
    };
  }
}

function pageUrl(spaceSlug: string, slugId: string, anchor?: string): string {
  const url = `/s/${spaceSlug}/p/${slugId}`;
  return anchor ? `${url}#${anchor}` : url;
}

function headingAnchor(
  content: unknown,
  headingPath: string[],
): string | undefined {
  if (headingPath.length === 0) return undefined;
  const nodes = (content as ProseMirrorNode | null)?.content ?? [];
  let stack: { level: number; title: string }[] = [];
  for (const node of nodes) {
    const level = node.type === 'heading' ? Number(node.attrs?.level) : NaN;
    if (!Number.isInteger(level)) continue;
    stack = [
      ...stack.filter((entry) => entry.level < level),
      { level, title: headingTitle(node) },
    ];
    const id = node.attrs?.id;
    if (typeof id === 'string' && id && samePath(stack, headingPath)) {
      return id;
    }
  }
  return undefined;
}

function headingTitle(node: ProseMirrorNode): string {
  const markdown = jsonToMarkdown({ type: 'doc', content: [node] }).trim();
  return MARKDOWN_HEADING.exec(markdown)?.[2]?.trim() ?? '';
}

function samePath(stack: { title: string }[], headingPath: string[]): boolean {
  return (
    stack.length === headingPath.length &&
    stack.every((entry, index) => entry.title === headingPath[index])
  );
}
