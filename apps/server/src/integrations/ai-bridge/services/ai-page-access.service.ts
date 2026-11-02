import { ForbiddenException, Injectable } from '@nestjs/common';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { Page, User } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../../../core/page/page-access/page-access.service';
import { AiBridgeError } from '../ai-bridge.errors';

@Injectable()
export class AiPageAccessService {
  constructor(
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly pageRepo: PageRepo,
    private readonly pagePermissionRepo: PagePermissionRepo,
    private readonly pageAccessService: PageAccessService,
  ) {}

  async readableSpaceIds(
    userId: string,
    workspaceId: string,
  ): Promise<string[]> {
    const memberSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(userId);
    const spaces = await Promise.all(
      memberSpaceIds.map((spaceId) =>
        this.spaceRepo.findById(spaceId, workspaceId),
      ),
    );
    return spaces
      .filter((space) => space && !space.deletedAt)
      .map((space) => space.id);
  }

  async filterViewablePageIds(
    user: User,
    pageIds: string[],
    spaceId?: string,
  ): Promise<string[]> {
    const uniquePageIds = [...new Set(pageIds)];
    if (uniquePageIds.length === 0) return [];

    const pageIdsBySpace = await this.groupReadablePageIdsBySpace(
      user,
      uniquePageIds,
      spaceId,
    );
    const viewablePageIds = new Set<string>();
    for (const [spaceId, spacePageIds] of pageIdsBySpace) {
      const accessible = await this.pagePermissionRepo.filterAccessiblePageIds({
        pageIds: spacePageIds,
        userId: user.id,
        spaceId,
      });
      accessible.forEach((pageId) => viewablePageIds.add(pageId));
    }
    return uniquePageIds.filter((pageId) => viewablePageIds.has(pageId));
  }

  async findViewablePage(user: User, pageId: string): Promise<Page | null> {
    return this.loadViewablePage(user, pageId);
  }

  async requireViewablePage(
    user: User,
    pageId: string,
    spaceId?: string,
  ): Promise<Page> {
    const page = await this.loadViewablePage(user, pageId, spaceId);
    if (page) return page;
    throw await this.refusalOfPage(user, pageId, spaceId);
  }

  async requireReadableSpace(user: User, spaceId: string): Promise<void> {
    const space = await this.spaceRepo.findById(spaceId, user.workspaceId);
    if (!space || space.deletedAt) {
      throw new AiBridgeError('space_not_found', 'Space not found');
    }
    const readable = await this.readableSpaceIds(user.id, user.workspaceId);
    if (!readable.includes(space.id)) {
      throw new AiBridgeError(
        'space_forbidden',
        'The user is not a member of the space',
      );
    }
  }

  async findEditablePage(user: User, pageId: string): Promise<Page> {
    const page = await this.requireViewablePage(user, pageId);
    try {
      await this.pageAccessService.validateCanEdit(page, user);
    } catch (error) {
      if (!(error instanceof ForbiddenException)) throw error;
      throw new AiBridgeError(
        'page_not_editable',
        'The user may not edit the page',
      );
    }
    return page;
  }

  private async loadViewablePage(
    user: User,
    pageId: string,
    spaceId?: string,
  ): Promise<Page | null> {
    const [viewablePageId] = await this.filterViewablePageIds(
      user,
      [pageId],
      spaceId,
    );
    if (!viewablePageId) return null;
    const page = await this.pageRepo.findById(viewablePageId, {
      includeContent: true,
    });
    return page ?? null;
  }

  private async refusalOfPage(
    user: User,
    pageId: string,
    spaceId?: string,
  ): Promise<AiBridgeError> {
    if (await this.isMissingPage(user, pageId, spaceId)) {
      return new AiBridgeError('page_not_found', 'Page not found');
    }
    return new AiBridgeError(
      'page_forbidden',
      'The user may not view the page',
    );
  }

  private async isMissingPage(
    user: User,
    pageId: string,
    spaceId?: string,
  ): Promise<boolean> {
    const [page] = await this.pageRepo.findManyByIds([pageId], {
      workspaceId: user.workspaceId,
    });
    if (!page || (spaceId && page.spaceId !== spaceId)) return true;
    const space = await this.spaceRepo.findById(page.spaceId, user.workspaceId);
    return !space || Boolean(space.deletedAt);
  }

  private async groupReadablePageIdsBySpace(
    user: User,
    pageIds: string[],
    spaceId?: string,
  ): Promise<Map<string, string[]>> {
    const pages = await this.pageRepo.findManyByIds(pageIds, {
      workspaceId: user.workspaceId,
    });
    const pageIdsBySpace = new Map<string, string[]>();
    if (pages.length === 0) return pageIdsBySpace;

    const readableSpaceIds = new Set(
      await this.readableSpaceIds(user.id, user.workspaceId),
    );
    for (const page of pages) {
      if (!readableSpaceIds.has(page.spaceId)) continue;
      if (spaceId && page.spaceId !== spaceId) continue;
      pageIdsBySpace.set(page.spaceId, [
        ...(pageIdsBySpace.get(page.spaceId) ?? []),
        page.id,
      ]);
    }
    return pageIdsBySpace;
  }
}
