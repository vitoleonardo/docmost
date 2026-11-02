import {
  Body,
  Controller,
  Res,
  HttpCode,
  HttpStatus,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { User } from '@docmost/db/types/entity.types';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import {
  AiBridgeUser,
  AiBridgeUserToken,
} from './decorators/ai-bridge-auth.decorator';
import {
  AttachmentIdDto,
  FilterPagesDto,
  PageIdDto,
  PageListDto,
  ReadBlocksToolDto,
  SearchToolDto,
  TaskTokenDto,
} from './dto/ai-bridge-internal.dto';
import { AiBridgeExceptionFilter } from './filters/ai-bridge-exception.filter';
import { AiInternalAuthGuard } from './guards/ai-internal-auth.guard';
import {
  AiAgentToolsService,
  AiReadBlocksResult,
} from './services/ai-agent-tools.service';
import {
  AiContentService,
  AiPageContent,
  AiReadPageResult,
  AiSearchResults,
} from './services/ai-content.service';
import { AiPageAccessService } from './services/ai-page-access.service';
import { AiPageList, AiPageListService } from './services/ai-page-list.service';
import { AiTokenService } from './services/ai-token.service';

@UseGuards(AiInternalAuthGuard)
@UseFilters(AiBridgeExceptionFilter)
@Controller('ai-bridge/internal')
export class AiBridgeInternalController {
  constructor(
    private readonly aiPageAccessService: AiPageAccessService,
    private readonly aiTokenService: AiTokenService,
    private readonly aiContentService: AiContentService,
    private readonly aiPageListService: AiPageListService,
    private readonly aiAgentToolsService: AiAgentToolsService,
  ) {}

  @SkipTransform()
  @AiBridgeUserToken({ allowTask: true })
  @HttpCode(HttpStatus.OK)
  @Post('filter-pages')
  async filterPages(
    @Body() dto: FilterPagesDto,
    @AiBridgeUser() user: User,
  ): Promise<{ pageIds: string[] }> {
    const pageIds = await this.aiPageAccessService.filterViewablePageIds(
      user,
      dto.pageIds,
      dto.spaceId,
    );
    return { pageIds };
  }

  @SkipTransform()
  @AiBridgeUserToken({ allowTask: false })
  @HttpCode(HttpStatus.OK)
  @Post('task-token')
  async taskToken(
    @Body() dto: TaskTokenDto,
    @AiBridgeUser() user: User,
  ): Promise<{ taskToken: string; expiresAt: string }> {
    return this.aiTokenService.issueTaskToken(user, dto.runId);
  }

  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @Post('pages')
  async pages(@Body() dto: PageListDto): Promise<AiPageList> {
    return this.aiPageListService.listPages(dto.cursor);
  }

  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @Post('page-content')
  async pageContent(@Body() dto: PageIdDto): Promise<AiPageContent> {
    return this.aiContentService.getPageContent(dto.pageId);
  }

  @SkipTransform()
  @HttpCode(HttpStatus.OK)
  @Post('attachment')
  async attachment(
    @Body() dto: AttachmentIdDto,
    @Res() reply: FastifyReply,
  ): Promise<FastifyReply> {
    const { stream, mimeType } = await this.aiContentService.getAttachmentFile(
      dto.attachmentId,
    );
    reply.headers({ 'Content-Type': mimeType });
    return reply.send(stream);
  }

  @SkipTransform()
  @AiBridgeUserToken({ allowTask: true })
  @HttpCode(HttpStatus.OK)
  @Post('tools/read-page')
  async readPage(
    @Body() dto: PageIdDto,
    @AiBridgeUser() user: User,
  ): Promise<AiReadPageResult> {
    return this.aiContentService.readPage(user, dto.pageId);
  }

  @SkipTransform()
  @AiBridgeUserToken({ allowTask: true })
  @HttpCode(HttpStatus.OK)
  @Post('tools/search')
  async search(
    @Body() dto: SearchToolDto,
    @AiBridgeUser() user: User,
  ): Promise<AiSearchResults> {
    return this.aiContentService.searchSpace(user, dto.spaceId, dto.query);
  }

  @SkipTransform()
  @AiBridgeUserToken({ allowTask: true })
  @HttpCode(HttpStatus.OK)
  @Post('tools/read-blocks')
  async readBlocks(
    @Body() dto: ReadBlocksToolDto,
    @AiBridgeUser() user: User,
  ): Promise<AiReadBlocksResult> {
    return this.aiAgentToolsService.readBlocks(user, dto.pageId, dto.spaceId);
  }
}
