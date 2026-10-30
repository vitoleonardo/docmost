import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { User } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AiAskDto } from './dto/ai-ask.dto';
import { AiBridgeExceptionFilter } from './filters/ai-bridge-exception.filter';
import { AiExtractDto } from './dto/ai-extract.dto';
import {
  abortedWhenClientLeaves,
  streamServerSentEvents,
} from './server-sent-events';
import { AiAskService } from './services/ai-ask.service';
import { AiExtractService } from './services/ai-extract.service';
import { AiServiceExtractResult } from './services/ai-service.client';
import {
  AiAssistantStatus,
  AiStatusService,
} from './services/ai-status.service';

@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiBridgeController {
  constructor(
    private readonly aiStatusService: AiStatusService,
    private readonly aiAskService: AiAskService,
    private readonly aiExtractService: AiExtractService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('status')
  status(@AuthUser() user: User): Promise<{ status: AiAssistantStatus }> {
    return this.aiStatusService.status(user);
  }

  @UseFilters(AiBridgeExceptionFilter)
  @HttpCode(HttpStatus.OK)
  @Post('ask')
  ask(
    @Body() dto: AiAskDto,
    @AuthUser() user: User,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return streamServerSentEvents(reply, (signal) =>
      this.aiAskService.ask(user, dto, signal),
    );
  }

  @UseFilters(AiBridgeExceptionFilter)
  @HttpCode(HttpStatus.OK)
  @Post('extract')
  extract(
    @Body() dto: AiExtractDto,
    @AuthUser() user: User,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<AiServiceExtractResult | null> {
    return this.aiExtractService.extract(
      user,
      dto,
      abortedWhenClientLeaves(reply),
    );
  }
}
