import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AiBridgeController } from './ai-bridge.controller';
import { AiBridgeInternalController } from './ai-bridge-internal.controller';
import { AiPageListRepo } from '@docmost/db/repos/page/ai-page-list.repo';
import { SearchModule } from '../../core/search/search.module';
import { AiQueueProcessor } from './ai-queue.processor';
import { AiAskService } from './services/ai-ask.service';
import { AiInternalAuthGuard } from './guards/ai-internal-auth.guard';
import { AiContentService } from './services/ai-content.service';
import { AiPageAccessService } from './services/ai-page-access.service';
import { AiPageListService } from './services/ai-page-list.service';
import { AiServiceClient } from './services/ai-service.client';
import { AiStatusService } from './services/ai-status.service';
import { AiTokenService } from './services/ai-token.service';

@Module({
  imports: [JwtModule.register({}), SearchModule],
  controllers: [AiBridgeController, AiBridgeInternalController],
  providers: [
    AiAskService,
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
