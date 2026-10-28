import { stub } from '../test-stub';
import { Readable } from 'node:stream';
import { Test } from '@nestjs/testing';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { Attachment, Page, User } from '@docmost/db/types/entity.types';
import { SearchService } from '../../../core/search/search.service';
import { StorageService } from '../../storage/storage.service';
import { AiBridgeError } from '../ai-bridge.errors';
import { AiContentService } from './ai-content.service';
import { AiPageAccessService } from './ai-page-access.service';

const WORKSPACE_ID = 'workspace-1';
const USER = { id: 'user-1', workspaceId: WORKSPACE_ID } as User;
const UPDATED_AT = new Date('2026-10-01T08:30:00.000Z');

const HEADED_DOC = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Titel' }],
    },
    { type: 'paragraph', content: [{ type: 'text', text: 'Einleitung' }] },
    {
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Abschnitt' }],
    },
  ],
};

const makePage = (overrides: Partial<Page> = {}) =>
  ({
    id: 'page-1',
    title: 'Seite',
    spaceId: 'space-a',
    workspaceId: WORKSPACE_ID,
    updatedAt: UPDATED_AT,
    deletedAt: null,
    content: HEADED_DOC,
    ...overrides,
  }) as Page;

const makeAttachment = (overrides: Partial<Attachment> = {}) =>
  stub<Attachment>({
    id: 'att-1',
    fileName: 'vertrag.pdf',
    filePath: 'workspace-1/files/att-1/vertrag.pdf',
    mimeType: 'application/pdf',
    fileSize: '2048',
    pageId: 'page-1',
    type: 'file',
    deletedAt: null,
    ...overrides,
  });

const expectBridgeError = async (promise: Promise<unknown>, code: string) => {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(AiBridgeError);
  expect((error as AiBridgeError).code).toBe(code);
};

