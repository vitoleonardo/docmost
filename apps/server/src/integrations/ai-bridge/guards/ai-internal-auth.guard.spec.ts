import { stub } from '../test-stub';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { User } from '@docmost/db/types/entity.types';
import { EnvironmentService } from '../../environment/environment.service';
import { AiBridgeError, AiBridgeErrorCode } from '../ai-bridge.errors';
import { AiBridgeUserToken } from '../decorators/ai-bridge-auth.decorator';
import { AiTokenService } from '../services/ai-token.service';
import { AiInternalAuthGuard } from './ai-internal-auth.guard';

const SERVICE_CREDENTIAL = 'test-service-token-0123456789abcdef';
const USER_CREDENTIAL = 'test-user-token';

class RoutesUnderTest {
  @AiBridgeUserToken({ allowTask: true })
  userOrTask() {}

  @AiBridgeUserToken({ allowTask: false })
  userOnly() {}

  serviceOnly() {}
}

interface TestRequest {
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
  aiBridgeUser?: User;
}

function contextFor(
  route: keyof RoutesUnderTest,
  request: TestRequest,
): ExecutionContext {
  return stub<ExecutionContext>({
    getHandler: () => RoutesUnderTest.prototype[route],
    getClass: () => RoutesUnderTest,
    switchToHttp: () => ({ getRequest: () => request }),
  });
}

