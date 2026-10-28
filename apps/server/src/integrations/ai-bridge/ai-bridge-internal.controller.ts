import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { User } from '@docmost/db/types/entity.types';
import { SkipTransform } from '../../common/decorators/skip-transform.decorator';
import {
  AiBridgeUser,
  AiBridgeUserToken,
} from './decorators/ai-bridge-auth.decorator';
import { FilterPagesDto, TaskTokenDto } from './dto/ai-bridge-internal.dto';
import { AiBridgeExceptionFilter } from './filters/ai-bridge-exception.filter';
import { AiInternalAuthGuard } from './guards/ai-internal-auth.guard';
import { AiPageAccessService } from './services/ai-page-access.service';
import { AiTokenService } from './services/ai-token.service';

@UseGuards(AiInternalAuthGuard)
@UseFilters(AiBridgeExceptionFilter)
@Controller('ai-bridge/internal')
export class AiBridgeInternalController {
  constructor(
    private readonly aiPageAccessService: AiPageAccessService,
    private readonly aiTokenService: AiTokenService,
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
}
