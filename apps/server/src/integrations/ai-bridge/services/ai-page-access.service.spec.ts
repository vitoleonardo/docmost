import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { Page, Space, User } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../../../core/page/page-access/page-access.service';
import { AiBridgeError } from '../ai-bridge.errors';
import { FilterPagesDto } from '../dto/ai-bridge-internal.dto';
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
  const pageAccessService = { validateCanEdit: jest.fn() };

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
        { provide: PageAccessService, useValue: pageAccessService },
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

  describe('filterViewablePageIds with a space', () => {
    it('ASK-AC30: keeps only viewable pages that are in that space now', async () => {
      pages = pages.map((page) =>
        page.id === 'page-a1' ? { ...page, spaceId: 'space-b' } : page,
      );

      await expect(
        service.filterViewablePageIds(
          USER,
          ['page-a1', 'page-a2', 'page-b1'],
          'space-a',
        ),
      ).resolves.toEqual(['page-a2']);
    });

    it('ASK-AC30: a restricted page in that space is still dropped', async () => {
      restrictedPageIds = new Set(['page-a2']);

      await expect(
        service.filterViewablePageIds(USER, ['page-a1', 'page-a2'], 'space-a'),
      ).resolves.toEqual(['page-a1']);
    });

    it('ASK-AC30: a space the user is not a member of passes nothing', async () => {
      await expect(
        service.filterViewablePageIds(USER, ['page-gf', 'page-a1'], 'space-gf'),
      ).resolves.toEqual([]);
    });
  });

  describe('FilterPagesDto', () => {
    const PAGE_ID = '1c2d3e4f-0000-4000-8000-000000000001';
    const SPACE_ID = '0B7C5E8A-0000-4000-8000-000000000001';
    const parse = async (body: object) => {
      const dto = plainToInstance(FilterPagesDto, body);
      return { dto, errors: await validate(dto) };
    };

    it('ASK-AC30: accepts page ids without a space', async () => {
      expect((await parse({ pageIds: [PAGE_ID] })).errors).toEqual([]);
    });

    it('ASK-AC30: accepts a space id and lowercases it', async () => {
      const { dto, errors } = await parse({
        pageIds: [PAGE_ID],
        spaceId: SPACE_ID,
      });

      expect(errors).toEqual([]);
      expect(dto.spaceId).toBe(SPACE_ID.toLowerCase());
    });

    it.each([['space-1'], [42], ['']])(
      'ASK-AC30: rejects the malformed space id %p',
      async (spaceId) => {
        expect(
          (await parse({ pageIds: [PAGE_ID], spaceId })).errors,
        ).not.toEqual([]);
      },
    );
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

  describe('findEditablePage', () => {
    const failureOf = async (promise: Promise<unknown>) => {
      const error = await promise.then(
        () => undefined,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(AiBridgeError);
      return {
        code: (error as AiBridgeError).code,
        status: (error as AiBridgeError).status,
      };
    };

    it('EXTRACT-AC42: returns the viewable page when the user may edit it', async () => {
      pageAccessService.validateCanEdit.mockResolvedValue({
        hasRestriction: false,
      });

      await expect(service.findEditablePage(USER, 'page-a1')).resolves.toEqual(
        expect.objectContaining({ id: 'page-a1' }),
      );
      expect(pageAccessService.validateCanEdit).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'page-a1' }),
        USER,
      );
    });

    it('EXTRACT-AC44: a page the user may view but not edit throws 403 page_not_editable', async () => {
      pageAccessService.validateCanEdit.mockRejectedValue(
        new ForbiddenException(),
      );

      expect(
        await failureOf(service.findEditablePage(USER, 'page-a1')),
      ).toEqual({ code: 'page_not_editable', status: 403 });
    });

    it('EXTRACT-AC45: restricted, other-space, trashed and unknown pages throw 404 page_not_found without an edit check', async () => {
      restrictedPageIds = new Set(['page-a2']);
      pages.push({ id: 'page-trash', spaceId: 'space-a', trashed: true });

      for (const pageId of ['page-a2', 'page-gf', 'page-trash', 'page-x']) {
        expect(await failureOf(service.findEditablePage(USER, pageId))).toEqual(
          { code: 'page_not_found', status: 404 },
        );
      }
      expect(pageAccessService.validateCanEdit).not.toHaveBeenCalled();
    });

    it('EXTRACT-AC44: an edit check error that is not a denial is rethrown unchanged', async () => {
      const broken = new Error('database down');
      pageAccessService.validateCanEdit.mockRejectedValue(broken);

      await expect(service.findEditablePage(USER, 'page-a1')).rejects.toBe(
        broken,
      );
    });
  });
});
