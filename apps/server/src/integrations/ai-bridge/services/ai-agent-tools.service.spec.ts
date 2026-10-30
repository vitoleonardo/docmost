import { stub } from '../test-stub';
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { Page, Space, User } from '@docmost/db/types/entity.types';
import { CollaborationGateway } from '../../../collaboration/collaboration.gateway';
import { PageAccessService } from '../../../core/page/page-access/page-access.service';
import { EnvironmentService } from '../../environment/environment.service';
import { AiBridgeError } from '../ai-bridge.errors';
import { AiBridgeInternalController } from '../ai-bridge-internal.controller';
import {
  AI_BRIDGE_USER_TOKEN_KEY,
  AiBridgeRequest,
} from '../decorators/ai-bridge-auth.decorator';
import { AiInternalAuthGuard } from '../guards/ai-internal-auth.guard';
import { AgentBlockRead } from './agent-document';
import { AiAgentToolsService } from './ai-agent-tools.service';
import { AiLiveDocumentService } from './ai-live-document.service';
import { AiPageAccessService } from './ai-page-access.service';
import { AiTokenService } from './ai-token.service';

const WORKSPACE_ID = 'workspace-1';
const USER = {
  id: 'user-gf',
  workspaceId: WORKSPACE_ID,
  deactivatedAt: null,
  deletedAt: null,
} as User;
const ALLGEMEIN = 'space-allgemein';
const VERTRIEB = 'space-vertrieb';
const PAGE_ID = 'page-reisekosten';
const UNKNOWN_PAGE_ID = '00000000-0000-4000-8000-000000000000';

const LIVE_READ: AgentBlockRead = {
  fingerprint: 'fingerprint-1',
  blocks: [
    {
      number: 1,
      text: 'Reisekosten',
      heading: null,
      isHeading: true,
      editable: true,
    },
    {
      number: 2,
      text: 'Pro Kilometer 0,30 €.',
      heading: 'Reisekosten',
      isHeading: false,
      editable: true,
    },
  ],
};

interface WikiPage {
  spaceId: string;
  title: string;
  trashed: boolean;
  restricted: boolean;
}

interface WikiState {
  memberOf: Set<string>;
  deletedSpaces: Set<string>;
  pages: Map<string, WikiPage>;
}

function seedWiki(): WikiState {
  return {
    memberOf: new Set([ALLGEMEIN, VERTRIEB]),
    deletedSpaces: new Set(),
    pages: new Map([
      [
        PAGE_ID,
        {
          spaceId: ALLGEMEIN,
          title: 'Reisekosten',
          trashed: false,
          restricted: false,
        },
      ],
      [
        'page-vertrieb',
        {
          spaceId: VERTRIEB,
          title: 'Preisliste',
          trashed: false,
          restricted: false,
        },
      ],
    ]),
  };
}

function wikiRepos(wiki: WikiState) {
  const toPage = (id: string, page: WikiPage) =>
    ({
      id,
      title: page.title,
      spaceId: page.spaceId,
      workspaceId: WORKSPACE_ID,
      deletedAt: page.trashed ? new Date() : null,
    }) as Page;
  return {
    spaceMemberRepo: stub<SpaceMemberRepo>({
      getUserSpaceIds: async () => [...wiki.memberOf],
    }),
    spaceRepo: stub<SpaceRepo>({
      findById: async (spaceId: string) =>
        ({
          id: spaceId,
          workspaceId: WORKSPACE_ID,
          deletedAt: wiki.deletedSpaces.has(spaceId) ? new Date() : null,
        }) as Space,
    }),
    pageRepo: stub<PageRepo>({
      findManyByIds: async (ids: string[]) =>
        ids.flatMap((id) => {
          const page = wiki.pages.get(id);
          return page && !page.trashed ? [toPage(id, page)] : [];
        }),
      findById: async (id: string) => {
        const page = wiki.pages.get(id);
        return page ? toPage(id, page) : undefined;
      },
    }),
    pagePermissionRepo: stub<PagePermissionRepo>({
      filterAccessiblePageIds: async ({ pageIds }: { pageIds: string[] }) =>
        pageIds.filter((id) => !wiki.pages.get(id)?.restricted),
    }),
  };
}

function pageAccessFor(wiki: WikiState): AiPageAccessService {
  const repos = wikiRepos(wiki);
  return new AiPageAccessService(
    repos.spaceMemberRepo,
    repos.spaceRepo,
    repos.pageRepo,
    repos.pagePermissionRepo,
    stub<PageAccessService>({}),
  );
}

