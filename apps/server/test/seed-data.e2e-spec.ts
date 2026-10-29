import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CamelCasePlugin, Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { randomInt } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Type } from '@nestjs/common';
import { DB } from '@docmost/db/types/db';
import type { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import type { PageRepo } from '@docmost/db/repos/page/page.repo';
import type { UserRepo } from '@docmost/db/repos/user/user.repo';
import type { PageAccessService } from '../src/core/page/page-access/page-access.service';
import type { SearchService } from '../src/core/search/search.service';
import type { SearchDTO } from '../src/core/search/dto/search.dto';
import {
  createSeedMigrator,
  loadSeedEnvironment,
  prepareSeedReset,
  SEED_RESET_LOCK_KEY,
} from '../src/integrations/seed/seed-preflight';
import type {
  formatSeedSummary as FormatSeedSummary,
  SeedPageCounts,
  SeedService,
  SeedWorkspaceResult,
} from '../src/integrations/seed/seed.service';
import type { SeedContentService } from '../src/integrations/seed/seed-content.service';
import {
  SEED_DEMO_PASSWORD,
  SEED_RESTRICTED_PAGES,
  SEED_USERS,
  SeedUserKey,
} from '../src/integrations/seed/seed-definition';
import {
  readSeedPageMarkdown,
  readSeedPdf,
  SEED_PAGES,
  SEED_PDFS,
} from '../src/integrations/seed/seed-pages';
import type { SeedCanary } from '../src/integrations/seed/seed-pdfs';

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

const SEED_SUMMARY_LINE =
  'Seeded: 1 workspace, 4 users, 2 groups, 6 spaces, 30 pages, 9 attachments';

const RESTRICTED_VIEW: Record<string, SeedUserKey[]> = {
  'Umstrukturierung 2027': ['GF'],
  'Angebot Kalkulation Kläranlage Nordhafen': ['GF', 'PL'],
  'Baustelle Nordhafen intern': ['GF', 'PL', 'WS'],
  'Baustelle Nordhafen Zugangscodes': ['GF', 'PL', 'WS'],
};

const RESTRICTED_EDIT: Record<string, SeedUserKey[]> = {
  'Umstrukturierung 2027': ['GF'],
  'Angebot Kalkulation Kläranlage Nordhafen': ['GF', 'PL'],
  'Baustelle Nordhafen intern': ['GF', 'PL'],
  'Baustelle Nordhafen Zugangscodes': ['GF', 'PL'],
};

const SEARCH_WORDS = ['Zweiströmeland', 'Kalenderfuchs', 'Pegelhase'];

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SEED_ENTRY_SCRIPT =
  /dist[\\/]integrations[\\/]seed[\\/]seed-main(\.js)?$/;

const SEED_SOURCE_DIR = join(__dirname, '..', 'src', 'integrations', 'seed');
const SEED_ENTRY = join(
  __dirname,
  '..',
  'dist',
  'integrations',
  'seed',
  'seed-main.js',
);

const AI_ENVIRONMENT = /^(AI_|OLLAMA_|OPENAI_|GEMINI_|TURBOPUFFER_)/;

const NETWORK_GUARD = `
const net = require('node:net');
const fs = require('node:fs');
const loopback = new Set(['localhost', '127.0.0.1', '::1', '::ffff:127.0.0.1']);
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  const options =
    first && typeof first === 'object'
      ? first
      : { port: first, host: typeof args[1] === 'string' ? args[1] : undefined };
  if (!options.path) {
    const host = options.host || 'localhost';
    const kind = loopback.has(host) ? 'loopback' : 'outbound';
    fs.appendFileSync(process.env.SEED_NETWORK_LOG, kind + ' ' + host + '\\n');
  }
  return connect.apply(this, args);
};
`;

const ARGV_LOGGER = `
const fs = require('node:fs');
const script = process.argv[1] || '';
fs.appendFileSync(process.env.SEED_ARGV_LOG, JSON.stringify(process.argv.slice(1)) + '\\n');
if (/@nestjs[\\\\/]cli[\\\\/]/.test(script) || /seed-main(\\.js)?$/.test(script)) {
  process.exit(0);
}
`;

interface ProseMirrorNode {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: ProseMirrorNode[];
}

const collapseWhitespace = (text: string) => text.replace(/\s+/g, ' ').trim();

const nodeText = (node: ProseMirrorNode): string =>
  node.text ?? (node.content ?? []).map(nodeText).join('');

const firstParagraphOfDoc = (doc: ProseMirrorNode) =>
  collapseWhitespace(
    nodeText(doc.content?.find((node) => node.type === 'paragraph') ?? {}),
  );

const firstParagraphOfMarkdown = (markdown: string) =>
  collapseWhitespace(
    markdown
      .split(/\n\s*\n/)
      .find((block) => block.trim() && !block.trim().startsWith('#')) ?? '',
  );

const readCanaries = (): SeedCanary[] =>
  JSON.parse(
    readFileSync(
      join(SEED_SOURCE_DIR, 'content', 'generated', 'canaries.json'),
      'utf8',
    ),
  ) as SeedCanary[];

const ACCESS_DENIED_ERRORS = new Set([
  'ForbiddenException',
  'NotFoundException',
]);

const isAccessDenied = (error: unknown) =>
  error instanceof Error && ACCESS_DENIED_ERRORS.has(error.name);

function newestSeedSourceTime(dir: string): number {
  return readdirSync(dir, { withFileTypes: true }).reduce((newest, entry) => {
    const path = join(dir, entry.name);
    const time = entry.isDirectory()
      ? newestSeedSourceTime(path)
      : statSync(path).mtimeMs;
    return Math.max(newest, time);
  }, 0);
}

function connect(url: string) {
  return new Kysely<DB>({
    dialect: new PostgresJSDialect({
      postgres: postgres(url, { max: 1, onnotice: () => undefined }),
    }),
    plugins: [new CamelCasePlugin()],
  });
}

async function removeDatabase(admin: Kysely<DB>, name: string) {
  await sql`drop database if exists ${sql.id(name)} with (force)`.execute(
    admin,
  );
}

async function recreateDatabase(admin: Kysely<DB>, name: string) {
  await removeDatabase(admin, name);
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
  seedContentService: SeedContentService;
  formatSeedSummary: typeof FormatSeedSummary;
  spaceMemberRepo: SpaceMemberRepo;
  pageRepo: PageRepo;
  userRepo: UserRepo;
  pageAccessService: PageAccessService;
  searchService: SearchService;
  loadDocumentJson: (pageId: string) => Promise<ProseMirrorNode>;
}

async function bootSeedApp(
  databaseUrl: string,
  storageRoot: string,
): Promise<SeedApp> {
  process.env.DATABASE_URL = databaseUrl;
  let seedApp: SeedApp | undefined;
  await jest.isolateModulesAsync(async () => {
    const { Test } = await import('@nestjs/testing');
    const { ValidationPipe } = await import('@nestjs/common');
    const { FastifyAdapter } = await import('@nestjs/platform-fastify');
    const { default: fastifyCookie } = await import('@fastify/cookie');
    const { Document } = await import('@hocuspocus/server');
    const { TiptapTransformer } = await import('@hocuspocus/transformer');
    const { SeedModule } = await import('../src/integrations/seed/seed.module');
    const { SeedService, formatSeedSummary } =
      await import('../src/integrations/seed/seed.service');
    const { SeedContentService } =
      await import('../src/integrations/seed/seed-content.service');
    const { SpaceMemberRepo } =
      await import('@docmost/db/repos/space/space-member.repo');
    const { PageRepo } = await import('@docmost/db/repos/page/page.repo');
    const { UserRepo } = await import('@docmost/db/repos/user/user.repo');
    const { PageAccessService } =
      await import('../src/core/page/page-access/page-access.service');
    const { SearchService } = await import('../src/core/search/search.service');
    const { PersistenceExtension } =
      await import('../src/collaboration/extensions/persistence.extension');
    const { STORAGE_DRIVER_TOKEN } =
      await import('../src/integrations/storage/constants/storage.constants');
    const { LocalDriver } =
      await import('../src/integrations/storage/drivers/local.driver');

    const moduleRef = await Test.createTestingModule({ imports: [SeedModule] })
      .overrideProvider(STORAGE_DRIVER_TOKEN)
      .useValue(new LocalDriver({ storagePath: storageRoot }))
      .compile();
    const app = moduleRef.createNestApplication<NestFastifyApplication>(
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
    const provider = <T>(type: Type<T>): T => app.get(type, { strict: false });
    const persistence = provider(PersistenceExtension);
    seedApp = {
      app,
      seedService: app.get(SeedService),
      seedContentService: app.get(SeedContentService),
      formatSeedSummary,
      spaceMemberRepo: provider(SpaceMemberRepo),
      pageRepo: provider(PageRepo),
      userRepo: provider(UserRepo),
      pageAccessService: provider(PageAccessService),
      searchService: provider(SearchService),
      loadDocumentJson: async (pageId) => {
        const documentName = `page.${pageId}`;
        const ydoc = await persistence.onLoadDocument({
          documentName,
          document: new Document(documentName),
        } as Parameters<typeof persistence.onLoadDocument>[0]);
        return TiptapTransformer.fromYdoc(ydoc, 'default') as ProseMirrorNode;
      },
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
    const seedApp = await bootSeedApp(databaseUrl, storageRoot);
    try {
      const result = await seedApp.seedService.seedWorkspace();
      const pageCounts: SeedPageCounts =
        await seedApp.seedContentService.seedPages(result);
      return { seedApp, result, pageCounts };
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

async function effectiveRoles(
  seedApp: SeedApp,
  result: SeedWorkspaceResult,
  userKey: SeedUserKey,
) {
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
}

async function pageIdByTitle(db: Kysely<DB>, title: string) {
  const row = await db
    .selectFrom('pages')
    .select('id')
    .where('title', '=', title)
    .executeTakeFirstOrThrow();
  return row.id;
}

async function usersAllowedTo(
  db: Kysely<DB>,
  seedApp: SeedApp,
  result: SeedWorkspaceResult,
  action: 'view' | 'edit',
  title: string,
) {
  const page = await seedApp.pageRepo.findById(await pageIdByTitle(db, title));
  const allowed: SeedUserKey[] = [];
  for (const { key } of SEED_USERS) {
    const user = await seedApp.userRepo.findById(
      result.userIds[key],
      result.workspaceId,
    );
    try {
      if (action === 'view') {
        await seedApp.pageAccessService.validateCanView(page, user);
      } else {
        await seedApp.pageAccessService.validateCanEdit(page, user);
      }
      allowed.push(key);
    } catch (error) {
      if (!isAccessDenied(error)) throw error;
    }
  }
  return allowed;
}

const COUNTED_TABLES = [
  'workspaces',
  'users',
  'groups',
  'groupUsers',
  'spaces',
  'spaceMembers',
  'pages',
  'pageAccess',
  'pagePermissions',
  'attachments',
] as const;

async function seedSnapshot(
  db: Kysely<DB>,
  seedApp: SeedApp,
  result: SeedWorkspaceResult,
) {
  const counts: Record<string, number> = {};
  for (const table of COUNTED_TABLES) {
    const row = await db
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .executeTakeFirstOrThrow();
    counts[table] = Number(row.count);
  }
  const pages = await db
    .selectFrom('pages')
    .innerJoin('spaces', 'spaces.id', 'pages.spaceId')
    .leftJoin('pages as parent', 'parent.id', 'pages.parentPageId')
    .select(['spaces.slug', 'parent.title as parentTitle', 'pages.title'])
    .orderBy('pages.title')
    .execute();
  const spaceMatrix: Record<string, Record<string, string>> = {};
  for (const { key } of SEED_USERS) {
    spaceMatrix[key] = (await effectiveRoles(seedApp, result, key)).matrix;
  }
  const pageMatrix: Record<string, SeedUserKey[]> = {};
  for (const { title } of SEED_RESTRICTED_PAGES) {
    pageMatrix[`view ${title}`] = await usersAllowedTo(
      db,
      seedApp,
      result,
      'view',
      title,
    );
    pageMatrix[`edit ${title}`] = await usersAllowedTo(
      db,
      seedApp,
      result,
      'edit',
      title,
    );
  }
  const canaries: string[] = [];
  for (const { canary, title } of readCanaries()) {
    const page = await db
      .selectFrom('pages')
      .select('textContent')
      .where('title', '=', title)
      .executeTakeFirstOrThrow();
    if (page.textContent?.includes(canary))
      canaries.push(`${title}: ${canary}`);
  }
  return { counts, pages, spaceMatrix, pageMatrix, canaries };
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
    await removeDatabase(admin, TEST_DATABASE);
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
      await removeDatabase(admin, NO_MIGRATIONS_DATABASE);
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

  it('SEED-AC28: the reset keeps the migration records in public and ai and empties both schemas', async () => {
    await insertWorkspace(db, 'Before reset');
    await sql`create schema if not exists ai`.execute(db);
    await sql`create table if not exists ai.chunks (id serial primary key, body text)`.execute(
      db,
    );
    await sql`insert into ai.chunks (body) values ('stale')`.execute(db);
    await sql`create table if not exists ai.alembic_version (version_num varchar(32) primary key)`.execute(
      db,
    );
    await sql`insert into ai.alembic_version (version_num) values ('0001_initial') on conflict do nothing`.execute(
      db,
    );

    const { release } = await prepareSeedReset(localOptions(storageRoot));
    await release();

    const migrations = await createSeedMigrator(db).getMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.filter((m) => !m.executedAt)).toEqual([]);
    expect(await countRows(db, 'kysely_migration')).toBe(migrations.length);
    expect(await countRows(db, 'workspaces')).toBe(0);
    expect(await countRows(db, 'ai.chunks')).toBe(0);
    expect(await countRows(db, 'ai.alembic_version')).toBe(1);
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

  it('SEED-AC28: a failed storage delete leaves the database and the workspace ids for the next run', async () => {
    const workspaceId = await insertWorkspace(db, 'Undeletable files');
    const lockedFolder = join(storageRoot, workspaceId, 'files');
    await mkdir(lockedFolder, { recursive: true });
    await writeFile(join(lockedFolder, 'a.txt'), 'x');
    await chmod(lockedFolder, 0o500);
    try {
      await expect(prepareSeedReset(localOptions(storageRoot))).rejects.toThrow(
        /^Reset failed: /,
      );
      const remaining = await db
        .selectFrom('workspaces')
        .select('id')
        .where('id', '=', workspaceId)
        .execute();
      expect(remaining).toEqual([{ id: workspaceId }]);

      await chmod(lockedFolder, 0o700);
      const { release } = await prepareSeedReset(localOptions(storageRoot));
      await release();
      expect(existsSync(join(storageRoot, workspaceId))).toBe(false);
      expect(await countRows(db, 'workspaces')).toBe(0);
    } finally {
      await chmod(lockedFolder, 0o700).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      });
      await db.deleteFrom('workspaces').execute();
    }
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
    let pageCounts: SeedPageCounts;
    const clientAddress = `198.51.100.${randomInt(1, 255)}`;

    const login = (email: string, password: string) =>
      seedApp.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: clientAddress,
        payload: { email, password },
      });

    const storedPage = (id: string) =>
      db
        .selectFrom('pages')
        .select(['title', 'content', 'textContent', 'ydoc'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow();

    beforeAll(async () => {
      seedStorage = await mkdtemp(join(tmpdir(), 'seed-writer-'));
      ({ seedApp, result, pageCounts } = await preflightAndSeed(
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
        const { spaceCount, matrix } = await effectiveRoles(
          seedApp,
          result,
          userKey,
        );
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

    it.each(Object.keys(RESTRICTED_VIEW))(
      'SEED-AC6: only the granted users can view "%s"',
      async (title) => {
        expect(
          await usersAllowedTo(db, seedApp, result, 'view', title),
        ).toEqual(RESTRICTED_VIEW[title]);
      },
    );

    it.each(Object.keys(RESTRICTED_EDIT))(
      'SEED-AC7: only the users with view and edit can edit "%s"',
      async (title) => {
        expect(
          await usersAllowedTo(db, seedApp, result, 'edit', title),
        ).toEqual(RESTRICTED_EDIT[title]);
      },
    );

    it('SEED-AC7: every grant of the page matrix is a row and the child has none', async () => {
      const rows = await db
        .selectFrom('pagePermissions')
        .innerJoin(
          'pageAccess',
          'pageAccess.id',
          'pagePermissions.pageAccessId',
        )
        .innerJoin('pages', 'pages.id', 'pageAccess.pageId')
        .leftJoin('users', 'users.id', 'pagePermissions.userId')
        .leftJoin('groups', 'groups.id', 'pagePermissions.groupId')
        .select([
          'pages.title',
          'pageAccess.accessLevel',
          'users.email',
          'groups.name as groupName',
          'pagePermissions.role',
        ])
        .execute();
      const emailByKey = Object.fromEntries(
        SEED_USERS.map((user) => [user.key, user.email]),
      );
      const expected = SEED_RESTRICTED_PAGES.flatMap((page) =>
        (page.grants ?? []).map((grant) => ({
          title: page.title,
          accessLevel: 'restricted',
          email: grant.userKey ? emailByKey[grant.userKey] : null,
          groupName: grant.groupName ?? null,
          role: grant.role,
        })),
      );
      const order = (r: { title: string; email: string; groupName: string }) =>
        `${r.title} ${r.email ?? ''} ${r.groupName ?? ''}`;
      expect(rows.sort((a, b) => order(a).localeCompare(order(b)))).toEqual(
        expected.sort((a, b) => order(a).localeCompare(order(b))),
      );
    });

    it.each(readCanaries().map((entry) => [entry.title, entry]))(
      'SEED-AC13: the users denied "%s" by PageAccessService are the deniedUsers of canaries.json',
      async (_title, entry) => {
        const page = await db
          .selectFrom('pages')
          .innerJoin('spaces', 'spaces.id', 'pages.spaceId')
          .select('spaces.name as spaceName')
          .where('pages.title', '=', entry.title)
          .executeTakeFirstOrThrow();
        expect(page.spaceName).toBe(entry.space);
        const allowed = await usersAllowedTo(
          db,
          seedApp,
          result,
          'view',
          entry.title,
        );
        const denied = SEED_USERS.map((user) => user.key).filter(
          (key) => !allowed.includes(key),
        );
        expect(denied.sort()).toEqual([...entry.deniedUsers].sort());
      },
    );

    it('SEED-AC26: the summary line names 30 pages and 9 attachments', () => {
      expect(pageCounts).toEqual({
        pages: SEED_PAGES.length,
        attachments: SEED_PDFS.length,
      });
      expect(
        seedApp.formatSeedSummary({ ...result.counts, ...pageCounts }),
      ).toBe(SEED_SUMMARY_LINE);
    });

    it('SEED-AC17: every page loads twice with its title and first paragraph and stays unchanged', async () => {
      for (const seedPage of SEED_PAGES) {
        const id = await pageIdByTitle(db, seedPage.title);
        const before = await storedPage(id);
        const expectedParagraph = firstParagraphOfMarkdown(
          readSeedPageMarkdown(seedPage),
        );
        expect(expectedParagraph).not.toBe('');

        const first = await seedApp.loadDocumentJson(id);
        const second = await seedApp.loadDocumentJson(id);
        const after = await storedPage(id);

        expect(after.title).toBe(seedPage.title);
        expect(firstParagraphOfDoc(first)).toBe(expectedParagraph);
        expect(firstParagraphOfDoc(second)).toBe(expectedParagraph);
        expect(second).toEqual(first);
        expect(after).toEqual(before);
      }
    }, 60_000);

    it.each(SEARCH_WORDS)(
      'SEED-AC18: GF finds the one page containing "%s"',
      async (word) => {
        const pagesWithWord = SEED_PAGES.filter((page) =>
          readSeedPageMarkdown(page).includes(word),
        );
        expect(pagesWithWord).toHaveLength(1);
        const { items } = await seedApp.searchService.searchPage(
          { query: word } as SearchDTO,
          { userId: result.userIds.GF, workspaceId: result.workspaceId },
        );
        expect(items.map((item) => item.title)).toContain(
          pagesWithWord[0].title,
        );
      },
    );

    it('SEED-AC19: exactly 9 PDFs hang on their named pages and are stored with their size', async () => {
      const attachments = await db
        .selectFrom('attachments')
        .innerJoin('pages', 'pages.id', 'attachments.pageId')
        .innerJoin('spaces', 'spaces.id', 'attachments.spaceId')
        .select([
          'attachments.id',
          'attachments.fileName',
          'attachments.filePath',
          'attachments.fileSize',
          'attachments.fileExt',
          'attachments.mimeType',
          'attachments.type',
          'attachments.creatorId',
          'attachments.workspaceId',
          'pages.title',
          'pages.content',
          'pages.spaceId as pageSpaceId',
          'spaces.id as spaceId',
          'spaces.name as spaceName',
        ])
        .execute();
      expect(await countRows(db, 'attachments')).toBe(9);
      expect(
        attachments
          .map((a) => [a.spaceName, a.title, a.fileName].join(' / '))
          .sort(),
      ).toEqual(
        SEED_PDFS.map((pdf) =>
          [pdf.space, pdf.pageTitle, pdf.fileName].join(' / '),
        ).sort(),
      );

      for (const attachment of attachments) {
        const pdf = SEED_PDFS.find((p) => p.fileName === attachment.fileName)!;
        const bytes = readSeedPdf(pdf);
        expect(attachment).toMatchObject({
          filePath: `${result.workspaceId}/files/${attachment.id}/${pdf.fileName}`,
          fileSize: String(bytes.length),
          fileExt: '.pdf',
          mimeType: 'application/pdf',
          type: 'file',
          creatorId: result.userIds.GF,
          workspaceId: result.workspaceId,
          spaceId: attachment.pageSpaceId,
        });
        const stored = await readFile(join(seedStorage, attachment.filePath));
        expect(stored.equals(bytes)).toBe(true);
        const nodes = (attachment.content as ProseMirrorNode).content ?? [];
        expect(nodes).toContainEqual({
          type: 'attachment',
          attrs: expect.objectContaining({
            url: `/api/files/${attachment.id}/${pdf.fileName}`,
            name: pdf.fileName,
            mime: 'application/pdf',
            size: bytes.length,
            attachmentId: attachment.id,
          }),
        });
      }
    });
  });

  describe('seed rebuild over a changed workspace', () => {
    let seedStorage: string;
    let seedApp: SeedApp | undefined;

    beforeAll(async () => {
      seedStorage = await mkdtemp(join(tmpdir(), 'seed-rebuild-'));
    });

    afterAll(async () => {
      await seedApp?.app.close();
      await rm(seedStorage, { recursive: true, force: true });
    });

    it('SEED-AC27: a rebuild removes an added page and a changed membership and equals a fresh seed', async () => {
      const fresh = await preflightAndSeed(
        TEST_DATABASE_URL,
        false,
        seedStorage,
      );
      seedApp = fresh.seedApp;
      const freshSnapshot = await seedSnapshot(db, fresh.seedApp, fresh.result);
      expect(freshSnapshot.canaries).toHaveLength(readCanaries().length);

      await db
        .insertInto('pages')
        .values({
          title: 'Hinzugefügte Seite',
          slugId: 'addedpage1',
          spaceId: fresh.result.spaceIds.allgemein,
          workspaceId: fresh.result.workspaceId,
          creatorId: fresh.result.userIds.VT,
        })
        .execute();
      await db
        .updateTable('spaceMembers')
        .set({ role: 'reader' })
        .where('userId', '=', fresh.result.userIds.VT)
        .where('spaceId', '=', fresh.result.spaceIds.vertrieb)
        .execute();
      expect(await seedSnapshot(db, fresh.seedApp, fresh.result)).not.toEqual(
        freshSnapshot,
      );
      await fresh.seedApp.app.close();
      seedApp = undefined;

      const rebuilt = await preflightAndSeed(
        TEST_DATABASE_URL,
        false,
        seedStorage,
      );
      seedApp = rebuilt.seedApp;
      expect(await seedSnapshot(db, rebuilt.seedApp, rebuilt.result)).toEqual(
        freshSnapshot,
      );
      const added = await db
        .selectFrom('pages')
        .select('id')
        .where('title', '=', 'Hinzugefügte Seite')
        .execute();
      expect(added).toEqual([]);
      expect(existsSync(join(seedStorage, fresh.result.workspaceId))).toBe(
        false,
      );
    }, 240_000);
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

  describe('seed rebuild command', () => {
    let workDir: string;
    let commandDir: string;
    let networkLog: string;
    let baseEnv: NodeJS.ProcessEnv;
    let run: ReturnType<typeof spawnSync>;

    const runSeedCommand = (
      args: string[],
      env: NodeJS.ProcessEnv,
      cwd = commandDir,
      command = process.execPath,
    ) =>
      spawnSync(command, args, {
        cwd,
        env: { ...baseEnv, ...env },
        encoding: 'utf8',
        timeout: 180_000,
      });

    const lastLine = (output: string | Buffer) =>
      String(output).trimEnd().split('\n').pop() ?? '';

    const expectRefusal = async (
      args: string[],
      env: NodeJS.ProcessEnv,
      message: string | RegExp,
    ) => {
      const pagesBefore = await countRows(db, 'pages');
      const refused = runSeedCommand([SEED_ENTRY, ...args], env);
      expect(refused.status).toBe(1);
      expect(lastLine(refused.stderr)).toEqual(
        typeof message === 'string' ? message : expect.stringMatching(message),
      );
      expect(lastLine(refused.stdout)).not.toMatch(/^Seeded:/);
      expect(await countRows(db, 'pages')).toBe(pagesBefore);
    };

    beforeAll(async () => {
      if (
        !existsSync(SEED_ENTRY) ||
        statSync(SEED_ENTRY).mtimeMs < newestSeedSourceTime(SEED_SOURCE_DIR)
      ) {
        throw new Error(
          'Build the server first: pnpm --filter ./apps/server run build',
        );
      }
      workDir = await mkdtemp(join(tmpdir(), 'seed-command-'));
      commandDir = join(workDir, 'apps', 'server');
      await mkdir(commandDir, { recursive: true });
      networkLog = join(workDir, 'network.log');
      await writeFile(networkLog, '');
      const guard = join(workDir, 'network-guard.cjs');
      await writeFile(guard, NETWORK_GUARD);

      baseEnv = Object.fromEntries(
        Object.entries(loadSeedEnvironment()).filter(
          ([key]) => !AI_ENVIRONMENT.test(key) && key !== 'NODE_ENV',
        ),
      );
      Object.assign(baseEnv, {
        DATABASE_URL: TEST_DATABASE_URL,
        STORAGE_DRIVER: 'local',
      });
      run = runSeedCommand([SEED_ENTRY], {
        NODE_OPTIONS: `--require ${guard}`,
        SEED_NETWORK_LOG: networkLog,
      });
    }, 240_000);

    afterAll(async () => {
      if (workDir) await rm(workDir, { recursive: true, force: true });
    });

    it('SEED-AC26: the built rebuild command ends with the summary line', async () => {
      expect({ status: run.status, stderr: String(run.stderr) }).toEqual({
        status: 0,
        stderr: expect.any(String),
      });
      expect(lastLine(run.stdout)).toBe(SEED_SUMMARY_LINE);
      expect(await countRows(db, 'pages')).toBe(30);
      const files = await db
        .selectFrom('attachments')
        .select('filePath')
        .execute();
      expect(files).toHaveLength(9);
      for (const { filePath } of files) {
        expect(existsSync(join(workDir, 'data', 'storage', filePath))).toBe(
          true,
        );
      }
    });

    it('SEED-AC35: the rebuild runs without AI settings and connects only to loopback hosts', async () => {
      expect(run.status).toBe(0);
      const connections = (await readFile(networkLog, 'utf8'))
        .split('\n')
        .filter(Boolean);
      expect(connections.length).toBeGreaterThan(0);
      expect(
        connections.filter((line) => !line.startsWith('loopback')),
      ).toEqual([]);
    });

    it('SEED-AC29: the command refuses the non-local host 0.0.0.0 without the flag and changes no data', async () => {
      await expectRefusal(
        [],
        { DATABASE_URL: NON_LOCAL_TEST_DATABASE_URL },
        'Refusing to reset non-local database 0.0.0.0',
      );
    }, 60_000);

    it('SEED-AC30: the command refuses non-local storage without the flag and changes no data', async () => {
      await expectRefusal(
        [],
        { STORAGE_DRIVER: 's3' },
        'Refusing to reset non-local storage',
      );
    }, 60_000);

    it('SEED-AC36: the command refuses non-local storage with the flag, because its files cannot be removed', async () => {
      await expectRefusal(
        ['--confirm-non-local'],
        { STORAGE_DRIVER: 's3' },
        'Refusing to reset non-local storage',
      );
    }, 60_000);

    it('SEED-AC32: the command names the host of an unreachable database', async () => {
      await expectRefusal(
        [],
        { DATABASE_URL: 'postgresql://docmost:docmost@localhost:1/docmost' },
        /^Cannot reach database at localhost: .+/,
      );
    }, 60_000);

    it('SEED-AC33: the command refuses a database without migrations', async () => {
      await recreateDatabase(admin, NO_MIGRATIONS_DATABASE);
      try {
        await expectRefusal(
          [],
          { DATABASE_URL: `${SERVER}/${NO_MIGRATIONS_DATABASE}` },
          MIGRATION_MESSAGE,
        );
      } finally {
        await removeDatabase(admin, NO_MIGRATIONS_DATABASE);
      }
    }, 60_000);

    it('SEED-AC31: the command seeds the non-local host 0.0.0.0 with --confirm-non-local', async () => {
      const confirmed = runSeedCommand([SEED_ENTRY, '--confirm-non-local'], {
        DATABASE_URL: NON_LOCAL_TEST_DATABASE_URL,
      });
      expect({
        status: confirmed.status,
        summary: lastLine(confirmed.stdout),
      }).toEqual({ status: 0, summary: SEED_SUMMARY_LINE });
      await expectSeededCounts(db);
    }, 240_000);

    it('SEED-AC31: pnpm seed passes --confirm-non-local through to the rebuild entry', async () => {
      const argvLog = join(workDir, 'argv.log');
      await writeFile(argvLog, '');
      const logger = join(workDir, 'argv-logger.cjs');
      await writeFile(logger, ARGV_LOGGER);

      const chain = runSeedCommand(
        ['seed', '--confirm-non-local'],
        {
          DATABASE_URL: NON_LOCAL_TEST_DATABASE_URL,
          NODE_OPTIONS: `--require ${logger}`,
          SEED_ARGV_LOG: argvLog,
        },
        REPO_ROOT,
        'pnpm',
      );

      expect(chain.status).toBe(0);
      const entryRuns = (await readFile(argvLog, 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[])
        .filter(([script]) => SEED_ENTRY_SCRIPT.test(script));
      expect(entryRuns).toHaveLength(1);
      expect(entryRuns[0].slice(1)).toEqual(['--confirm-non-local']);
    }, 120_000);
  });
});
