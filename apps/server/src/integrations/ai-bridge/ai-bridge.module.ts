import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AiBridgeInternalController } from './ai-bridge-internal.controller';
import { SearchModule } from '../../core/search/search.module';
import { AiInternalAuthGuard } from './guards/ai-internal-auth.guard';
import { AiContentService } from './services/ai-content.service';
import { AiPageAccessService } from './services/ai-page-access.service';
import { AiTokenService } from './services/ai-token.service';

@Module({
  imports: [JwtModule.register({}), SearchModule],
  controllers: [AiBridgeInternalController],
  providers: [
    AiPageAccessService,
    AiTokenService,
    AiContentService,
    AiInternalAuthGuard,
  ],
})
export class AiBridgeModule {}
