import { Injectable } from '@nestjs/common';
import { User } from '@docmost/db/types/entity.types';
import { EnvironmentService } from '../../environment/environment.service';
import { AiServiceClient } from './ai-service.client';
import { AiTokenService } from './ai-token.service';

export type AiAssistantStatus = 'available' | 'unavailable' | 'disabled';

@Injectable()
export class AiStatusService {
  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly aiTokenService: AiTokenService,
    private readonly aiServiceClient: AiServiceClient,
  ) {}

  async status(user: User): Promise<{ status: AiAssistantStatus }> {
    if (!this.environmentService.isAiBridgeConfigured()) {
      return { status: 'disabled' };
    }
    const userToken = await this.aiTokenService.issueUserToken(user);
    const accepted = await this.aiServiceClient.checkSession(userToken);
    return { status: accepted ? 'available' : 'unavailable' };
  }
}
