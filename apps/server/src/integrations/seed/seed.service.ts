import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { GroupRepo } from '@docmost/db/repos/group/group.repo';
import { GroupUserRepo } from '@docmost/db/repos/group/group-user.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { SignupService } from '../../core/auth/services/signup.service';
import { SpaceService } from '../../core/space/services/space.service';
import { SpaceMemberService } from '../../core/space/services/space-member.service';
import { UserRole } from '../../common/helpers/types/permission';
import {
  SEED_DEFAULT_GROUP_NAME,
  SEED_DEMO_PASSWORD,
  SEED_GROUPS,
  SEED_SPACE_MEMBERSHIPS,
  SEED_SPACES,
  SEED_USERS,
  SEED_WORKSPACE_NAME,
  SeedSpace,
  SeedSpaceMembership,
  SeedUserKey,
} from './seed-definition';

export interface SeedCounts {
  workspaces: number;
  users: number;
  groups: number;
  spaces: number;
}

export interface SeedPageCounts {
  pages: number;
  attachments: number;
}

export type SeedSummary = SeedCounts & SeedPageCounts;

export interface SeedWorkspaceResult {
  workspaceId: string;
  userIds: Record<SeedUserKey, string>;
  groupIds: Record<string, string>;
  spaceIds: Record<string, string>;
  counts: SeedCounts;
}

export const formatSeedSummary = (summary: SeedSummary) =>
  `Seeded: ${summary.workspaces} workspace, ${summary.users} users, ` +
  `${summary.groups} groups, ${summary.spaces} spaces, ` +
  `${summary.pages} pages, ${summary.attachments} attachments`;

export const seedSpaceByName = (name: string): SeedSpace =>
  SEED_SPACES.find((space) => space.name === name)!;

const DEFAULT_SPACE = SEED_SPACES[0];
export const SEED_OWNER = SEED_USERS.find(
  (user) => user.workspaceRole === 'owner',
)!;
@Injectable()
export class SeedService {
  constructor(
    @InjectKysely() private db: KyselyDB,
    private signupService: SignupService,
    private userRepo: UserRepo,
    private groupRepo: GroupRepo,
    private groupUserRepo: GroupUserRepo,
    private spaceService: SpaceService,
    private spaceRepo: SpaceRepo,
    private spaceMemberService: SpaceMemberService,
    private spaceMemberRepo: SpaceMemberRepo,
  ) {}

  async seedWorkspace(): Promise<SeedWorkspaceResult> {
    return executeTx(this.db, async (trx) => {
      const { user, workspace } = await this.signupService.initialSetup(
        {
          name: SEED_OWNER.name,
          email: SEED_OWNER.email,
          password: SEED_DEMO_PASSWORD,
          workspaceName: SEED_WORKSPACE_NAME,
        },
        trx,
      );
      const result: SeedWorkspaceResult = {
        workspaceId: workspace.id,
        userIds: { [SEED_OWNER.key]: user.id } as Record<SeedUserKey, string>,
        groupIds: {},
        spaceIds: {},
        counts: { workspaces: 1, users: 0, groups: 0, spaces: 0 },
      };

      const defaultGroup = await this.groupRepo.getDefaultGroup(
        workspace.id,
        trx,
      );
      result.groupIds[SEED_DEFAULT_GROUP_NAME] = defaultGroup.id;
      result.spaceIds[DEFAULT_SPACE.slug] = await this.convertDefaultSpace(
        workspace.id,
        workspace.defaultSpaceId,
        defaultGroup.id,
        trx,
      );

      await this.insertMembers(result, defaultGroup.id, trx);
      await this.insertGroups(result, user.id, trx);
      await this.insertSpaces(result, user.id, trx);
      await this.insertMemberships(result, trx);

      result.counts = {
        workspaces: 1,
        users: Object.keys(result.userIds).length,
        groups: Object.keys(result.groupIds).length,
        spaces: Object.keys(result.spaceIds).length,
      };
      return result;
    });
  }

