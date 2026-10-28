import { Test } from '@nestjs/testing';
import { KYSELY_MODULE_CONNECTION_TOKEN } from 'nestjs-kysely';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { StorageService } from '../storage/storage.service';
import { SeedContentService } from './seed-content.service';
import { SEED_SPACES, SEED_USERS } from './seed-definition';
import { SEED_PAGES, SEED_PDFS } from './seed-pages';
import { SeedWorkspaceResult } from './seed.service';

const trx = { isTransaction: true };
const WORKSPACE_ID = 'workspace-1';

const workspaceResult = (): SeedWorkspaceResult => ({
  workspaceId: WORKSPACE_ID,
  userIds: Object.fromEntries(
    SEED_USERS.map((user) => [user.key, `user-${user.key}`]),
  ) as SeedWorkspaceResult['userIds'],
  groupIds: { Everyone: 'group-default', Projektteam: 'group-projektteam' },
  spaceIds: Object.fromEntries(
    SEED_SPACES.map((space) => [space.slug, `space-${space.slug}`]),
  ),
  counts: { workspaces: 1, users: 4, groups: 2, spaces: 6 },
});

describe('SeedContentService', () => {
  let service: SeedContentService;
  let pageRepo: { insertPage: jest.Mock };
  let pagePermissionRepo: {
    insertPageAccess: jest.Mock;
    insertPagePermissions: jest.Mock;
  };
  let attachmentRepo: { insertAttachment: jest.Mock };
  let storageService: { upload: jest.Mock };

  beforeEach(async () => {
    const db = {
      transaction: () => ({
        execute: (callback: (t: unknown) => Promise<unknown>) => callback(trx),
      }),
    };
    pageRepo = {
      insertPage: jest
        .fn()
        .mockImplementation(async ({ title }) => ({ id: `page-${title}` })),
    };
    pagePermissionRepo = {
      insertPageAccess: jest
        .fn()
        .mockImplementation(async ({ pageId }) => ({ id: `access-${pageId}` })),
      insertPagePermissions: jest.fn().mockResolvedValue(undefined),
    };
    attachmentRepo = {
      insertAttachment: jest.fn().mockResolvedValue(undefined),
    };
    storageService = { upload: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        SeedContentService,
        { provide: KYSELY_MODULE_CONNECTION_TOKEN(), useValue: db },
        { provide: PageRepo, useValue: pageRepo },
        { provide: PagePermissionRepo, useValue: pagePermissionRepo },
        { provide: AttachmentRepo, useValue: attachmentRepo },
        { provide: StorageService, useValue: storageService },
      ],
    }).compile();
    service = module.get(SeedContentService);
  });

  const insertedPage = (title: string) =>
    pageRepo.insertPage.mock.calls
      .map(([page]) => page)
      .find((p) => p.title === title);

  it('SEED-AC17: inserts every seed page and reports the page and attachment counts', async () => {
    const counts = await service.seedPages(workspaceResult());

    expect(counts).toEqual({
      pages: SEED_PAGES.length,
      attachments: SEED_PDFS.length,
    });
    expect(SEED_PDFS).toHaveLength(9);
    expect(pageRepo.insertPage).toHaveBeenCalledTimes(SEED_PAGES.length);
  });

  it('SEED-AC17: derives content, text content and ydoc from the page markdown', async () => {
    await service.seedPages(workspaceResult());

    const welcome = insertedPage('Willkommen bei Ostmooimooi');
    expect(welcome.content.type).toBe('doc');
    expect(welcome.content.content.length).toBeGreaterThan(0);
    expect(welcome.textContent.length).toBeGreaterThan(0);
    expect(welcome.ydoc).toBeInstanceOf(Uint8Array);
    expect(welcome.ydoc.length).toBeGreaterThan(0);
    expect(welcome.spaceId).toBe('space-allgemein');
    expect(welcome.workspaceId).toBe(WORKSPACE_ID);
    expect(welcome.creatorId).toBe('user-GF');
    expect(welcome.lastUpdatedById).toBe('user-GF');
    expect(welcome.parentPageId).toBeNull();
  });

  it('SEED-AC17: every page has text content and a distinct slug id', async () => {
    await service.seedPages(workspaceResult());

    const pages = pageRepo.insertPage.mock.calls.map(([page]) => page);
    expect(pages.every((page) => page.textContent.length > 0)).toBe(true);
    expect(new Set(pages.map((page) => page.slugId)).size).toBe(pages.length);
  });

  it('SEED-AC27: nests child pages under their parent and orders siblings by position', async () => {
    await service.seedPages(workspaceResult());

    const kickoff = insertedPage('Besprechung Nordhafen Kickoff');
    const acceptance = insertedPage('Besprechung Nordhafen Bauabnahme');
    expect(kickoff.parentPageId).toBe('page-Projektübersicht 2026');
    expect(acceptance.parentPageId).toBe('page-Projektübersicht 2026');
    expect(kickoff.position < acceptance.position).toBe(true);
    expect(insertedPage('Baustelle Nordhafen Zugangscodes').parentPageId).toBe(
      'page-Baustelle Nordhafen intern',
    );
  });

  it('SEED-AC19: stores each PDF and attaches it to its named page as application/pdf', async () => {
    await service.seedPages(workspaceResult());

    expect(storageService.upload).toHaveBeenCalledTimes(SEED_PDFS.length);
    expect(attachmentRepo.insertAttachment).toHaveBeenCalledTimes(
      SEED_PDFS.length,
    );
    for (const pdf of SEED_PDFS) {
      const [attachment] = attachmentRepo.insertAttachment.mock.calls
        .map(([a]) => a)
        .filter((a) => a.fileName === pdf.fileName);
      expect(attachment.pageId).toBe(`page-${pdf.pageTitle}`);
      expect(attachment.mimeType).toBe('application/pdf');
      expect(attachment.fileExt).toBe('.pdf');
      expect(attachment.fileSize).toBeGreaterThan(0);
      expect(attachment.workspaceId).toBe(WORKSPACE_ID);
      expect(attachment.filePath).toContain(`${attachment.id}/${pdf.fileName}`);
      expect(storageService.upload).toHaveBeenCalledWith(
        attachment.filePath,
        expect.any(Buffer),
      );
    }
  });

  it('SEED-AC19: embeds an attachment node for the PDF in the page content', async () => {
    await service.seedPages(workspaceResult());

    const page = insertedPage('Kundenvertrag Stadtwerke Beispielstadt');
    const node = page.content.content.at(-1);
    expect(node.type).toBe('attachment');
    expect(node.attrs).toMatchObject({
      name: 'kundenvertrag-stadtwerke-beispielstadt.pdf',
      mime: 'application/pdf',
    });
    expect(
      page.content.content.filter((n) => n.type === 'attachment'),
    ).toHaveLength(1);
  });

  it('SEED-AC6: restricts the listed pages and grants the defined users and groups', async () => {
    await service.seedPages(workspaceResult());

    expect(pagePermissionRepo.insertPageAccess).toHaveBeenCalledTimes(3);
    expect(pagePermissionRepo.insertPageAccess).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: 'page-Umstrukturierung 2027',
        spaceId: 'space-allgemein',
        accessLevel: 'restricted',
        creatorId: 'user-GF',
      }),
      trx,
    );
    expect(pagePermissionRepo.insertPagePermissions).toHaveBeenCalledWith(
      [
        {
          pageAccessId: 'access-page-Umstrukturierung 2027',
          userId: 'user-GF',
          groupId: null,
          role: 'writer',
          addedById: 'user-GF',
        },
      ],
      trx,
    );
  });

  it('SEED-AC7: grants a group reader access on the internal construction page', async () => {
    await service.seedPages(workspaceResult());

    expect(pagePermissionRepo.insertPagePermissions).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          userId: null,
          groupId: 'group-projektteam',
          role: 'reader',
        }),
      ]),
      trx,
    );
  });

  it('SEED-AC6: a restricted page without grants gets no page access of its own', async () => {
    await service.seedPages(workspaceResult());

    const restrictedIds = pagePermissionRepo.insertPageAccess.mock.calls.map(
      ([access]) => access.pageId,
    );
    expect(restrictedIds).not.toContain(
      'page-Baustelle Nordhafen Zugangscodes',
    );
  });

  it('SEED-AC17: fails and attaches nothing when the storage upload fails', async () => {
    storageService.upload.mockRejectedValueOnce(new Error('disk full'));

    await expect(service.seedPages(workspaceResult())).rejects.toThrow(
      'disk full',
    );
    expect(attachmentRepo.insertAttachment).not.toHaveBeenCalled();
    expect(pagePermissionRepo.insertPageAccess).not.toHaveBeenCalled();
  });

  it('SEED-AC17: propagates a failing page insert', async () => {
    pageRepo.insertPage.mockRejectedValueOnce(new Error('insert failed'));

    await expect(service.seedPages(workspaceResult())).rejects.toThrow(
      'insert failed',
    );
    expect(storageService.upload).not.toHaveBeenCalled();
  });
});
