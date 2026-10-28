import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely } from 'kysely';
import type { INestApplication } from '@nestjs/common';
import { DB } from '@docmost/db/types/db';
import type { User } from '@docmost/db/types/entity.types';
import type { PageRepo } from '@docmost/db/repos/page/page.repo';
import type { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import type { UserRepo } from '@docmost/db/repos/user/user.repo';
import type { AiPageAccessService } from '../src/integrations/ai-bridge/services/ai-page-access.service';
import type { SeedWorkspaceResult } from '../src/integrations/seed/seed.service';
import { prepareSeedReset } from '../src/integrations/seed/seed-preflight';
import {
  deniedUserKeys,
  SEED_GROUPS,
  SEED_RESTRICTED_PAGES,
  SEED_SPACE_MEMBERSHIPS,
  SEED_SPACES,
  SEED_USERS,
  SeedUserKey,
} from '../src/integrations/seed/seed-definition';
import { SEED_PAGES } from '../src/integrations/seed/seed-pages';
import {
  createMigratedTestDatabase,
  loadAppModulesFor,
  removeDatabase,
  TEST_POSTGRES_SERVER,
} from './test-database';

const TEST_DATABASE = 'docmost_ai_bridge_test';
const TEST_DATABASE_URL = `${TEST_POSTGRES_SERVER}/${TEST_DATABASE}`;

const USER_KEYS = SEED_USERS.map((user) => user.key);

interface BridgeApp {
  app: INestApplication;
  aiPageAccessService: AiPageAccessService;
  pageRepo: PageRepo;
  spaceMemberRepo: SpaceMemberRepo;
  userRepo: UserRepo;
  seed: SeedWorkspaceResult;
}

function bootSeededBridge(storageRoot: string): Promise<BridgeApp> {
  return loadAppModulesFor(TEST_DATABASE_URL, async (): Promise<BridgeApp> => {
    const { Test } = await import('@nestjs/testing');
    const { FastifyAdapter } = await import('@nestjs/platform-fastify');
    const { SeedModule } = await import('../src/integrations/seed/seed.module');
    const { SeedService } =
      await import('../src/integrations/seed/seed.service');
    const { SeedContentService } =
      await import('../src/integrations/seed/seed-content.service');
    const { AiPageAccessService } =
      await import('../src/integrations/ai-bridge/services/ai-page-access.service');
    const { PageRepo } = await import('@docmost/db/repos/page/page.repo');
    const { SpaceMemberRepo } =
      await import('@docmost/db/repos/space/space-member.repo');
    const { UserRepo } = await import('@docmost/db/repos/user/user.repo');
    const { STORAGE_DRIVER_TOKEN } =
      await import('../src/integrations/storage/constants/storage.constants');
    const { LocalDriver } =
      await import('../src/integrations/storage/drivers/local.driver');

    const moduleRef = await Test.createTestingModule({
      imports: [SeedModule],
      providers: [AiPageAccessService],
    })
      .overrideProvider(STORAGE_DRIVER_TOKEN)
      .useValue(new LocalDriver({ storagePath: storageRoot }))
      .compile();
    const app = moduleRef.createNestApplication(new FastifyAdapter(), {
      logger: ['error'],
    });
    app.setGlobalPrefix('api');
    await app.init();

    const seed = await app.get(SeedService).seedWorkspace();
    await app.get(SeedContentService).seedPages(seed);
    return {
      app,
      seed,
      aiPageAccessService: app.get(AiPageAccessService),
      pageRepo: app.get(PageRepo, { strict: false }),
      spaceMemberRepo: app.get(SpaceMemberRepo, { strict: false }),
      userRepo: app.get(UserRepo, { strict: false }),
    };
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

  it('BRIDGE-AC14: a page moved into Geschäftsführung is dropped for WS and kept for GF', async () => {
    const id = await pageId('Willkommen bei Ostmooimooi');
    expect(await usersWhoSee(id)).toContain('WS');

    await bridge.pageRepo.updatePage(
      { spaceId: spaceId('Geschäftsführung') },
      id,
    );
    try {
      expect(await usersWhoSee(id)).toEqual(['GF']);
    } finally {
      await bridge.pageRepo.updatePage({ spaceId: spaceId('Allgemein') }, id);
    }
  });

  it('BRIDGE-AC16: a member removed from Vertrieb no longer gets its pages', async () => {
    const id = await pageId('Vertriebsprozess Anlagenbau');
    const vertriebId = spaceId('Vertrieb');
    expect(await usersWhoSee(id)).toEqual(['GF', 'VT']);

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
      expect(await usersWhoSee(id)).toEqual(['GF']);
      expect(
        await bridge.aiPageAccessService.readableSpaceIds(
          users.VT.id,
          users.VT.workspaceId,
        ),
      ).not.toContain(vertriebId);
    } finally {
      await bridge.spaceMemberRepo.insertSpaceMember(member);
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
});