  private async convertDefaultSpace(
    workspaceId: string,
    spaceId: string,
    defaultGroupId: string,
    trx: KyselyTransaction,
  ): Promise<string> {
    await this.spaceRepo.updateSpace(
      {
        name: DEFAULT_SPACE.name,
        slug: DEFAULT_SPACE.slug,
        visibility: DEFAULT_SPACE.visibility,
      },
      spaceId,
      workspaceId,
      trx,
    );
    const groupMembership = await this.spaceMemberRepo.getSpaceMemberByTypeId(
      spaceId,
      { groupId: defaultGroupId },
      trx,
    );
    if (groupMembership) {
      await this.spaceMemberRepo.removeSpaceMemberById(
        groupMembership.id,
        spaceId,
        { trx },
      );
    }
    return spaceId;
  }

  private async insertMembers(
    result: SeedWorkspaceResult,
    defaultGroupId: string,
    trx: KyselyTransaction,
  ) {
    const members = SEED_USERS.filter((user) => user.workspaceRole !== 'owner');
    for (const member of members) {
      const user = await this.userRepo.insertUser(
        {
          name: member.name,
          email: member.email,
          password: SEED_DEMO_PASSWORD,
          role: UserRole.MEMBER,
          workspaceId: result.workspaceId,
          emailVerifiedAt: new Date(),
        },
        trx,
      );
      result.userIds[member.key] = user.id;
      await this.groupUserRepo.addUserToGroup(
        user.id,
        defaultGroupId,
        result.workspaceId,
        trx,
      );
    }
  }

  private async insertGroups(
    result: SeedWorkspaceResult,
    creatorId: string,
    trx: KyselyTransaction,
  ) {
    for (const seedGroup of SEED_GROUPS.filter((group) => !group.isDefault)) {
      const group = await this.groupRepo.insertGroup(
        {
          name: seedGroup.name,
          isDefault: false,
          creatorId,
          workspaceId: result.workspaceId,
        },
        trx,
      );
      result.groupIds[seedGroup.name] = group.id;
      for (const key of seedGroup.userKeys) {
        await this.groupUserRepo.addUserToGroup(
          result.userIds[key],
          group.id,
          result.workspaceId,
          trx,
        );
      }
    }
  }

  private async insertSpaces(
    result: SeedWorkspaceResult,
    creatorId: string,
    trx: KyselyTransaction,
  ) {
    for (const seedSpace of SEED_SPACES.filter((s) => s !== DEFAULT_SPACE)) {
      const space = await this.spaceService.create(
        creatorId,
        result.workspaceId,
        { name: seedSpace.name, slug: seedSpace.slug },
        trx,
      );
      if (space.visibility !== seedSpace.visibility) {
        await this.spaceRepo.updateSpace(
          { visibility: seedSpace.visibility },
          space.id,
          result.workspaceId,
          trx,
        );
      }
      result.spaceIds[seedSpace.slug] = space.id;
    }
  }

  private async insertMemberships(
    result: SeedWorkspaceResult,
    trx: KyselyTransaction,
  ) {
    for (const membership of SEED_SPACE_MEMBERSHIPS) {
      const spaceId = result.spaceIds[seedSpaceByName(membership.space).slug];
      if (await this.membershipExists(result, spaceId, membership, trx)) {
        continue;
      }
      if (membership.userKey) {
        await this.spaceMemberService.addUserToSpace(
          result.userIds[membership.userKey],
          spaceId,
          membership.role,
          result.workspaceId,
          trx,
        );
        continue;
      }
      await this.spaceMemberService.addGroupToSpace(
        result.groupIds[membership.groupName!],
        spaceId,
        membership.role,
        result.workspaceId,
        trx,
      );
    }
  }

  private async membershipExists(
    result: SeedWorkspaceResult,
    spaceId: string,
    membership: SeedSpaceMembership,
    trx: KyselyTransaction,
  ): Promise<boolean> {
    const existing = await this.spaceMemberRepo.getSpaceMemberByTypeId(
      spaceId,
      membership.userKey
        ? { userId: result.userIds[membership.userKey] }
        : { groupId: result.groupIds[membership.groupName!] },
      trx,
    );
    if (existing && existing.role !== membership.role) {
      throw new Error(
        `Seed membership conflict in ${membership.space}: ${existing.role} instead of ${membership.role}`,
      );
    }
    return Boolean(existing);
  }
}