describe('AiInternalAuthGuard', () => {
  const user = { id: 'user-1', workspaceId: 'workspace-1' } as User;
  const environmentService = {
    isAiBridgeConfigured: jest.fn(),
    getAiServiceToken: jest.fn(),
  };
  const aiTokenService = { verifyToken: jest.fn() };
  const guard = new AiInternalAuthGuard(
    new Reflector(),
    stub<EnvironmentService>(environmentService),
    stub<AiTokenService>(aiTokenService),
  );

  const validHeaders = {
    'x-service-token': SERVICE_CREDENTIAL,
    'x-user-token': USER_CREDENTIAL,
  };

  async function codeOf(
    route: keyof RoutesUnderTest,
    request: TestRequest,
  ): Promise<AiBridgeErrorCode | 'passed'> {
    try {
      await guard.canActivate(contextFor(route, request));
      return 'passed';
    } catch (error) {
      if (error instanceof AiBridgeError) return error.code;
      throw error;
    }
  }

  beforeEach(() => {
    jest.resetAllMocks();
    environmentService.isAiBridgeConfigured.mockReturnValue(true);
    environmentService.getAiServiceToken.mockReturnValue(SERVICE_CREDENTIAL);
    aiTokenService.verifyToken.mockResolvedValue(user);
  });

  it('BRIDGE-AC45: answers assistant_disabled before any other check when the bridge is not configured', async () => {
    environmentService.isAiBridgeConfigured.mockReturnValue(false);

    expect(await codeOf('userOrTask', { headers: {} })).toBe(
      'assistant_disabled',
    );
    expect(await codeOf('serviceOnly', { headers: validHeaders })).toBe(
      'assistant_disabled',
    );
    expect(aiTokenService.verifyToken).not.toHaveBeenCalled();
  });

  it('BRIDGE-AC45: the assistant_disabled error has status 503', async () => {
    environmentService.isAiBridgeConfigured.mockReturnValue(false);

    await expect(
      guard.canActivate(contextFor('serviceOnly', { headers: {} })),
    ).rejects.toMatchObject({ code: 'assistant_disabled', status: 503 });
  });

  it('BRIDGE-AC46: answers service_token_missing without the header, also when a user token is present', async () => {
    expect(
      await codeOf('userOrTask', { headers: { 'x-user-token': USER_CREDENTIAL } }),
    ).toBe('service_token_missing');
    expect(await codeOf('serviceOnly', { headers: {} })).toBe(
      'service_token_missing',
    );
  });

  it('BRIDGE-AC46: an empty service token header counts as missing', async () => {
    expect(
      await codeOf('serviceOnly', { headers: { 'x-service-token': '' } }),
    ).toBe('service_token_missing');
  });

  it('BRIDGE-AC47: answers service_token_invalid for a wrong token of equal or different length', async () => {
    const sameLength = SERVICE_CREDENTIAL.replace(/.$/, 'X');
    for (const wrong of [sameLength, 'short', `${SERVICE_CREDENTIAL}-longer`]) {
      expect(
        await codeOf('userOrTask', {
          headers: { ...validHeaders, 'x-service-token': wrong },
        }),
      ).toBe('service_token_invalid');
    }
    expect(aiTokenService.verifyToken).not.toHaveBeenCalled();
  });

  it('BRIDGE-AC47: a repeated service token header is invalid', async () => {
    expect(
      await codeOf('serviceOnly', {
        headers: { 'x-service-token': [SERVICE_CREDENTIAL, SERVICE_CREDENTIAL] },
      }),
    ).toBe('service_token_invalid');
  });

  it('BRIDGE-AC48: answers user_token_missing for a user id in the body without a user token', async () => {
    expect(
      await codeOf('userOrTask', {
        headers: { 'x-service-token': SERVICE_CREDENTIAL },
        body: { userId: user.id, pageIds: [] },
      }),
    ).toBe('user_token_missing');
    expect(
      await codeOf('userOnly', {
        headers: { 'x-service-token': SERVICE_CREDENTIAL, 'x-user-token': '' },
        body: { runId: 'run-1' },
      }),
    ).toBe('user_token_missing');
  });

  it('BRIDGE-AC49: answers user_id_not_allowed for a user id next to a user token, before verifying it', async () => {
    expect(
      await codeOf('userOrTask', {
        headers: validHeaders,
        body: { userId: user.id, pageIds: [] },
      }),
    ).toBe('user_id_not_allowed');
    expect(aiTokenService.verifyToken).not.toHaveBeenCalled();
  });

  it('BRIDGE-AC49: a null user id counts as a user id', async () => {
    expect(
      await codeOf('userOnly', {
        headers: validHeaders,
        body: { userId: null, runId: 'run-1' },
      }),
    ).toBe('user_id_not_allowed');
  });

  it('BRIDGE-AC49: service-only routes reject a user id as well', async () => {
    expect(
      await codeOf('serviceOnly', {
        headers: { 'x-service-token': SERVICE_CREDENTIAL },
        body: { userId: user.id, pageId: 'page-1' },
      }),
    ).toBe('user_id_not_allowed');
  });

  it('BRIDGE-AC50: passes the token error of the verification through', async () => {
    aiTokenService.verifyToken.mockRejectedValue(
      new AiBridgeError('user_token_expired', 'User token has expired'),
    );

    expect(await codeOf('userOrTask', { headers: validHeaders })).toBe(
      'user_token_expired',
    );
  });

  it('BRIDGE-AC53: verifies with allowTask false on user-only routes and true on the others', async () => {
    await codeOf('userOnly', { headers: validHeaders });
    await codeOf('userOrTask', { headers: validHeaders });

    expect(aiTokenService.verifyToken.mock.calls).toEqual([
      [USER_CREDENTIAL, { allowTask: false }],
      [USER_CREDENTIAL, { allowTask: true }],
    ]);
  });

  it('BRIDGE-AC13: attaches the verified user to the request', async () => {
    const request: TestRequest = { headers: validHeaders, body: {} };

    expect(await codeOf('userOrTask', request)).toBe('passed');
    expect(request.aiBridgeUser).toBe(user);
  });

  it('BRIDGE-AC46: service-only routes pass with the service token alone and never verify a user token', async () => {
    const request: TestRequest = {
      headers: { 'x-service-token': SERVICE_CREDENTIAL },
      body: { pageId: 'page-1' },
    };

    expect(await codeOf('serviceOnly', request)).toBe('passed');
    expect(aiTokenService.verifyToken).not.toHaveBeenCalled();
    expect(request.aiBridgeUser).toBeUndefined();
  });
});
