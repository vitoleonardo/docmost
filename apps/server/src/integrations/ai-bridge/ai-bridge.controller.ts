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
import { AiAgentRunDto } from './dto/ai-agent.dto';
import { AiAskDto } from './dto/ai-ask.dto';
import { AiBridgeExceptionFilter } from './filters/ai-bridge-exception.filter';
import { AiExtractDto } from './dto/ai-extract.dto';
import { KnownBodyFieldsGuard } from './guards/known-body-fields.guard';
import { AiAgentService } from './services/ai-agent.service';
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
    private readonly aiAgentService: AiAgentService,
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

  @UseGuards(KnownBodyFieldsGuard)
  @UseFilters(AiBridgeExceptionFilter)
  @HttpCode(HttpStatus.OK)
  @Post('agent/run')
  agentRun(
    @Body() { spaceId, task }: AiAgentRunDto,
    @AuthUser() user: User,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    return streamServerSentEvents(reply, (signal) =>
      this.aiAgentService.run(user, { spaceId, task }, signal),
    );
  }
}

function abortedWhenClientLeaves(reply: FastifyReply): AbortSignal {
  const clientGone = new AbortController();
  reply.raw.on('close', () => clientGone.abort());
  return clientGone.signal;
}

async function streamServerSentEvents(
  reply: FastifyReply,
  open: (signal: AbortSignal) => Promise<AsyncIterable<object> | null>,
): Promise<void> {
  const events = await open(abortedWhenClientLeaves(reply));
  if (!events) return;

  reply.hijack();
  for (const [name, value] of Object.entries(reply.getHeaders())) {
    if (value !== undefined) reply.raw.setHeader(name, value);
  }
  reply.raw.writeHead(HttpStatus.OK, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    'x-accel-buffering': 'no',
  });
  for await (const event of events) {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  reply.raw.end();
}
