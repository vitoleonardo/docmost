import { User } from '@docmost/db/types/entity.types';
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
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AiAgentProposalDto, AiAgentRunDto } from './dto/ai-agent.dto';
import { AiBridgeExceptionFilter } from './filters/ai-bridge-exception.filter';
import { KnownBodyFieldsGuard } from './guards/known-body-fields.guard';
import { streamServerSentEvents } from './server-sent-events';
import {
  AiAgentProposalService,
  AiAgentProposalView,
} from './services/ai-agent-proposal.service';
import { AiAgentService } from './services/ai-agent.service';

@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiAgentController {
  constructor(
    private readonly aiAgentService: AiAgentService,
    private readonly aiAgentProposalService: AiAgentProposalService,
  ) {}

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

  @UseGuards(KnownBodyFieldsGuard)
  @UseFilters(AiBridgeExceptionFilter)
  @HttpCode(HttpStatus.OK)
  @Post('agent/proposal')
  agentProposal(
    @Body() { proposalId }: AiAgentProposalDto,
    @AuthUser() user: User,
  ): Promise<AiAgentProposalView> {
    return this.aiAgentProposalService.viewProposal(user, proposalId);
  }

  @UseGuards(KnownBodyFieldsGuard)
  @UseFilters(AiBridgeExceptionFilter)
  @HttpCode(HttpStatus.OK)
  @Post('agent/proposal/apply')
  agentProposalApply(
    @Body() { proposalId }: AiAgentProposalDto,
    @AuthUser() user: User,
  ): Promise<{ status: 'applied' }> {
    return this.aiAgentProposalService.applyProposal(user, proposalId);
  }

  @UseGuards(KnownBodyFieldsGuard)
  @UseFilters(AiBridgeExceptionFilter)
  @HttpCode(HttpStatus.OK)
  @Post('agent/proposal/discard')
  agentProposalDiscard(
    @Body() { proposalId }: AiAgentProposalDto,
    @AuthUser() user: User,
  ): Promise<{ status: 'discarded' }> {
    return this.aiAgentProposalService.discardProposal(user, proposalId);
  }
}
