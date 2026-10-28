import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CamelCasePlugin, Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { randomInt } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DB } from '@docmost/db/types/db';
import type { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import {
  createSeedMigrator,
  prepareSeedReset,
  SEED_RESET_LOCK_KEY,
} from '../src/integrations/seed/seed-preflight';
import type {
  SeedService,
  SeedWorkspaceResult,
} from '../src/integrations/seed/seed.service';
import {
  SEED_DEMO_PASSWORD,
  SEED_USERS,
  SeedUserKey,
} from '../src/integrations/seed/seed-definition';

const SERVER = 'postgresql://docmost:docmost@127.0.0.1:5433';
const TEST_DATABASE = 'docmost_seed_test';
const NO_MIGRATIONS_DATABASE = 'docmost_seed_test_nomig';
const TEST_DATABASE_URL = `${SERVER}/${TEST_DATABASE}`;
const NON_LOCAL_TEST_DATABASE_URL = `postgresql://docmost:docmost@0.0.0.0:5433/${TEST_DATABASE}`;

const SEED_SPACE_NAMES = [
  'Allgemein',
  'HR',
  'Vertrieb',
  'Projekte',
  'IT',
  'Geschäftsführung',
];

const SPACE_MATRIX: Record<SeedUserKey, Record<string, string>> = {
  GF: {
    allgemein: 'admin',
    hr: 'admin',
    vertrieb: 'admin',
    projekte: 'admin',
    it: 'admin',
    geschaeftsfuehrung: 'admin',
  },
  PL: { allgemein: 'writer', hr: 'reader', projekte: 'admin', it: 'reader' },
  VT: { allgemein: 'writer', vertrieb: 'writer', projekte: 'reader' },
  WS: { allgemein: 'reader', projekte: 'writer', it: 'reader' },
};

const ROLE_RANK: Record<string, number> = { reader: 1, writer: 2, admin: 3 };

const MIGRATION_MESSAGE =
  'Apply the migrations first: pnpm --filter ./apps/server run migration:latest';

function connect(url: string) {
  return new Kysely<DB>({
    dialect: new PostgresJSDialect({
      postgres: postgres(url, { max: 1, onnotice: () => undefined }),
    }),
    plugins: [new CamelCasePlugin()],
  });
}

async function recreateDatabase(admin: Kysely<DB>, name: string) {
  await sql`drop database if exists ${sql.id(name)} with (force)`.execute(
    admin,
  );
  await sql`create database ${sql.id(name)}`.execute(admin);
}

async function insertWorkspace(db: Kysely<DB>, name: string) {
  const row = await db
    .insertInto('workspaces')
    .values({ name })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

async function countRows(db: Kysely<DB>, table: string) {
  const { rows } = await sql<{
    count: string;
  }>`select count(*) as count from ${sql.table(table)}`.execute(db);
  return Number(rows[0].count);
}

interface SeedApp {
  app: NestFastifyApplication;
  seedService: SeedService;
  spaceMemberRepo: SpaceMemberRepo;
}

async function bootSeedApp(databaseUrl: string): Promise<SeedApp> {
  process.env.DATABASE_URL = databaseUrl;
  let seedApp: SeedApp | undefined;
  await jest.isolateModulesAsync(async () => {
    const { NestFactory } = await import('@nestjs/core');
    const { ValidationPipe } = await import('@nestjs/common');
    const { FastifyAdapter } = await import('@nestjs/platform-fastify');
    const { default: fastifyCookie } = await import('@fastify/cookie');
    const { SeedModule } = await import('../src/integrations/seed/seed.module');
    const { SeedService } =
      await import('../src/integrations/seed/seed.service');
    const { SpaceMemberRepo } =
      await import('@docmost/db/repos/space/space-member.repo');

    const app = await NestFactory.create<NestFastifyApplication>(
      SeedModule,
      new FastifyAdapter(),
      { logger: ['error'] },
    );
    app.setGlobalPrefix('api');
    await app.register(fastifyCookie);
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, stopAtFirstError: true }),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    seedApp = {
      app,
      seedService: app.get(SeedService),
      spaceMemberRepo: app.get(SpaceMemberRepo, { strict: false }),
    };
  });
  return seedApp!;
}

async function preflightAndSeed(
  databaseUrl: string,
  confirmNonLocal: boolean,
  storageRoot: string,
) {
  const reset = await prepareSeedReset({
    databaseUrl,
    storageDriver: 'local',
    confirmNonLocal,
    storageRoot,
  });
  try {
    const seedApp = await bootSeedApp(databaseUrl);
    try {
      const result = await seedApp.seedService.seedWorkspace();
      return { seedApp, result };
    } catch (error) {
      await seedApp.app.close();
      throw error;
    }
  } finally {
    await reset.release();
  }
}

