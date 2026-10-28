import * as path from 'path';
import { promises as fs } from 'fs';
import { rm } from 'node:fs/promises';
import { FileMigrationProvider, Kysely, Migrator, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import * as dotenv from 'dotenv';
import { DB } from '@docmost/db/types/db';
import { envPath, normalizePostgresUrl } from '../../common/helpers/utils';
import { LOCAL_STORAGE_PATH } from '../../common/helpers/constants';

export const CONFIRM_NON_LOCAL_FLAG = '--confirm-non-local';
export const SEED_RESET_LOCK_KEY = 4207311802;

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const MIGRATION_RECORD_TABLES = [
  'kysely_migration',
  'kysely_migration_lock',
  'alembic_version',
];
const MIGRATION_FOLDER = path.join(
  __dirname,
  '..',
  '..',
  'database',
  'migrations',
);

export interface SeedPreflightOptions {
  databaseUrl: string;
  storageDriver?: string;
  confirmNonLocal: boolean;
  storageRoot?: string;
}

export interface SeedReset {
  release: () => Promise<void>;
}

const stripBrackets = (host: string) => host.replace(/^\[(.*)\]$/, '$1');

function databaseHost(databaseUrl: string | undefined): string {
  if (!databaseUrl) throw new Error('DATABASE_URL is not set');
  const host = stripBrackets(new URL(databaseUrl).hostname);
  if (!host) throw new Error('DATABASE_URL has no host');
  return host;
}

export const isLocalDatabaseHost = (host: string) =>
  LOCAL_DATABASE_HOSTS.has(stripBrackets(host));

const isLocalStorageDriver = (driver?: string) =>
  !driver || driver.toLowerCase() === 'local';

export function readSeedPreflightOptions(
  argv: string[],
  env: NodeJS.ProcessEnv,
): SeedPreflightOptions {
  databaseHost(env.DATABASE_URL);
  return {
    databaseUrl: env.DATABASE_URL,
    storageDriver: env.STORAGE_DRIVER,
    confirmNonLocal: argv.includes(CONFIRM_NON_LOCAL_FLAG),
  };
}

export function loadSeedEnvironment(): NodeJS.ProcessEnv {
  dotenv.config({ path: envPath });
  return process.env;
}

export function assertLocalTargets(options: SeedPreflightOptions): void {
  const host = databaseHost(options.databaseUrl);
  if (!options.confirmNonLocal && !isLocalDatabaseHost(host)) {
    throw new Error(`Refusing to reset non-local database ${host}`);
  }
  if (!isLocalStorageDriver(options.storageDriver)) {
    throw new Error('Refusing to reset non-local storage');
  }
}

export function createSeedMigrator(db: Kysely<DB>): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: MIGRATION_FOLDER,
    }),
  });
}

function connectSingleSession(databaseUrl: string): Kysely<DB> {
  return new Kysely<DB>({
    dialect: new PostgresJSDialect({
      postgres: postgres(normalizePostgresUrl(databaseUrl), {
        max: 1,
        idle_timeout: null,
        max_lifetime: null,
        connect_timeout: 10,
        onnotice: () => undefined,
      }),
    }),
  });
}

const errorReason = (error: unknown) => {
  if (!(error instanceof Error)) return String(error);
  const code = (error as NodeJS.ErrnoException).code;
  return error.message || code || error.name;
};

async function assertReachable(db: Kysely<DB>, host: string) {
  try {
    await sql`select 1`.execute(db);
  } catch (error) {
    throw new Error(`Cannot reach database at ${host}: ${errorReason(error)}`);
  }
}

async function assertMigrationsApplied(db: Kysely<DB>) {
  const migrations = await createSeedMigrator(db).getMigrations();
  if (migrations.some((migration) => !migration.executedAt)) {
    throw new Error(
      'Apply the migrations first: pnpm --filter ./apps/server run migration:latest',
    );
  }
}

async function acquireLock(db: Kysely<DB>) {
  const { rows } = await sql<{
    locked: boolean;
  }>`select pg_try_advisory_lock(${SEED_RESET_LOCK_KEY}::bigint) as locked`.execute(
    db,
  );
  if (!rows[0]?.locked) throw new Error('Another rebuild is running');
}

async function releaseLock(db: Kysely<DB>) {
  await sql`select pg_advisory_unlock(${SEED_RESET_LOCK_KEY}::bigint)`.execute(
    db,
  );
}

async function truncateData(db: Kysely<DB>) {
  const { rows: tables } = await sql<{ schema: string; name: string }>`
    select table_schema as schema, table_name as name
    from information_schema.tables
    where table_type = 'BASE TABLE'
      and table_schema in ('public', 'ai')
      and table_name not in (${sql.join(MIGRATION_RECORD_TABLES)})
  `.execute(db);
  if (tables.length === 0) return;
  await sql`truncate ${sql.join(
    tables.map((table) => sql.id(table.schema, table.name)),
  )} restart identity cascade`.execute(db);
}

function workspaceStoragePath(storageRoot: string, workspaceId: string) {
  const root = path.resolve(storageRoot);
  const folder = path.resolve(root, workspaceId);
  if (path.dirname(folder) !== root) {
    throw new Error(
      `Refusing to delete storage outside ${root}: ${workspaceId}`,
    );
  }
  return folder;
}

async function removeWorkspaceStorage(
  storageRoot: string,
  workspaceIds: string[],
) {
  for (const workspaceId of workspaceIds) {
    await rm(workspaceStoragePath(storageRoot, workspaceId), {
      recursive: true,
      force: true,
    });
  }
}

async function resetData(db: Kysely<DB>, options: SeedPreflightOptions) {
  const workspaces = await db.selectFrom('workspaces').select('id').execute();
  await removeWorkspaceStorage(
    options.storageRoot ?? LOCAL_STORAGE_PATH,
    workspaces.map((workspace) => workspace.id),
  );
  await truncateData(db);
}

export async function prepareSeedReset(
  options: SeedPreflightOptions,
): Promise<SeedReset> {
  assertLocalTargets(options);
  const host = databaseHost(options.databaseUrl);
  const db = connectSingleSession(options.databaseUrl);
  let locked = false;
  const release = async () => {
    try {
      if (locked) await releaseLock(db);
    } finally {
      await db.destroy();
    }
  };

  try {
    await assertReachable(db, host);
    await assertMigrationsApplied(db);
    await acquireLock(db);
    locked = true;
    await resetData(db, options).catch((error: unknown) => {
      throw new Error(`Reset failed: ${errorReason(error)}`);
    });
    return { release };
  } catch (error) {
    await release();
    throw error;
  }
}