async function refusalOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the read to be refused');
    },
    (error: unknown) => error,
  );
}

describe('AiAgentToolsService.readBlocks', () => {
  let wiki: WikiState;
  let gateway: { handleYjsEvent: jest.Mock };
  let service: AiAgentToolsService;

  beforeEach(() => {
    wiki = seedWiki();
    gateway = { handleYjsEvent: jest.fn().mockResolvedValue(LIVE_READ) };
    service = new AiAgentToolsService(
      pageAccessFor(wiki),
      new AiLiveDocumentService(stub<CollaborationGateway>(gateway)),
    );
  });

  const unknownPageRefusal = () =>
    refusalOf(service.readBlocks(USER, UNKNOWN_PAGE_ID, ALLGEMEIN));

  it('returns the live blocks and fingerprint of a viewable page of the run space', async () => {
    await expect(service.readBlocks(USER, PAGE_ID, ALLGEMEIN)).resolves.toEqual(
      {
        id: PAGE_ID,
        title: 'Reisekosten',
        spaceId: ALLGEMEIN,
        fingerprint: LIVE_READ.fingerprint,
        blocks: LIVE_READ.blocks,
      },
    );
    expect(gateway.handleYjsEvent).toHaveBeenCalledWith(
      'readAgentBlocks',
      `page.${PAGE_ID}`,
      undefined,
    );
  });

  it('refuses an unknown page id with page_not_found', async () => {
    const refusal = await unknownPageRefusal();

    expect(refusal).toBeInstanceOf(AiBridgeError);
    expect(refusal).toMatchObject({ code: 'page_not_found', status: 404 });
    expect(gateway.handleYjsEvent).not.toHaveBeenCalled();
  });

  it('AGENT-AC26: a page of another space the user may view is refused as not found', async () => {
    const refusal = await refusalOf(
      service.readBlocks(USER, 'page-vertrieb', ALLGEMEIN),
    );

    expect(refusal).toEqual(await unknownPageRefusal());
    expect(refusal).toMatchObject({ code: 'page_not_found' });
    expect(JSON.stringify(refusal)).not.toContain('Preisliste');
    expect(gateway.handleYjsEvent).not.toHaveBeenCalled();
  });

  it('AGENT-AC27: a restricted page is refused with the same answer as an unknown id', async () => {
    wiki.pages.get(PAGE_ID)!.restricted = true;

    const refusal = await refusalOf(
      service.readBlocks(USER, PAGE_ID, ALLGEMEIN),
    );

    expect(refusal).toEqual(await unknownPageRefusal());
    expect(refusal).toMatchObject({ code: 'page_not_found' });
    expect(gateway.handleYjsEvent).not.toHaveBeenCalled();
  });

  it('AGENT-AC28: a trashed page is refused with the same answer as an unknown id', async () => {
    wiki.pages.get(PAGE_ID)!.trashed = true;

    const refusal = await refusalOf(
      service.readBlocks(USER, PAGE_ID, ALLGEMEIN),
    );

    expect(refusal).toEqual(await unknownPageRefusal());
    expect(refusal).toMatchObject({ code: 'page_not_found' });
    expect(gateway.handleYjsEvent).not.toHaveBeenCalled();
  });

  it('AGENT-AC29: a page of a run space marked as deleted is refused as not found', async () => {
    wiki.deletedSpaces.add(ALLGEMEIN);

    const refusal = await refusalOf(
      service.readBlocks(USER, PAGE_ID, ALLGEMEIN),
    );

    expect(refusal).toEqual(await unknownPageRefusal());
    expect(refusal).toMatchObject({ code: 'page_not_found' });
    expect(gateway.handleYjsEvent).not.toHaveBeenCalled();
  });

  it('AGENT-AC31: after the user is removed from the run space the next read is refused as not found', async () => {
    await service.readBlocks(USER, PAGE_ID, ALLGEMEIN);
    wiki.memberOf.delete(ALLGEMEIN);

    const refusal = await refusalOf(
      service.readBlocks(USER, PAGE_ID, ALLGEMEIN),
    );

    expect(refusal).toEqual(await unknownPageRefusal());
    expect(refusal).toMatchObject({ code: 'page_not_found' });
    expect(gateway.handleYjsEvent).toHaveBeenCalledTimes(1);
  });

  it('answers assistant_unavailable, not page_not_found, when the collaboration event has no result', async () => {
    gateway.handleYjsEvent.mockResolvedValue(undefined);

    const refusal = await refusalOf(
      service.readBlocks(USER, PAGE_ID, ALLGEMEIN),
    );

    expect(refusal).toBeInstanceOf(AiBridgeError);
    expect(refusal).toMatchObject({
      code: 'assistant_unavailable',
      status: 503,
    });
  });

  it('answers assistant_unavailable, not page_not_found, when the collaboration event fails', async () => {
    gateway.handleYjsEvent.mockRejectedValue(new Error('TIMEOUT'));

    const refusal = await refusalOf(
      service.readBlocks(USER, PAGE_ID, ALLGEMEIN),
    );

    expect(refusal).toBeInstanceOf(AiBridgeError);
    expect(refusal).toMatchObject({
      code: 'assistant_unavailable',
      status: 503,
    });
    expect((refusal as AiBridgeError).message).toContain('TIMEOUT');
  });
});

