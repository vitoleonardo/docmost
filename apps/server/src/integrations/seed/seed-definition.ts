export type SeedUserKey = 'GF' | 'PL' | 'VT' | 'WS';
export type SeedSpaceRole = 'admin' | 'writer' | 'reader';
export type SeedPageRole = 'writer' | 'reader';

export interface SeedUser {
  key: SeedUserKey;
  name: string;
  email: string;
  workspaceRole: 'owner' | 'member';
}

export interface SeedGroup {
  name: string;
  isDefault: boolean;
  userKeys: SeedUserKey[];
}

export interface SeedSpace {
  name: string;
  slug: string;
  visibility: 'open' | 'private';
}

export interface SeedSpaceMembership {
  space: string;
  userKey?: SeedUserKey;
  groupName?: string;
  role: SeedSpaceRole;
}

export interface SeedPageGrant {
  userKey?: SeedUserKey;
  groupName?: string;
  role: SeedPageRole;
}

export interface SeedPageRef {
  space: string;
  title: string;
  parentTitle?: string;
}

export interface SeedRestrictedPage extends SeedPageRef {
  grants?: SeedPageGrant[];
}

export const SEED_WORKSPACE_NAME = 'Ostmooimooi Anlagenbau GmbH';
export const SEED_DEMO_PASSWORD = 'seed-demo-password';
export const SEED_DEFAULT_GROUP_NAME = 'Everyone';

export const SEED_USERS: SeedUser[] = [
  {
    key: 'GF',
    name: 'Jörg Ostmoor',
    email: 'joerg.ostmoor@ostmooimooi.example.com',
    workspaceRole: 'owner',
  },
  {
    key: 'PL',
    name: 'Sabine Kettler',
    email: 'sabine.kettler@ostmooimooi.example.com',
    workspaceRole: 'member',
  },
  {
    key: 'VT',
    name: 'Tobias Renner',
    email: 'tobias.renner@ostmooimooi.example.com',
    workspaceRole: 'member',
  },
  {
    key: 'WS',
    name: 'Lukas Brehm',
    email: 'lukas.brehm@ostmooimooi.example.com',
    workspaceRole: 'member',
  },
];

export const SEED_GROUPS: SeedGroup[] = [
  {
    name: SEED_DEFAULT_GROUP_NAME,
    isDefault: true,
    userKeys: ['GF', 'PL', 'VT', 'WS'],
  },
  { name: 'Projektteam', isDefault: false, userKeys: ['WS'] },
];

export const SEED_SPACES: SeedSpace[] = [
  { name: 'Allgemein', slug: 'allgemein', visibility: 'open' },
  { name: 'HR', slug: 'hr', visibility: 'private' },
  { name: 'Vertrieb', slug: 'vertrieb', visibility: 'private' },
  { name: 'Projekte', slug: 'projekte', visibility: 'private' },
  { name: 'IT', slug: 'it', visibility: 'private' },
  {
    name: 'Geschäftsführung',
    slug: 'geschaeftsfuehrung',
    visibility: 'private',
  },
];

export const SEED_SPACE_MEMBERSHIPS: SeedSpaceMembership[] = [
  { space: 'Allgemein', userKey: 'GF', role: 'admin' },
  { space: 'HR', userKey: 'GF', role: 'admin' },
  { space: 'Vertrieb', userKey: 'GF', role: 'admin' },
  { space: 'Projekte', userKey: 'GF', role: 'admin' },
  { space: 'IT', userKey: 'GF', role: 'admin' },
  { space: 'Geschäftsführung', userKey: 'GF', role: 'admin' },
  { space: 'Allgemein', userKey: 'PL', role: 'writer' },
  { space: 'HR', userKey: 'PL', role: 'reader' },
  { space: 'Projekte', userKey: 'PL', role: 'admin' },
  { space: 'IT', userKey: 'PL', role: 'reader' },
  { space: 'Allgemein', userKey: 'VT', role: 'writer' },
  { space: 'Vertrieb', userKey: 'VT', role: 'writer' },
  { space: 'Projekte', userKey: 'VT', role: 'reader' },
  { space: 'Allgemein', userKey: 'WS', role: 'reader' },
  { space: 'IT', userKey: 'WS', role: 'reader' },
  { space: 'Projekte', groupName: 'Projektteam', role: 'writer' },
];

export const SEED_RESTRICTED_PAGES: SeedRestrictedPage[] = [
  {
    space: 'Allgemein',
    title: 'Umstrukturierung 2027',
    grants: [{ userKey: 'GF', role: 'writer' }],
  },
  {
    space: 'Projekte',
    title: 'Angebot Kalkulation Kläranlage Nordhafen',
    grants: [
      { userKey: 'GF', role: 'writer' },
      { userKey: 'PL', role: 'writer' },
    ],
  },
  {
    space: 'Projekte',
    title: 'Baustelle Nordhafen intern',
    grants: [
      { userKey: 'GF', role: 'writer' },
      { userKey: 'PL', role: 'writer' },
      { groupName: 'Projektteam', role: 'reader' },
    ],
  },
  {
    space: 'Projekte',
    title: 'Baustelle Nordhafen Zugangscodes',
    parentTitle: 'Baustelle Nordhafen intern',
  },
];

function userKeysWithSpaceRole(space: string): Set<SeedUserKey> {
  const keys = new Set<SeedUserKey>();
  for (const membership of SEED_SPACE_MEMBERSHIPS) {
    if (membership.space !== space) continue;
    if (membership.userKey) keys.add(membership.userKey);
    const group = SEED_GROUPS.find((g) => g.name === membership.groupName);
    group?.userKeys.forEach((key) => keys.add(key));
  }
  return keys;
}

function userKeysWithGrants(grants: SeedPageGrant[]): Set<SeedUserKey> {
  const keys = new Set<SeedUserKey>();
  for (const grant of grants) {
    if (grant.userKey) keys.add(grant.userKey);
    const group = SEED_GROUPS.find((g) => g.name === grant.groupName);
    group?.userKeys.forEach((key) => keys.add(key));
  }
  return keys;
}

function pageChain(
  page: SeedPageRef,
  restrictedPages: SeedRestrictedPage[],
): SeedRestrictedPage[] {
  const chain: SeedRestrictedPage[] = [];
  const visited = new Set<string>();
  let current: SeedPageRef | undefined = page;
  while (current && !visited.has(current.title)) {
    visited.add(current.title);
    const restricted: SeedRestrictedPage | undefined = restrictedPages.find(
      (p) => p.space === page.space && p.title === current.title,
    );
    if (restricted) chain.push(restricted);
    const parentTitle: string | undefined =
      current.parentTitle ?? restricted?.parentTitle;
    current = parentTitle
      ? { space: page.space, title: parentTitle }
      : undefined;
  }
  return chain;
}

export function deniedUserKeys(
  page: SeedPageRef,
  restrictedPages: SeedRestrictedPage[] = SEED_RESTRICTED_PAGES,
): SeedUserKey[] {
  const withSpaceRole = userKeysWithSpaceRole(page.space);
  const restrictions = pageChain(page, restrictedPages).filter((p) => p.grants);

  return SEED_USERS.map((u) => u.key).filter((key) => {
    if (!withSpaceRole.has(key)) return true;
    return restrictions.some(
      (restricted) => !userKeysWithGrants(restricted.grants!).has(key),
    );
  });
}
