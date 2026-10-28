import { User } from '@docmost/db/types/entity.types';
import { EnvironmentService } from '../../environment/environment.service';
import { AiServiceClient } from './ai-service.client';
import { AiStatusService } from './ai-status.service';
import { AiTokenService } from './ai-token.service';

const USER_TOKEN = 'header.payload.signature';

describe('AiStatusService', () => {
  const user = { id: 'user-1' } as User;
  const environmentService = { isAiBridgeConfigured: jest.fn() };
  const aiTokenService = { issueUserToken: jest.fn() };
  const aiServiceClient = { checkSession: jest.fn() };
  const service = new AiStatusService(
    environmentService as unknown as EnvironmentService,
    aiTokenService as unknown as AiTokenService,
    aiServiceClient as unknown as AiServiceClient,
  );

  beforeEach(() => {
    jest.resetAllMocks();
    environmentService.isAiBridgeConfigured.mockReturnValue(true);
    aiTokenService.issueUserToken.mockResolvedValue(USER_TOKEN);
    aiServiceClient.checkSession.mockResolvedValue(true);
  });

  it('BRIDGE-AC1: answers disabled without issuing a token or calling the AI service when not configured', async () => {
    environmentService.isAiBridgeConfigured.mockReturnValue(false);

    await expect(service.status(user)).resolves.toEqual({ status: 'disabled' });

    expect(aiTokenService.issueUserToken).not.toHaveBeenCalled();
    expect(aiServiceClient.checkSession).not.toHaveBeenCalled();
  });

  it('BRIDGE-AC3: answers available when the AI service accepts a fresh user token', async () => {
    await expect(service.status(user)).resolves.toEqual({
      status: 'available',
    });

    expect(aiTokenService.issueUserToken).toHaveBeenCalledWith(user);
    expect(aiServiceClient.checkSession).toHaveBeenCalledWith(USER_TOKEN);
  });

  it('BRIDGE-AC38: answers unavailable when the session check fails', async () => {
    aiServiceClient.checkSession.mockResolvedValue(false);

    await expect(service.status(user)).resolves.toEqual({
      status: 'unavailable',
    });
  });

  it('BRIDGE-AC4: the result has only the status key and never the token', async () => {
    const result = await service.status(user);

    expect(Object.keys(result)).toEqual(['status']);
    expect(JSON.stringify(result)).not.toContain(USER_TOKEN);
  });
});