describe('tools/read-blocks route', () => {
  const NOW = new Date('2026-10-30T09:00:00.000Z');
  const SERVICE_CREDENTIAL = 'test-service-token-0123456789abcdef';
  const environmentService = stub<EnvironmentService>({
    isAiBridgeConfigured: () => true,
    getAiServiceToken: () => SERVICE_CREDENTIAL,
    getAiBridgeSecret: () => 'test-bridge-secret-0123456789abcdef',
  });
  let wiki: WikiState;
  let tokens: AiTokenService;
  let guard: AiInternalAuthGuard;
  let controller: AiBridgeInternalController;
  let gateway: { handleYjsEvent: jest.Mock };

  beforeEach(() => {
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout'],
    });
    wiki = seedWiki();
    const pageAccess = pageAccessFor(wiki);
    tokens = new AiTokenService(
      new JwtService(),
      stub<UserRepo>({
        findById: async (id: string) => (id === USER.id ? USER : undefined),
      }),
      pageAccess,
      environmentService,
    );
    guard = new AiInternalAuthGuard(
      new Reflector(),
      environmentService,
      tokens,
    );
    gateway = { handleYjsEvent: jest.fn().mockResolvedValue(LIVE_READ) };
    controller = new AiBridgeInternalController(
      pageAccess,
      tokens,
      stub({}),
      stub({}),
      new AiAgentToolsService(
        pageAccess,
        new AiLiveDocumentService(stub<CollaborationGateway>(gateway)),
      ),
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function requestWith(userToken: string): AiBridgeRequest {
    return {
      headers: {
        'x-service-token': SERVICE_CREDENTIAL,
        'x-user-token': userToken,
      },
      body: { pageId: PAGE_ID, spaceId: ALLGEMEIN },
    };
  }

  const contextFor = (request: AiBridgeRequest) =>
    stub<ExecutionContext>({
      getHandler: () => AiBridgeInternalController.prototype.readBlocks,
      getClass: () => AiBridgeInternalController,
      switchToHttp: () => ({ getRequest: () => request }),
    });

  it('AGENT-AC32: the route accepts a task token', () => {
    expect(
      Reflect.getMetadata(
        AI_BRIDGE_USER_TOKEN_KEY,
        AiBridgeInternalController.prototype.readBlocks,
      ),
    ).toEqual({ allowTask: true });
  });

  it('AGENT-AC32: three minutes into a run the task token still reads the blocks for the run user', async () => {
    const userToken = await tokens.issueUserToken(USER);
    const { taskToken } = await tokens.issueTaskToken(USER, 'run-1');
    jest.setSystemTime(NOW.getTime() + 3 * 60 * 1000);

    const expiredUserRefusal = await refusalOf(
      guard.canActivate(contextFor(requestWith(userToken))),
    );
    const request = requestWith(taskToken);
    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);
    const read = await controller.readBlocks(
      { pageId: PAGE_ID, spaceId: ALLGEMEIN },
      request.aiBridgeUser!,
    );

    expect(expiredUserRefusal).toMatchObject({ code: 'user_token_expired' });
    expect(request.aiBridgeUser).toBe(USER);
    expect(read.blocks).toEqual(LIVE_READ.blocks);
    expect(read.fingerprint).toBe(LIVE_READ.fingerprint);
  });
});
