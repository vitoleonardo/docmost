import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AiAgentController } from './ai-agent.controller';
import { AiBridgeController } from './ai-bridge.controller';
import { AiBridgeInternalController } from './ai-bridge-internal.controller';
import { AiPageListRepo } from '@docmost/db/repos/page/ai-page-list.repo';
import { SearchModule } from '../../core/search/search.module';
import { CollaborationModule } from '../../collaboration/collaboration.module';
import { AiQueueProcessor } from './ai-queue.processor';
import { AiAgentService } from './services/ai-agent.service';
import { AiAgentProposalRecords } from './services/ai-agent-proposal-records.service';
import { AiAgentProposalService } from './services/ai-agent-proposal.service';
import { AiAgentToolsService } from './services/ai-agent-tools.service';
import { AiAskService } from './services/ai-ask.service';
import { AiInternalAuthGuard } from './guards/ai-internal-auth.guard';
import { AiExtractService } from './services/ai-extract.service';
import { AiContentService } from './services/ai-content.service';
import { AiLiveDocumentService } from './services/ai-live-document.service';
import { AiPageAccessService } from './services/ai-page-access.service';
import { AiPageListService } from './services/ai-page-list.service';
import { AiServiceClient } from './services/ai-service.client';
import { AiStatusService } from './services/ai-status.service';
import { AiTokenService } from './services/ai-token.service';

@Module({
  imports: [JwtModule.register({}), SearchModule, CollaborationModule],
  controllers: [
    AiBridgeController,
    AiAgentController,
    AiBridgeInternalController,
  ],
  providers: [
    AiAgentService,
    AiAgentProposalRecords,
    AiAgentProposalService,
    AiAgentToolsService,
    AiAskService,
    AiExtractService,
    AiLiveDocumentService,
    AiPageAccessService,
    AiTokenService,
    AiContentService,
    AiInternalAuthGuard,
    AiServiceClient,
    AiStatusService,
    AiQueueProcessor,
    AiPageListRepo,
    AiPageListService,
  ],
})
export class AiBridgeModule {}
