import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { markdownToHtml } from '@docmost/editor-ext';
import { JSONContent } from '@tiptap/core';
import { generateJitteredKeyBetween } from 'fractional-indexing-jittered';
import { v7 as uuid7 } from 'uuid';
import { generateSlugId } from '../../common/helpers';
import { createYdocFromJson } from '../../common/helpers/prosemirror/utils';
import { htmlToJson, jsonToText } from '../../collaboration/collaboration.util';
import { AttachmentType } from '../../core/attachment/attachment.constants';
import { getAttachmentFolderPath } from '../../core/attachment/attachment.utils';
import { StorageService } from '../storage/storage.service';
import { SEED_RESTRICTED_PAGES } from './seed-definition';
import {
  readSeedPageMarkdown,
  readSeedPdf,
  SEED_PAGES,
  SEED_PDFS,
  SeedPage,
  SeedPdf,
} from './seed-pages';
import {
  SEED_OWNER,
  SeedPageCounts,
  seedSpaceByName,
  SeedWorkspaceResult,
} from './seed.service';

const PDF_MIME_TYPE = 'application/pdf';

interface SeedAttachmentFile {
  id: string;
  pdf: SeedPdf;
  bytes: Buffer;
}

const attachmentFilesFor = (page: SeedPage): SeedAttachmentFile[] =>
  SEED_PDFS.filter(
    (pdf) => pdf.space === page.space && pdf.pageTitle === page.title,
  ).map((pdf) => ({ id: uuid7(), pdf, bytes: readSeedPdf(pdf) }));

const attachmentNode = (file: SeedAttachmentFile): JSONContent => ({
  type: 'attachment',
  attrs: {
    url: `/api/files/${file.id}/${file.pdf.fileName}`,
    name: file.pdf.fileName,
    mime: PDF_MIME_TYPE,
    size: file.bytes.length,
    attachmentId: file.id,
  },
});

async function seedPageContent(
  page: SeedPage,
  files: SeedAttachmentFile[],
): Promise<JSONContent> {
  const doc: JSONContent = htmlToJson(
    await markdownToHtml(readSeedPageMarkdown(page)),
  );
  return {
    ...doc,
    content: [...(doc.content ?? []), ...files.map(attachmentNode)],
  };
}

@Injectable()
export class SeedContentService {
  constructor(
    @InjectKysely() private db: KyselyDB,
    private pageRepo: PageRepo,
    private pagePermissionRepo: PagePermissionRepo,
    private attachmentRepo: AttachmentRepo,
    private storageService: StorageService,
  ) {}

  async seedPages(workspace: SeedWorkspaceResult): Promise<SeedPageCounts> {
    return executeTx(this.db, async (trx) => {
      const pageIds: Record<string, string> = {};
      const lastPositions = new Map<string, string>();
      let attachments = 0;
      for (const seedPage of SEED_PAGES) {
        const spaceId =
          workspace.spaceIds[seedSpaceByName(seedPage.space).slug];
        const parentPageId = this.parentPageId(seedPage, pageIds);
        const siblings = `${spaceId}/${parentPageId ?? ''}`;
        const position = generateJitteredKeyBetween(
          lastPositions.get(siblings) ?? null,
          null,
        );
        lastPositions.set(siblings, position);

        const files = attachmentFilesFor(seedPage);
        const content = await seedPageContent(seedPage, files);
        const page = await this.pageRepo.insertPage(
          {
            slugId: generateSlugId(),
            title: seedPage.title,
            position,
            content,
            textContent: jsonToText(content),
            ydoc: createYdocFromJson(content),
            creatorId: workspace.userIds[SEED_OWNER.key],
            lastUpdatedById: workspace.userIds[SEED_OWNER.key],
            spaceId,
            workspaceId: workspace.workspaceId,
            parentPageId,
          },
          trx,
        );
        pageIds[seedPage.title] = page.id;
        await this.insertAttachments(workspace, page.id, spaceId, files, trx);
        attachments += files.length;
      }
      await this.insertPageRestrictions(workspace, pageIds, trx);
      return { pages: Object.keys(pageIds).length, attachments };
    });
  }

  private parentPageId(
    seedPage: SeedPage,
    pageIds: Record<string, string>,
  ): string | null {
    if (!seedPage.parentTitle) return null;
    const parentId = pageIds[seedPage.parentTitle];
    if (!parentId) {
      throw new Error(
        `Seed page "${seedPage.title}" comes before its parent "${seedPage.parentTitle}"`,
      );
    }
    return parentId;
  }

  private async insertAttachments(
    workspace: SeedWorkspaceResult,
    pageId: string,
    spaceId: string,
    files: SeedAttachmentFile[],
    trx: KyselyTransaction,
  ) {
    for (const file of files) {
      const filePath = `${getAttachmentFolderPath(AttachmentType.File, workspace.workspaceId)}/${file.id}/${file.pdf.fileName}`;
      await this.storageService.upload(filePath, file.bytes);
      await this.attachmentRepo.insertAttachment(
        {
          id: file.id,
          type: AttachmentType.File,
          filePath,
          fileName: file.pdf.fileName,
          fileSize: file.bytes.length,
          mimeType: PDF_MIME_TYPE,
          fileExt: '.pdf',
          creatorId: workspace.userIds[SEED_OWNER.key],
          workspaceId: workspace.workspaceId,
          pageId,
          spaceId,
        },
        trx,
      );
    }
  }

  private async insertPageRestrictions(
    workspace: SeedWorkspaceResult,
    pageIds: Record<string, string>,
    trx: KyselyTransaction,
  ) {
    const creatorId = workspace.userIds[SEED_OWNER.key];
    for (const restricted of SEED_RESTRICTED_PAGES) {
      if (!restricted.grants) continue;
      const pageAccess = await this.pagePermissionRepo.insertPageAccess(
        {
          pageId: pageIds[restricted.title],
          workspaceId: workspace.workspaceId,
          spaceId: workspace.spaceIds[seedSpaceByName(restricted.space).slug],
          accessLevel: 'restricted',
          creatorId,
        },
        trx,
      );
      await this.pagePermissionRepo.insertPagePermissions(
        restricted.grants.map((grant) => ({
          pageAccessId: pageAccess.id,
          userId: grant.userKey ? workspace.userIds[grant.userKey] : null,
          groupId: grant.groupName ? workspace.groupIds[grant.groupName] : null,
          role: grant.role,
          addedById: creatorId,
        })),
        trx,
      );
    }
  }
}
