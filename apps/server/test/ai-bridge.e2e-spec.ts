import { randomUUID } from 'node:crypto';
import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely } from 'kysely';
import { DB } from '@docmost/db/types/db';
import type { User } from '@docmost/db/types/entity.types';
import type { PageRepo } from '@docmost/db/repos/page/page.repo';
import type { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import type { UserRepo } from '@docmost/db/repos/user/user.repo';
import { JwtService } from '@nestjs/jwt';
import type { LoggerService as Logger } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AiQueueProcessor } from '../src/integrations/ai-bridge/ai-queue.processor';
import type { AiPageAccessService } from '../src/integrations/ai-bridge/services/ai-page-access.service';
import type { AiTokenService } from '../src/integrations/ai-bridge/services/ai-token.service';
import type { EnvironmentService } from '../src/integrations/environment/environment.service';
import type { SeedWorkspaceResult } from '../src/integrations/seed/seed.service';
import { prepareSeedReset } from '../src/integrations/seed/seed-preflight';
import {
  deniedUserKeys,
  SEED_GROUPS,
  SEED_RESTRICTED_PAGES,
  SEED_SPACE_MEMBERSHIPS,
  SEED_SPACES,
  SEED_DEMO_PASSWORD,
  SEED_USERS,
  SeedUserKey,
} from '../src/integrations/seed/seed-definition';
import {
  readSeedPdf,
  SEED_PAGES,
  SEED_PDFS,
} from '../src/integrations/seed/seed-pages';
import {
  bootSeedHttpApp,
  createMigratedTestDatabase,
  loadAppModulesFor,
  providerOf,
  removeDatabase,
  TEST_POSTGRES_SERVER,
} from './test-database';

const TEST_DATABASE = 'docmost_ai_bridge_test';
const TEST_DATABASE_URL = `${TEST_POSTGRES_SERVER}/${TEST_DATABASE}`;

const TEST_REDIS_URL = 'redis://127.0.0.1:6380/14';

const TEST_AI_BRIDGE_KEY = 'test-ai-bridge-secret-0123456789abcdef';
const TEST_AI_SERVICE_CREDENTIAL = 'test-ai-service-token-0123456789abcdef';
const TEST_AI_SERVICE_URL = 'http://127.0.0.1:9';

const USER_KEYS = SEED_USERS.map((user) => user.key);

interface BridgeApp {
  app: NestFastifyApplication;
  aiPageAccessService: AiPageAccessService;
  aiQueueProcessor: AiQueueProcessor;
  aiTokenService: AiTokenService;
  environmentService: EnvironmentService;
  pageRepo: PageRepo;
  spaceMemberRepo: SpaceMemberRepo;
  userRepo: UserRepo;
  seed: SeedWorkspaceResult;
}

function bootSeededBridge(storageRoot: string): Promise<BridgeApp> {
  process.env.REDIS_URL = TEST_REDIS_URL;
  process.env.AI_BRIDGE_SECRET = TEST_AI_BRIDGE_KEY;
  process.env.AI_SERVICE_TOKEN = TEST_AI_SERVICE_CREDENTIAL;
  process.env.AI_SERVICE_URL = TEST_AI_SERVICE_URL;
  return loadAppModulesFor(TEST_DATABASE_URL, async (): Promise<BridgeApp> => {
    const { SeedService } =
      await import('../src/integrations/seed/seed.service');
    const { SeedContentService } =
      await import('../src/integrations/seed/seed-content.service');
    const { AiPageAccessService } =
      await import('../src/integrations/ai-bridge/services/ai-page-access.service');
    const { AiQueueProcessor } =
      await import('../src/integrations/ai-bridge/ai-queue.processor');
    const { AiTokenService } =
      await import('../src/integrations/ai-bridge/services/ai-token.service');
    const { EnvironmentService } =
      await import('../src/integrations/environment/environment.service');
    const { PageRepo } = await import('@docmost/db/repos/page/page.repo');
    const { SpaceMemberRepo } =
      await import('@docmost/db/repos/space/space-member.repo');
    const { UserRepo } = await import('@docmost/db/repos/user/user.repo');
    const app = await bootSeedHttpApp(storageRoot, {
      whitelist: true,
      stopAtFirstError: true,
      transform: true,
    });
    const provider = providerOf(app);

    const seed = await app.get(SeedService).seedWorkspace();
    await app.get(SeedContentService).seedPages(seed);
    return {
      app,
      seed,
      aiPageAccessService: provider(AiPageAccessService),
      aiQueueProcessor: provider(AiQueueProcessor),
      aiTokenService: provider(AiTokenService),
      environmentService: provider(EnvironmentService),
      pageRepo: provider(PageRepo),
      spaceMemberRepo: provider(SpaceMemberRepo),
      userRepo: provider(UserRepo),
    };
  });
}

function expectError(
  response: { statusCode: number; json: () => unknown },
  status: number,
  code: string,
) {
  expect({ status: response.statusCode, body: response.json() }).toEqual({
    status,
    body: { code, message: expect.any(String) },
  });
}

function spaceSlug(spaceName: string) {
  return SEED_SPACES.find((space) => space.name === spaceName)!.slug;
}

function membersOfSpace(spaceName: string): SeedUserKey[] {
  const members = new Set<SeedUserKey>();
  for (const membership of SEED_SPACE_MEMBERSHIPS) {
    if (membership.space !== spaceName) continue;
    if (membership.userKey) members.add(membership.userKey);
    SEED_GROUPS.find(
      (group) => group.name === membership.groupName,
    )?.userKeys.forEach((key) => members.add(key));
  }
  return USER_KEYS.filter((key) => members.has(key));
}

const RESTRICTED_TITLES = new Set(SEED_RESTRICTED_PAGES.map((p) => p.title));

const UNRESTRICTED_PAGE_PER_SPACE = SEED_SPACES.map(
  (space) =>
    SEED_PAGES.find(
      (page) => page.space === space.name && !RESTRICTED_TITLES.has(page.title),
    )!,
);