describe('AiContentService', () => {
  let service: AiContentService;
  const pageRepo = { findById: jest.fn() };
  const attachmentRepo = {
    findById: jest.fn(),
    findPageAttachments: jest.fn(),
  };
  const storageService = { readStream: jest.fn(), exists: jest.fn() };
  const searchService = { searchPage: jest.fn() };
  const aiPageAccessService = {
    findViewablePage: jest.fn(),
    readableSpaceIds: jest.fn(),
    filterViewablePageIds: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    attachmentRepo.findPageAttachments.mockResolvedValue({
      items: [],
      meta: { hasNextPage: false, nextCursor: null },
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        AiContentService,
        { provide: PageRepo, useValue: pageRepo },
        { provide: AttachmentRepo, useValue: attachmentRepo },
        { provide: StorageService, useValue: storageService },
        { provide: SearchService, useValue: searchService },
        { provide: AiPageAccessService, useValue: aiPageAccessService },
      ],
    }).compile();
    service = moduleRef.get(AiContentService);
  });

  describe('getPageContent', () => {
    it('BRIDGE-AC20: returns id, title, space, workspace, ISO update time and markdown with headings', async () => {
      pageRepo.findById.mockResolvedValue(makePage());

      const result = await service.getPageContent('page-1');

      expect(pageRepo.findById).toHaveBeenCalledWith('page-1', {
        includeContent: true,
      });
      expect(result).toEqual({
        id: 'page-1',
        title: 'Seite',
        spaceId: 'space-a',
        workspaceId: WORKSPACE_ID,
        updatedAt: '2026-10-01T08:30:00.000Z',
        markdown: expect.stringContaining('Einleitung'),
        attachments: [],
      });
      expect(result.markdown).toMatch(/^# Titel$/m);
      expect(result.markdown).toMatch(/^## Abschnitt$/m);
    });

    it('BRIDGE-AC21: lists only PDF attachments with id, file name, type and numeric size', async () => {
      pageRepo.findById.mockResolvedValue(makePage());
      attachmentRepo.findPageAttachments.mockResolvedValue({
        items: [
          makeAttachment(),
          makeAttachment({
            id: 'att-2',
            fileName: 'bild.png',
            mimeType: 'image/png',
          }),
        ],
        meta: { hasNextPage: false, nextCursor: null },
      });

      const result = await service.getPageContent('page-1');

      expect(result.attachments).toEqual([
        {
          id: 'att-1',
          fileName: 'vertrag.pdf',
          mimeType: 'application/pdf',
          fileSize: 2048,
        },
      ]);
    });

    it('BRIDGE-AC21: follows the cursor until every attachment page is read', async () => {
      pageRepo.findById.mockResolvedValue(makePage());
      attachmentRepo.findPageAttachments
        .mockResolvedValueOnce({
          items: [makeAttachment({ id: 'att-1' })],
          meta: { hasNextPage: true, nextCursor: 'cursor-1' },
        })
        .mockResolvedValueOnce({
          items: [makeAttachment({ id: 'att-2' })],
          meta: { hasNextPage: false, nextCursor: null },
        });

      const result = await service.getPageContent('page-1');

      expect(result.attachments.map((entry) => entry.id)).toEqual([
        'att-1',
        'att-2',
      ]);
      expect(attachmentRepo.findPageAttachments.mock.calls[1][1].cursor).toBe(
        'cursor-1',
      );
    });

    it.each([
      ['null content', null],
      ['a doc without content', { type: 'doc' }],
      ['a doc with an empty content list', { type: 'doc', content: [] }],
    ])(
      'BRIDGE-AC66: %s yields an empty markdown string',
      async (_, content) => {
        pageRepo.findById.mockResolvedValue(makePage({ content }));

        const result = await service.getPageContent('page-1');

        expect(result.markdown).toBe('');
      },
    );

    it.each([
      ['a missing page', undefined],
      ['a page in the trash', makePage({ deletedAt: new Date() })],
    ])('BRIDGE-AC65: %s answers page_not_found', async (_, page) => {
      pageRepo.findById.mockResolvedValue(page);

      await expectBridgeError(
        service.getPageContent('page-1'),
        'page_not_found',
      );
    });
  });

  describe('getAttachmentFile', () => {
    it('BRIDGE-AC23: opens the stored file and returns its stream and mime type', async () => {
      const stream = Readable.from(['bytes']);
      attachmentRepo.findById.mockResolvedValue(makeAttachment());
      pageRepo.findById.mockResolvedValue(makePage());
      storageService.readStream.mockResolvedValue(stream);

      const result = await service.getAttachmentFile('att-1');

      expect(storageService.readStream).toHaveBeenCalledWith(
        'workspace-1/files/att-1/vertrag.pdf',
      );
      expect(result).toEqual({ stream, mimeType: 'application/pdf' });
    });

    it('BRIDGE-AC67: a stored file missing from storage answers attachment_not_found', async () => {
      attachmentRepo.findById.mockResolvedValue(makeAttachment());
      pageRepo.findById.mockResolvedValue(makePage());
      storageService.readStream.mockRejectedValue(new Error('File not found'));
      storageService.exists.mockResolvedValue(false);

      await expectBridgeError(
        service.getAttachmentFile('att-1'),
        'attachment_not_found',
      );
    });

    it('BRIDGE-AC67: a storage error for a file that exists is rethrown with context', async () => {
      attachmentRepo.findById.mockResolvedValue(makeAttachment());
      pageRepo.findById.mockResolvedValue(makePage());
      storageService.readStream.mockRejectedValue(new Error('disk offline'));
      storageService.exists.mockResolvedValue(true);

      await expect(service.getAttachmentFile('att-1')).rejects.toThrow(
        /att-1.*disk offline/,
      );
    });

    it.each([
      ['a missing attachment', undefined, makePage()],
      [
        'a deleted attachment',
        makeAttachment({ deletedAt: new Date() }),
        makePage(),
      ],
      [
        'an attachment without page',
        makeAttachment({ pageId: null }),
        makePage(),
      ],
      ['an attachment of a missing page', makeAttachment(), undefined],
      [
        'an attachment of a trashed page',
        makeAttachment(),
        makePage({ deletedAt: new Date() }),
      ],
    ])(
      'BRIDGE-AC67: %s answers attachment_not_found',
      async (_, attachment, page) => {
        attachmentRepo.findById.mockResolvedValue(attachment);
        pageRepo.findById.mockResolvedValue(page);

        await expectBridgeError(
          service.getAttachmentFile('att-1'),
          'attachment_not_found',
        );
        expect(storageService.readStream).not.toHaveBeenCalled();
      },
    );
  });

  describe('readPage', () => {
    it('BRIDGE-AC24: returns id, title, space and markdown of a viewable page', async () => {
      aiPageAccessService.findViewablePage.mockResolvedValue(makePage());

      const result = await service.readPage(USER, 'page-1');

      expect(aiPageAccessService.findViewablePage).toHaveBeenCalledWith(
        USER,
        'page-1',
      );
      expect(result).toEqual({
        id: 'page-1',
        title: 'Seite',
        spaceId: 'space-a',
        markdown: expect.stringContaining('# Titel'),
      });
    });

    it('BRIDGE-AC61: a page the user may not view answers page_not_found', async () => {
      aiPageAccessService.findViewablePage.mockResolvedValue(null);

      await expectBridgeError(
        service.readPage(USER, 'page-1'),
        'page_not_found',
      );
    });
  });

  describe('searchSpace', () => {
    beforeEach(() => {
      aiPageAccessService.readableSpaceIds.mockResolvedValue(['space-a']);
      aiPageAccessService.filterViewablePageIds.mockImplementation(
        async (_user: User, ids: string[]) => ids,
      );
      searchService.searchPage.mockResolvedValue({ items: [] });
    });

    const row = (id: string, title: string, spaceId = 'space-a') => ({
      id,
      title,
      space: { id: spaceId },
    });

    it('BRIDGE-AC25: searches the given space as the user with limit 20 and maps id, title, space', async () => {
      searchService.searchPage.mockResolvedValueOnce({
        items: [
          { ...row('p1', 'Eins'), highlight: 'x', rank: 1 },
          { ...row('p2', 'Zwei'), highlight: 'y', rank: 0.5 },
        ],
      });

      const result = await service.searchSpace(USER, 'space-a', '  Preis ');

      expect(searchService.searchPage).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'Preis',
          spaceId: 'space-a',
          limit: 100,
          offset: 0,
        }),
        { userId: 'user-1', workspaceId: WORKSPACE_ID },
      );
      expect(result).toEqual({
        results: [
          { id: 'p1', title: 'Eins', spaceId: 'space-a' },
          { id: 'p2', title: 'Zwei', spaceId: 'space-a' },
        ],
      });
    });

    it('BRIDGE-AC25: returns at most 20 results', async () => {
      searchService.searchPage.mockResolvedValueOnce({
        items: Array.from({ length: 25 }, (_, index) =>
          row(`p${index}`, `Seite ${index}`),
        ),
      });

      const result = await service.searchSpace(USER, 'space-a', 'Seite');

      expect(result.results).toHaveLength(20);
    });

    it('BRIDGE-AC26: a viewable match ranked below 20 restricted matches is returned', async () => {
      searchService.searchPage.mockImplementation(async (params) =>
        params.offset === 100
          ? { items: [row('visible', 'Sichtbar')] }
          : { items: [] },
      );

      const result = await service.searchSpace(USER, 'space-a', 'Plan');

      expect(
        searchService.searchPage.mock.calls.slice(0, 2).map(([p]) => p.offset),
      ).toEqual([0, 100]);
      expect(result.results).toEqual([
        { id: 'visible', title: 'Sichtbar', spaceId: 'space-a' },
      ]);
    });

    it('BRIDGE-AC26: keeps paging until 20 results are collected and never asks for more', async () => {
      searchService.searchPage.mockImplementation(async (params) => ({
        items: Array.from({ length: 12 }, (_, index) =>
          row(`p${params.offset}-${index}`, 'T'),
        ),
      }));

      const result = await service.searchSpace(USER, 'space-a', 'Plan');

      expect(searchService.searchPage).toHaveBeenCalledTimes(2);
      expect(result.results).toHaveLength(20);
    });

    it('BRIDGE-AC26: drops matches the page access check rejects', async () => {
      searchService.searchPage.mockResolvedValueOnce({
        items: [row('ok', 'Ok'), row('restricted', 'Gesperrt')],
      });
      aiPageAccessService.filterViewablePageIds.mockResolvedValue(['ok']);

      const result = await service.searchSpace(USER, 'space-a', 'Plan');

      expect(result.results.map((entry) => entry.id)).toEqual(['ok']);
    });

    it('BRIDGE-AC25: reports the real space of a match and drops one from another space', async () => {
      searchService.searchPage.mockResolvedValueOnce({
        items: [row('mine', 'Meins'), row('foreign', 'Fremd', 'space-gf')],
      });

      const result = await service.searchSpace(USER, 'space-a', 'Plan');

      expect(result.results).toEqual([
        { id: 'mine', title: 'Meins', spaceId: 'space-a' },
      ]);
    });

    it('BRIDGE-AC62: a space outside the readable spaces answers space_not_found without searching', async () => {
      await expectBridgeError(
        service.searchSpace(USER, 'space-gf', 'Plan'),
        'space_not_found',
      );
      expect(searchService.searchPage).not.toHaveBeenCalled();
    });

    it.each(['', '   ', '\t\n'])(
      'BRIDGE-AC63: the query %j answers invalid_request without searching',
      async (query) => {
        await expectBridgeError(
          service.searchSpace(USER, 'space-a', query),
          'invalid_request',
        );
        expect(searchService.searchPage).not.toHaveBeenCalled();
      },
    );
  });
});
