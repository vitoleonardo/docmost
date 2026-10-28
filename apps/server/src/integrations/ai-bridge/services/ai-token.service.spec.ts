import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { User } from '@docmost/db/types/entity.types';
import { EnvironmentService } from '../../environment/environment.service';
import { AiBridgeError } from '../ai-bridge.errors';
import { AiPageAccessService } from './ai-page-access.service';
import { AiTokenService } from './ai-token.service';

const BRIDGE_SECRET = 'test-bridge-secret-0123456789abcdef';
const APP_SECRET = 'test-app-secret-0123456789abcdefgh';
const OTHER_SECRET = 'test-other-secret-0123456789abcdef';
const WORKSPACE_ID = 'workspace-1';
const RUN_ID = 'run-1';
const NOW = new Date('2026-10-28T10:00:00.000Z');

interface DecodedToken {
  sub: string;
  workspaceId: string;
  spaceIds?: string[];
  runId?: string;
  aud: string;
  type: string;
  iat: number;
  exp: number;
}

function base64UrlJson(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

describe('AiTokenService', () => {
  let service: AiTokenService;
  let storedUser: User | undefined;
  const jwtService = new JwtService();

  const userRepo = { findById: jest.fn() };
  const aiPageAccessService = { readableSpaceIds: jest.fn() };
  const environmentService = {
    getAiBridgeSecret: jest.fn(),
    getAppSecret: jest.fn(),
  };

  const activeUser = (): User =>
    ({
      id: 'user-1',
      workspaceId: WORKSPACE_ID,
      deactivatedAt: null,
      deletedAt: null,
    }) as User;

  const decode = (token: string): DecodedToken =>
    jwtService.decode(token) as DecodedToken;

  const expectCode = async (promise: Promise<unknown>, code: string) => {
    const error = await promise.then(
      () => undefined,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(AiBridgeError);
    expect((error as AiBridgeError).code).toBe(code);
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout'],
    });
    storedUser = activeUser();
    userRepo.findById.mockImplementation(
      async (userId: string, workspaceId: string) =>
        storedUser &&
        storedUser.id === userId &&
        storedUser.workspaceId === workspaceId
          ? storedUser
          : undefined,
    );
    aiPageAccessService.readableSpaceIds.mockResolvedValue([
      'space-a',
      'space-b',
    ]);
    environmentService.getAiBridgeSecret.mockReturnValue(BRIDGE_SECRET);
    environmentService.getAppSecret.mockReturnValue(APP_SECRET);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AiTokenService,
        { provide: JwtService, useValue: jwtService },
        { provide: UserRepo, useValue: userRepo },
        { provide: AiPageAccessService, useValue: aiPageAccessService },
        { provide: EnvironmentService, useValue: environmentService },
      ],
    }).compile();
    service = moduleRef.get(AiTokenService);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('issueUserToken', () => {
    it('BRIDGE-AC10: spaceIds are the readable spaces from current data', async () => {
      const token = await service.issueUserToken(activeUser());

      expect(decode(token).spaceIds).toEqual(['space-a', 'space-b']);
      expect(aiPageAccessService.readableSpaceIds).toHaveBeenCalledWith(
        'user-1',
        WORKSPACE_ID,
      );
    });

    it('BRIDGE-AC43: a user with no spaces gets an empty spaceIds list', async () => {
      aiPageAccessService.readableSpaceIds.mockResolvedValue([]);

      const token = await service.issueUserToken(activeUser());

      expect(decode(token).spaceIds).toEqual([]);
    });

    it('BRIDGE-AC11: carries sub, workspaceId, audience ai-service, type user and lives at most 60 s', async () => {
      const token = await service.issueUserToken(activeUser());
      const claims = decode(token);

      expect(claims).toMatchObject({
        sub: 'user-1',
        workspaceId: WORKSPACE_ID,
        aud: 'ai-service',
        type: 'user',
      });
      expect(claims.iat).toBe(Math.floor(NOW.getTime() / 1000));
      expect(claims.exp - claims.iat).toBeGreaterThan(0);
      expect(claims.exp - claims.iat).toBeLessThanOrEqual(60);
    });

    it('BRIDGE-AC12: verifies with the bridge secret and fails with the app secret', async () => {
      const token = await service.issueUserToken(activeUser());

      await expect(
        jwtService.verifyAsync(token, {
          secret: BRIDGE_SECRET,
          algorithms: ['HS256'],
        }),
      ).resolves.toMatchObject({ sub: 'user-1' });
      await expect(
        jwtService.verifyAsync(token, {
          secret: APP_SECRET,
          algorithms: ['HS256'],
        }),
      ).rejects.toThrow('invalid signature');
      expect(
        JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString()),
      ).toMatchObject({ alg: 'HS256' });
    });

    it('BRIDGE-AC12: refuses to issue when no bridge secret is configured', async () => {
      environmentService.getAiBridgeSecret.mockReturnValue(undefined);

      await expectCode(
        service.issueUserToken(activeUser()),
        'assistant_disabled',
      );
    });
  });

  describe('issueTaskToken', () => {
    it('BRIDGE-AC27: carries sub, workspaceId, runId, type task and lives at most 15 min', async () => {
      const { taskToken, expiresAt } = await service.issueTaskToken(
        activeUser(),
        RUN_ID,
      );
      const claims = decode(taskToken);

      expect(claims).toMatchObject({
        sub: 'user-1',
        workspaceId: WORKSPACE_ID,
        runId: RUN_ID,
        aud: 'ai-service',
        type: 'task',
      });
      expect(claims.spaceIds).toBeUndefined();
      expect(claims.exp - claims.iat).toBeGreaterThan(60);
      expect(claims.exp - claims.iat).toBeLessThanOrEqual(900);
      expect(expiresAt).toBe(new Date(claims.exp * 1000).toISOString());
    });

    it('BRIDGE-AC54: the same runId exchanged twice gives two valid task tokens', async () => {
      const first = await service.issueTaskToken(activeUser(), RUN_ID);
      jest.setSystemTime(NOW.getTime() + 1000);
      const second = await service.issueTaskToken(activeUser(), RUN_ID);

      for (const { taskToken } of [first, second]) {
        await expect(
          service.verifyToken(taskToken, { allowTask: true }),
        ).resolves.toMatchObject({ id: 'user-1' });
        expect(decode(taskToken).runId).toBe(RUN_ID);
      }
    });
  });

  describe('verifyToken', () => {
    it('BRIDGE-AC12: returns the current user for a valid user token', async () => {
      const token = await service.issueUserToken(activeUser());

      await expect(
        service.verifyToken(token, { allowTask: false }),
      ).resolves.toBe(storedUser);
      expect(userRepo.findById).toHaveBeenCalledWith('user-1', WORKSPACE_ID);
    });

    it('BRIDGE-AC50: an expired user token gives user_token_expired', async () => {
      const token = await service.issueUserToken(activeUser());
      jest.setSystemTime(NOW.getTime() + 61_000);

      await expectCode(
        service.verifyToken(token, { allowTask: false }),
        'user_token_expired',
      );
    });

    it('BRIDGE-AC50: an expired task token gives user_token_expired', async () => {
      const { taskToken } = await service.issueTaskToken(activeUser(), RUN_ID);
      jest.setSystemTime(NOW.getTime() + 901_000);

      await expectCode(
        service.verifyToken(taskToken, { allowTask: true }),
        'user_token_expired',
      );
    });

    it('BRIDGE-AC50: a task token is still valid shortly before 15 min', async () => {
      const { taskToken } = await service.issueTaskToken(activeUser(), RUN_ID);
      jest.setSystemTime(NOW.getTime() + 899_000);

      await expect(
        service.verifyToken(taskToken, { allowTask: true }),
      ).resolves.toMatchObject({ id: 'user-1' });
    });

    describe('BRIDGE-AC51: invalid tokens give user_token_invalid', () => {
      const userClaims = {
        sub: 'user-1',
        workspaceId: WORKSPACE_ID,
        spaceIds: [],
        type: 'user',
      };

      const cases: Array<[string, () => string]> = [
        ['a malformed token', () => 'not-a-jwt'],
        ['an empty token', () => ''],
        [
          'a token with a tampered payload',
          () => {
            const [header, , signature] = jwtService
              .sign(userClaims, {
                secret: BRIDGE_SECRET,
                audience: 'ai-service',
                expiresIn: 60,
              })
              .split('.');
            const payload = base64UrlJson({
              ...userClaims,
              sub: 'user-2',
              aud: 'ai-service',
            });
            return `${header}.${payload}.${signature}`;
          },
        ],
        [
          'a token with another audience',
          () =>
            jwtService.sign(userClaims, {
              secret: BRIDGE_SECRET,
              audience: 'someone-else',
              expiresIn: 60,
            }),
        ],
        [
          'a token without an audience',
          () =>
            jwtService.sign(userClaims, {
              secret: BRIDGE_SECRET,
              expiresIn: 60,
            }),
        ],
        [
          'a token with algorithm none',
          () => {
            const now = Math.floor(Date.now() / 1000);
            return `${base64UrlJson({ alg: 'none', typ: 'JWT' })}.${base64UrlJson(
              { ...userClaims, aud: 'ai-service', iat: now, exp: now + 60 },
            )}.`;
          },
        ],
        [
          'a token signed with HS512 and the bridge secret',
          () =>
            jwtService.sign(userClaims, {
              secret: BRIDGE_SECRET,
              algorithm: 'HS512',
              audience: 'ai-service',
              expiresIn: 60,
            }),
        ],
        [
          'a Docmost login token signed with the app secret',
          () =>
            jwtService.sign(
              { sub: 'user-1', workspaceId: WORKSPACE_ID, type: 'access' },
              { secret: APP_SECRET, expiresIn: '1h' },
            ),
        ],
        [
          'a login-type token signed with the bridge secret',
          () =>
            jwtService.sign(
              { sub: 'user-1', workspaceId: WORKSPACE_ID, type: 'access' },
              { secret: BRIDGE_SECRET, audience: 'ai-service', expiresIn: 60 },
            ),
        ],
        [
          'a token signed with another secret',
          () =>
            jwtService.sign(userClaims, {
              secret: OTHER_SECRET,
              audience: 'ai-service',
              expiresIn: 60,
            }),
        ],
        [
          'a token without sub',
          () =>
            jwtService.sign(
              { workspaceId: WORKSPACE_ID, type: 'user' },
              { secret: BRIDGE_SECRET, audience: 'ai-service', expiresIn: 60 },
            ),
        ],
      ];

      it.each(cases)('%s', async (_name, makeToken) => {
        await expectCode(
          service.verifyToken(makeToken(), { allowTask: true }),
          'user_token_invalid',
        );
        expect(userRepo.findById).not.toHaveBeenCalled();
      });
    });

    it('BRIDGE-AC51: verifying never falls back to the app secret', async () => {
      environmentService.getAiBridgeSecret.mockReturnValue(undefined);
      const loginToken = jwtService.sign(
        { sub: 'user-1', workspaceId: WORKSPACE_ID, type: 'user' },
        { secret: APP_SECRET, audience: 'ai-service', expiresIn: 60 },
      );

      await expectCode(
        service.verifyToken(loginToken, { allowTask: true }),
        'user_token_invalid',
      );
    });

    describe('BRIDGE-AC52: the user is re-checked against current data', () => {
      const tokenKinds: Array<[string, () => Promise<string>]> = [
        ['user token', () => service.issueUserToken(activeUser())],
        [
          'task token',
          async () =>
            (await service.issueTaskToken(activeUser(), RUN_ID)).taskToken,
        ],
      ];

      it.each(tokenKinds)(
        'a deactivated user with a %s gives user_token_invalid',
        async (_kind, issue) => {
          const token = await issue();
          storedUser = { ...activeUser(), deactivatedAt: new Date() };

          await expectCode(
            service.verifyToken(token, { allowTask: true }),
            'user_token_invalid',
          );
        },
      );

      it.each(tokenKinds)(
        'a deleted user with a %s gives user_token_invalid',
        async (_kind, issue) => {
          const token = await issue();
          storedUser = { ...activeUser(), deletedAt: new Date() };

          await expectCode(
            service.verifyToken(token, { allowTask: true }),
            'user_token_invalid',
          );
        },
      );

      it.each(tokenKinds)(
        'a user that no longer exists with a %s gives user_token_invalid',
        async (_kind, issue) => {
          const token = await issue();
          storedUser = undefined;

          await expectCode(
            service.verifyToken(token, { allowTask: true }),
            'user_token_invalid',
          );
        },
      );
    });

    it('BRIDGE-AC53: a task token is refused when task tokens are not allowed', async () => {
      const { taskToken } = await service.issueTaskToken(activeUser(), RUN_ID);

      await expectCode(
        service.verifyToken(taskToken, { allowTask: false }),
        'user_token_invalid',
      );
      expect(userRepo.findById).not.toHaveBeenCalled();
    });

    it('BRIDGE-AC53: a user token is accepted when task tokens are allowed', async () => {
      const token = await service.issueUserToken(activeUser());

      await expect(
        service.verifyToken(token, { allowTask: true }),
      ).resolves.toMatchObject({ id: 'user-1' });
    });
  });
});