describe('AI bridge page access (e2e)', () => {
  let admin: Kysely<DB>;
  let db: Kysely<DB>;
  let storageRoot: string;
  let bridge: BridgeApp;
  const users = {} as Record<SeedUserKey, User>;

  const pageId = async (title: string) =>
    (
      await db
        .selectFrom('pages')
        .select('id')
        .where('title', '=', title)
        .executeTakeFirstOrThrow()
    ).id;

  const spaceId = (spaceName: string) =>
    bridge.seed.spaceIds[spaceSlug(spaceName)];

  const viewers = async (pageIds: string[]) => {
    const result = {} as Record<SeedUserKey, string[]>;
    for (const key of USER_KEYS) {
      result[key] = await bridge.aiPageAccessService.filterViewablePageIds(
        users[key],
        pageIds,
      );
    }
    return result;
  };

  const usersWhoSee = async (id: string) => {
    const byUser = await viewers([id]);
    return USER_KEYS.filter((key) => byUser[key].includes(id));
  };

  beforeAll(async () => {
    ({ admin, db } = await createMigratedTestDatabase(TEST_DATABASE));

    storageRoot = await mkdtemp(join(tmpdir(), 'ai-bridge-storage-'));
    const reset = await prepareSeedReset({
      databaseUrl: TEST_DATABASE_URL,
      storageDriver: 'local',
      confirmNonLocal: false,
      storageRoot,
    });
    try {
      bridge = await bootSeededBridge(storageRoot);
    } finally {
      await reset.release();
    }
    for (const key of USER_KEYS) {
      users[key] = await bridge.userRepo.findById(
        bridge.seed.userIds[key],
        bridge.seed.workspaceId,
      );
    }
  }, 180_000);

  afterAll(async () => {
    await bridge?.app.close();
    await db?.destroy();
    if (admin) await removeDatabase(admin, TEST_DATABASE);
    await admin?.destroy();
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  it('BRIDGE-AC17: each restricted page is kept exactly for the users the page matrix grants view', async () => {
    for (const page of SEED_RESTRICTED_PAGES) {
      const denied = deniedUserKeys(page);
      const granted = USER_KEYS.filter((key) => !denied.includes(key));

      expect({
        title: page.title,
        users: await usersWhoSee(await pageId(page.title)),
      }).toEqual({ title: page.title, users: granted });
    }
  });

  it('BRIDGE-AC17: the inherited child and the group grant reach WS, not VT', async () => {
    const childId = await pageId('Baustelle Nordhafen Zugangscodes');
    const parentId = await pageId('Baustelle Nordhafen intern');
    const byUser = await viewers([childId, parentId]);

    expect(byUser.WS).toEqual([childId, parentId]);
    expect(byUser.VT).toEqual([]);
  });

  it('BRIDGE-AC18: one unrestricted page per space is kept exactly for the members of its space', async () => {
    const pageIds = await Promise.all(
      UNRESTRICTED_PAGE_PER_SPACE.map((page) => pageId(page.title)),
    );
    const byUser = await viewers(pageIds);

    for (const key of USER_KEYS) {
      const expected = UNRESTRICTED_PAGE_PER_SPACE.flatMap((page, index) =>
        membersOfSpace(page.space).includes(key) ? [pageIds[index]] : [],
      );
      expect({ user: key, pageIds: byUser[key] }).toEqual({
        user: key,
        pageIds: expected,
      });
    }
  });

  it('BRIDGE-AC15: a page in the trash is dropped for every member of its space', async () => {
    const id = await pageId('Preisliste Standardkomponenten');
    expect(await usersWhoSee(id)).toEqual(['GF', 'VT']);

    await bridge.pageRepo.removePage(id, users.GF.id, bridge.seed.workspaceId);
    try {
      expect(await usersWhoSee(id)).toEqual([]);
      expect(
        await bridge.aiPageAccessService.findViewablePage(users.GF, id),
      ).toBeNull();
    } finally {
      await bridge.pageRepo.restorePage(id, bridge.seed.workspaceId);
    }
  });

  it('BRIDGE-AC19: a page of a space marked as deleted is dropped for its members', async () => {
    const id = await pageId('Wartung Serverraum');
    const itId = spaceId('IT');
    expect(await usersWhoSee(id)).toEqual(['GF', 'PL', 'WS']);

    await db
      .updateTable('spaces')
      .set({ deletedAt: new Date() })
      .where('id', '=', itId)
      .execute();
    try {
      expect(await usersWhoSee(id)).toEqual([]);
      for (const key of ['GF', 'PL', 'WS'] as const) {
        expect(
          await bridge.aiPageAccessService.readableSpaceIds(
            users[key].id,
            users[key].workspaceId,
          ),
        ).not.toContain(itId);
      }
    } finally {
      await db
        .updateTable('spaces')
        .set({ deletedAt: null })
        .where('id', '=', itId)
        .execute();
    }
  });

  it('BRIDGE-AC61: findViewablePage returns the page with content for a viewer and null otherwise', async () => {
    const id = await pageId('Umstrukturierung 2027');

    const page = await bridge.aiPageAccessService.findViewablePage(
      users.GF,
      id,
    );
    expect(page).toEqual(
      expect.objectContaining({ id, title: 'Umstrukturierung 2027' }),
    );
    expect(page?.content).toBeTruthy();
    expect(
      await bridge.aiPageAccessService.findViewablePage(users.PL, id),
    ).toBeNull();
  });
  describe('internal HTTP API', () => {
    const clientAddress = `198.51.100.${Math.floor(Math.random() * 254) + 1}`;
    const jwt = new JwtService();

    const post = (
      path: string,
      payload: object,
      headers: Record<string, string> = {},
    ) =>
      bridge.app.inject({
        method: 'POST',
        url: `/api/ai-bridge/internal/${path}`,
        remoteAddress: clientAddress,
        headers,
        payload,
      });

    const asUser = (userToken: string) => ({
      'x-service-token': TEST_AI_SERVICE_CREDENTIAL,
      'x-user-token': userToken,
    });

    const userToken = (key: SeedUserKey) =>
      bridge.aiTokenService.issueUserToken(users[key]);

    const filterAs = async (token: string, pageIds: unknown[]) =>
      post('filter-pages', { pageIds }, asUser(token));

    const whileMovedToGeschaeftsfuehrung = async (
      id: string,
      check: () => Promise<void>,
    ) => {
      await bridge.pageRepo.updatePage(
        { spaceId: spaceId('Geschäftsführung') },
        id,
      );
      try {
        await check();
      } finally {
        await bridge.pageRepo.updatePage({ spaceId: spaceId('Allgemein') }, id);
      }
    };

    it('BRIDGE-AC14: a page moved into Geschäftsführung is dropped for WS and kept for GF', async () => {
      const id = await pageId('Willkommen bei Ostmooimooi');
      const wsToken = await userToken('WS');
      const gfToken = await userToken('GF');
      expect((await filterAs(wsToken, [id])).json()).toEqual({ pageIds: [id] });

      await whileMovedToGeschaeftsfuehrung(id, async () => {
        expect((await filterAs(wsToken, [id])).json()).toEqual({ pageIds: [] });
        expect((await filterAs(gfToken, [id])).json()).toEqual({
          pageIds: [id],
        });
      });
    });

    it('ASK-AC30: with a spaceId, filter-pages keeps a viewable page only while it is in that space', async () => {
      const id = await pageId('Willkommen bei Ostmooimooi');
      const gfToken = await userToken('GF');
      const filterIn = async (space: string) =>
        (
          await post(
            'filter-pages',
            { pageIds: [id], spaceId: spaceId(space) },
            asUser(gfToken),
          )
        ).json();
      expect(await filterIn('Allgemein')).toEqual({ pageIds: [id] });

      await whileMovedToGeschaeftsfuehrung(id, async () => {
        expect(await filterIn('Allgemein')).toEqual({ pageIds: [] });
        expect(await filterIn('Geschäftsführung')).toEqual({ pageIds: [id] });
        expect((await filterAs(gfToken, [id])).json()).toEqual({
          pageIds: [id],
        });
      });
    });

    it('ASK-AC30: a malformed spaceId answers 400 invalid_request', async () => {
      const response = await post(
        'filter-pages',
        { pageIds: [], spaceId: 'space-1' },
        asUser(await userToken('GF')),
      );

      expect(response.statusCode).toBe(400);
      expect(response.json().code).toBe('invalid_request');
    });

    it('BRIDGE-AC14: a forged spaceIds claim grants nothing', async () => {
      const id = await pageId('Strategie 2027 bis 2030');
      const forged = await jwt.signAsync(
        {
          sub: users.WS.id,
          workspaceId: users.WS.workspaceId,
          spaceIds: [spaceId('Geschäftsführung')],
          type: 'user',
        },
        {
          secret: TEST_AI_BRIDGE_KEY,
          audience: 'ai-service',
          expiresIn: 60,
        },
      );

      const response = await filterAs(forged, [id]);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ pageIds: [] });
    });

    it('BRIDGE-AC16: a member removed from Vertrieb no longer gets its pages', async () => {
      const id = await pageId('Vertriebsprozess Anlagenbau');
      const vertriebId = spaceId('Vertrieb');
      const vtToken = await userToken('VT');
      expect((await filterAs(vtToken, [id])).json()).toEqual({ pageIds: [id] });

      const member = await bridge.spaceMemberRepo.getSpaceMemberByTypeId(
        vertriebId,
        { userId: users.VT.id },
      );
      await bridge.spaceMemberRepo.removeSpaceMemberById(
        member.id,
        vertriebId,
        {},
      );
      try {
        expect((await filterAs(vtToken, [id])).json()).toEqual({ pageIds: [] });
        expect((await filterAs(await userToken('GF'), [id])).json()).toEqual({
          pageIds: [id],
        });
      } finally {
        await bridge.spaceMemberRepo.insertSpaceMember(member);
      }
    });

    it('BRIDGE-AC13: filter-pages returns the viewable ids in first-occurrence order, without envelope', async () => {
      const restricted = await pageId('Umstrukturierung 2027');
      const serverRoom = await pageId('Wartung Serverraum');
      const welcome = await pageId('Willkommen bei Ostmooimooi');
      const unknown = randomUUID();

      const response = await filterAs(await userToken('PL'), [
        restricted,
        serverRoom,
        unknown,
        welcome,
        serverRoom,
      ]);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ pageIds: [serverRoom, welcome] });
    });

    it('BRIDGE-AC13: filter-pages matches uppercase ids and returns them lowercase', async () => {
      const welcome = await pageId('Willkommen bei Ostmooimooi');

      const response = await filterAs(await userToken('PL'), [
        welcome.toUpperCase(),
      ]);

      expect(response.json()).toEqual({ pageIds: [welcome] });
    });

    it('BRIDGE-AC28: filter-pages with a task token answers as with the user token', async () => {
      const pageIds = await Promise.all(
        [
          ...UNRESTRICTED_PAGE_PER_SPACE.map((page) => page.title),
          ...SEED_RESTRICTED_PAGES.map((page) => page.title),
        ].map(pageId),
      );
      for (const key of USER_KEYS) {
        const token = await userToken(key);
        const exchanged = await post(
          'task-token',
          { runId: `run-${key}` },
          asUser(token),
        );
        const { taskToken } = exchanged.json() as { taskToken: string };

        const withUser = (await filterAs(token, pageIds)).json();
        const withTask = await filterAs(taskToken, pageIds);

        expect(withTask.statusCode).toBe(200);
        expect({ user: key, body: withTask.json() }).toEqual({
          user: key,
          body: withUser,
        });
      }
    });

    it('BRIDGE-AC27: task-token returns a task token for the user and run, expiring within 15 min', async () => {
      const before = Math.floor(Date.now() / 1000);

      const response = await post(
        'task-token',
        { runId: 'run-ac27' },
        asUser(await userToken('WS')),
      );

      expect(response.statusCode).toBe(200);
      const body = response.json() as { taskToken: string; expiresAt: string };
      expect(Object.keys(body).sort()).toEqual(['expiresAt', 'taskToken']);
      const claims = jwt.verify(body.taskToken, {
        secret: TEST_AI_BRIDGE_KEY,
        audience: 'ai-service',
      });
      expect(claims).toEqual(
        expect.objectContaining({
          sub: users.WS.id,
          workspaceId: users.WS.workspaceId,
          runId: 'run-ac27',
          type: 'task',
        }),
      );
      expect(claims.exp - claims.iat).toBeLessThanOrEqual(900);
      expect(claims.iat).toBeGreaterThanOrEqual(before);
      expect(new Date(body.expiresAt).getTime()).toBe(claims.exp * 1000);
    });

    it('BRIDGE-AC45: every internal endpoint answers 503 assistant_disabled while the assistant is switched off', async () => {
      const token = await userToken('GF');
      const configured = jest
        .spyOn(bridge.environmentService, 'isAiBridgeConfigured')
        .mockReturnValue(false);
      try {
        expectError(await filterAs(token, []), 503, 'assistant_disabled');
        expectError(
          await post('task-token', { runId: 'run-1' }, asUser(token)),
          503,
          'assistant_disabled',
        );
      } finally {
        configured.mockRestore();
      }
    });

    it('BRIDGE-AC46: a request without a service token answers 401 service_token_missing', async () => {
      const token = await userToken('GF');

      expectError(
        await post('filter-pages', { pageIds: [] }, { 'x-user-token': token }),
        401,
        'service_token_missing',
      );
      expectError(
        await post('task-token', { runId: 'run-1' }),
        401,
        'service_token_missing',
      );
    });

    it('BRIDGE-AC47: a request with a wrong service token answers 401 service_token_invalid', async () => {
      const token = await userToken('GF');

      expectError(
        await post(
          'filter-pages',
          { pageIds: [] },
          {
            'x-service-token': TEST_AI_SERVICE_CREDENTIAL.replace(/.$/, 'X'),
            'x-user-token': token,
          },
        ),
        401,
        'service_token_invalid',
      );
    });

    it('BRIDGE-AC48: a user id in the body without a user token answers 401 user_token_missing', async () => {
      const serviceOnly = { 'x-service-token': TEST_AI_SERVICE_CREDENTIAL };

      expectError(
        await post(
          'filter-pages',
          { userId: users.GF.id, pageIds: [] },
          serviceOnly,
        ),
        401,
        'user_token_missing',
      );
      expectError(
        await post(
          'task-token',
          { userId: users.GF.id, runId: 'run-1' },
          serviceOnly,
        ),
        401,
        'user_token_missing',
      );
    });

    it('BRIDGE-AC49: a valid user token next to a user id answers 400 user_id_not_allowed', async () => {
      const token = await userToken('PL');

      expectError(
        await post(
          'filter-pages',
          { userId: users.GF.id, pageIds: [] },
          asUser(token),
        ),
        400,
        'user_id_not_allowed',
      );
      expectError(
        await post(
          'task-token',
          { userId: users.GF.id, runId: 'run-1' },
          asUser(token),
        ),
        400,
        'user_id_not_allowed',
      );
    });

    it('BRIDGE-AC50: an expired user token or task token answers 401 user_token_expired', async () => {
      const past = Math.floor(Date.now() / 1000) - 3600;
      const sign = (type: 'user' | 'task') =>
        jwt.signAsync(
          {
            sub: users.GF.id,
            workspaceId: users.GF.workspaceId,
            type,
            runId: type === 'task' ? 'run-1' : undefined,
            iat: past,
            exp: past + 60,
          },
          { secret: TEST_AI_BRIDGE_KEY, audience: 'ai-service' },
        );

      expectError(
        await filterAs(await sign('user'), []),
        401,
        'user_token_expired',
      );
      expectError(
        await filterAs(await sign('task'), []),
        401,
        'user_token_expired',
      );
      expectError(
        await post(
          'task-token',
          { runId: 'run-1' },
          asUser(await sign('user')),
        ),
        401,
        'user_token_expired',
      );
    });

    it('BRIDGE-AC51: a wiki login token answers 401 user_token_invalid', async () => {
      const login = await bridge.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: clientAddress,
        payload: { email: users.GF.email, password: SEED_DEMO_PASSWORD },
      });
      const loginToken = /authToken=([^;]+)/.exec(
        String(login.headers['set-cookie']),
      )?.[1];
      expect(loginToken).toBeTruthy();

      expectError(await filterAs(loginToken!, []), 401, 'user_token_invalid');
    });

    it('BRIDGE-AC51: a malformed token answers 401 user_token_invalid', async () => {
      expectError(await filterAs('not-a-token', []), 401, 'user_token_invalid');
    });

    it('BRIDGE-AC52: tokens of a user deactivated after issuing answer 401 user_token_invalid', async () => {
      const token = await userToken('VT');
      const exchanged = await post(
        'task-token',
        { runId: 'run-ac52' },
        asUser(token),
      );
      const { taskToken } = exchanged.json() as { taskToken: string };

      await bridge.userRepo.updateUser(
        { deactivatedAt: new Date() },
        users.VT.id,
        users.VT.workspaceId,
      );
      try {
        expectError(await filterAs(token, []), 401, 'user_token_invalid');
        expectError(await filterAs(taskToken, []), 401, 'user_token_invalid');
      } finally {
        await bridge.userRepo.updateUser(
          { deactivatedAt: null },
          users.VT.id,
          users.VT.workspaceId,
        );
      }
      expect((await filterAs(token, [])).statusCode).toBe(200);
    });

    it('BRIDGE-AC53: exchanging a task token for another task token answers 401 user_token_invalid', async () => {
      const exchanged = await post(
        'task-token',
        { runId: 'run-ac53' },
        asUser(await userToken('GF')),
      );
      const { taskToken } = exchanged.json() as { taskToken: string };

      expectError(
        await post('task-token', { runId: 'run-ac53b' }, asUser(taskToken)),
        401,
        'user_token_invalid',
      );
    });

    it('BRIDGE-AC58: a malformed page id answers 400 invalid_request', async () => {
      const token = await userToken('GF');
      const welcome = await pageId('Willkommen bei Ostmooimooi');

      expectError(
        await filterAs(token, [welcome, 'not-a-uuid']),
        400,
        'invalid_request',
      );
      expectError(await filterAs(token, [42]), 400, 'invalid_request');
      expectError(
        await post('filter-pages', {}, asUser(token)),
        400,
        'invalid_request',
      );
    });

    it('BRIDGE-AC58: task-token without a run id answers 400 invalid_request', async () => {
      const token = await userToken('GF');

      expectError(
        await post('task-token', { runId: '' }, asUser(token)),
        400,
        'invalid_request',
      );
      expectError(
        await post('task-token', { runId: 'r'.repeat(201) }, asUser(token)),
        400,
        'invalid_request',
      );
    });

    it('BRIDGE-AC59: exactly 500 ids answer 200', async () => {
      const ids = Array.from({ length: 500 }, () => randomUUID());

      const response = await filterAs(await userToken('GF'), ids);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ pageIds: [] });
    });

    it('BRIDGE-AC60: 501 ids answer 400 too_many_page_ids', async () => {
      const ids = Array.from({ length: 501 }, () => randomUUID());

      expectError(
        await filterAs(await userToken('GF'), ids),
        400,
        'too_many_page_ids',
      );
    });

    describe('content endpoints and read tools', () => {
      const serviceOnly = { 'x-service-token': TEST_AI_SERVICE_CREDENTIAL };
      const LICENSE_PAGE = 'Softwarelizenzvertrag Planungssoftware';
      const LICENSE_PDF = 'softwarelizenzvertrag-planungssoftware.pdf';

      const pageContent = (id: string) =>
        post('page-content', { pageId: id }, serviceOnly);

      const readPageAs = (token: string, id: string) =>
        post('tools/read-page', { pageId: id }, asUser(token));

      const searchAs = (token: string, space: string, query: unknown) =>
        post('tools/search', { spaceId: space, query }, asUser(token));

      const taskTokenOf = async (key: SeedUserKey) => {
        const exchanged = await post(
          'task-token',
          { runId: `run-content-${key}` },
          asUser(await userToken(key)),
        );
        return (exchanged.json() as { taskToken: string }).taskToken;
      };

      const attachmentIdOf = async (fileName: string) =>
        (
          await db
            .selectFrom('attachments')
            .select('id')
            .where('fileName', '=', fileName)
            .executeTakeFirstOrThrow()
        ).id;

      const withTrashedPage = async (
        title: string,
        run: () => Promise<void>,
      ) => {
        const id = await pageId(title);
        await bridge.pageRepo.removePage(
          id,
          users.GF.id,
          bridge.seed.workspaceId,
        );
        try {
          await run();
        } finally {
          await bridge.pageRepo.restorePage(id, bridge.seed.workspaceId);
        }
      };

      const withDeletedSpace = async (
        name: string,
        run: () => Promise<void>,
      ) => {
        const id = spaceId(name);
        await db
          .updateTable('spaces')
          .set({ deletedAt: new Date() })
          .where('id', '=', id)
          .execute();
        try {
          await run();
        } finally {
          await db
            .updateTable('spaces')
            .set({ deletedAt: null })
            .where('id', '=', id)
            .execute();
        }
      };

      it('BRIDGE-AC20: page-content returns the page fields and markdown with its headings, without envelope', async () => {
        const id = await pageId('Willkommen bei Ostmooimooi');
        const stored = await bridge.pageRepo.findById(id);

        const response = await pageContent(id);

        expect(response.statusCode).toBe(200);
        const body = response.json() as { markdown: string };
        expect(body).toEqual({
          id,
          title: 'Willkommen bei Ostmooimooi',
          spaceId: spaceId('Allgemein'),
          workspaceId: bridge.seed.workspaceId,
          updatedAt: new Date(stored.updatedAt).toISOString(),
          markdown: expect.any(String),
          attachments: [],
        });
        expect(body.markdown).toMatch(/^## Unser Unternehmen$/m);
        expect(body.markdown).toMatch(/^## Fragen und Feedback$/m);
      });

      it('BRIDGE-AC21: page-content lists the PDF attachment with id, file name, type and size and skips other attachments', async () => {
        const id = await pageId(LICENSE_PAGE);
        const pdfId = await attachmentIdOf(LICENSE_PDF);
        const pdf = SEED_PDFS.find((entry) => entry.fileName === LICENSE_PDF)!;
        const imageId = randomUUID();
        await db
          .insertInto('attachments')
          .values({
            id: imageId,
            type: 'file',
            filePath: `${bridge.seed.workspaceId}/files/${imageId}/bild.png`,
            fileName: 'bild.png',
            fileSize: 10,
            mimeType: 'image/png',
            fileExt: '.png',
            creatorId: users.GF.id,
            workspaceId: bridge.seed.workspaceId,
            pageId: id,
            spaceId: spaceId('IT'),
          })
          .execute();
        try {
          const response = await pageContent(id);

          expect(response.json()).toEqual(
            expect.objectContaining({
              attachments: [
                {
                  id: pdfId,
                  fileName: LICENSE_PDF,
                  mimeType: 'application/pdf',
                  fileSize: readSeedPdf(pdf).length,
                },
              ],
            }),
          );
        } finally {
          await db
            .deleteFrom('attachments')
            .where('id', '=', imageId)
            .execute();
        }
      });

      it('BRIDGE-AC22: page-content returns the restricted page and a Geschäftsführung page', async () => {
        for (const title of [
          'Umstrukturierung 2027',
          'Strategie 2027 bis 2030',
        ]) {
          const id = await pageId(title);

          const response = await pageContent(id);

          expect({ title, status: response.statusCode }).toEqual({
            title,
            status: 200,
          });
          expect(response.json()).toEqual(
            expect.objectContaining({ id, title }),
          );
        }
      });

      it('BRIDGE-AC23: attachment returns the stored bytes with the PDF content type', async () => {
        const pdf = SEED_PDFS.find((entry) => entry.fileName === LICENSE_PDF)!;

        const response = await post(
          'attachment',
          { attachmentId: await attachmentIdOf(LICENSE_PDF) },
          serviceOnly,
        );

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toBe('application/pdf');
        expect(response.rawPayload.equals(readSeedPdf(pdf))).toBe(true);
      });

      it('BRIDGE-AC24: read-page returns id, title, space and markdown for a viewer', async () => {
        const id = await pageId('Willkommen bei Ostmooimooi');

        const response = await readPageAs(await userToken('PL'), id);

        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
          id,
          title: 'Willkommen bei Ostmooimooi',
          spaceId: spaceId('Allgemein'),
          markdown: expect.stringMatching(/^## Unser Unternehmen$/m),
        });
      });

      it.each([
        ['HR', 'Urlaubsantrag im Personalportal', 'Kalenderfuchs'],
        ['Vertrieb', 'Preisliste Standardkomponenten', 'Pegelhase'],
      ])(
        'BRIDGE-AC25: searching %s for %s returns pages of that space only, and AC26: it finds the page',
        async (space, title, word) => {
          const member = membersOfSpace(space)[0];

          const response = await searchAs(
            await userToken(member),
            spaceId(space),
            word,
          );

          expect(response.statusCode).toBe(200);
          const { results } = response.json() as {
            results: { id: string; title: string; spaceId: string }[];
          };
          expect(results.map((entry) => entry.title)).toContain(title);
          expect(results.length).toBeLessThanOrEqual(20);
          const storedSpaceIds = await db
            .selectFrom('pages')
            .select('spaceId')
            .where(
              'id',
              'in',
              results.map((entry) => entry.id),
            )
            .execute();
          expect(storedSpaceIds).toHaveLength(results.length);
          expect(
            storedSpaceIds.every((row) => row.spaceId === spaceId(space)),
          ).toBe(true);
          expect(results[0]).toEqual({
            id: await pageId(title),
            title,
            spaceId: spaceId(space),
          });
        },
      );

      it('BRIDGE-AC25: a page in the trash is not found', async () => {
        const member = membersOfSpace('Vertrieb')[0];

        await withTrashedPage('Preisliste Standardkomponenten', async () => {
          const response = await searchAs(
            await userToken(member),
            spaceId('Vertrieb'),
            'Pegelhase',
          );

          expect(response.json()).toEqual({ results: [] });
        });
      });

      it('BRIDGE-AC28: read-page and search with a task token answer as with the user token', async () => {
        const id = await pageId('Preisliste Standardkomponenten');
        const token = await userToken('VT');
        const taskToken = await taskTokenOf('VT');

        const readWithUser = await readPageAs(token, id);
        const readWithTask = await readPageAs(taskToken, id);
        const searchWithUser = await searchAs(
          token,
          spaceId('Vertrieb'),
          'Pegelhase',
        );
        const searchWithTask = await searchAs(
          taskToken,
          spaceId('Vertrieb'),
          'Pegelhase',
        );

        expect(readWithTask.statusCode).toBe(200);
        expect(readWithTask.json()).toEqual(readWithUser.json());
        expect(searchWithTask.statusCode).toBe(200);
        expect(searchWithTask.json()).toEqual(searchWithUser.json());
        expect(
          (searchWithTask.json() as { results: unknown[] }).results,
        ).not.toHaveLength(0);
      });

      it('BRIDGE-AC61: read-page answers every unreadable variant with the same 404 page_not_found', async () => {
        const token = await userToken('WS');
        const bodies: unknown[] = [];
        const collect = async (id: string) => {
          const response = await readPageAs(token, id);
          expectError(response, 404, 'page_not_found');
          bodies.push(response.json());
        };

        await collect(await pageId('Umstrukturierung 2027'));
        await collect(await pageId('Strategie 2027 bis 2030'));
        await collect(randomUUID());
        await withTrashedPage('Willkommen bei Ostmooimooi', async () =>
          collect(await pageId('Willkommen bei Ostmooimooi')),
        );
        await withDeletedSpace('IT', async () =>
          collect(await pageId('Wartung Serverraum')),
        );

        expect(bodies).toHaveLength(5);
        expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(
          1,
        );
      });

      it('BRIDGE-AC62: search answers a foreign, deleted or unknown space with the same 404 space_not_found', async () => {
        const token = await userToken('WS');
        const bodies: unknown[] = [];
        const collect = async (space: string) => {
          const response = await searchAs(token, space, 'Plan');
          expectError(response, 404, 'space_not_found');
          bodies.push(response.json());
        };

        await collect(spaceId('Geschäftsführung'));
        await collect(randomUUID());
        await withDeletedSpace('IT', async () => collect(spaceId('IT')));

        expect(new Set(bodies.map((body) => JSON.stringify(body))).size).toBe(
          1,
        );
      });

      it('BRIDGE-AC63: search with an empty or blank query answers 400 invalid_request', async () => {
        const token = await userToken('WS');

        for (const query of ['', '   ', undefined, 'x'.repeat(201)]) {
          expectError(
            await searchAs(token, spaceId('Allgemein'), query),
            400,
            'invalid_request',
          );
        }
      });

      it('BRIDGE-AC64: a word only in a restricted page finds nothing for WS and the page for GF', async () => {
        const allgemein = spaceId('Allgemein');

        const denied = await searchAs(
          await userToken('WS'),
          allgemein,
          'Zweiströmeland',
        );
        const granted = await searchAs(
          await userToken('GF'),
          allgemein,
          'Zweiströmeland',
        );

        expect(denied.json()).toEqual({ results: [] });
        expect(granted.json()).toEqual({
          results: [
            {
              id: await pageId('Umstrukturierung 2027'),
              title: 'Umstrukturierung 2027',
              spaceId: allgemein,
            },
          ],
        });
      });

      it('BRIDGE-AC65: page-content answers a page in the trash and an unknown id with 404 page_not_found', async () => {
        expectError(await pageContent(randomUUID()), 404, 'page_not_found');

        await withTrashedPage('Willkommen bei Ostmooimooi', async () => {
          expectError(
            await pageContent(await pageId('Willkommen bei Ostmooimooi')),
            404,
            'page_not_found',
          );
        });
      });

      it('BRIDGE-AC67: attachment answers an unknown id, a deleted attachment and one of a trashed page with 404 attachment_not_found', async () => {
        const attachmentId = await attachmentIdOf(LICENSE_PDF);
        const fetchAttachment = (id: string) =>
          post('attachment', { attachmentId: id }, serviceOnly);

        expectError(
          await fetchAttachment(randomUUID()),
          404,
          'attachment_not_found',
        );

        await withTrashedPage(LICENSE_PAGE, async () => {
          expectError(
            await fetchAttachment(attachmentId),
            404,
            'attachment_not_found',
          );
        });

        await db
          .updateTable('attachments')
          .set({ deletedAt: new Date() })
          .where('id', '=', attachmentId)
          .execute();
        try {
          expectError(
            await fetchAttachment(attachmentId),
            404,
            'attachment_not_found',
          );
        } finally {
          await db
            .updateTable('attachments')
            .set({ deletedAt: null })
            .where('id', '=', attachmentId)
            .execute();
        }
      });

      describe('page list', () => {
        interface PageListBody {
          pages: { id: string; spaceId: string; updatedAt: string }[];
          nextCursor: string | null;
        }

        const pageList = (
          payload: object,
          headers: Record<string, string> = serviceOnly,
        ) => post('pages', payload, headers);

        const readPart = async (payload: object) => {
          const response = await pageList(payload);
          expect(response.statusCode).toBe(200);
          return response.json() as PageListBody;
        };

        const readAllParts = async () => {
          const parts: PageListBody[] = [];
          let cursor: string | null = null;
          do {
            const part = await readPart(cursor ? { cursor } : {});
            parts.push(part);
            cursor = part.nextCursor;
          } while (cursor);
          return parts;
        };

        const listedPages = async () =>
          (await readAllParts()).flatMap((part) => part.pages);

        const byId = (a: { id: string }, b: { id: string }) =>
          a.id.localeCompare(b.id);

        const indexablePages = async () =>
          (
            await db
              .selectFrom('pages')
              .innerJoin('spaces', 'spaces.id', 'pages.spaceId')
              .select(['pages.id', 'pages.spaceId', 'pages.updatedAt'])
              .where('pages.deletedAt', 'is', null)
              .where('spaces.deletedAt', 'is', null)
              .execute()
          )
            .map((page) => ({
              id: page.id,
              spaceId: page.spaceId,
              updatedAt: new Date(page.updatedAt).toISOString(),
            }))
            .sort(byId);

        const withExtraPages = async (
          count: number,
          run: () => Promise<void>,
        ) => {
          const ids = Array.from({ length: count }, () => randomUUID());
          await db
            .insertInto('pages')
            .values(
              ids.map((id, index) => ({
                id,
                slugId: `list${id.slice(0, 8)}`,
                title: `Seitenliste ${index}`,
                spaceId: spaceId('IT'),
                workspaceId: bridge.seed.workspaceId,
              })),
            )
            .execute();
          try {
            await run();
          } finally {
            await db.deleteFrom('pages').where('id', 'in', ids).execute();
          }
        };

        it('INDEX-AC43: the parts together hold every page outside the trash and deleted spaces exactly once', async () => {
          const listed = await listedPages();

          expect(new Set(listed.map((page) => page.id)).size).toBe(
            listed.length,
          );
          expect([...listed].sort(byId)).toEqual(await indexablePages());
          expect(listed.length).toBeGreaterThan(0);
        });

        it('INDEX-AC44: with 501 pages the first part holds 500 entries and a cursor, the next part the rest', async () => {
          const seeded = (await indexablePages()).length;

          await withExtraPages(501 - seeded, async () => {
            const first = await readPart({});
            expect(first.pages).toHaveLength(500);
            expect(
              first.nextCursor?.startsWith(`${first.pages[499].id}.`),
            ).toBe(true);

            const second = await readPart({ cursor: first.nextCursor });
            expect(second).toEqual({
              pages: [expect.any(Object)],
              nextCursor: null,
            });
            expect([...first.pages, ...second.pages].sort(byId)).toEqual(
              await indexablePages(),
            );
          });
        });

        it('INDEX-AC45: each update time equals the one page-content returns', async () => {
          for (const page of await listedPages()) {
            const content = await pageContent(page.id);
            expect({ id: page.id, updatedAt: page.updatedAt }).toEqual({
              id: page.id,
              updatedAt: (content.json() as { updatedAt: string }).updatedAt,
            });
          }
        });

        it('INDEX-AC46: a page in the trash and the pages of a space marked as deleted are not listed', async () => {
          const trashedId = await pageId('Preisliste Standardkomponenten');
          await withTrashedPage('Preisliste Standardkomponenten', async () => {
            const listed = await listedPages();
            expect(listed.length).toBeGreaterThan(0);
            expect(listed.map((page) => page.id)).not.toContain(trashedId);
          });

          await withDeletedSpace('IT', async () => {
            const listed = await listedPages();
            expect(listed.length).toBeGreaterThan(0);
            expect(listed.map((page) => page.spaceId)).not.toContain(
              spaceId('IT'),
            );
            expect(listed.map((page) => page.id)).not.toContain(
              await pageId('Wartung Serverraum'),
            );
          });
        });

        it('INDEX-AC47: page-content answers a page of a space marked as deleted with 404 page_not_found', async () => {
          const id = await pageId('Wartung Serverraum');

          await withDeletedSpace('IT', async () => {
            expectError(await pageContent(id), 404, 'page_not_found');
          });
          expect((await pageContent(id)).statusCode).toBe(200);
        });

        it.each([['not-a-cursor'], [''], [42], [['a']]])(
          'INDEX-AC48: the cursor %j answers 400 invalid_request',
          async (cursor) => {
            expectError(await pageList({ cursor }), 400, 'invalid_request');
          },
        );

        it('INDEX-AC48: a null cursor answers the first part like an absent one', async () => {
          expect(await readPart({ cursor: null })).toEqual(await readPart({}));
        });

        it('INDEX-AC48: a bare page id as cursor answers 400 invalid_request', async () => {
          const [listed] = await listedPages();

          expectError(
            await pageList({ cursor: listed.id }),
            400,
            'invalid_request',
          );
        });

        it('INDEX-AC48: a returned cursor with a tampered signature answers 400 invalid_request', async () => {
          const seeded = (await indexablePages()).length;

          await withExtraPages(501 - seeded, async () => {
            const { nextCursor, pages } = await readPart({});
            const cursor = nextCursor ?? '';
            const tampered =
              cursor.slice(0, -1) + (cursor.endsWith('A') ? 'B' : 'A');
            const signature = cursor.split('.')[1];

            expectError(
              await pageList({ cursor: tampered }),
              400,
              'invalid_request',
            );
            expectError(
              await pageList({ cursor: `${pages[0].id}.${signature}` }),
              400,
              'invalid_request',
            );
            expect((await pageList({ cursor })).statusCode).toBe(200);
          });
        });

        it('INDEX-AC49: the page list answers 503 assistant_disabled while the assistant is switched off', async () => {
          const configured = jest
            .spyOn(bridge.environmentService, 'isAiBridgeConfigured')
            .mockReturnValue(false);
          try {
            expectError(await pageList({}), 503, 'assistant_disabled');
          } finally {
            configured.mockRestore();
          }
        });

        it('INDEX-AC50: the page list without a service token answers 401 service_token_missing', async () => {
          expectError(await pageList({}, {}), 401, 'service_token_missing');
        });

        it('INDEX-AC51: the page list with a wrong service token answers 401 service_token_invalid', async () => {
          expectError(
            await pageList(
              {},
              {
                'x-service-token': TEST_AI_SERVICE_CREDENTIAL.replace(
                  /.$/,
                  'X',
                ),
              },
            ),
            401,
            'service_token_invalid',
          );
        });

        it('INDEX-AC52: the page list with a user id in its body answers 400 user_id_not_allowed', async () => {
          expectError(
            await pageList({ userId: users.GF.id }),
            400,
            'user_id_not_allowed',
          );
        });
      });
    });
  });

  describe('assistant status and job forwarding', () => {
    const clientAddress = `198.51.100.${Math.floor(Math.random() * 254) + 1}`;
    const JWT_PATTERN = /eyJ[\w-]+\.[\w-]+\.[\w-]+/;

    interface FakeRequest {
      method?: string;
      url?: string;
      headers: IncomingMessage['headers'];
      body: string;
    }

    type FakeMode = 'ok' | 'unauthorized' | 'error' | 'hang';

    let fake: Server;
    let fakeUrl: string;
    let fakeMode: FakeMode;
    let fakeRequests: FakeRequest[];
    let fakeAsk: (response: ServerResponse) => Promise<void>;
    let urlSpy: jest.SpyInstance;

    const pointAiServiceAt = (url: string) => urlSpy.mockReturnValue(url);

    const closedUrl = async () => {
      const probe = createServer();
      await new Promise<void>((resolve) =>
        probe.listen(0, '127.0.0.1', resolve),
      );
      const port = (probe.address() as AddressInfo).port;
      await new Promise((resolve) => probe.close(resolve));
      return `http://127.0.0.1:${port}`;
    };

    const login = async (key: SeedUserKey, remoteAddress = clientAddress) => {
      const response = await bridge.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress,
        payload: { email: users[key].email, password: SEED_DEMO_PASSWORD },
      });
      const authToken = /authToken=([^;]+)/.exec(
        String(response.headers['set-cookie']),
      )?.[1];
      expect(authToken).toBeTruthy();
      return { cookie: `authToken=${authToken}` };
    };

    const api = (
      path: string,
      payload: object,
      headers: Record<string, string> = {},
    ) =>
      bridge.app.inject({
        method: 'POST',
        url: `/api/${path}`,
        remoteAddress: clientAddress,
        headers,
        payload,
      });

    const waitFor = async <T>(find: () => T | undefined, timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = find();
        if (found !== undefined) return found;
        if (Date.now() > deadline) throw new Error('timed out waiting');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    };

    const createPage = async (
      headers: Record<string, string>,
      title: string,
    ) => {
      const response = await api(
        'pages/create',
        { title, spaceId: spaceId('Allgemein') },
        headers,
      );
      expect(response.statusCode).toBe(200);
      return response.json().id as string;
    };

    beforeAll(async () => {
      fake = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
          fakeRequests.push({
            method: req.method,
            url: req.url,
            headers: req.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          });
          if (fakeMode === 'hang') return;
          const serviceTokenOk =
            req.headers['x-service-token'] === TEST_AI_SERVICE_CREDENTIAL;
          const userToken = String(req.headers['x-user-token'] ?? '');
          const sessionOk =
            req.url !== '/v1/session' || JWT_PATTERN.test(userToken);
          const accepted = serviceTokenOk && sessionOk;
          if (req.url === '/v1/ask' && fakeMode === 'ok' && accepted) {
            void fakeAsk(res);
            return;
          }
          if (
            req.url === '/v1/conversations/confirm' &&
            fakeMode === 'ok' &&
            accepted
          ) {
            res.writeHead(204);
            res.end();
            return;
          }
          const status =
            fakeMode === 'error'
              ? 500
              : fakeMode === 'unauthorized' || !accepted
                ? 401
                : req.url === '/v1/jobs'
                  ? 202
                  : 200;
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end('{}');
        });
      });
      await new Promise<void>((resolve) =>
        fake.listen(0, '127.0.0.1', resolve),
      );
      fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    });

    afterAll(async () => {
      fake.closeAllConnections();
      await new Promise((resolve) => fake.close(resolve));
    });

    beforeEach(() => {
      fakeMode = 'ok';
      fakeRequests = [];
      fakeAsk = async (response) => {
        response.writeHead(200, { 'content-type': 'application/x-ndjson' });
        response.end('{"type":"no_source"}\n');
      };
      urlSpy = jest.spyOn(bridge.environmentService, 'getAiServiceUrl');
      pointAiServiceAt(fakeUrl);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('BRIDGE-AC37: the status endpoint answers 401 without a session', async () => {
      const response = await api('ai/status', {});

      expect(response.statusCode).toBe(401);
      expect(fakeRequests).toHaveLength(0);
    });

    it('BRIDGE-AC1: the status endpoint answers disabled and sends nothing while the assistant is switched off', async () => {
      const headers = await login('GF');
      jest
        .spyOn(bridge.environmentService, 'isAiBridgeConfigured')
        .mockReturnValue(false);

      const response = await api('ai/status', {}, headers);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'disabled' });
      expect(fakeRequests).toHaveLength(0);
    });

    it('BRIDGE-AC3: the status endpoint answers available when the AI service accepts the session', async () => {
      const response = await api('ai/status', {}, await login('GF'));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'available' });
      expect(fakeRequests).toHaveLength(1);
      expect(fakeRequests[0].url).toBe('/v1/session');
      expect(fakeRequests[0].headers['x-service-token']).toBe(
        TEST_AI_SERVICE_CREDENTIAL,
      );
    });

    it('BRIDGE-AC4: neither the status body nor its headers contain the user token sent to the AI service or any JWT', async () => {
      const response = await api('ai/status', {}, await login('GF'));

      const sentToken = String(fakeRequests[0].headers['x-user-token']);
      expect(sentToken).toMatch(JWT_PATTERN);
      const visible = `${response.body}${JSON.stringify(response.headers)}`;
      expect(visible).not.toContain(sentToken);
      expect(visible).not.toMatch(JWT_PATTERN);
      expect(Object.keys(response.json())).toEqual(['status']);
    });

    it('BRIDGE-AC38: the status endpoint answers unavailable when the connection is refused', async () => {
      pointAiServiceAt(await closedUrl());

      const response = await api('ai/status', {}, await login('GF'));

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'unavailable' });
    });

    it('BRIDGE-AC39: the status endpoint answers unavailable within 5 s when the AI service never answers', async () => {
      fakeMode = 'hang';
      const headers = await login('GF');
      const started = Date.now();

      const response = await api('ai/status', {}, headers);

      expect(Date.now() - started).toBeLessThan(5000);
      expect(response.json()).toEqual({ status: 'unavailable' });
    }, 15_000);

    it('BRIDGE-AC40: the status endpoint answers unavailable on HTTP 500', async () => {
      fakeMode = 'error';

      const response = await api('ai/status', {}, await login('GF'));

      expect(response.json()).toEqual({ status: 'unavailable' });
    });

    it('BRIDGE-AC41: the status endpoint answers unavailable on HTTP 401', async () => {
      fakeMode = 'unauthorized';

      const response = await api('ai/status', {}, await login('GF'));

      expect(response.json()).toEqual({ status: 'unavailable' });
    });

    it('BRIDGE-AC29: creating a page forwards page-created with the page id and workspace to the AI service within 5 s', async () => {
      const headers = await login('GF');

      const id = await createPage(headers, 'Weiterleitung AC29');

      const forwarded = await waitFor(() =>
        fakeRequests.find(
          (request) =>
            request.url === '/v1/jobs' &&
            JSON.parse(request.body).data.pageIds?.includes(id),
        ),
      );
      expect(forwarded.method).toBe('POST');
      expect(forwarded.headers['x-service-token']).toBe(
        TEST_AI_SERVICE_CREDENTIAL,
      );
      expect(JSON.parse(forwarded.body)).toEqual({
        name: 'page-created',
        data: { pageIds: [id], workspaceId: bridge.seed.workspaceId },
      });
    });

    describe('ask endpoint', () => {
      const CONVERSATION_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
      const TURN_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
      const sessions: Partial<Record<SeedUserKey, Record<string, string>>> = {};

      const loginAddress = `203.0.113.${Math.floor(Math.random() * 254) + 1}`;

      const session = async (key: SeedUserKey) =>
        (sessions[key] ??= await login(key, loginAddress));

      const ask = (body: object, headers: Record<string, string> = {}) =>
        api('ai/ask', { conversationId: CONVERSATION_ID, ...body }, headers);

      const sseEvents = (body: string) =>
        body
          .split('\n\n')
          .filter(Boolean)
          .map((frame) => {
            expect(frame.startsWith('data: ')).toBe(true);
            return JSON.parse(frame.slice('data: '.length));
          });

      const expectWithdrawn = async (headers: Record<string, string>) => {
        const response = await ask({ question: 'Frage' }, headers);

        expect(sseEvents(response.body)).toEqual([
          { type: 'delta', text: 'Antwort [1]' },
          { type: 'no_source' },
        ]);
        expect(confirmRequests()).toEqual([]);
      };

      const expectModelUnavailableAfterText = async (
        headers: Record<string, string>,
      ) => {
        const response = await ask({ question: 'Frage' }, headers);

        expect(response.statusCode).toBe(200);
        expect(sseEvents(response.body)).toEqual([
          { type: 'delta', text: 'Teil' },
          { type: 'error', code: 'model_unavailable' },
        ]);
        expect(confirmRequests()).toEqual([]);
      };

      const ndjson = (...events: object[]) =>
        events.map((event) => `${JSON.stringify(event)}\n`).join('');

      const citation = (pageIdValue: string, headingPath: string[]) => ({
        number: 1,
        pageId: pageIdValue,
        headingPath,
        attachmentId: null,
        fileName: null,
        pdfPage: null,
      });

      const answerCiting = (
        citations: object[],
        beforeCitations: () => Promise<void> = async () => undefined,
      ) => {
        fakeAsk = async (response) => {
          response.writeHead(200, { 'content-type': 'application/x-ndjson' });
          response.write(ndjson({ type: 'delta', text: 'Antwort [1]' }));
          await beforeCitations();
          response.end(
            ndjson({ type: 'citations', turnId: TURN_ID, citations }),
          );
        };
      };

      const askRequests = () =>
        fakeRequests.filter((request) => request.url === '/v1/ask');

      const confirmRequests = () =>
        fakeRequests.filter(
          (request) => request.url === '/v1/conversations/confirm',
        );

      it('ASK-AC64: a question without a session answers 401 and calls nothing', async () => {
        const response = await ask({ question: 'Frage' });

        expect(response.statusCode).toBe(401);
        expect(fakeRequests).toHaveLength(0);
      });

      it('ASK-AC61: every malformed question request answers 400 invalid_request', async () => {
        const headers = await session('WS');
        const allgemein = spaceId('Allgemein');
        const welcome = await pageId('Willkommen bei Ostmooimooi');
        const bodies = [
          { question: '' },
          { question: '   ' },
          { question: 'x'.repeat(2001) },
          { question: 'Frage', conversationId: undefined },
          { question: 'Frage', conversationId: 'not-a-uuid' },
          { question: 'Frage', spaceId: 'space-1' },
          { question: 'Frage', pageId: 'page-1' },
          { question: 'Frage', spaceId: allgemein, pageId: welcome },
        ];

        for (const body of bodies) {
          expectError(await ask(body, headers), 400, 'invalid_request');
        }
        expect(askRequests()).toHaveLength(0);
      });

      it('ASK-AC62: a foreign, deleted or unknown space answers the same 404 space_not_found', async () => {
        const headers = await session('WS');
        const itId = spaceId('IT');

        expectError(
          await ask(
            { question: 'Frage', spaceId: spaceId('Geschäftsführung') },
            headers,
          ),
          404,
          'space_not_found',
        );
        expectError(
          await ask({ question: 'Frage', spaceId: randomUUID() }, headers),
          404,
          'space_not_found',
        );
        await db
          .updateTable('spaces')
          .set({ deletedAt: new Date() })
          .where('id', '=', itId)
          .execute();
        try {
          expectError(
            await ask({ question: 'Frage', spaceId: itId }, headers),
            404,
            'space_not_found',
          );
        } finally {
          await db
            .updateTable('spaces')
            .set({ deletedAt: null })
            .where('id', '=', itId)
            .execute();
        }
        expect(askRequests()).toHaveLength(0);
      });

      it('ASK-AC63: a restricted, trashed or unknown page answers the same 404 page_not_found', async () => {
        const headers = await session('WS');
        const restricted = await pageId('Umstrukturierung 2027');
        const trashed = await pageId('Bürozeiten und Erreichbarkeit');

        expectError(
          await ask({ question: 'Frage', pageId: restricted }, headers),
          404,
          'page_not_found',
        );
        expectError(
          await ask({ question: 'Frage', pageId: randomUUID() }, headers),
          404,
          'page_not_found',
        );
        await bridge.pageRepo.removePage(
          trashed,
          users.GF.id,
          bridge.seed.workspaceId,
        );
        try {
          expectError(
            await ask({ question: 'Frage', pageId: trashed }, headers),
            404,
            'page_not_found',
          );
        } finally {
          await bridge.pageRepo.restorePage(trashed, bridge.seed.workspaceId);
        }
        expect(askRequests()).toHaveLength(0);
      });

      it('ASK-AC65: a switched-off assistant answers 503 assistant_disabled and calls nothing', async () => {
        const headers = await session('WS');
        jest
          .spyOn(bridge.environmentService, 'isAiBridgeConfigured')
          .mockReturnValue(false);

        expectError(
          await ask({ question: 'Frage' }, headers),
          503,
          'assistant_disabled',
        );
        expect(askRequests()).toHaveLength(0);
      });

      it('ASK-AC66: a refused connection answers 503 assistant_unavailable', async () => {
        const headers = await session('WS');
        pointAiServiceAt(await closedUrl());

        expectError(
          await ask({ question: 'Frage' }, headers),
          503,
          'assistant_unavailable',
        );
      });

      it('ASK-AC66: HTTP 401 and 500 from the AI service answer 503 assistant_unavailable', async () => {
        const headers = await session('WS');

        for (const mode of ['unauthorized', 'error'] as const) {
          fakeMode = mode;
          expectError(
            await ask({ question: 'Frage' }, headers),
            503,
            'assistant_unavailable',
          );
        }
      });

      it('ASK-AC17: GF gets the streamed text and a source for "Bänder" in Geschäftsführung linking the heading', async () => {
        const headers = await session('GF');
        const bands = await pageId('Gehaltsbänder Führungsebene');
        const page = await db
          .selectFrom('pages')
          .select(['slugId', 'content'])
          .where('id', '=', bands)
          .executeTakeFirstOrThrow();
        const headingId = (
          page.content as {
            content: {
              type: string;
              attrs: { id: string };
              content: { text: string }[];
            }[];
          }
        ).content.find(
          (node) =>
            node.type === 'heading' && node.content[0].text === 'Bänder',
        )!.attrs.id;
        answerCiting([citation(bands, ['Bänder'])]);

        const response = await ask(
          { question: '  Welche Gehaltsbänder gelten?  ' },
          headers,
        );

        expect(response.statusCode).toBe(200);
        expect(response.headers['content-type']).toContain('text/event-stream');
        expect(sseEvents(response.body)).toEqual([
          { type: 'delta', text: 'Antwort [1]' },
          {
            type: 'sources',
            sources: [
              {
                number: 1,
                pageId: bands,
                title: 'Gehaltsbänder Führungsebene',
                spaceName: 'Geschäftsführung',
                headingPath: ['Bänder'],
                fileName: null,
                pdfPage: null,
                url: `/s/${spaceSlug('Geschäftsführung')}/p/${page.slugId}#${headingId}`,
              },
            ],
          },
        ]);
        expect(headingId).toBeTruthy();
        const [sent] = askRequests();
        expect(JSON.parse(sent.body)).toEqual({
          question: 'Welche Gehaltsbänder gelten?',
          conversationId: CONVERSATION_ID,
        });
        expect(sent.headers['x-service-token']).toBe(
          TEST_AI_SERVICE_CREDENTIAL,
        );
        expect(String(sent.headers['x-user-token'])).toMatch(JWT_PATTERN);
        expect(
          `${response.body}${JSON.stringify(response.headers)}`,
        ).not.toMatch(JWT_PATTERN);
        const [confirmed] = confirmRequests();
        expect(JSON.parse(confirmed.body)).toEqual({
          conversationId: CONVERSATION_ID,
          turnId: TURN_ID,
        });
        expect(confirmed.headers['x-service-token']).toBe(
          TEST_AI_SERVICE_CREDENTIAL,
        );
        expect(String(confirmed.headers['x-user-token'])).toMatch(JWT_PATTERN);
      });

      it('ASK-AC20: a PDF source gets the file name and page and links the page top', async () => {
        const headers = await session('GF');
        const pdf = SEED_PDFS[0];
        const owner = await pageId(pdf.pageTitle);
        const slugId = (
          await db
            .selectFrom('pages')
            .select('slugId')
            .where('id', '=', owner)
            .executeTakeFirstOrThrow()
        ).slugId;
        answerCiting([
          {
            ...citation(owner, []),
            attachmentId: randomUUID(),
            fileName: pdf.fileName,
            pdfPage: 2,
          },
        ]);

        const events = sseEvents(
          (await ask({ question: 'Frage' }, headers)).body,
        );

        expect(events[events.length - 1]).toEqual({
          type: 'sources',
          sources: [
            expect.objectContaining({
              spaceName: pdf.space,
              headingPath: [],
              fileName: pdf.fileName,
              pdfPage: 2,
              url: `/s/${spaceSlug(pdf.space)}/p/${slugId}`,
            }),
          ],
        });
      });

      it('ASK-AC26: a cited page moved to the trash during the answer is withdrawn with no_source', async () => {
        const headers = await session('WS');
        const travel = await pageId('Reisekosten Richtlinie 2026');
        answerCiting([citation(travel, [])], () =>
          bridge.pageRepo.removePage(
            travel,
            users.GF.id,
            bridge.seed.workspaceId,
          ),
        );

        try {
          await expectWithdrawn(headers);
        } finally {
          await bridge.pageRepo.restorePage(travel, bridge.seed.workspaceId);
        }
      });

      it('ASK-AC27: a cited page of a space the user was removed from during the answer is withdrawn with no_source', async () => {
        const headers = await session('VT');
        const process = await pageId('Vertriebsprozess Anlagenbau');
        const vertriebId = spaceId('Vertrieb');
        const member = await bridge.spaceMemberRepo.getSpaceMemberByTypeId(
          vertriebId,
          { userId: users.VT.id },
        );
        answerCiting([citation(process, [])], () =>
          bridge.spaceMemberRepo.removeSpaceMemberById(
            member.id,
            vertriebId,
            {},
          ),
        );

        try {
          await expectWithdrawn(headers);
        } finally {
          await bridge.spaceMemberRepo.insertSpaceMember(member);
        }
      });

      it('ASK-AC28: a cited page restricted against the user during the answer is withdrawn with no_source', async () => {
        const headers = await session('WS');
        const hours = await pageId('Bürozeiten und Erreichbarkeit');
        answerCiting([citation(hours, [])], async () => {
          await db
            .insertInto('pageAccess')
            .values({
              pageId: hours,
              workspaceId: bridge.seed.workspaceId,
              spaceId: spaceId('Allgemein'),
              accessLevel: 'restricted',
              creatorId: users.GF.id,
            })
            .execute();
        });

        try {
          await expectWithdrawn(headers);
        } finally {
          await db
            .deleteFrom('pageAccess')
            .where('pageId', '=', hours)
            .execute();
        }
      });

      it('ASK-AC67: an error event after text ends the stream with model_unavailable', async () => {
        const headers = await session('WS');
        fakeAsk = async (response) => {
          response.writeHead(200, { 'content-type': 'application/x-ndjson' });
          response.end(
            ndjson(
              { type: 'delta', text: 'Teil' },
              { type: 'error', code: 'model_unavailable' },
            ),
          );
        };

        await expectModelUnavailableAfterText(headers);
      });

      it('ASK-AC69: a stream that breaks off after text ends with model_unavailable, not a 500', async () => {
        const headers = await session('WS');
        fakeAsk = async (response) => {
          response.writeHead(200, { 'content-type': 'application/x-ndjson' });
          response.write(ndjson({ type: 'delta', text: 'Teil' }));
          await new Promise((resolve) => setTimeout(resolve, 20));
          response.destroy();
        };

        await expectModelUnavailableAfterText(headers);
      });
    });

    describe('with the AI service down', () => {
      beforeEach(async () => {
        pointAiServiceAt(await closedUrl());
      });

      it('BRIDGE-AC8: login, page create, content update and reload still work', async () => {
        const headers = await login('GF');
        const id = await createPage(headers, 'Offline AC8');

        const update = await api(
          'pages/update',
          {
            pageId: id,
            content: '# Bearbeitet ohne KI',
            operation: 'replace',
            format: 'markdown',
          },
          headers,
        );
        const info = await api('pages/info', { pageId: id }, headers);

        expect(update.statusCode).toBe(200);
        expect(info.statusCode).toBe(200);
        expect(JSON.stringify(info.json().content)).toContain(
          'Bearbeitet ohne KI',
        );
      });

      it('BRIDGE-AC9: GET /api/health answers 200 healthy', async () => {
        const response = await bridge.app.inject({
          method: 'GET',
          url: '/api/health',
          remoteAddress: clientAddress,
        });

        expect(response.statusCode).toBe(200);
        expect(response.json().status).toBe('ok');
      });

      it('BRIDGE-AC68: page create still answers 200 and the failed forward is logged as a warning without content or tokens', async () => {
        const warn = jest.spyOn(
          Reflect.get(bridge.aiQueueProcessor, 'logger') as Logger,
          'warn',
        );
        const headers = await login('GF');

        const id = await createPage(headers, 'Offline AC68');

        const call = await waitFor(() =>
          warn.mock.calls.find(
            (args) =>
              String(args[0]).startsWith('Forwarding page-created') &&
              String(args[0]).includes(`(pageIds: ${id})`),
          ),
        );
        const message = String(call[0]);
        expect(message).toContain(`(pageIds: ${id})`);
        expect(message).toContain('connection error (ECONNREFUSED)');
        expect(message).not.toContain(TEST_AI_SERVICE_CREDENTIAL);
        expect(message).not.toMatch(JWT_PATTERN);
      });
    });
  });
});
