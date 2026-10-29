import { Test } from '@nestjs/testing';
import { KYSELY_MODULE_CONNECTION_TOKEN } from 'nestjs-kysely';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { GroupRepo } from '@docmost/db/repos/group/group.repo';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { SignupService } from '../../core/auth/services/signup.service';
import { SpaceService } from '../../core/space/services/space.service';
import { SpaceMemberService } from '../../core/space/services/space-member.service';
import {
  SEED_DEFAULT_GROUP_NAME,
  SEED_SPACE_MEMBERSHIPS,
  SEED_SPACES,
  SEED_USERS,
} from './seed-definition';
import {
  formatSeedSummary,
  SeedService,
  seedSpaceByName,
} from './seed.service';

const WORKSPACE_ID = 'workspace-1';
const DEFAULT_SPACE_ID = 'space-default';
const DEFAULT_GROUP_ID = 'group-default';
const trx = { isTransaction: true };

type MemberLookup = { userId?: string; groupId?: string };

describe('SeedService', () => {
  let service: SeedService;
  let signupService: { initialSetup: jest.Mock };
  let userRepo: { insertUser: jest.Mock };
  let groupRepo: { getDefaultGroup: jest.Mock; insertGroup: jest.Mock };
  let groupUserRepo: { addUserToGroup: jest.Mock };
  let spaceService: { create: jest.Mock };
  let spaceRepo: { updateSpace: jest.Mock };
  let spaceMemberService: {
    addUserToSpace: jest.Mock;
    addGroupToSpace: jest.Mock;
  };
  let spaceMemberRepo: {
    getSpaceMemberByTypeId: jest.Mock;
    removeSpaceMemberById: jest.Mock;
  };
  let existingMember: (spaceId: string, lookup: MemberLookup) => unknown;

  beforeEach(async () => {
    const db = {
      transaction: () => ({
        execute: (callback: (t: unknown) => Promise<unknown>) => callback(trx),
      }),
    };
    signupService = {
      initialSetup: jest.fn().mockResolvedValue({
        user: { id: 'user-GF' },
        workspace: { id: WORKSPACE_ID, defaultSpaceId: DEFAULT_SPACE_ID },
      }),
    };
    userRepo = {
      insertUser: jest
        .fn()
        .mockImplementation(async ({ email }) => ({ id: `user-${email}` })),
    };
    groupRepo = {
      getDefaultGroup: jest.fn().mockResolvedValue({ id: DEFAULT_GROUP_ID }),
      insertGroup: jest
        .fn()
        .mockImplementation(async ({ name }) => ({ id: `group-${name}` })),
    };
    groupUserRepo = { addUserToGroup: jest.fn().mockResolvedValue(undefined) };
    spaceService = {
      create: jest
        .fn()
        .mockImplementation(async (_creator, _workspace, { slug }) => ({
          id: `space-${slug}`,
          visibility: 'open',
        })),
    };
    spaceRepo = { updateSpace: jest.fn().mockResolvedValue(undefined) };
    spaceMemberService = {
      addUserToSpace: jest.fn().mockResolvedValue(undefined),
      addGroupToSpace: jest.fn().mockResolvedValue(undefined),
    };
    existingMember = (spaceId, lookup) =>
      spaceId === DEFAULT_SPACE_ID && lookup.groupId === DEFAULT_GROUP_ID
        ? { id: 'default-group-membership', role: 'writer' }
        : undefined;
    spaceMemberRepo = {
      getSpaceMemberByTypeId: jest
        .fn()
        .mockImplementation(async (spaceId, lookup) =>
          existingMember(spaceId, lookup),
        ),
      removeSpaceMemberById: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        SeedService,
        { provide: KYSELY_MODULE_CONNECTION_TOKEN(), useValue: db },
        { provide: SignupService, useValue: signupService },
        { provide: UserRepo, useValue: userRepo },
        { provide: GroupRepo, useValue: groupRepo },
        { provide: GroupUserRepo, useValue: groupUserRepo },
        { provide: SpaceService, useValue: spaceService },
        { provide: SpaceRepo, useValue: spaceRepo },
        { provide: SpaceMemberService, useValue: spaceMemberService },
        { provide: SpaceMemberRepo, useValue: spaceMemberRepo },
      ],
    }).compile();
    service = module.get(SeedService);
  });

  it('SEED-AC1: creates the owner workspace, 4 users, 2 groups and 6 spaces from the definition', async () => {
    const result = await service.seedWorkspace();

    expect(result.counts).toEqual({
      workspaces: 1,
      users: 4,
      groups: 2,
      spaces: 6,
    });
    expect(result.workspaceId).toBe(WORKSPACE_ID);
    expect(Object.keys(result.userIds).sort()).toEqual([
      'GF',
      'PL',
      'VT',
      'WS',
    ]);
    expect(signupService.initialSetup).toHaveBeenCalledWith(
      expect.objectContaining({
        email: SEED_USERS[0].email,
        name: SEED_USERS[0].name,
      }),
      trx,
    );
    expect(userRepo.insertUser.mock.calls.map(([user]) => user.email)).toEqual(
      SEED_USERS.slice(1).map((user) => user.email),
    );
    expect(groupRepo.insertGroup).toHaveBeenCalledTimes(1);
    expect(groupRepo.insertGroup.mock.calls[0][0]).toMatchObject({
      name: 'Projektteam',
      isDefault: false,
    });
    expect(Object.keys(result.groupIds).sort()).toEqual(
      [SEED_DEFAULT_GROUP_NAME, 'Projektteam'].sort(),
    );
    expect(spaceService.create.mock.calls.map(([, , dto]) => dto.name)).toEqual(
      SEED_SPACES.slice(1).map((space) => space.name),
    );
    expect(Object.keys(result.spaceIds).sort()).toEqual(
      SEED_SPACES.map((space) => space.slug).sort(),
    );
  });

  it('SEED-AC1: renames the default space to Allgemein and keeps it open', async () => {
    await service.seedWorkspace();

    expect(spaceRepo.updateSpace).toHaveBeenCalledWith(
      { name: 'Allgemein', slug: 'allgemein', visibility: 'open' },
      DEFAULT_SPACE_ID,
      WORKSPACE_ID,
      trx,
    );
  });

  it('SEED-AC1: adds every member to the default group and WS to Projektteam', async () => {
    await service.seedWorkspace();

    const added = groupUserRepo.addUserToGroup.mock.calls.map(
      ([userId, groupId]) => `${userId}@${groupId}`,
    );
    for (const member of SEED_USERS.slice(1)) {
      expect(added).toContain(`user-${member.email}@${DEFAULT_GROUP_ID}`);
    }
    expect(added).toContain(
      'user-lukas.brehm@ostmooimooi.example.com@group-Projektteam',
    );
    expect(added).not.toContain(
      'user-sabine.kettler@ostmooimooi.example.com@group-Projektteam',
    );
  });

  it('SEED-AC3: writes the space memberships of the matrix', async () => {
    await service.seedWorkspace();

    expect(spaceMemberService.addUserToSpace).toHaveBeenCalledTimes(
      SEED_SPACE_MEMBERSHIPS.filter((m) => m.userKey).length,
    );
    expect(spaceMemberService.addGroupToSpace).toHaveBeenCalledTimes(1);
    expect(spaceMemberService.addGroupToSpace).toHaveBeenCalledWith(
      'group-Projektteam',
      'space-projekte',
      'writer',
      WORKSPACE_ID,
      trx,
    );
    expect(spaceMemberService.addUserToSpace).toHaveBeenCalledWith(
      'user-sabine.kettler@ostmooimooi.example.com',
      'space-hr',
      'reader',
      WORKSPACE_ID,
      trx,
    );
    expect(spaceMemberService.addUserToSpace).toHaveBeenCalledWith(
      'user-GF',
      'space-geschaeftsfuehrung',
      'admin',
      WORKSPACE_ID,
      trx,
    );
  });

  it('SEED-AC5: removes the default group from the default space', async () => {
    await service.seedWorkspace();

    expect(spaceMemberRepo.removeSpaceMemberById).toHaveBeenCalledWith(
      'default-group-membership',
      DEFAULT_SPACE_ID,
      { trx },
    );
  });

  it('SEED-AC5: does not remove anything when the default group has no space membership', async () => {
    existingMember = () => undefined;

    await service.seedWorkspace();

    expect(spaceMemberRepo.removeSpaceMemberById).not.toHaveBeenCalled();
  });

  it('SEED-AC1: makes new spaces private when they are created open', async () => {
    await service.seedWorkspace();

    const privateSpaces = SEED_SPACES.filter((s) => s.visibility === 'private');
    for (const space of privateSpaces) {
      expect(spaceRepo.updateSpace).toHaveBeenCalledWith(
        { visibility: 'private' },
        `space-${space.slug}`,
        WORKSPACE_ID,
        trx,
      );
    }
  });

  it('SEED-AC1: does not touch the visibility of a space that was created as defined', async () => {
    spaceService.create.mockImplementation(async (_c, _w, { slug }) => ({
      id: `space-${slug}`,
      visibility: 'private',
    }));

    await service.seedWorkspace();

    expect(spaceRepo.updateSpace).toHaveBeenCalledTimes(1);
  });

  it('SEED-AC4: gives WS no direct Projekte membership, only the group one', async () => {
    await service.seedWorkspace();

    expect(spaceMemberService.addUserToSpace).not.toHaveBeenCalledWith(
      'user-lukas.brehm@ostmooimooi.example.com',
      'space-projekte',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('SEED-AC3: skips a membership that already exists with the same role', async () => {
    const base = existingMember;
    existingMember = (spaceId, lookup) =>
      spaceId === 'space-hr' && lookup.userId === 'user-GF'
        ? { id: 'm', role: 'admin' }
        : base(spaceId, lookup);

    await service.seedWorkspace();

    expect(spaceMemberService.addUserToSpace).not.toHaveBeenCalledWith(
      'user-GF',
      'space-hr',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(spaceMemberService.addUserToSpace).toHaveBeenCalledTimes(
      SEED_SPACE_MEMBERSHIPS.filter((m) => m.userKey).length - 1,
    );
  });

  it('SEED-AC3: fails on a membership that exists with a different role', async () => {
    const base = existingMember;
    existingMember = (spaceId, lookup) =>
      spaceId === 'space-hr' && lookup.userId === 'user-GF'
        ? { id: 'm', role: 'reader' }
        : base(spaceId, lookup);

    await expect(service.seedWorkspace()).rejects.toThrow(
      'Seed membership conflict in HR: reader instead of admin',
    );
  });

  it('SEED-AC1: propagates a failing repo call and does not report a result', async () => {
    userRepo.insertUser.mockRejectedValueOnce(new Error('insert failed'));

    await expect(service.seedWorkspace()).rejects.toThrow('insert failed');
    expect(groupRepo.insertGroup).not.toHaveBeenCalled();
    expect(spaceMemberService.addUserToSpace).not.toHaveBeenCalled();
  });

  it('SEED-AC1: propagates a failing signup', async () => {
    signupService.initialSetup.mockRejectedValueOnce(
      new Error('signup failed'),
    );

    await expect(service.seedWorkspace()).rejects.toThrow('signup failed');
    expect(userRepo.insertUser).not.toHaveBeenCalled();
  });
});

describe('formatSeedSummary', () => {
  it('SEED-AC26: prints the one-line summary', () => {
    expect(
      formatSeedSummary({
        workspaces: 1,
        users: 4,
        groups: 2,
        spaces: 6,
        pages: 31,
        attachments: 9,
      }),
    ).toBe(
      'Seeded: 1 workspace, 4 users, 2 groups, 6 spaces, 31 pages, 9 attachments',
    );
  });
});

describe('seedSpaceByName', () => {
  it('SEED-AC1: finds a space of the definition by its name', () => {
    expect(seedSpaceByName('Geschäftsführung').slug).toBe('geschaeftsfuehrung');
  });
});
