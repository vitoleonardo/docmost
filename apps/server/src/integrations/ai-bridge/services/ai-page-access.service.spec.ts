import { Test } from '@nestjs/testing';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { Page, Space, User } from '@docmost/db/types/entity.types';
import { AiPageAccessService } from './ai-page-access.service';

const WORKSPACE_ID = 'workspace-1';
const USER = { id: 'user-1', workspaceId: WORKSPACE_ID } as User;
const PAGE_CONTENT: Page['content'] = { type: 'doc' };

interface StoredPage {
  id: string;
  spaceId: string;
  trashed?: boolean;
}

interface StoredSpace {
  id: string;
  deleted?: boolean;
}

describe('AiPageAccessService', () => {
  let service: AiPageAccessService;
  let memberSpaceIds: string[];
  let spaces: StoredSpace[];
  let pages: StoredPage[];
  let restrictedPageIds: Set<string>;

  const spaceMemberRepo = { getUserSpaceIds: jest.fn() };
  const spaceRepo = { findById: jest.fn() };
  const pageRepo = { findManyByIds: jest.fn(), findById: jest.fn() };
  const pagePermissionRepo = { filterAccessiblePageIds: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    memberSpaceIds = ['space-a', 'space-b'];
    spaces = [{ id: 'space-a' }, { id: 'space-b' }, { id: 'space-gf' }];
    pages = [
      { id: 'page-a1', spaceId: 'space-a' },
      { id: 'page-a2', spaceId: 'space-a' },
      { id: 'page-b1', spaceId: 'space-b' },
      { id: 'page-gf', spaceId: 'space-gf' },
    ];
    restrictedPageIds = new Set();

    spaceMemberRepo.getUserSpaceIds.mockImplementation(async () => [
      ...memberSpaceIds,
    ]);
    spaceRepo.findById.mockImplementation(
      async (spaceId: string, workspaceId: string) => {
        const space = spaces.find((entry) => entry.id === spaceId);
        if (!space || workspaceId !== WORKSPACE_ID) return undefined;
        return {
          id: space.id,
          workspaceId,
          deletedAt: space.deleted ? new Date() : null,
        } as Space;
      },
    );
    pageRepo.findManyByIds.mockImplementation(
      async (ids: string[], opts: { workspaceId?: string }) =>
        pages
          .filter((page) => ids.includes(page.id))
          .filter((page) => !(opts?.workspaceId && page.trashed))
          .reverse()
          .map(
            (page) =>
              ({
                id: page.id,
                spaceId: page.spaceId,
                workspaceId: WORKSPACE_ID,
              }) as Page,
          ),
    );
    pageRepo.findById.mockImplementation(
      async (id: string) =>
        ({
          id,
          title: `Title ${id}`,
          content: PAGE_CONTENT,
        }) as Page,
    );
    pagePermissionRepo.filterAccessiblePageIds.mockImplementation(
      async (opts: { pageIds: string[] }) =>
        opts.pageIds.filter((id) => !restrictedPageIds.has(id)).reverse(),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        AiPageAccessService,
        { provide: SpaceMemberRepo, useValue: spaceMemberRepo },
        { provide: SpaceRepo, useValue: spaceRepo },
        { provide: PageRepo, useValue: pageRepo },
        { provide: PagePermissionRepo, useValue: pagePermissionRepo },
      ],
    }).compile();
    service = moduleRef.get(AiPageAccessService);
  });

  describe('readableSpaceIds', () => {
    it('BRIDGE-AC10: returns the member spaces from the repo, group memberships included', async () => {
      memberSpaceIds = ['space-a', 'space-b'];

      await expect(
        service.readableSpaceIds(USER.id, WORKSPACE_ID),
      ).resolves.toEqual(['space-a', 'space-b']);
      expect(spaceMemberRepo.getUserSpaceIds).toHaveBeenCalledWith(USER.id);
    });

    it('BRIDGE-AC10: excludes spaces marked as deleted', async () => {
      spaces = [{ id: 'space-a' }, { id: 'space-b', deleted: true }];

      await expect(
        service.readableSpaceIds(USER.id, WORKSPACE_ID),
      ).resolves.toEqual(['space-a']);
    });

    it('BRIDGE-AC10: excludes spaces outside the workspace', async () => {
      await expect(
        service.readableSpaceIds(USER.id, 'other-workspace'),
      ).resolves.toEqual([]);
    });

    it('BRIDGE-AC43: a user who is a member of no space gets an empty list', async () => {
      memberSpaceIds = [];

      await expect(
        service.readableSpaceIds(USER.id, WORKSPACE_ID),
      ).resolves.toEqual([]);
      expect(spaceRepo.findById).not.toHaveBeenCalled();
    });
  });

  describe('filterViewablePageIds', () => {
    it('BRIDGE-AC13: keeps only viewable ids in input order', async () => {
      restrictedPageIds = new Set(['page-a2']);

      await expect(
        service.filterViewablePageIds(USER, [
          'page-b1',
          'page-gf',
          'page-a2',
          'page-a1',
        ]),
      ).resolves.toEqual(['page-b1', 'page-a1']);
    });

    it('BRIDGE-AC13: checks restrictions per space with the user id', async () => {
      await service.filterViewablePageIds(USER, ['page-a1', 'page-b1']);

      expect(pagePermissionRepo.filterAccessiblePageIds).toHaveBeenCalledWith({
        pageIds: ['page-a1'],
        userId: USER.id,
        spaceId: 'space-a',
      });
      expect(pagePermissionRepo.filterAccessiblePageIds).toHaveBeenCalledWith({
        pageIds: ['page-b1'],
        userId: USER.id,
        spaceId: 'space-b',
      });
      expect(pageRepo.findManyByIds).toHaveBeenCalledWith(
        ['page-a1', 'page-b1'],
        { workspaceId: WORKSPACE_ID },
      );
    });

    it('BRIDGE-AC56: a page named twice is returned once, at its first position', async () => {
      await expect(
        service.filterViewablePageIds(USER, [
          'page-b1',
          'page-a1',
          'page-b1',
          'page-a1',
        ]),
      ).resolves.toEqual(['page-b1', 'page-a1']);
      expect(pageRepo.findManyByIds).toHaveBeenCalledWith(
        ['page-b1', 'page-a1'],
        { workspaceId: WORKSPACE_ID },
      );
    });

    it('BRIDGE-AC57: an id that belongs to no page is dropped and the others are filtered', async () => {
      restrictedPageIds = new Set(['page-a2']);

      await expect(
        service.filterViewablePageIds(USER, [
          '00000000-0000-4000-8000-000000000000',
          'page-a2',
          'page-a1',
        ]),
      ).resolves.toEqual(['page-a1']);
    });

    it('BRIDGE-AC55: an empty list gives an empty list without queries', async () => {
      await expect(service.filterViewablePageIds(USER, [])).resolves.toEqual(
        [],
      );
      expect(pageRepo.findManyByIds).not.toHaveBeenCalled();
      expect(spaceMemberRepo.getUserSpaceIds).not.toHaveBeenCalled();
      expect(pagePermissionRepo.filterAccessiblePageIds).not.toHaveBeenCalled();
    });

    it('BRIDGE-AC15: a page in the trash is dropped for a member of its space', async () => {
      pages = pages.map((page) =>
        page.id === 'page-a1' ? { ...page, trashed: true } : page,
      );

      await expect(
        service.filterViewablePageIds(USER, ['page-a1', 'page-a2']),
      ).resolves.toEqual(['page-a2']);
    });

    it('BRIDGE-AC19: a page in a space marked as deleted is dropped for its members', async () => {
      spaces = [{ id: 'space-a', deleted: true }, { id: 'space-b' }];

      await expect(
        service.filterViewablePageIds(USER, ['page-a1', 'page-b1']),
      ).resolves.toEqual(['page-b1']);
      expect(
        pagePermissionRepo.filterAccessiblePageIds,
      ).not.toHaveBeenCalledWith(
        expect.objectContaining({ spaceId: 'space-a' }),
      );
    });

    it('BRIDGE-AC14: a page moved to a space the user is not a member of is dropped', async () => {
      pages = pages.map((page) =>
        page.id === 'page-a1' ? { ...page, spaceId: 'space-gf' } : page,
      );

      await expect(
        service.filterViewablePageIds(USER, ['page-a1', 'page-a2']),
      ).resolves.toEqual(['page-a2']);
    });

    it('BRIDGE-AC16: pages of a space the user was removed from are dropped', async () => {
      memberSpaceIds = ['space-b'];

      await expect(
        service.filterViewablePageIds(USER, ['page-a1', 'page-b1']),
      ).resolves.toEqual(['page-b1']);
    });

    it('BRIDGE-AC43: a user who is a member of no space gets an empty list', async () => {
      memberSpaceIds = [];

      await expect(
        service.filterViewablePageIds(USER, ['page-a1', 'page-b1']),
      ).resolves.toEqual([]);
      expect(pagePermissionRepo.filterAccessiblePageIds).not.toHaveBeenCalled();
    });
  });

  describe('findViewablePage', () => {
    it('BRIDGE-AC61: returns the page with its content when the user may view it', async () => {
      await expect(service.findViewablePage(USER, 'page-a1')).resolves.toEqual(
        expect.objectContaining({ id: 'page-a1', content: PAGE_CONTENT }),
      );
      expect(pageRepo.findById).toHaveBeenCalledWith('page-a1', {
        includeContent: true,
      });
    });

    it('BRIDGE-AC61: restricted, other-space, deleted-space, trashed and unknown pages all give null', async () => {
      restrictedPageIds = new Set(['page-a2']);
      spaces = [
        { id: 'space-a' },
        { id: 'space-b', deleted: true },
        { id: 'space-gf' },
      ];
      pages = [
        ...pages,
        { id: 'page-trashed', spaceId: 'space-a', trashed: true },
      ];

      for (const pageId of [
        'page-a2',
        'page-gf',
        'page-b1',
        'page-trashed',
        '00000000-0000-4000-8000-000000000000',
      ]) {
        await expect(
          service.findViewablePage(USER, pageId),
        ).resolves.toBeNull();
      }
      expect(pageRepo.findById).not.toHaveBeenCalled();
    });
  });
});
