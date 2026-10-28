import {
  SEED_GROUPS,
  SEED_RESTRICTED_PAGES,
  SEED_SPACE_MEMBERSHIPS,
  SEED_SPACES,
  SEED_USERS,
  SeedSpaceRole,
  SeedUserKey,
} from './seed-definition';
import {
  findDuplicateTitles,
  readSeedIssues,
  readSeedPageMarkdown,
  SEED_PAGES,
  SEED_PDFS,
  SeedPage,
} from './seed-pages';

const CANARY = /CANARY-[0-9A-F]{8}/g;

const bodyOf = (page: SeedPage) => readSeedPageMarkdown(page);

const findPage = (space: string, title: string) =>
  SEED_PAGES.find((p) => p.space === space && p.title === title);

const isRestricted = (page: SeedPage) =>
  SEED_RESTRICTED_PAGES.some(
    (r) =>
      r.space === page.space &&
      (r.title === page.title || r.title === page.parentTitle),
  );

const canaryPages = () =>
  SEED_PAGES.filter(
    (p) =>
      p.space === 'Geschäftsführung' ||
      SEED_RESTRICTED_PAGES.some(
        (r) => r.space === p.space && r.title === p.title,
      ),
  );

const spaceRolesOfNonOwners = (space: string): SeedSpaceRole[] =>
  SEED_USERS.filter((u) => u.workspaceRole !== 'owner').map((u) => {
    const groupNames = SEED_GROUPS.filter((g) =>
      g.userKeys.includes(u.key),
    ).map((g) => g.name);
    const roles = SEED_SPACE_MEMBERSHIPS.filter(
      (m) =>
        m.space === space &&
        ((m.userKey && m.userKey === (u.key as SeedUserKey)) ||
          (m.groupName && groupNames.includes(m.groupName))),
    ).map((m) => m.role);
    if (roles.includes('admin')) return 'admin';
    if (roles.includes('writer')) return 'writer';
    return roles.includes('reader') ? 'reader' : undefined;
  }) as SeedSpaceRole[];

