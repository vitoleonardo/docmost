import { Injectable } from '@nestjs/common';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { Page, User } from '@docmost/db/types/entity.types';

@Injectable()
export class AiPageAccessService {
  constructor(
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly pageRepo: PageRepo,
    private readonly pagePermissionRepo: PagePermissionRepo,
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
    const [viewablePageId] = await this.filterViewablePageIds(user, [pageId]);
    if (!viewablePageId) return null;
    const page = await this.pageRepo.findById(viewablePageId, {
      includeContent: true,
    });
    return page ?? null;
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
