import {
  assertLocalTargets,
  CONFIRM_NON_LOCAL_FLAG,
  isLocalDatabaseHost,
  prepareSeedReset,
  readSeedPreflightOptions,
} from './seed-preflight';

const urlFor = (host: string) =>
  `postgresql://seed:test-password@${host}:5432/docmost`;

describe('seed preflight locality', () => {
  it.each(['localhost', '127.0.0.1', '::1', '[::1]'])(
    'SEED-AC29: treats %s as a local database host',
    (host) => {
      expect(isLocalDatabaseHost(host)).toBe(true);
    },
  );

  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'SEED-AC29: accepts a database URL on %s',
    (host) => {
      expect(() =>
        assertLocalTargets({
          databaseUrl: urlFor(host),
          storageDriver: 'local',
          confirmNonLocal: false,
        }),
      ).not.toThrow();
    },
  );

  it.each(['db.internal', '10.0.0.5'])(
    'SEED-AC29: refuses the non-local database host %s',
    (host) => {
      expect(() =>
        assertLocalTargets({
          databaseUrl: urlFor(host),
          storageDriver: 'local',
          confirmNonLocal: false,
        }),
      ).toThrow(new Error(`Refusing to reset non-local database ${host}`));
    },
  );

  it('SEED-AC29: refuses a non-local database before connecting', async () => {
    await expect(
      prepareSeedReset({
        databaseUrl: urlFor('db.internal'),
        storageDriver: 'local',
        confirmNonLocal: false,
      }),
    ).rejects.toThrow(
      new Error('Refusing to reset non-local database db.internal'),
    );
  });

  it.each([undefined, '', 'local', 'LOCAL'])(
    'SEED-AC30: treats storage driver %p as local',
    (storageDriver) => {
      expect(() =>
        assertLocalTargets({
          databaseUrl: urlFor('localhost'),
          storageDriver,
          confirmNonLocal: false,
        }),
      ).not.toThrow();
    },
  );

  it.each(['s3', 'azure'])(
    'SEED-AC30: refuses the storage driver %s',
    (storageDriver) => {
      expect(() =>
        assertLocalTargets({
          databaseUrl: urlFor('localhost'),
          storageDriver,
          confirmNonLocal: false,
        }),
      ).toThrow(new Error('Refusing to reset non-local storage'));
    },
  );

  it('SEED-AC31: the confirmation flag lets a non-local database and storage pass', () => {
    expect(() =>
      assertLocalTargets({
        databaseUrl: urlFor('db.internal'),
        storageDriver: 's3',
        confirmNonLocal: true,
      }),
    ).not.toThrow();
  });

  it('SEED-AC31: reads the confirmation flag and the environment', () => {
    const env = {
      DATABASE_URL: urlFor('10.0.0.5'),
      STORAGE_DRIVER: 's3',
    };

    expect(
      readSeedPreflightOptions(
        ['node', 'seed-main', CONFIRM_NON_LOCAL_FLAG],
        env,
      ),
    ).toEqual({
      databaseUrl: env.DATABASE_URL,
      storageDriver: 's3',
      confirmNonLocal: true,
    });
    expect(readSeedPreflightOptions(['node', 'seed-main'], env)).toEqual(
      expect.objectContaining({ confirmNonLocal: false }),
    );
  });
});