describe('seed pages', () => {
  it('SEED-AC8: has 28 to 34 pages and at least 3 per space', () => {
    expect(SEED_PAGES.length).toBeGreaterThanOrEqual(28);
    expect(SEED_PAGES.length).toBeLessThanOrEqual(34);
    for (const space of SEED_SPACES) {
      const count = SEED_PAGES.filter((p) => p.space === space.name).length;
      expect(count).toBeGreaterThanOrEqual(3);
    }
    for (const page of SEED_PAGES) {
      expect(SEED_SPACES.map((s) => s.name)).toContain(page.space);
    }
  });

  it('SEED-AC9: every title occurs once', () => {
    expect(findDuplicateTitles(SEED_PAGES)).toEqual([]);
  });

  it('SEED-AC9: findDuplicateTitles reports a duplicated title', () => {
    const fixture: SeedPage[] = [
      { space: 'HR', title: 'Doppelt', file: 'hr/a.md' },
      { space: 'IT', title: 'Doppelt', file: 'it/b.md' },
      { space: 'IT', title: 'Einmalig', file: 'it/c.md' },
    ];
    expect(findDuplicateTitles(fixture)).toEqual(['Doppelt']);
  });

  it('SEED-AC10: at least 10 pages have 2 or more headings', () => {
    const withHeadings = SEED_PAGES.filter(
      (p) => (bodyOf(p).match(/^#{2,3} /gm) ?? []).length >= 2,
    );
    expect(withHeadings.length).toBeGreaterThanOrEqual(10);
  });

  it('SEED-AC10: bodies start with a paragraph and have no H1', () => {
    for (const page of SEED_PAGES) {
      const body = bodyOf(page);
      expect(body.trimStart().startsWith('#')).toBe(false);
      expect(body).not.toMatch(/^# /m);
    }
  });

  it('SEED-AC11: restricted and Geschäftsführung pages hold exactly one canary, others none', () => {
    const withCanary = canaryPages();
    expect(withCanary.length).toBeGreaterThanOrEqual(8);
    expect(SEED_RESTRICTED_PAGES.length).toBe(4);
    for (const page of SEED_PAGES) {
      const matches = bodyOf(page).match(CANARY) ?? [];
      expect(matches.length).toBe(withCanary.includes(page) ? 1 : 0);
      expect(bodyOf(page).match(/CANARY/g) ?? []).toHaveLength(
        matches.length,
      );
    }
  });

  it('SEED-AC12: every canary occurs in exactly one page', () => {
    const canaries = SEED_PAGES.flatMap((p) => bodyOf(p).match(CANARY) ?? []);
    expect(canaries.length).toBe(canaryPages().length);
    expect(new Set(canaries).size).toBe(canaries.length);
    for (const canary of canaries) {
      const holders = SEED_PAGES.filter((p) => bodyOf(p).includes(canary));
      expect(holders).toHaveLength(1);
    }
  });

  it('SEED-AC14: has 3 contradiction pairs with verbatim values on existing pages', () => {
    const { contradictions } = readSeedIssues();
    expect(contradictions.length).toBeGreaterThanOrEqual(3);
    for (const pair of contradictions) {
      expect(pair.fact.length).toBeGreaterThan(0);
      expect(pair.outdated.value).not.toBe(pair.current.value);
      for (const side of [pair.outdated, pair.current]) {
        const page = findPage(side.space, side.title);
        expect(page).toBeDefined();
        expect(bodyOf(page as SeedPage)).toContain(side.value);
      }
    }
  });

  it('SEED-AC15: a pair has both pages unrestricted in a space with a writer and a reader', () => {
    const { contradictions } = readSeedIssues();
    const qualifying = contradictions.filter((pair) => {
      if (pair.outdated.space !== pair.current.space) return false;
      const pages = [pair.outdated, pair.current].map((s) =>
        findPage(s.space, s.title),
      ) as SeedPage[];
      if (pages.some((p) => !p || isRestricted(p))) return false;
      const roles = spaceRolesOfNonOwners(pair.outdated.space);
      return roles.includes('writer') && roles.includes('reader');
    });
    expect(qualifying.length).toBeGreaterThanOrEqual(1);
  });

  it('SEED-AC16: has 2 outdated pages with verbatim statements', () => {
    const { outdated } = readSeedIssues();
    expect(outdated.length).toBeGreaterThanOrEqual(2);
    for (const entry of outdated) {
      const page = findPage(entry.space, entry.title);
      expect(page).toBeDefined();
      expect(bodyOf(page as SeedPage)).toContain(entry.statement);
    }
  });

  it('SEED-AC8: manifest restricted pages equal the definition and no other page sits below one', () => {
    for (const restricted of SEED_RESTRICTED_PAGES) {
      const page = findPage(restricted.space, restricted.title);
      expect(page).toBeDefined();
      expect(page?.parentTitle).toBe(restricted.parentTitle);
    }
    const restrictedTitles = SEED_RESTRICTED_PAGES.map((r) => r.title);
    const childTitles = SEED_PAGES.filter(
      (p) => p.parentTitle && restrictedTitles.includes(p.parentTitle),
    ).map((p) => p.title);
    expect(childTitles).toEqual(['Baustelle Nordhafen Zugangscodes']);
  });

  it('SEED-AC8: parents exist in the same space and files exist', () => {
    for (const page of SEED_PAGES) {
      if (page.parentTitle) {
        const parent = findPage(page.space, page.parentTitle);
        expect(parent).toBeDefined();
      }
      expect(bodyOf(page).length).toBeGreaterThan(100);
    }
  });

  it('SEED-AC19: 9 unique PDFs are attached to existing pages', () => {
    const names = SEED_PAGES.flatMap((p) => p.attachments ?? []);
    expect(names).toHaveLength(9);
    expect(new Set(names).size).toBe(9);
    expect(SEED_PDFS).toHaveLength(9);
    expect(SEED_PDFS.map((p) => p.fileName).sort()).toEqual([...names].sort());
    for (const pdf of SEED_PDFS) {
      expect(pdf.fileName).toMatch(/^[a-z0-9-]+\.pdf$/);
      expect(findPage(pdf.space, pdf.pageTitle)).toBeDefined();
    }
  });

  it('SEED-AC19: PDF kinds and placement match the documents section', () => {
    const count = (kind: string) =>
      SEED_PDFS.filter((p) => p.kind === kind).length;
    expect(count('contract')).toBe(6);
    expect(count('minutes')).toBe(2);
    expect(count('scan')).toBe(1);
    expect(
      SEED_PDFS.filter(
        (p) => p.kind === 'contract' && p.space === 'Geschäftsführung',
      ),
    ).toHaveLength(1);
    expect(
      SEED_PDFS.filter((p) => p.kind === 'minutes').every(
        (p) => p.space === 'Projekte',
      ),
    ).toBe(true);
    expect(SEED_PDFS.filter((p) => p.noRenewal)).toHaveLength(1);
    expect(SEED_PDFS.find((p) => p.noRenewal)?.kind).toBe('contract');
  });
});
