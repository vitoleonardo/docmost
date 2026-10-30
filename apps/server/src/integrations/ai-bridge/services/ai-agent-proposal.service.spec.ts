import { stub } from '../test-stub';
import 'reflect-metadata';
import {
  ArgumentsHost,
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import {
  EXCEPTION_FILTERS_METADATA,
  GUARDS_METADATA,
} from '@nestjs/common/constants';
import { FastifyReply } from 'fastify';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { Page, Space, User } from '@docmost/db/types/entity.types';
import { CollaborationGateway } from '../../../collaboration/collaboration.gateway';
import { PageAccessService } from '../../../core/page/page-access/page-access.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { EnvironmentService } from '../../environment/environment.service';
import { AiAgentController } from '../ai-agent.controller';
import { AiBridgeError } from '../ai-bridge.errors';
import { AiAgentProposalDto } from '../dto/ai-agent.dto';
import { AiBridgeExceptionFilter } from '../filters/ai-bridge-exception.filter';
import { KnownBodyFieldsGuard } from '../guards/known-body-fields.guard';
import {
  AgentApplyResult,
  AgentBlockRead,
  AgentDiffOp,
} from './agent-document';
import { AiAgentProposalRecords } from './ai-agent-proposal-records.service';
import { AiAgentProposalService } from './ai-agent-proposal.service';
import { AiAgentService } from './ai-agent.service';
import { AiLiveDocumentService } from './ai-live-document.service';
import { AiPageAccessService } from './ai-page-access.service';
import {
  AiAgentProposalStatus,
  AiServiceAgentProposal,
  AiServiceClient,
  AiServiceUnreachableError,
} from './ai-service.client';
import { AiTokenService } from './ai-token.service';

const WORKSPACE_ID = 'workspace-1';
const USER = { id: 'user-1', workspaceId: WORKSPACE_ID } as User;
const SPACE_ALLG = '0b7c5e8a-0000-4000-8000-000000000002';
const RUN_ID = '3e4f5a6b-0000-4000-8000-000000000001';
const PROPOSAL_ID = '4f5a6b7c-0000-4000-8000-000000000001';
const PAGE_ID = '1c2d3e4f-0000-4000-8000-000000000001';

describe('AiAgentProposalService', () => {
  const OTHER_USER = { id: 'user-2', workspaceId: WORKSPACE_ID } as User;
  const PAGE_TITLE = 'Reisekosten Richtlinie 2022';
  const REASON = 'Kilometerpauschale ist veraltet';
  const OLD_TEXT = 'Die Pauschale beträgt 0,30 € pro Kilometer.';
  const NEW_TEXT = 'Die Pauschale beträgt 0,38 € pro Kilometer.';
  const READ_FINGERPRINT = 'fingerprint-of-the-read';
  const OPS: AgentDiffOp[] = [
    { op: 'keep', text: 'Die Pauschale beträgt ' },
    { op: 'remove', text: '0,30' },
    { op: 'add', text: '0,38' },
    { op: 'keep', text: ' € pro Kilometer.' },
  ];
  const ALLOWED_FROM: Record<AiAgentProposalStatus, AiAgentProposalStatus[]> = {
    applying: ['open'],
    applied: ['applying'],
    open: ['applying'],
    stale: ['open', 'applying'],
    discarded: ['open'],
  };
  const tokenOf = (user: User) => `test-user-token-${user.id}`;

  type PageState =
    | 'editable'
    | 'view_only'
    | 'restricted'
    | 'trashed'
    | 'deleted'
    | 'space_left';

  interface GatewayCall {
    event: string;
    documentName: string;
    payload: unknown;
  }

  let configured: boolean;
  let aiServiceReachable: boolean;
  let stored: AiServiceAgentProposal & { newText: string; userId: string };
  let transitions: AiAgentProposalStatus[];
  let pageState: PageState;
  let liveRead: () => Promise<AgentBlockRead | undefined>;
  let applyAnswer: () => Promise<AgentApplyResult | undefined>;
  let gatewayCalls: GatewayCall[];
  let failTransitionTo: AiAgentProposalStatus | undefined;

  const liveBlocks = (
    fingerprint = READ_FINGERPRINT,
    text = OLD_TEXT,
  ): AgentBlockRead => ({
    fingerprint,
    blocks: [
      {
        number: 1,
        text: 'Kilometerpauschale',
        heading: null,
        isHeading: true,
        editable: true,
      },
      {
        number: 2,
        text,
        heading: 'Kilometerpauschale',
        isHeading: false,
        editable: true,
      },
    ],
  });

  const proposalWith = (status: AiAgentProposalStatus) => ({
    id: PROPOSAL_ID,
    runId: RUN_ID,
    userId: USER.id,
    pageId: PAGE_ID,
    pageTitle: PAGE_TITLE,
    reason: REASON,
    fingerprint: READ_FINGERPRINT,
    changes: [
      {
        block: 2,
        heading: 'Kilometerpauschale',
        oldText: OLD_TEXT,
        ops: OPS,
      },
    ],
    newText: NEW_TEXT,
    added: 1,
    removed: 1,
    status,
  });

  const ownedProposal = async (token: string, proposalId: string) => {
    await Promise.resolve();
    if (!aiServiceReachable) {
      throw new AiServiceUnreachableError('connection error (ECONNREFUSED)');
    }
    if (
      proposalId !== stored.id ||
      token !== `test-user-token-${stored.userId}`
    ) {
      throw new AiBridgeError('proposal_not_found', 'refused');
    }
    return stored;
  };

  const aiServiceClient = stub<AiServiceClient>({
    agentProposal: async (token: string, proposalId: string) => ({
      ...(await ownedProposal(token, proposalId)),
    }),
    transitionAgentProposal: async (
      token: string,
      proposalId: string,
      to: AiAgentProposalStatus,
    ) => {
      const proposal = await ownedProposal(token, proposalId);
      if (failTransitionTo === to) {
        throw new AiServiceUnreachableError('timeout');
      }
      if (!ALLOWED_FROM[to].includes(proposal.status)) {
        throw new AiBridgeError('proposal_not_open', 'refused');
      }
      proposal.status = to;
      transitions.push(to);
      return { ...proposal };
    },
  });

  const page = () =>
    ({
      id: PAGE_ID,
      title: PAGE_TITLE,
      spaceId: SPACE_ALLG,
      workspaceId: WORKSPACE_ID,
      deletedAt: pageState === 'trashed' ? new Date() : null,
    }) as Page;

  const pageAccess = new AiPageAccessService(
    stub<SpaceMemberRepo>({
      getUserSpaceIds: async () =>
        pageState === 'space_left' ? [] : [SPACE_ALLG],
    }),
    stub<SpaceRepo>({
      findById: async (spaceId: string) =>
        ({ id: spaceId, workspaceId: WORKSPACE_ID, deletedAt: null }) as Space,
    }),
    stub<PageRepo>({
      findManyByIds: async (ids: string[]) =>
        ids.includes(PAGE_ID) && !['trashed', 'deleted'].includes(pageState)
          ? [page()]
          : [],
      findById: async () => (pageState === 'deleted' ? undefined : page()),
    }),
    stub<PagePermissionRepo>({
      filterAccessiblePageIds: async ({ pageIds }: { pageIds: string[] }) =>
        pageState === 'restricted' ? [] : pageIds,
    }),
    stub<PageAccessService>({
      validateCanEdit: async () => {
        if (pageState === 'view_only') throw new ForbiddenException();
      },
    }),
  );

  const gateway = stub<CollaborationGateway>({
    handleYjsEvent: async (
      event: string,
      documentName: string,
      payload: unknown,
    ) => {
      gatewayCalls.push({ event, documentName, payload });
      return event === 'readAgentBlocks' ? liveRead() : applyAnswer();
    },
  });

  const service = new AiAgentProposalService(
    new AiAgentProposalRecords(
      stub<EnvironmentService>({ isAiBridgeConfigured: () => configured }),
      stub<AiTokenService>({
        issueUserToken: async (user: User) => tokenOf(user),
      }),
      aiServiceClient,
    ),
    pageAccess,
    new AiLiveDocumentService(
      gateway,
      stub<PageRepo>({
        findById: async () =>
          stub<Page>({
            ydoc: null,
            content: {
              type: 'doc',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Gespeicherter Text.' }],
                },
              ],
            },
          }),
      }),
    ),
  );

  const writes = () =>
    gatewayCalls.filter((call) => call.event === 'applyAgentChanges');

  const refusalOf = async (promise: Promise<unknown>) => {
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

  let logged: string[];

  beforeEach(() => {
    configured = true;
    aiServiceReachable = true;
    stored = proposalWith('open');
    transitions = [];
    pageState = 'editable';
    liveRead = async () => liveBlocks();
    applyAnswer = async () => 'applied';
    gatewayCalls = [];
    failTransitionTo = undefined;
    logged = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation((...parts: unknown[]) => {
          logged.push(parts.map(String).join(' '));
        });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const outcomeLines = () =>
    logged.filter((line) => /^agent (apply|discard) /.test(line));

  const VIEW = {
    id: PROPOSAL_ID,
    runId: RUN_ID,
    pageId: PAGE_ID,
    pageTitle: PAGE_TITLE,
    reason: REASON,
    canEdit: true,
    added: 1,
    removed: 1,
    changes: [{ heading: 'Kilometerpauschale', ops: OPS }],
  };

  describe('view', () => {
    it('AGENT-AC74: an applied proposal shows its diff with the status applied and only the fields the client needs', async () => {
      stored = proposalWith('applied');

      expect(await service.viewProposal(USER, PROPOSAL_ID)).toEqual({
        ...VIEW,
        status: 'applied',
      });
      expect(transitions).toEqual([]);
    });

    it('AGENT-AC74: a discarded proposal shows its diff with the status discarded', async () => {
      stored = proposalWith('discarded');

      expect(await service.viewProposal(USER, PROPOSAL_ID)).toMatchObject({
        status: 'discarded',
        changes: VIEW.changes,
      });
    });

    it('AGENT-AC74: an open proposal whose page is unchanged shows its diff as open and editable', async () => {
      expect(await service.viewProposal(USER, PROPOSAL_ID)).toEqual({
        ...VIEW,
        status: 'open',
      });
      expect(gatewayCalls).toEqual([
        {
          event: 'readAgentBlocks',
          documentName: `page.${PAGE_ID}`,
          payload: undefined,
        },
      ]);
      expect(transitions).toEqual([]);
    });

    it('AGENT-AC74: a proposal being applied is shown as open', async () => {
      stored = proposalWith('applying');

      expect(await service.viewProposal(USER, PROPOSAL_ID)).toMatchObject({
        status: 'open',
      });
    });

    it('AGENT-AC82: a view after the write of an apply in flight leaves the proposal to the apply, which records it applied', async () => {
      let viewed: { status: string } | undefined;
      applyAnswer = async () => {
        liveRead = async () => liveBlocks('fingerprint-after-the-write');
        viewed = await service.viewProposal(USER, PROPOSAL_ID);
        return 'applied';
      };

      expect(await service.applyProposal(USER, PROPOSAL_ID)).toEqual({
        status: 'applied',
      });
      expect(viewed?.status).toBe('open');
      expect(transitions).toEqual(['applying', 'applied']);
      expect(stored.status).toBe('applied');
    });

    it('AGENT-AC89: an open proposal for a block that is no longer editable is shown stale, as apply would refuse it', async () => {
      const live = liveBlocks();
      live.blocks[1].editable = false;
      liveRead = async () => live;

      expect(await service.viewProposal(USER, PROPOSAL_ID)).toMatchObject({
        status: 'stale',
      });
      expect(transitions).toEqual(['stale']);
    });

    it('AGENT-AC89: an open proposal whose ops do not spell the old text is shown stale, as apply would refuse it', async () => {
      stored.changes = [
        { ...stored.changes[0], ops: [{ op: 'add', text: NEW_TEXT }] },
      ];

      expect(await service.viewProposal(USER, PROPOSAL_ID)).toMatchObject({
        status: 'stale',
      });
      expect(transitions).toEqual(['stale']);
    });

    it('AGENT-AC97: a user who may only view the page gets the diff with canEdit false', async () => {
      pageState = 'view_only';

      expect(await service.viewProposal(USER, PROPOSAL_ID)).toEqual({
        ...VIEW,
        status: 'open',
        canEdit: false,
      });
    });

    it('AGENT-AC91: an open proposal whose page fingerprint changed becomes stale and is shown stale', async () => {
      liveRead = async () => liveBlocks('fingerprint-after-an-edit');

      expect(await service.viewProposal(USER, PROPOSAL_ID)).toMatchObject({
        status: 'stale',
      });
      expect(transitions).toEqual(['stale']);
      expect(stored.status).toBe('stale');
      expect(writes()).toHaveLength(0);
    });

    it('AGENT-AC91: an open proposal whose changed block no longer holds the old text is shown stale', async () => {
      liveRead = async () => liveBlocks(READ_FINGERPRINT, 'Ein anderer Text.');

      expect(await service.viewProposal(USER, PROPOSAL_ID)).toMatchObject({
        status: 'stale',
      });
      expect(transitions).toEqual(['stale']);
    });

    it('AGENT-AC91: a proposal that changed state while it was marked stale is shown in its new state', async () => {
      liveRead = async () => {
        stored.status = 'discarded';
        return liveBlocks('fingerprint-after-an-edit');
      };

      expect(await service.viewProposal(USER, PROPOSAL_ID)).toMatchObject({
        status: 'discarded',
      });
      expect(transitions).toEqual([]);
    });

    it('AGENT-AC91: a live document that rejects answers 503 assistant_unavailable and the proposal stays open', async () => {
      liveRead = async () => {
        throw new Error('TIMEOUT');
      };

      expect(await refusalOf(service.viewProposal(USER, PROPOSAL_ID))).toEqual({
        code: 'assistant_unavailable',
        status: 503,
      });
      expect(stored.status).toBe('open');
    });

    it('AGENT-AC91: a page no collaboration node holds is compared with the stored page and shown stale when it changed', async () => {
      liveRead = async () => undefined;

      expect(await service.viewProposal(USER, PROPOSAL_ID)).toMatchObject({
        status: 'stale',
      });
      expect(transitions).toEqual(['stale']);
      expect(writes()).toHaveLength(0);
    });

    it.each(['restricted', 'trashed', 'deleted', 'space_left'] as const)(
      'AGENT-AC100: a page that is %s answers 404 page_not_found with no text of the proposal',
      async (state) => {
        pageState = state;
        const error = await service.viewProposal(USER, PROPOSAL_ID).then(
          () => undefined,
          (caught: unknown) => caught,
        );

        expect(error).toBeInstanceOf(AiBridgeError);
        const answer = filteredAnswerOf(error as AiBridgeError);
        expect(answer.status).toBe(404);
        expect(answer.body.code).toBe('page_not_found');
        const body = JSON.stringify(answer.body);
        for (const text of [
          REASON,
          OLD_TEXT,
          NEW_TEXT,
          PAGE_TITLE,
          '0,30',
          '0,38',
        ]) {
          expect(body).not.toContain(text);
        }
        expect(gatewayCalls).toEqual([]);
      },
    );
  });

  describe('apply', () => {
    it('AGENT-AC76: claims the proposal, writes exactly its changes as the user and records it applied', async () => {
      expect(await service.applyProposal(USER, PROPOSAL_ID)).toEqual({
        status: 'applied',
      });
      expect(transitions).toEqual(['applying', 'applied']);
      expect(writes()).toEqual([
        {
          event: 'applyAgentChanges',
          documentName: `page.${PAGE_ID}`,
          payload: {
            fingerprint: READ_FINGERPRINT,
            changes: [{ block: 2, oldText: OLD_TEXT, ops: OPS }],
            user: USER,
          },
        },
      ]);
    });

    it.each(['applied', 'discarded'] as const)(
      'AGENT-AC84: an apply request for a proposal that is %s answers 409 proposal_not_open and writes nothing',
      async (status) => {
        stored = proposalWith(status);

        expect(
          await refusalOf(service.applyProposal(USER, PROPOSAL_ID)),
        ).toEqual({
          code: 'proposal_not_open',
          status: 409,
        });
        expect(writes()).toHaveLength(0);
        expect(stored.status).toBe(status);
      },
    );

    it('AGENT-AC85: two apply requests at the same time write the page once and one answers 409 proposal_not_open', async () => {
      const results = await Promise.allSettled([
        service.applyProposal(USER, PROPOSAL_ID),
        service.applyProposal(USER, PROPOSAL_ID),
      ]);

      expect(writes()).toHaveLength(1);
      expect(
        results.map((result) =>
          result.status === 'fulfilled'
            ? result.value
            : (result.reason as AiBridgeError).code,
        ),
      ).toEqual(
        expect.arrayContaining([{ status: 'applied' }, 'proposal_not_open']),
      );
      expect(stored.status).toBe('applied');
    });

    it('AGENT-AC85: a write whose record fails still answers applied, so the user does not apply it twice', async () => {
      failTransitionTo = 'applied';

      expect(await service.applyProposal(USER, PROPOSAL_ID)).toEqual({
        status: 'applied',
      });
      expect(writes()).toHaveLength(1);
      expect(logged.some((line) => line.includes('record'))).toBe(true);
    });

    it.each([
      ['answers nothing', async () => undefined],
      [
        'rejects',
        async () => {
          throw new Error('TIMEOUT');
        },
      ],
    ])(
      'AGENT-AC86: a write that %s answers 503 write_failed and the proposal is open again',
      async (_case, answer) => {
        applyAnswer = answer;

        expect(
          await refusalOf(service.applyProposal(USER, PROPOSAL_ID)),
        ).toEqual({
          code: 'write_failed',
          status: 503,
        });
        expect(transitions).toEqual(['applying', 'open']);
        expect(stored.status).toBe('open');
      },
    );

    it('AGENT-AC86: a failed write whose release fails still answers 503 write_failed', async () => {
      applyAnswer = async () => undefined;
      failTransitionTo = 'open';

      expect(await refusalOf(service.applyProposal(USER, PROPOSAL_ID))).toEqual(
        {
          code: 'write_failed',
          status: 503,
        },
      );
    });

    it('AGENT-AC88: an AI service that refuses connections answers 503 assistant_unavailable and nothing is written', async () => {
      aiServiceReachable = false;

      expect(await refusalOf(service.applyProposal(USER, PROPOSAL_ID))).toEqual(
        {
          code: 'assistant_unavailable',
          status: 503,
        },
      );
      expect(gatewayCalls).toEqual([]);
    });

    it('AGENT-AC88: an AI service that fails the claim answers 503 assistant_unavailable and nothing is written', async () => {
      failTransitionTo = 'applying';

      expect(await refusalOf(service.applyProposal(USER, PROPOSAL_ID))).toEqual(
        {
          code: 'assistant_unavailable',
          status: 503,
        },
      );
      expect(writes()).toHaveLength(0);
    });

    it('AGENT-AC91: a page that changed since the read answers 409 proposal_stale and the proposal becomes stale', async () => {
      applyAnswer = async () => 'stale';

      expect(await refusalOf(service.applyProposal(USER, PROPOSAL_ID))).toEqual(
        {
          code: 'proposal_stale',
          status: 409,
        },
      );
      expect(transitions).toEqual(['applying', 'stale']);
      expect(stored.status).toBe('stale');
    });

    it('AGENT-AC96: a stale proposal answers 409 proposal_not_open and is not written, even if the page is back to its old content', async () => {
      stored = proposalWith('stale');

      expect(await refusalOf(service.applyProposal(USER, PROPOSAL_ID))).toEqual(
        {
          code: 'proposal_not_open',
          status: 409,
        },
      );
      expect(writes()).toHaveLength(0);
    });

    it('AGENT-AC98: a user who may only view the page gets 403 page_not_editable, no claim and no write', async () => {
      pageState = 'view_only';

      expect(await refusalOf(service.applyProposal(USER, PROPOSAL_ID))).toEqual(
        {
          code: 'page_not_editable',
          status: 403,
        },
      );
      expect(transitions).toEqual([]);
      expect(gatewayCalls).toEqual([]);
      expect(stored.status).toBe('open');
    });

    it.each(['restricted', 'trashed', 'deleted', 'space_left'] as const)(
      'AGENT-AC101: a page that is %s answers 404 page_not_found, no claim and no write',
      async (state) => {
        pageState = state;

        expect(
          await refusalOf(service.applyProposal(USER, PROPOSAL_ID)),
        ).toEqual({
          code: 'page_not_found',
          status: 404,
        });
        expect(transitions).toEqual([]);
        expect(gatewayCalls).toEqual([]);
      },
    );
  });

  describe('discard', () => {
    it('AGENT-AC83: an open proposal is discarded without touching the page', async () => {
      expect(await service.discardProposal(USER, PROPOSAL_ID)).toEqual({
        status: 'discarded',
      });
      expect(transitions).toEqual(['discarded']);
      expect(gatewayCalls).toEqual([]);
    });

    it.each(['applied', 'discarded', 'stale'] as const)(
      'AGENT-AC84: a discard request for a proposal that is %s answers 409 proposal_not_open',
      async (status) => {
        stored = proposalWith(status);

        expect(
          await refusalOf(service.discardProposal(USER, PROPOSAL_ID)),
        ).toEqual({ code: 'proposal_not_open', status: 409 });
        expect(stored.status).toBe(status);
        expect(gatewayCalls).toEqual([]);
      },
    );
  });

  describe('requests', () => {
    const ACTIONS = [
      ['view', (user: User, id: string) => service.viewProposal(user, id)],
      ['apply', (user: User, id: string) => service.applyProposal(user, id)],
      [
        'discard',
        (user: User, id: string) => service.discardProposal(user, id),
      ],
    ] as const;

    it.each(ACTIONS)(
      'AGENT-AC102: a %s request for a proposal of another user answers 404 proposal_not_found',
      async (_action, act) => {
        expect(await refusalOf(act(OTHER_USER, PROPOSAL_ID))).toEqual({
          code: 'proposal_not_found',
          status: 404,
        });
        expect(gatewayCalls).toEqual([]);
        expect(transitions).toEqual([]);
      },
    );

    it.each(ACTIONS)(
      'AGENT-AC102: a %s request for a proposal id that does not exist answers 404 proposal_not_found',
      async (_action, act) => {
        expect(
          await refusalOf(act(USER, '4f5a6b7c-0000-4000-8000-0000000000ff')),
        ).toEqual({ code: 'proposal_not_found', status: 404 });
        expect(gatewayCalls).toEqual([]);
      },
    );

    it.each(ACTIONS)(
      'AGENT-AC107: a %s request with the assistant switched off answers 503 assistant_disabled',
      async (_action, act) => {
        configured = false;

        expect(await refusalOf(act(USER, PROPOSAL_ID))).toEqual({
          code: 'assistant_disabled',
          status: 503,
        });
        expect(gatewayCalls).toEqual([]);
      },
    );

    it.each(ACTIONS)(
      'AGENT-AC88: a %s request while the AI service refuses connections answers 503 assistant_unavailable',
      async (_action, act) => {
        aiServiceReachable = false;

        expect(await refusalOf(act(USER, PROPOSAL_ID))).toEqual({
          code: 'assistant_unavailable',
          status: 503,
        });
      },
    );

    it.each([
      ['a missing proposal id', {}],
      ['a malformed proposal id', { proposalId: 'proposal-1' }],
      ['a proposal id that is not a string', { proposalId: 42 }],
    ])('AGENT-AC105: %s answers 400 invalid_request', async (_case, body) => {
      expect(await validationAnswerOf(body, AiAgentProposalDto)).toEqual({
        status: 400,
        body: expect.objectContaining({ code: 'invalid_request' }),
      });
    });

    it.each([
      ['agentProposal'],
      ['agentProposalApply'],
      ['agentProposalDiscard'],
    ] as const)(
      'AGENT-AC105: %s sits behind the session guard, the body field guard and the bridge filter',
      (handlerName) => {
        const handler = AiAgentController.prototype[handlerName];

        expect(Reflect.getMetadata(GUARDS_METADATA, AiAgentController)).toEqual(
          [JwtAuthGuard],
        );
        expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
          KnownBodyFieldsGuard,
        ]);
        expect(
          Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, handler),
        ).toEqual([AiBridgeExceptionFilter]);
      },
    );

    it('AGENT-AC105: an apply request with new texts besides the proposal id answers 400 invalid_request', () => {
      const guardOutcome = (body: object) => {
        try {
          new KnownBodyFieldsGuard().canActivate(
            stub<ExecutionContext>({
              getClass: () => AiAgentController,
              getHandler: () => AiAgentController.prototype.agentProposalApply,
              switchToHttp: () => ({ getRequest: () => ({ body }) }),
            }),
          );
          return 'passed';
        } catch (error) {
          return filteredAnswerOf(error as AiBridgeError);
        }
      };

      expect(
        guardOutcome({
          proposalId: PROPOSAL_ID,
          changes: [{ block: 2, newText: 'Alles neu' }],
        }),
      ).toEqual({
        status: 400,
        body: expect.objectContaining({ code: 'invalid_request' }),
      });
      expect(guardOutcome({ proposalId: PROPOSAL_ID })).toBe('passed');
    });

    it('AGENT-AC105: the routes pass only the proposal id to the service', async () => {
      const calls: unknown[][] = [];
      const record =
        (status: string) =>
        async (...args: unknown[]) => {
          calls.push(args);
          return { status };
        };
      const controller = new AiAgentController(
        stub<AiAgentService>({}),
        stub<AiAgentProposalService>({
          viewProposal: record('open'),
          applyProposal: record('applied'),
          discardProposal: record('discarded'),
        }),
      );
      const dto = { proposalId: PROPOSAL_ID };

      expect(await controller.agentProposal(dto, USER)).toEqual({
        status: 'open',
      });
      expect(await controller.agentProposalApply(dto, USER)).toEqual({
        status: 'applied',
      });
      expect(await controller.agentProposalDiscard(dto, USER)).toEqual({
        status: 'discarded',
      });
      expect(calls).toEqual([
        [USER, PROPOSAL_ID],
        [USER, PROPOSAL_ID],
        [USER, PROPOSAL_ID],
      ]);
    });
  });

  describe('logging', () => {
    const OUTCOMES: [string, string, () => Promise<unknown>][] = [
      ['applied', 'apply', () => service.applyProposal(USER, PROPOSAL_ID)],
      [
        'discarded',
        'discard',
        () => service.discardProposal(USER, PROPOSAL_ID),
      ],
      [
        'stale',
        'apply',
        () => {
          applyAnswer = async () => 'stale';
          return service.applyProposal(USER, PROPOSAL_ID);
        },
      ],
      [
        'not_editable',
        'apply',
        () => {
          pageState = 'view_only';
          return service.applyProposal(USER, PROPOSAL_ID);
        },
      ],
      [
        'page_not_found',
        'apply',
        () => {
          pageState = 'trashed';
          return service.applyProposal(USER, PROPOSAL_ID);
        },
      ],
      [
        'proposal_not_open',
        'apply',
        () => {
          stored = proposalWith('applied');
          return service.applyProposal(USER, PROPOSAL_ID);
        },
      ],
      [
        'proposal_not_open',
        'discard',
        () => {
          stored = proposalWith('stale');
          return service.discardProposal(USER, PROPOSAL_ID);
        },
      ],
      [
        'write_failed',
        'apply',
        () => {
          applyAnswer = async () => {
            throw new Error('TIMEOUT');
          };
          return service.applyProposal(USER, PROPOSAL_ID);
        },
      ],
    ];

    it.each(OUTCOMES)(
      'AGENT-AC112: the outcome %s of a %s request logs one line with the run id, the proposal id and the outcome',
      async (outcome, action, act) => {
        await act().catch(() => undefined);

        expect(outcomeLines()).toEqual([
          `agent ${action} run=${RUN_ID} proposal=${PROPOSAL_ID} outcome=${outcome}`,
        ]);
      },
    );

    it('AGENT-AC112: a request for a proposal that is not found logs no outcome line, as it has no run id', async () => {
      await service
        .applyProposal(OTHER_USER, PROPOSAL_ID)
        .catch(() => undefined);
      await service
        .discardProposal(OTHER_USER, PROPOSAL_ID)
        .catch(() => undefined);

      expect(outcomeLines()).toEqual([]);
    });

    it.each(OUTCOMES)(
      'AGENT-AC113: the log lines of the outcome %s (%s) hold no reason, title, page text or token',
      async (_outcome, _action, act) => {
        await act().catch(() => undefined);
        await service.viewProposal(USER, PROPOSAL_ID).catch(() => undefined);

        expect(logged.length).toBeGreaterThan(0);
        const output = logged.join('\n');
        for (const secret of [
          REASON,
          PAGE_TITLE,
          OLD_TEXT,
          NEW_TEXT,
          'Kilometerpauschale',
          '0,30',
          '0,38',
          tokenOf(USER),
          READ_FINGERPRINT,
        ]) {
          expect(output).not.toContain(secret);
        }
      },
    );
  });
});

const pipeline = new ValidationPipe({
  whitelist: true,
  stopAtFirstError: true,
  transform: true,
});

function filteredAnswerOf(error: AiBridgeError | BadRequestException) {
  const send = jest.fn();
  const reply = { status: jest.fn((_status: number) => ({ send })) };
  new AiBridgeExceptionFilter().catch(
    error,
    stub<ArgumentsHost>({
      switchToHttp: () => ({
        getResponse: () => stub<FastifyReply>(reply),
      }),
    }),
  );
  return {
    status: reply.status.mock.calls[0][0],
    body: send.mock.calls[0][0],
  };
}

async function validationAnswerOf(
  body: Record<string, unknown>,
  metatype: new () => object,
) {
  const refusal = await pipeline
    .transform(body, { type: 'body', metatype })
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(refusal).toBeInstanceOf(BadRequestException);
  return filteredAnswerOf(refusal as BadRequestException);
}
