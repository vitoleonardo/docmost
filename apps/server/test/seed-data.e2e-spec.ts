import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { DB } from '@docmost/db/types/db';
import {
  createSeedMigrator,
  prepareSeedReset,
  SEED_RESET_LOCK_KEY,
} from '../src/integrations/seed/seed-preflight';

const SERVER = 'postgresql://docmost:docmost@127.0.0.1:5433';
const TEST_DATABASE = 'docmost_seed_test';
const NO_MIGRATIONS_DATABASE = 'docmost_seed_test_nomig';
const TEST_DATABASE_URL = `${SERVER}/${TEST_DATABASE}`;

const MIGRATION_MESSAGE =
  'Apply the migrations first: pnpm --filter ./apps/server run migration:latest';

function connect(url: string) {
  return new Kysely<DB>({
    dialect: new PostgresJSDialect({
      postgres: postgres(url, { max: 1, onnotice: () => undefined }),
    }),
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
});
