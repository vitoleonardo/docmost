import {
  SEED_GROUPS,
  SEED_SPACES,
  SEED_SPACE_MEMBERSHIPS,
  SEED_USERS,
  SeedUserKey,
  deniedUserKeys,
} from './seed-definition';

describe('seed definition', () => {
  it('SEED-AC13: denies PL, VT and WS on Umstrukturierung 2027', () => {
    expect(
      deniedUserKeys({ space: 'Allgemein', title: 'Umstrukturierung 2027' }),
    ).toEqual(['PL', 'VT', 'WS']);
  });

  it('SEED-AC13: denies VT and WS on the Kläranlage offer', () => {
    expect(
      deniedUserKeys({
        space: 'Projekte',
        title: 'Angebot Kalkulation Kläranlage Nordhafen',
      }),
    ).toEqual(['VT', 'WS']);
  });

  it('SEED-AC13: denies only VT on Baustelle Nordhafen intern', () => {
    expect(
      deniedUserKeys({
        space: 'Projekte',
        title: 'Baustelle Nordhafen intern',
      }),
    ).toEqual(['VT']);
  });

  it('SEED-AC13: the child page inherits the denied users of its parent', () => {
    expect(
      deniedUserKeys({
        space: 'Projekte',
        title: 'Baustelle Nordhafen Zugangscodes',
        parentTitle: 'Baustelle Nordhafen intern',
      }),
    ).toEqual(['VT']);
  });

  it('SEED-AC13: denies PL, VT and WS on an unrestricted Geschäftsführung page', () => {
    expect(
      deniedUserKeys({
        space: 'Geschäftsführung',
        title: 'Gesellschafterliste',
      }),
    ).toEqual(['PL', 'VT', 'WS']);
  });

  it('SEED-AC13: denies users without a space role on an unrestricted page', () => {
    expect(deniedUserKeys({ space: 'Vertrieb', title: 'Preisliste' })).toEqual([
      'PL',
      'WS',
    ]);
  });

  it('SEED-AC13: a group grant counts as view for WS', () => {
    expect(
      deniedUserKeys({
        space: 'Projekte',
        title: 'Baustelle Nordhafen intern',
      }),
    ).not.toContain('WS');
    expect(SEED_GROUPS.find((g) => g.name === 'Projektteam')?.userKeys).toEqual(
      ['WS'],
    );
  });

  it('SEED-AC13: a space admin gets no bypass on a restricted page', () => {
    expect(
      deniedUserKeys({ space: 'Projekte', title: 'Geheim' }, [
        {
          space: 'Projekte',
          title: 'Geheim',
          grants: [{ userKey: 'PL', role: 'reader' }],
        },
      ]),
    ).toContain('GF');
  });

  it('SEED-AC13: the space matrix matches the spec table', () => {
    const roleOf = (userKey: SeedUserKey, space: string) => {
      const memberships = SEED_SPACE_MEMBERSHIPS.filter(
        (m) =>
          m.space === space &&
          (m.userKey === userKey ||
            SEED_GROUPS.find((g) => g.name === m.groupName)?.userKeys.includes(
              userKey,
            )),
      );
      return memberships.map((m) => m.role);
    };
    const spaces = SEED_SPACES.map((s) => s.name);
    const countFor = (userKey: SeedUserKey) =>
      spaces.filter((s) => roleOf(userKey, s).length > 0).length;

    expect(SEED_USERS.map((u) => u.key)).toEqual(['GF', 'PL', 'VT', 'WS']);
    expect(spaces).toHaveLength(6);
    expect(countFor('GF')).toBe(6);
    expect(countFor('PL')).toBe(4);
    expect(countFor('VT')).toBe(3);
    expect(countFor('WS')).toBe(3);
    expect(roleOf('WS', 'Projekte')).toEqual(['writer']);
    expect(
      SEED_SPACE_MEMBERSHIPS.filter(
        (m) => m.space === 'Projekte' && m.userKey === 'WS',
      ),
    ).toHaveLength(0);
    expect(
      SEED_SPACES.filter((s) => s.visibility === 'open').map((s) => s.name),
    ).toEqual(['Allgemein']);
  });
});
