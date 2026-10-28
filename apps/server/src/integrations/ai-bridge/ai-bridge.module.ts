import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AiBridgeInternalController } from './ai-bridge-internal.controller';
import { AiInternalAuthGuard } from './guards/ai-internal-auth.guard';
import { AiPageAccessService } from './services/ai-page-access.service';
import { AiTokenService } from './services/ai-token.service';

@Module({
  imports: [JwtModule.register({})],
  controllers: [AiBridgeInternalController],
  providers: [AiPageAccessService, AiTokenService, AiInternalAuthGuard],
})
export class AiBridgeModule {}
