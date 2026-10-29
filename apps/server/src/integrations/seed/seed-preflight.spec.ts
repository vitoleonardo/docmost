import {
  assertLocalTargets,
  CONFIRM_NON_LOCAL_FLAG,
  isLocalDatabaseHost,
  prepareSeedReset,
  readSeedPreflightOptions,
} from './seed-preflight';

const NON_LOCAL_STORAGE_MESSAGE = 'Refusing to reset non-local storage';

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

  it('SEED-AC31: the confirmation flag lets a non-local database pass', () => {
    expect(() =>
      assertLocalTargets({
        databaseUrl: urlFor('db.internal'),
        storageDriver: 'local',
        confirmNonLocal: true,
      }),
    ).not.toThrow();
  });

  it.each(['s3', 'azure'])(
    'SEED-AC36: a confirmed run with the storage driver %s fails because its files cannot be removed',
    (storageDriver) => {
      expect(() =>
        assertLocalTargets({
          databaseUrl: urlFor('db.internal'),
          storageDriver,
          confirmNonLocal: true,
        }),
      ).toThrow(new Error(NON_LOCAL_STORAGE_MESSAGE));
    },
  );

  it('SEED-AC36: a confirmed run with non-local storage fails before connecting', async () => {
    await expect(
      prepareSeedReset({
        databaseUrl: urlFor('localhost'),
        storageDriver: 's3',
        confirmNonLocal: true,
      }),
    ).rejects.toThrow(new Error(NON_LOCAL_STORAGE_MESSAGE));
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

describe('seed preflight database URL', () => {
  it.each([undefined, ''])(
    'SEED-AC29: a DATABASE_URL of %p fails with "DATABASE_URL is not set"',
    (databaseUrl) => {
      expect(() =>
        readSeedPreflightOptions(['node', 'seed-main'], {
          DATABASE_URL: databaseUrl,
        }),
      ).toThrow(new Error('DATABASE_URL is not set'));
    },
  );

  it('SEED-AC29: a DATABASE_URL without a host fails with "DATABASE_URL has no host"', () => {
    expect(() =>
      readSeedPreflightOptions(['node', 'seed-main'], {
        DATABASE_URL: 'postgresql:///docmost',
      }),
    ).toThrow(new Error('DATABASE_URL has no host'));
  });

  it.each([
    ['', 'DATABASE_URL is not set'],
    ['postgresql:///docmost', 'DATABASE_URL has no host'],
  ])(
    'SEED-AC31: the confirmation flag does not skip the check of DATABASE_URL %p',
    async (databaseUrl, message) => {
      await expect(
        prepareSeedReset({
          databaseUrl,
          storageDriver: 'local',
          confirmNonLocal: true,
        }),
      ).rejects.toThrow(new Error(message));
    },
  );
});

describe('seed preflight unreachable database', () => {
  const unreachableUrl = 'postgresql://seed:test-password@localhost:1/docmost';

  it('SEED-AC32: rejects with a message naming the database host', async () => {
    await expect(
      prepareSeedReset({
        databaseUrl: unreachableUrl,
        storageDriver: 'local',
        confirmNonLocal: false,
      }),
    ).rejects.toThrow(/^Cannot reach database at localhost: /);
  }, 30000);

  it('SEED-AC32: does not print the database password', async () => {
    const error = await prepareSeedReset({
      databaseUrl: unreachableUrl,
      storageDriver: 'local',
      confirmNonLocal: false,
    }).catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('test-password');
  }, 30000);
});