async function selectNames(
  db: Kysely<DB>,
  table: 'workspaces' | 'users' | 'groups' | 'spaces',
) {
  const rows = await db.selectFrom(table).select('name').execute();
  return rows.map((row) => row.name).sort();
}

async function expectSeededCounts(db: Kysely<DB>) {
  expect(await selectNames(db, 'workspaces')).toEqual([
    'Ostmooimooi Anlagenbau GmbH',
  ]);
  expect(await selectNames(db, 'users')).toEqual(
    SEED_USERS.map((user) => user.name).sort(),
  );
  expect(await selectNames(db, 'groups')).toEqual(['Everyone', 'Projektteam']);
  expect(await selectNames(db, 'spaces')).toEqual([...SEED_SPACE_NAMES].sort());
}

const localOptions = (storageRoot?: string) => ({
  databaseUrl: TEST_DATABASE_URL,
  storageDriver: 'local',
  confirmNonLocal: false,
  storageRoot,
});

describe('seed preflight and reset (e2e)', () => {
  let admin: Kysely<DB>;
  let db: Kysely<DB>;
  let storageRoot: string;

  beforeAll(async () => {
    admin = connect(`${SERVER}/postgres`);
    await recreateDatabase(admin, TEST_DATABASE);
    db = connect(TEST_DATABASE_URL);
    const { error } = await createSeedMigrator(db).migrateToLatest();
    if (error) throw error;
  }, 120_000);

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), 'seed-storage-'));
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
  });

  afterAll(async () => {
    await db?.destroy();
    await sql`drop database if exists ${sql.id(TEST_DATABASE)} with (force)`.execute(
      admin,
    );
    await admin?.destroy();
  });

  it('SEED-AC32: an unreachable database fails with its host', async () => {
    await expect(
      prepareSeedReset({
        ...localOptions(storageRoot),
        databaseUrl: 'postgresql://docmost:docmost@localhost:1/docmost',
      }),
    ).rejects.toThrow(/^Cannot reach database at localhost: .+/);
  });

  it('SEED-AC33: a database without migrations fails with the migration message', async () => {
    await recreateDatabase(admin, NO_MIGRATIONS_DATABASE);
    try {
      await expect(
        prepareSeedReset({
          ...localOptions(storageRoot),
          databaseUrl: `${SERVER}/${NO_MIGRATIONS_DATABASE}`,
        }),
      ).rejects.toThrow(new Error(MIGRATION_MESSAGE));
    } finally {
      await sql`drop database if exists ${sql.id(NO_MIGRATIONS_DATABASE)} with (force)`.execute(
        admin,
      );
    }
  });

  it('SEED-AC34: a held lock fails with "Another rebuild is running" and changes nothing', async () => {
    const sentinelId = await insertWorkspace(db, 'Sentinel');
    await mkdir(join(storageRoot, sentinelId), { recursive: true });
    const holder = connect(TEST_DATABASE_URL);
    try {
      await sql`select pg_advisory_lock(${SEED_RESET_LOCK_KEY}::bigint)`.execute(
        holder,
      );

      await expect(prepareSeedReset(localOptions(storageRoot))).rejects.toThrow(
        new Error('Another rebuild is running'),
      );

      const sentinel = await db
        .selectFrom('workspaces')
        .select('id')
        .where('id', '=', sentinelId)
        .executeTakeFirst();
      expect(sentinel).toEqual({ id: sentinelId });
      expect(existsSync(join(storageRoot, sentinelId))).toBe(true);
    } finally {
      await holder.destroy();
      await db.deleteFrom('workspaces').execute();
    }
  });

  it('SEED-AC28: the reset keeps the migration record and empties public and ai', async () => {
    await insertWorkspace(db, 'Before reset');
    await sql`create schema if not exists ai`.execute(db);
    await sql`create table if not exists ai.chunks (id serial primary key, body text)`.execute(
      db,
    );
    await sql`insert into ai.chunks (body) values ('stale')`.execute(db);

    const { release } = await prepareSeedReset(localOptions(storageRoot));
    await release();

    const migrations = await createSeedMigrator(db).getMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.filter((m) => !m.executedAt)).toEqual([]);
    expect(await countRows(db, 'kysely_migration')).toBe(migrations.length);
    expect(await countRows(db, 'workspaces')).toBe(0);
    expect(await countRows(db, 'ai.chunks')).toBe(0);
  });

  it('SEED-AC28: the reset removes only the stored folders of existing workspaces', async () => {
    const workspaceId = await insertWorkspace(db, 'Stored files');
    const workspaceFile = join(storageRoot, workspaceId, 'files', 'a.txt');
    const siblingFile = join(storageRoot, 'unrelated', 'keep.txt');
    await mkdir(join(storageRoot, workspaceId, 'files'), { recursive: true });
    await mkdir(join(storageRoot, 'unrelated'), { recursive: true });
    await writeFile(workspaceFile, 'x');
    await writeFile(siblingFile, 'y');

    const { release } = await prepareSeedReset(localOptions(storageRoot));
    await release();

    expect(existsSync(join(storageRoot, workspaceId))).toBe(false);
    expect(existsSync(siblingFile)).toBe(true);
    expect(existsSync(storageRoot)).toBe(true);
  });

  it('SEED-AC34: the lock is held until release and free afterwards', async () => {
    const { release } = await prepareSeedReset(localOptions(storageRoot));
    try {
      await expect(prepareSeedReset(localOptions(storageRoot))).rejects.toThrow(
        new Error('Another rebuild is running'),
      );
    } finally {
      await release();
    }

    const second = await prepareSeedReset(localOptions(storageRoot));
    await second.release();
  });

  describe('seed writer', () => {
    let seedStorage: string;
    let seedApp: SeedApp;
    let result: SeedWorkspaceResult;
    const clientAddress = `198.51.100.${randomInt(1, 255)}`;

    const login = (email: string, password: string) =>
      seedApp.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: clientAddress,
        payload: { email, password },
      });

    const effectiveRoles = async (userKey: SeedUserKey) => {
      const userId = result.userIds[userKey];
      const spaceIds = await seedApp.spaceMemberRepo.getUserSpaceIds(userId);
      const roles = await seedApp.spaceMemberRepo.getUserRolesForSpaces(
        userId,
        spaceIds,
      );
      const slugById = Object.fromEntries(
        Object.entries(result.spaceIds).map(([slug, id]) => [id, slug]),
      );
      const matrix: Record<string, string> = {};
      for (const { spaceId, role } of roles) {
        const slug = slugById[spaceId];
        if (!matrix[slug] || ROLE_RANK[role] > ROLE_RANK[matrix[slug]]) {
          matrix[slug] = role;
        }
      }
      return { spaceCount: spaceIds.length, matrix };
    };

    beforeAll(async () => {
      seedStorage = await mkdtemp(join(tmpdir(), 'seed-writer-'));
      ({ seedApp, result } = await preflightAndSeed(
        TEST_DATABASE_URL,
        false,
        seedStorage,
      ));
    }, 120_000);

    afterAll(async () => {
      await seedApp?.app.close();
      await rm(seedStorage, { recursive: true, force: true });
    });

    it('SEED-AC1: seeds exactly 1 workspace, 4 users, 2 groups and the 6 spaces', async () => {
      await expectSeededCounts(db);
      expect(result.counts).toEqual({
        workspaces: 1,
        users: 4,
        groups: 2,
        spaces: 6,
      });
      const spaces = await db
        .selectFrom('spaces')
        .select(['slug', 'visibility', 'isPersonal'])
        .orderBy('slug')
        .execute();
      expect(spaces).toEqual([
        { slug: 'allgemein', visibility: 'open', isPersonal: false },
        {
          slug: 'geschaeftsfuehrung',
          visibility: 'private',
          isPersonal: false,
        },
        { slug: 'hr', visibility: 'private', isPersonal: false },
        { slug: 'it', visibility: 'private', isPersonal: false },
        { slug: 'projekte', visibility: 'private', isPersonal: false },
        { slug: 'vertrieb', visibility: 'private', isPersonal: false },
      ]);
      const workspace = await db
        .selectFrom('workspaces')
        .select('defaultSpaceId')
        .executeTakeFirstOrThrow();
      expect(workspace.defaultSpaceId).toBe(result.spaceIds.allgemein);
    });

    it('SEED-AC1: gives every user the workspace role from the users table', async () => {
      const users = await db
        .selectFrom('users')
        .select(['email', 'role', 'workspaceId'])
        .orderBy('email')
        .execute();
      expect(users).toEqual(
        SEED_USERS.map((user) => ({
          email: user.email,
          role: user.workspaceRole,
          workspaceId: result.workspaceId,
        })).sort((a, b) => a.email.localeCompare(b.email)),
      );
    });

    it.each(SEED_USERS.map((user) => [user.key, user.email]))(
      'SEED-AC2: %s logs in with the demo password and gets an auth cookie',
      async (_key, email) => {
        const response = await login(email, SEED_DEMO_PASSWORD);
        expect(response.statusCode).toBe(200);
        expect(String(response.headers['set-cookie'])).toMatch(/authToken=.+/);
        expect(response.body).not.toMatch(/userHasMfa|requiresMfaSetup/);
        const user = await db
          .selectFrom('users')
          .select(['emailVerifiedAt', 'deactivatedAt'])
          .where('email', '=', email)
          .executeTakeFirstOrThrow();
        expect(user.emailVerifiedAt).not.toBeNull();
        expect(user.deactivatedAt).toBeNull();
      },
    );

    it('SEED-AC2: a wrong password fails without an auth cookie', async () => {
      const response = await login(SEED_USERS[1].email, 'wrong-password');
      expect(response.statusCode).toBe(401);
      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it.each(Object.keys(SPACE_MATRIX) as SeedUserKey[])(
      'SEED-AC3: %s has exactly the spaces and roles of the space matrix',
      async (userKey) => {
        const { spaceCount, matrix } = await effectiveRoles(userKey);
        expect(matrix).toEqual(SPACE_MATRIX[userKey]);
        expect(spaceCount).toBe(Object.keys(SPACE_MATRIX[userKey]).length);
      },
    );

    it('SEED-AC4: WS is writer in Projekte only through the group Projektteam', async () => {
      const projekteId = result.spaceIds.projekte;
      const wsId = result.userIds.WS;
      const members = await db
        .selectFrom('spaceMembers')
        .leftJoin('groups', 'groups.id', 'spaceMembers.groupId')
        .select(['spaceMembers.userId', 'groups.name as groupName', 'role'])
        .where('spaceMembers.spaceId', '=', projekteId)
        .execute();
      expect(members.filter((m) => m.userId === wsId)).toEqual([]);
      expect(members.filter((m) => m.groupName)).toEqual([
        { userId: null, groupName: 'Projektteam', role: 'writer' },
      ]);
      const groupUsers = await db
        .selectFrom('groupUsers')
        .select('userId')
        .where('groupId', '=', result.groupIds.Projektteam)
        .execute();
      expect(groupUsers).toEqual([{ userId: wsId }]);
      const roles = await seedApp.spaceMemberRepo.getUserSpaceRoles(
        wsId,
        projekteId,
      );
      expect(roles).toEqual([{ userId: wsId, role: 'writer' }]);
    });

    it('SEED-AC5: the default group holds all 4 users and has no space membership', async () => {
      const everyone = await db
        .selectFrom('groups')
        .select(['id', 'isDefault'])
        .where('name', '=', 'Everyone')
        .executeTakeFirstOrThrow();
      expect(everyone.isDefault).toBe(true);
      expect(everyone.id).toBe(result.groupIds.Everyone);
      const memberships = await db
        .selectFrom('spaceMembers')
        .select('spaceId')
        .where('groupId', '=', everyone.id)
        .execute();
      expect(memberships).toEqual([]);
      const groupUsers = await db
        .selectFrom('groupUsers')
        .select('userId')
        .where('groupId', '=', everyone.id)
        .execute();
      expect(groupUsers.map((g) => g.userId).sort()).toEqual(
        Object.values(result.userIds).sort(),
      );
    });
  });

  describe('seed writer against a non-local host', () => {
    let seedStorage: string;
    let seedApp: SeedApp | undefined;

    beforeAll(async () => {
      seedStorage = await mkdtemp(join(tmpdir(), 'seed-nonlocal-'));
    });

    afterAll(async () => {
      await seedApp?.app.close();
      await rm(seedStorage, { recursive: true, force: true });
    });

    it('SEED-AC31: without confirmation the non-local host is refused', async () => {
      await expect(
        preflightAndSeed(NON_LOCAL_TEST_DATABASE_URL, false, seedStorage),
      ).rejects.toThrow(
        new Error('Refusing to reset non-local database 0.0.0.0'),
      );
    });

    it('SEED-AC31: with confirmation the rebuild seeds the non-local database', async () => {
      const run = await preflightAndSeed(
        NON_LOCAL_TEST_DATABASE_URL,
        true,
        seedStorage,
      );
      seedApp = run.seedApp;
      expect(run.result.counts).toEqual({
        workspaces: 1,
        users: 4,
        groups: 2,
        spaces: 6,
      });
      await expectSeededCounts(db);
    }, 120_000);
  });
});
