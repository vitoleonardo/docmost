import { CamelCasePlugin, Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { DB } from '@docmost/db/types/db';
import { createSeedMigrator } from '../src/integrations/seed/seed-preflight';

export const TEST_POSTGRES_SERVER =
  'postgresql://docmost:docmost@127.0.0.1:5433';

export function connect(url: string) {
  return new Kysely<DB>({
    dialect: new PostgresJSDialect({
      postgres: postgres(url, { max: 1, onnotice: () => undefined }),
    }),
    plugins: [new CamelCasePlugin()],
  });
}

export async function removeDatabase(admin: Kysely<DB>, name: string) {
  await sql`drop database if exists ${sql.id(name)} with (force)`.execute(
    admin,
  );
}

export async function createMigratedTestDatabase(name: string) {
  const admin = connect(`${TEST_POSTGRES_SERVER}/postgres`);
  await recreateDatabase(admin, name);
  const db = connect(`${TEST_POSTGRES_SERVER}/${name}`);
  const { error } = await createSeedMigrator(db).migrateToLatest();
  if (error) throw error;
  return { admin, db };
}

export async function loadAppModulesFor<T>(
  databaseUrl: string,
  load: () => Promise<T>,
): Promise<T> {
  process.env.DATABASE_URL = databaseUrl;
  let loaded: T | undefined;
  await jest.isolateModulesAsync(async () => {
    loaded = await load();
  });
  return loaded!;
}

export async function recreateDatabase(admin: Kysely<DB>, name: string) {
  await removeDatabase(admin, name);
  await sql`create database ${sql.id(name)}`.execute(admin);
}
