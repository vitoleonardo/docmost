import { stub } from './test-stub';
import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, RequestMethod } from '@nestjs/common';
import {
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RouteParamtypes } from '@nestjs/common/enums/route-paramtypes.enum';
import { JwtService } from '@nestjs/jwt';
import { plainToInstance } from 'class-transformer';
import { getMetadataStorage, validate } from 'class-validator';
import { Job } from 'bullmq';
import { FastifyReply } from 'fastify';
import { Attachment, Page, User } from '@docmost/db/types/entity.types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { EnvironmentService } from '../environment/environment.service';
import { QueueJob } from '../queue/constants';
import { AI_BRIDGE_ERROR_STATUS } from './ai-bridge.errors';
import { AiAgentController } from './ai-agent.controller';
import { AiBridgeController } from './ai-bridge.controller';
import { AiBridgeInternalController } from './ai-bridge-internal.controller';
import { AiQueueProcessor } from './ai-queue.processor';
import { AI_BRIDGE_USER_TOKEN_KEY } from './decorators/ai-bridge-auth.decorator';
import { AiAgentRunDto } from './dto/ai-agent.dto';
import { AiAskDto } from './dto/ai-ask.dto';
import { AiAgentProposalRecords } from './services/ai-agent-proposal-records.service';
import { AiAgentProposalService } from './services/ai-agent-proposal.service';
import { AiAgentService } from './services/ai-agent.service';
import { AiAskService } from './services/ai-ask.service';
import { AiExtractService } from './services/ai-extract.service';
import { AiAgentToolsService } from './services/ai-agent-tools.service';
import { AgentBlockRead } from './services/agent-document';
import { CollaborationGateway } from '../../collaboration/collaboration.gateway';
import { AiInternalAuthGuard } from './guards/ai-internal-auth.guard';
import { AiContentService } from './services/ai-content.service';
import { AiLiveDocumentService } from './services/ai-live-document.service';
import { AiPageAccessService } from './services/ai-page-access.service';
import { AiPageListService } from './services/ai-page-list.service';
import {
  AiServiceAskEvent,
  AiServiceClient,
  AiServiceExtractResult,
  AiServiceMalformedResponseError,
  AiServiceTimeoutError,
  AiServiceUnreachableError,
} from './services/ai-service.client';
import { AiStatusService } from './services/ai-status.service';
import { AiTokenService } from './services/ai-token.service';

interface ContractEndpoint {
  side: 'wiki-client' | 'bridge' | 'ai-service';
  method: string;
  path: string;
  auth: string[];
  acceptsTaskToken?: boolean;
  request: string[];
  response: string[];
  responseType?: string;
  responseContentType?: string;
  events?: Record<string, string[]>;
  outcomes?: Record<string, string[]>;
  values?: Record<string, string[]>;
  maxQuestionLength?: number;
  maxTaskLength?: number;
  status: number;
  errors: string[];
  changesPageContent?: boolean;
}

interface TokenContract {
  claims: string[];
  aud: string;
  type: string;
  maxLifetimeSeconds: number;
}

const CONTRACT: {
  headers: { serviceTokenHeader: string; userTokenHeader: string };
  errors: Record<string, number>;
  endpoints: ContractEndpoint[];
  tokens: { algorithm: string; user: TokenContract; task: TokenContract };
  jobs: {
    stream: string;
    body: string[];
    forwarded: Record<string, string[]>;
  };
} = JSON.parse(
  readFileSync(
    join(__dirname, '../../../../../docs/contracts/ai-bridge.json'),
    'utf8',
  ),
);

const SERVED_ENDPOINTS = CONTRACT.endpoints.filter(
  (endpoint) => endpoint.side !== 'ai-service',
);
const AI_SERVICE_ENDPOINTS = CONTRACT.endpoints.filter(
  (endpoint) => endpoint.side === 'ai-service',
);

const BRIDGE_KEY = 'test-bridge-secret-0123456789abcdef';
const SERVICE_CREDENTIAL = 'test-service-token-0123456789abcdef';
const WORKSPACE_ID = 'workspace-1';
const SPACE_ID = 'space-a';
const PAGE_ID = 'page-1';
const SPACE_UUID = '0b7c5e8a-0000-4000-8000-000000000001';
const USER = {
  id: 'user-1',
  workspaceId: WORKSPACE_ID,
  deactivatedAt: null,
  deletedAt: null,
} as User;

interface ServedRoute {
  method: string;
  path: string;
  controller: new (...args: never[]) => object;
  handlerName: string;
}

const CONTROLLERS = [
  AiBridgeController,
  AiAgentController,
  AiBridgeInternalController,
];

function routesOf(controller: ServedRoute['controller']): ServedRoute[] {
  const prefix = Reflect.getMetadata(PATH_METADATA, controller);
  return Object.getOwnPropertyNames(controller.prototype)
    .filter((name) => name !== 'constructor')
    .flatMap((handlerName) => {
      const handler = controller.prototype[handlerName];
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      if (method === undefined) return [];
      const path = Reflect.getMetadata(PATH_METADATA, handler);
      return [
        {
          method: RequestMethod[method],
          path: `/api/${prefix}/${path}`,
          controller,
          handlerName,
        },
      ];
    });
}

const SERVED_ROUTES = CONTROLLERS.flatMap(routesOf);

const routeOf = (endpoint: ContractEndpoint): ServedRoute | undefined =>
  SERVED_ROUTES.find(
    (route) => route.method === endpoint.method && route.path === endpoint.path,
  );

function handlerOf(route: ServedRoute) {
  return route.controller.prototype[route.handlerName];
}

function bodyDtoFields(route: ServedRoute): string[] {
  const args =
    Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      route.controller,
      route.handlerName,
    ) ?? {};
  const bodyKey = Object.keys(args).find((key) =>
    key.startsWith(`${RouteParamtypes.BODY}:`),
  );
  if (!bodyKey) return [];
  const paramTypes = Reflect.getMetadata(
    'design:paramtypes',
    route.controller.prototype,
    route.handlerName,
  );
  const dto = paramTypes[args[bodyKey].index];
  const metadatas = getMetadataStorage().getTargetValidationMetadatas(
    dto,
    undefined!,
    false,
    false,
  );
  return [...new Set(metadatas.map((metadata) => metadata.propertyName))];
}

function fieldPaths(value: unknown, prefix = ''): string[] {
  if (Array.isArray(value)) {
    expect(value.length).toBeGreaterThan(0);
    const [first] = value;
    return first !== null && typeof first === 'object'
      ? fieldPaths(first, `${prefix}[]`)
      : [prefix];
  }
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => {
      const path = prefix ? `${prefix}.${key}` : key;
      return Array.isArray(child) || (child && typeof child === 'object')
        ? fieldPaths(child, path)
        : [path];
    });
  }
  return [prefix];
}

const sorted = (values: string[]) => [...values].sort();

const endpointAt = (path: string) =>
  CONTRACT.endpoints.find((endpoint) => endpoint.path === path)!;

const aiPageAccessService = {
  readableSpaceIds: jest.fn(),
  filterViewablePageIds: jest.fn(),
  findViewablePage: jest.fn(),
  findEditablePage: jest.fn(),
};
const pageRepo = { findById: jest.fn() };
const spaceRepo = { findById: jest.fn() };
const aiPageListRepo = { listIndexablePages: jest.fn() };
const attachmentRepo = { findById: jest.fn(), findPageAttachments: jest.fn() };
const storageService = { readStream: jest.fn() };
const collaborationGateway = { handleYjsEvent: jest.fn() };
const LIVE_BLOCKS: AgentBlockRead = {
  fingerprint: 'fingerprint-1',
  blocks: [
    {
      number: 1,
      text: 'Text',
      heading: null,
      isHeading: false,
      editable: true,
    },
  ],
};
const searchService = { searchPage: jest.fn() };
const userRepo = { findById: jest.fn() };
const environmentService = {
  getAiBridgeSecret: jest.fn(),
  getAiServiceToken: jest.fn(),
  getAiServiceUrl: jest.fn(),
  isAiBridgeConfigured: jest.fn(),
};

const jwtService = new JwtService();
const aiTokenService = new AiTokenService(
  jwtService,
  stub(userRepo),
  stub<AiPageAccessService>(aiPageAccessService),
  stub<EnvironmentService>(environmentService),
);
const aiContentService = new AiContentService(
  stub(pageRepo),
  stub(spaceRepo),
  stub(attachmentRepo),
  stub(storageService),
  stub(searchService),
  stub<AiPageAccessService>(aiPageAccessService),
);
const internalController = new AiBridgeInternalController(
  stub<AiPageAccessService>(aiPageAccessService),
  aiTokenService,
  aiContentService,
  new AiPageListService(
    stub(aiPageListRepo),
    stub<EnvironmentService>(environmentService),
  ),
  new AiAgentToolsService(
    stub<AiPageAccessService>(aiPageAccessService),
    new AiLiveDocumentService(stub<CollaborationGateway>(collaborationGateway)),
  ),
);

const PAGE = stub<Page>({
  id: PAGE_ID,
  slugId: 'slug-1',
  title: 'Seite',
  spaceId: SPACE_ID,
  workspaceId: WORKSPACE_ID,
  updatedAt: new Date('2026-10-01T08:30:00.000Z'),
  deletedAt: null,
  content: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Text' }] }],
  },
});

const PDF_ATTACHMENT = stub<Attachment>({
  id: 'att-1',
  fileName: 'vertrag.pdf',
  filePath: 'workspace-1/files/att-1/vertrag.pdf',
  mimeType: 'application/pdf',
  fileSize: '2048',
  pageId: PAGE_ID,
  workspaceId: WORKSPACE_ID,
  deletedAt: null,
});

const statusService = (
  configured: boolean,
  sessionAccepted: boolean,
): AiStatusService =>
  new AiStatusService(
    stub<EnvironmentService>({ isAiBridgeConfigured: () => configured }),
    stub<AiTokenService>({ issueUserToken: async () => 'user-token' }),
    stub<AiServiceClient>({
      checkSession: async () => sessionAccepted,
    }),
  );

const STORED_PROPOSAL = {
  id: '4f5a6b7c-0000-4000-8000-000000000001',
  runId: 'run-1',
  userId: USER.id,
  pageId: PAGE_ID,
  pageTitle: 'Seite',
  spaceId: SPACE_ID,
  reason: 'Veraltet',
  fingerprint: LIVE_BLOCKS.fingerprint,
  changes: [
    {
      block: 1,
      heading: null,
      oldText: 'Text',
      newText: 'Neuer Text',
      ops: [
        { op: 'add', text: 'Neuer ' },
        { op: 'keep', text: 'Text' },
      ],
    },
  ],
  added: 1,
  removed: 0,
  status: 'open',
  appliedBy: null,
  appliedAt: null,
};

const aiServiceAnswersProposals = () =>
  jest.spyOn(global, 'fetch').mockImplementation(
    async (_url, init) =>
      new Response(
        JSON.stringify({
          ...STORED_PROPOSAL,
          status: JSON.parse(String(init?.body)).to ?? STORED_PROPOSAL.status,
        }),
        { status: 200 },
      ),
  );

const servedProposal = async <T>(
  call: (controller: AiAgentController) => Promise<T>,
): Promise<T> => {
  const fetchSpy = aiServiceAnswersProposals();
  const gateway = stub<CollaborationGateway>({
    handleYjsEvent: async (event: string) =>
      event === 'readAgentBlocks' ? LIVE_BLOCKS : 'applied',
  });
  environmentService.isAiBridgeConfigured.mockReturnValue(true);
  try {
    return await call(
      new AiAgentController(
        stub({}),
        new AiAgentProposalService(
          new AiAgentProposalRecords(
            stub<EnvironmentService>(environmentService),
            stub<AiTokenService>({ issueUserToken: async () => 'user-token' }),
            new AiServiceClient(stub<EnvironmentService>(environmentService)),
          ),
          stub<AiPageAccessService>(aiPageAccessService),
          new AiLiveDocumentService(gateway),
        ),
      ),
    );
  } finally {
    fetchSpy.mockRestore();
  }
};

const PROPOSAL_DTO = { proposalId: STORED_PROPOSAL.id };

const RESPONSE_BODIES: Record<string, () => Promise<unknown>> = {
  '/api/ai/status': () =>
    new AiBridgeController(
      statusService(true, true),
      stub({}),
      stub({}),
    ).status(USER),
  '/api/ai-bridge/internal/filter-pages': () =>
    internalController.filterPages({ pageIds: [PAGE_ID] }, USER),
  '/api/ai-bridge/internal/task-token': () =>
    internalController.taskToken({ runId: 'run-1' }, USER),
  '/api/ai-bridge/internal/pages': () => internalController.pages({}),
  '/api/ai-bridge/internal/page-content': () =>
    internalController.pageContent({ pageId: PAGE_ID }),
  '/api/ai-bridge/internal/tools/read-page': () =>
    internalController.readPage({ pageId: PAGE_ID }, USER),
  '/api/ai-bridge/internal/tools/search': () =>
    internalController.search({ spaceId: SPACE_ID, query: 'Seite' }, USER),
  '/api/ai-bridge/internal/tools/read-blocks': () =>
    internalController.readBlocks({ pageId: PAGE_ID, spaceId: SPACE_ID }, USER),
  '/api/ai/agent/proposal': () =>
    servedProposal((controller) =>
      controller.agentProposal(PROPOSAL_DTO, USER),
    ),
  '/api/ai/agent/proposal/apply': () =>
    servedProposal((controller) =>
      controller.agentProposalApply(PROPOSAL_DTO, USER),
    ),
  '/api/ai/agent/proposal/discard': () =>
    servedProposal((controller) =>
      controller.agentProposalDiscard(PROPOSAL_DTO, USER),
    ),
};

beforeEach(() => {
  jest.resetAllMocks();
  environmentService.getAiBridgeSecret.mockReturnValue(BRIDGE_KEY);
  environmentService.getAiServiceToken.mockReturnValue(SERVICE_CREDENTIAL);
  environmentService.getAiServiceUrl.mockReturnValue('http://127.0.0.1:8100');
  aiPageAccessService.readableSpaceIds.mockResolvedValue([SPACE_ID]);
  aiPageAccessService.filterViewablePageIds.mockResolvedValue([PAGE_ID]);
  aiPageAccessService.findViewablePage.mockResolvedValue(PAGE);
  aiPageAccessService.findEditablePage.mockResolvedValue(PAGE);
  pageRepo.findById.mockResolvedValue(PAGE);
  spaceRepo.findById.mockResolvedValue({
    id: SPACE_ID,
    name: 'Allgemein',
    slug: 'allgemein',
    deletedAt: null,
  });
  aiPageListRepo.listIndexablePages.mockResolvedValue({
    pages: [PAGE],
    hasNextPage: true,
  });
  attachmentRepo.findById.mockResolvedValue(PDF_ATTACHMENT);
  attachmentRepo.findPageAttachments.mockResolvedValue({
    items: [PDF_ATTACHMENT],
    meta: { hasNextPage: false, nextCursor: null },
  });
  storageService.readStream.mockResolvedValue('file-stream');
  collaborationGateway.handleYjsEvent.mockResolvedValue(LIVE_BLOCKS);
  searchService.searchPage.mockResolvedValue({
    items: [
      {
        id: PAGE_ID,
        title: 'Seite',
        highlight: 'x',
        rank: 1,
        space: { id: SPACE_ID },
      },
    ],
  });
});

describe('contract file', () => {
  it('BRIDGE-AC35: lists the endpoints of all three sides', () => {
    expect(SERVED_ENDPOINTS.length).toBeGreaterThan(0);
    expect(AI_SERVICE_ENDPOINTS.length).toBeGreaterThan(0);
  });
});

describe.each(SERVED_ENDPOINTS.map((endpoint) => [endpoint.path, endpoint]))(
  'served endpoint %s',
  (_path, endpoint: ContractEndpoint) => {
    it('BRIDGE-AC35: the route exists on a controller with the contract method and path', () => {
      expect(routeOf(endpoint)).toBeDefined();
    });

    it('BRIDGE-AC35: request fields equal the properties of the DTO the handler validates', () => {
      const route = routeOf(endpoint)!;

      expect(sorted(bodyDtoFields(route))).toEqual(sorted(endpoint.request));
    });

    it('BRIDGE-AC35: the success status equals the contract status', () => {
      const route = routeOf(endpoint)!;

      expect(Reflect.getMetadata(HTTP_CODE_METADATA, handlerOf(route))).toBe(
        endpoint.status,
      );
    });

    it('BRIDGE-AC35: the declared errors are codes the bridge can answer', () => {
      for (const code of endpoint.errors) {
        expect(AI_BRIDGE_ERROR_STATUS).toHaveProperty(code);
        expect(CONTRACT.errors[code]).toBe(
          AI_BRIDGE_ERROR_STATUS[code as keyof typeof AI_BRIDGE_ERROR_STATUS],
        );
      }
    });

    it('BRIDGE-AC35: response fields equal the keys of what the services return', async () => {
      if (
        endpoint.responseType === 'binary' ||
        endpoint.responseType === 'sse' ||
        endpoint.outcomes
      ) {
        expect(endpoint.response).toEqual([]);
        return;
      }
      const produce = RESPONSE_BODIES[endpoint.path];
      expect(produce).toBeDefined();

      const body = await produce();

      expect(sorted(fieldPaths(body))).toEqual(sorted(endpoint.response));
    });
  },
);

describe('served routes', () => {
  it('BRIDGE-AC35: every route of the two controllers is in the contract', () => {
    const contracted = SERVED_ENDPOINTS.map(
      (endpoint) => `${endpoint.method} ${endpoint.path}`,
    );

    expect(
      SERVED_ROUTES.map((route) => `${route.method} ${route.path}`).sort(),
    ).toEqual(contracted.sort());
  });

  it('BRIDGE-AC35: user-token routes in the contract are exactly those marked with the user-token decorator', () => {
    const bridgeRoutes = SERVED_ENDPOINTS.filter(
      (endpoint) => endpoint.side === 'bridge',
    );

    for (const endpoint of bridgeRoutes) {
      const options = Reflect.getMetadata(
        AI_BRIDGE_USER_TOKEN_KEY,
        handlerOf(routeOf(endpoint)!),
      );
      expect(options !== undefined).toBe(endpoint.auth.includes('user'));
      if (options) {
        expect(options.allowTask).toBe(endpoint.acceptsTaskToken);
      }
    }
  });

  it('BRIDGE-AC35: bridge endpoints are behind the internal guard, the status endpoint behind the session guard', () => {
    const guards = (controller: ServedRoute['controller']) =>
      Reflect.getMetadata('__guards__', controller);

    expect(guards(AiBridgeInternalController)).toContain(AiInternalAuthGuard);
    expect(guards(AiBridgeController)).toContain(JwtAuthGuard);
    expect(guards(AiAgentController)).toContain(JwtAuthGuard);
    for (const endpoint of SERVED_ENDPOINTS) {
      const guarded =
        endpoint.side === 'bridge'
          ? endpoint.auth.includes('service')
          : endpoint.auth.includes('session');
      expect(guarded).toBe(true);
    }
  });

  it('AGENT-AC37: every bridge endpoint for the AI service declares that it does not change page content', () => {
    const bridgeEndpoints = SERVED_ENDPOINTS.filter(
      (endpoint) => endpoint.side === 'bridge',
    );

    expect(bridgeEndpoints.length).toBeGreaterThan(0);
    for (const endpoint of bridgeEndpoints) {
      expect({
        path: endpoint.path,
        changesPageContent: endpoint.changesPageContent,
      }).toEqual({ path: endpoint.path, changesPageContent: false });
    }
  });

  it('AGENT-AC37: every route of the internal controller is a bridge endpoint of the contract', () => {
    const bridgeRoutes = SERVED_ENDPOINTS.filter(
      (endpoint) => endpoint.side === 'bridge',
    ).map((endpoint) => `${endpoint.method} ${endpoint.path}`);

    expect(
      routesOf(AiBridgeInternalController)
        .map((route) => `${route.method} ${route.path}`)
        .sort(),
    ).toEqual(bridgeRoutes.sort());
  });

  it('BRIDGE-AC35: the error record equals the contract errors, with the same statuses', () => {
    expect(AI_BRIDGE_ERROR_STATUS).toEqual(CONTRACT.errors);
  });

  it('BRIDGE-AC35: every code of the record is listed by a served endpoint', () => {
    const listed = new Set(
      SERVED_ENDPOINTS.flatMap((endpoint) => endpoint.errors),
    );

    expect([...listed].sort()).toEqual(
      Object.keys(AI_BRIDGE_ERROR_STATUS).sort(),
    );
  });

  it('BRIDGE-AC35: the status endpoint answers exactly the contract values', async () => {
    const statusEndpoint = endpointAt('/api/ai/status');
    const answers = await Promise.all(
      [
        statusService(false, false),
        statusService(true, true),
        statusService(true, false),
      ].map((service) =>
        new AiBridgeController(service, stub({}), stub({})).status(USER),
      ),
    );

    expect(answers.map((answer) => answer.status).sort()).toEqual(
      sorted(statusEndpoint.values!.status),
    );
  });

  it('BRIDGE-AC35: the attachment endpoint answers the bytes with the attachment mime type', async () => {
    const reply = stub<FastifyReply>({
      headers: jest.fn().mockReturnThis(),
      send: jest.fn(),
    });

    await internalController.attachment({ attachmentId: 'att-1' }, reply);

    expect(reply.headers).toHaveBeenCalledWith({
      'Content-Type': PDF_ATTACHMENT.mimeType,
    });
    expect(reply.send).toHaveBeenCalledWith('file-stream');
  });
});

describe('ask endpoint', () => {
  const askEndpoint = endpointAt('/api/ai/ask');
  const CONVERSATION_ID = '6f1c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f';
  const CITATION = {
    number: 1,
    pageId: PAGE_ID,
    headingPath: ['Abschnitt'],
    attachmentId: null,
    fileName: null,
    pdfPage: null,
  };

  const streamOf = (events: AiServiceAskEvent[]) =>
    (async function* () {
      yield* events;
    })();

  const answer = async (upstream: AiServiceAskEvent[]) => {
    const askService = new AiAskService(
      stub<EnvironmentService>({ isAiBridgeConfigured: () => true }),
      stub<AiTokenService>({ issueUserToken: async () => 'user-token' }),
      stub<AiServiceClient>({
        ask: async () => streamOf(upstream),
        confirmTurn: async () => undefined,
      }),
      stub<AiPageAccessService>(aiPageAccessService),
      stub(spaceRepo),
    );
    const raw = Object.assign(new EventEmitter(), {
      setHeader: jest.fn(),
      writeHead: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    });
    const reply = stub<FastifyReply>({
      raw,
      hijack: jest.fn(),
      getHeaders: () => ({}),
    });

    await new AiBridgeController(
      statusService(true, true),
      askService,
      stub({}),
    ).ask({ question: 'Frage', conversationId: CONVERSATION_ID }, USER, reply);

    const frames: string[] = raw.write.mock.calls.map(([frame]) =>
      String(frame),
    );
    for (const frame of frames) expect(frame).toMatch(/^data: [^\n]*\n\n$/);
    return {
      raw,
      events: frames.map((frame) => JSON.parse(frame.slice('data: '.length))),
    };
  };

  it('ASK-AC9: the ask endpoint streams with the contract content type', async () => {
    const { raw } = await answer([{ type: 'no_source' }]);

    const [status, headers] = raw.writeHead.mock.calls[0];
    expect(status).toBe(askEndpoint.status);
    expect(headers['content-type']).toContain(askEndpoint.responseContentType);
    expect(raw.end).toHaveBeenCalled();
  });

  it('ASK-AC9: every ask event the wiki streams has exactly the fields of the contract', async () => {
    const runs = await Promise.all([
      answer([
        { type: 'delta', text: 'Antwort [1]' },
        { type: 'citations', turnId: 'turn-1', citations: [CITATION] },
      ]),
      answer([{ type: 'no_source' }]),
      answer([{ type: 'error', code: 'model_unavailable' }]),
    ]);

    const byType: Record<string, Set<string>> = {};
    const errorCodes = new Set<string>();
    for (const event of runs.flatMap((run) => run.events)) {
      byType[event.type] ??= new Set();
      fieldPaths(event).forEach((field) => byType[event.type].add(field));
      if (event.type === 'error') errorCodes.add(event.code);
    }
    expect(
      Object.fromEntries(
        Object.entries(byType).map(([type, fields]) => [
          type,
          sorted([...fields]),
        ]),
      ),
    ).toEqual(
      Object.fromEntries(
        Object.entries(askEndpoint.events!).map(([type, fields]) => [
          type,
          sorted(fields),
        ]),
      ),
    );
    expect([...errorCodes]).toEqual(askEndpoint.values!.errorCode);
  });

  it('ASK-AC61: the question length limit of the DTO equals the contract', async () => {
    const errorsFor = (question: string) =>
      validate(
        plainToInstance(AiAskDto, {
          question,
          conversationId: CONVERSATION_ID,
        }),
      );

    expect(await errorsFor('x'.repeat(askEndpoint.maxQuestionLength!))).toEqual(
      [],
    );
    expect(
      await errorsFor('x'.repeat(askEndpoint.maxQuestionLength! + 1)),
    ).not.toEqual([]);
  });
});

const fieldsByType = (events: { type: string }[]) => {
  const byType: Record<string, Set<string>> = {};
  for (const event of events) {
    byType[event.type] ??= new Set();
    fieldPaths(event).forEach((field) => byType[event.type].add(field));
  }
  return Object.fromEntries(
    Object.entries(byType).map(([type, fields]) => [type, sorted([...fields])]),
  );
};

const sortedEvents = (events: Record<string, string[]>) =>
  Object.fromEntries(
    Object.entries(events).map(([type, fields]) => [type, sorted(fields)]),
  );

describe('agent run endpoint', () => {
  const runEndpoint = endpointAt('/api/ai/agent/run');
  const upstreamEndpoint = endpointAt('/v1/agent/runs');
  const AGENT_EVENTS = [
    { type: 'run', runId: 'run-1' },
    {
      type: 'step',
      steps: 1,
      label: { kind: 'search', query: 'Reisekosten', count: 2 },
    },
    { type: 'step', steps: 2, label: { kind: 'read', title: 'Seite' } },
    { type: 'step', steps: 3, label: { kind: 'propose', title: 'Seite' } },
    { type: 'step', steps: 4, label: { kind: 'refused' } },
    {
      type: 'proposal',
      proposal: {
        id: 'proposal-1',
        pageId: PAGE_ID,
        pageTitle: 'Seite',
        reason: 'Veraltet',
        added: 1,
        removed: 1,
      },
    },
    { type: 'end', outcome: 'finished', pagesRead: 1, message: 'Fertig' },
  ];

  const streamed = async (upstream: object[]) => {
    const client = new AiServiceClient(
      stub<EnvironmentService>(environmentService),
    );
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(
          upstream.map((event) => `${JSON.stringify(event)}\n`).join(''),
          { status: upstreamEndpoint.status },
        ),
      );
    const raw = Object.assign(new EventEmitter(), {
      setHeader: jest.fn(),
      writeHead: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    });
    const reply = stub<FastifyReply>({
      raw,
      hijack: jest.fn(),
      getHeaders: () => ({}),
    });
    environmentService.isAiBridgeConfigured.mockReturnValue(true);

    await new AiAgentController(
      new AiAgentService(
        stub<EnvironmentService>(environmentService),
        stub<AiTokenService>({ issueUserToken: async () => 'user-token' }),
        client,
        stub<AiPageAccessService>(aiPageAccessService),
      ),
      stub({}),
    ).agentRun({ spaceId: SPACE_ID, task: 'Aufgabe' }, USER, reply);

    const frames: string[] = raw.write.mock.calls.map(([frame]) =>
      String(frame),
    );
    for (const frame of frames) expect(frame).toMatch(/^data: [^\n]*\n\n$/);
    return {
      raw,
      events: frames.map((frame) => JSON.parse(frame.slice('data: '.length))),
    };
  };

  afterEach(() => jest.restoreAllMocks());

  it('AGENT-AC17: the run endpoint streams with the contract content type', async () => {
    const { raw } = await streamed(AGENT_EVENTS);

    const [status, headers] = raw.writeHead.mock.calls[0];
    expect(status).toBe(runEndpoint.status);
    expect(headers['content-type']).toContain(runEndpoint.responseContentType);
    expect(raw.end).toHaveBeenCalled();
  });

  it('AGENT-AC17: every event the wiki streams has exactly the fields of the contract, the same as the AI service sends', async () => {
    const { events } = await streamed(AGENT_EVENTS);

    expect(events).toEqual(AGENT_EVENTS);
    expect(fieldsByType(events)).toEqual(sortedEvents(runEndpoint.events!));
    expect(sortedEvents(runEndpoint.events!)).toEqual(
      sortedEvents(upstreamEndpoint.events!),
    );
    expect(runEndpoint.values).toEqual(upstreamEndpoint.values);
  });

  it('AGENT-AC59: every end outcome and step kind of the contract is streamed, others end the stream', async () => {
    const ends = runEndpoint.values!.endOutcome.map((outcome) => ({
      type: 'end',
      outcome,
      pagesRead: 0,
      message: null,
    }));
    const steps = AGENT_EVENTS.filter((event) => event.type === 'step');

    for (const event of [...ends, ...steps]) {
      expect((await streamed([event])).events).toEqual([event]);
      jest.restoreAllMocks();
    }
    expect(
      sorted(
        steps.map((step) => (step as { label: { kind: string } }).label.kind),
      ),
    ).toEqual(sorted(runEndpoint.values!.stepKind));
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    expect(
      (
        await streamed([
          { type: 'end', outcome: 'cancelled', pagesRead: 0, message: null },
        ])
      ).events,
    ).toEqual([]);
  });

  it('AGENT-AC104: the task length limit of the DTO equals the contract', async () => {
    const errorsFor = (task: string) =>
      validate(plainToInstance(AiAgentRunDto, { spaceId: SPACE_UUID, task }));

    expect(runEndpoint.maxTaskLength).toBe(upstreamEndpoint.maxTaskLength);
    expect(await errorsFor('x'.repeat(runEndpoint.maxTaskLength!))).toEqual([]);
    expect(
      await errorsFor('x'.repeat(runEndpoint.maxTaskLength! + 1)),
    ).not.toEqual([]);
  });

  it('AGENT-AC70: the run call posts the contract request fields with both token headers and passes run_in_progress', async () => {
    const client = new AiServiceClient(
      stub<EnvironmentService>(environmentService),
    );
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ code: 'run_in_progress', message: 'x' }), {
        status: CONTRACT.errors.run_in_progress,
      }),
    );

    await expect(
      client.agentRun(
        'user-token',
        { spaceId: SPACE_ID, task: 'Aufgabe' },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: 'run_in_progress' });

    const [url, init] = fetchSpy.mock.calls[0] as [URL, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(url.pathname).toBe(upstreamEndpoint.path);
    expect(init.method).toBe(upstreamEndpoint.method);
    expect(headers[CONTRACT.headers.serviceTokenHeader.toLowerCase()]).toBe(
      SERVICE_CREDENTIAL,
    );
    expect(headers[CONTRACT.headers.userTokenHeader.toLowerCase()]).toBe(
      'user-token',
    );
    expect(sorted(Object.keys(JSON.parse(String(init.body))))).toEqual(
      sorted(upstreamEndpoint.request),
    );
    expect(upstreamEndpoint.errors).toContain('run_in_progress');
    expect(runEndpoint.errors).toContain('run_in_progress');
  });
});

describe('agent proposal endpoints', () => {
  const viewEndpoint = endpointAt('/api/ai/agent/proposal');
  const getEndpoint = endpointAt('/v1/agent/proposals/get');
  const transitionEndpoint = endpointAt('/v1/agent/proposals/transition');
  const client = () =>
    new AiServiceClient(stub<EnvironmentService>(environmentService));

  afterEach(() => jest.restoreAllMocks());

  it.each([
    [
      '/v1/agent/proposals/get',
      () => client().agentProposal('user-token', STORED_PROPOSAL.id),
    ],
    [
      '/v1/agent/proposals/transition',
      () =>
        client().transitionAgentProposal(
          'user-token',
          STORED_PROPOSAL.id,
          'applying',
        ),
    ],
  ])(
    'AGENT-AC102: %s is posted with the contract request fields and both token headers',
    async (path, call) => {
      const upstream = endpointAt(path);
      const fetchSpy = aiServiceAnswersProposals();

      await call();

      const [url, init] = fetchSpy.mock.calls[0] as [URL, RequestInit];
      const headers = init.headers as Record<string, string>;
      expect(url.pathname).toBe(upstream.path);
      expect(init.method).toBe(upstream.method);
      expect(headers[CONTRACT.headers.serviceTokenHeader.toLowerCase()]).toBe(
        SERVICE_CREDENTIAL,
      );
      expect(headers[CONTRACT.headers.userTokenHeader.toLowerCase()]).toBe(
        'user-token',
      );
      expect(sorted(Object.keys(JSON.parse(String(init.body))))).toEqual(
        sorted(upstream.request),
      );
    },
  );

  it.each(['proposal_not_found', 'proposal_not_open'] as const)(
    'AGENT-AC102: %s from the AI service passes through with the contract status',
    async (code) => {
      expect(getEndpoint.errors).toContain('proposal_not_found');
      expect(transitionEndpoint.errors).toContain(code);
      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ code, message: 'x' }), {
          status: CONTRACT.errors[code],
        }),
      );

      await expect(
        client().transitionAgentProposal('user-token', 'p', 'applying'),
      ).rejects.toMatchObject({ code, status: CONTRACT.errors[code] });
    },
  );

  it.each([
    ['HTTP 500', new Response('{}', { status: 500 })],
    [
      'a 404 with another code',
      new Response(JSON.stringify({ code: 'page_not_found' }), {
        status: 404,
      }),
    ],
    ['a body that is not JSON', new Response('nein', { status: 200 })],
    [
      'a proposal without changes',
      new Response(JSON.stringify({ ...STORED_PROPOSAL, changes: null }), {
        status: 200,
      }),
    ],
    [
      'a change with an unknown op',
      new Response(
        JSON.stringify({
          ...STORED_PROPOSAL,
          changes: [
            { ...STORED_PROPOSAL.changes[0], ops: [{ op: 'move', text: 'x' }] },
          ],
        }),
        { status: 200 },
      ),
    ],
  ])(
    'AGENT-AC88: %s from the AI service is not taken as a proposal',
    async (_case, response) => {
      jest.spyOn(global, 'fetch').mockResolvedValue(response);

      const error = await client()
        .agentProposal('user-token', 'p')
        .then(
          () => undefined,
          (caught: unknown) => caught,
        );

      expect(
        error instanceof AiServiceUnreachableError ||
          error instanceof AiServiceMalformedResponseError,
      ).toBe(true);
    },
  );

  it('AGENT-AC74: the wiki reads only fields the AI service contract lists and shows its statuses without applying', async () => {
    const read = sorted(
      fieldPaths(
        await (async () => {
          aiServiceAnswersProposals();
          return client().agentProposal('user-token', STORED_PROPOSAL.id);
        })(),
      ),
    );

    for (const field of read) {
      expect(getEndpoint.response).toContain(field.split('[]')[0]);
    }
    expect(sorted(viewEndpoint.values!.status)).toEqual(
      sorted(
        getEndpoint.values!.status.filter((status) => status !== 'applying'),
      ),
    );
    expect(sorted(transitionEndpoint.values!.to)).toEqual(
      sorted(getEndpoint.values!.status),
    );
  });

  it('AGENT-AC74: the view answers the contract status values for every stored status', async () => {
    const shown: string[] = [];
    for (const status of getEndpoint.values!.status) {
      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ ...STORED_PROPOSAL, status }), {
          status: 200,
        }),
      );
      const view = await new AiAgentProposalService(
        new AiAgentProposalRecords(
          stub<EnvironmentService>({ isAiBridgeConfigured: () => true }),
          stub<AiTokenService>({ issueUserToken: async () => 'user-token' }),
          client(),
        ),
        stub<AiPageAccessService>(aiPageAccessService),
        new AiLiveDocumentService(
          stub<CollaborationGateway>(collaborationGateway),
        ),
      ).viewProposal(USER, STORED_PROPOSAL.id);
      shown.push(view.status);
      jest.restoreAllMocks();
    }

    expect(sorted([...new Set(shown)])).toEqual(
      sorted(viewEndpoint.values!.status),
    );
  });
});

const EXTRACT_RESULTS: Record<string, AiServiceExtractResult> = {
  extracted: {
    outcome: 'extracted',
    fields: (
      ['parties', 'term', 'noticePeriod', 'value', 'renewal'] as const
    ).map((key) => ({
      key,
      value: 'Wert',
      quote: 'Wert im Vertrag',
      pdfPage: 1,
    })),
  },
  refused: {
    outcome: 'refused',
    reason: 'too_many_pages',
    pageCount: 11,
    fileSize: null,
    characterCount: null,
  },
  failed: { outcome: 'failed', reason: 'model_unavailable' },
};

const fieldsByOutcome = (bodies: unknown[]) =>
  Object.fromEntries(
    bodies.map((body) => [
      (body as { outcome: string }).outcome,
      sorted(fieldPaths(body)),
    ]),
  );

const sortedOutcomes = (outcomes: Record<string, string[]>) =>
  Object.fromEntries(
    Object.entries(outcomes).map(([outcome, fields]) => [
      outcome,
      sorted(fields),
    ]),
  );

describe('extract endpoint', () => {
  const extractEndpoint = endpointAt('/api/ai/extract');

  const served = (extractClient: object) =>
    new AiBridgeController(
      statusService(true, true),
      stub({}),
      new AiExtractService(
        stub<EnvironmentService>({ isAiBridgeConfigured: () => true }),
        stub<AiPageAccessService>(aiPageAccessService),
        stub(attachmentRepo),
        stub<AiTokenService>({ issueUserToken: async () => 'user-token' }),
        stub<AiServiceClient>(extractClient),
      ),
    ).extract(
      { pageId: PAGE_ID, attachmentId: PDF_ATTACHMENT.id },
      USER,
      stub<FastifyReply>({ raw: new EventEmitter() }),
    );

  it('extract contract: every outcome the wiki answers has exactly the fields of the contract', async () => {
    const bodies = await Promise.all(
      Object.values(EXTRACT_RESULTS).map((result) =>
        served({ extract: async () => result }),
      ),
    );

    expect(fieldsByOutcome(bodies)).toEqual(
      sortedOutcomes(extractEndpoint.outcomes!),
    );
    expect(sorted(Object.keys(fieldsByOutcome(bodies)))).toEqual(
      sorted(extractEndpoint.values!.outcome),
    );
  });

  it('EXTRACT-AC67: a timed-out AI service answers the contract failure reason', async () => {
    const body = await served({
      extract: async () => {
        throw new AiServiceTimeoutError('timeout');
      },
    });

    expect(body).toEqual({
      outcome: 'failed',
      reason: extractEndpoint.values!.failedReason[0],
    });
  });

  it('EXTRACT-AC44: the edit denial code is in the contract with status 403', () => {
    expect(extractEndpoint.errors).toContain('page_not_editable');
    expect(CONTRACT.errors.page_not_editable).toBe(403);
  });
});

describe('AI service calls of the bridge', () => {
  const client = new AiServiceClient(
    stub<EnvironmentService>(environmentService),
  );
  let fetchSpy: jest.SpyInstance;

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => fetchSpy.mockRestore());

  const lastRequest = () => {
    const [url, init] = fetchSpy.mock.calls[0];
    return { url: new URL(url), init };
  };

  it('BRIDGE-AC35: the session check posts to the contract path with both token headers', async () => {
    const endpoint = endpointAt('/v1/session');
    fetchSpy.mockResolvedValue(new Response('{}', { status: endpoint.status }));

    await expect(client.checkSession('user-token')).resolves.toBe(true);

    const { url, init } = lastRequest();
    expect(url.pathname).toBe(endpoint.path);
    expect(init.method).toBe(endpoint.method);
    expect(Object.keys(init.headers).sort()).toEqual(
      [CONTRACT.headers.serviceTokenHeader, CONTRACT.headers.userTokenHeader]
        .map((name) => name.toLowerCase())
        .sort(),
    );
    expect(init.body).toBeUndefined();
  });

  it('BRIDGE-AC35: the job post uses the contract path, status and request fields', async () => {
    const endpoint = endpointAt('/v1/jobs');
    fetchSpy.mockResolvedValue(new Response('{}', { status: endpoint.status }));

    await client.enqueueJob('page-created', { pageIds: ['p'] });

    const { url, init } = lastRequest();
    expect(url.pathname).toBe(endpoint.path);
    expect(init.method).toBe(endpoint.method);
    expect(
      init.headers[CONTRACT.headers.serviceTokenHeader.toLowerCase()],
    ).toBe(SERVICE_CREDENTIAL);
    expect(sorted(Object.keys(JSON.parse(init.body)))).toEqual(
      sorted(endpoint.request),
    );
    expect(sorted(endpoint.request)).toEqual(sorted(CONTRACT.jobs.body));
  });

  it('BRIDGE-AC35: the ask call posts the contract request fields with both token headers and reads NDJSON', async () => {
    const endpoint = endpointAt('/v1/ask');
    fetchSpy.mockResolvedValue(
      new Response('{"type":"no_source"}\n', {
        status: endpoint.status,
        headers: { 'content-type': endpoint.responseContentType! },
      }),
    );

    const events = await client.ask(
      'user-token',
      {
        question: 'Frage',
        conversationId: 'conversation-1',
        spaceId: SPACE_ID,
        pageId: PAGE_ID,
      },
      new AbortController().signal,
    );
    const received: AiServiceAskEvent[] = [];
    for await (const event of events) received.push(event);

    expect(received).toEqual([{ type: 'no_source' }]);
    const { url, init } = lastRequest();
    expect(url.pathname).toBe(endpoint.path);
    expect(init.method).toBe(endpoint.method);
    expect(
      init.headers[CONTRACT.headers.serviceTokenHeader.toLowerCase()],
    ).toBe(SERVICE_CREDENTIAL);
    expect(init.headers[CONTRACT.headers.userTokenHeader.toLowerCase()]).toBe(
      'user-token',
    );
    expect(sorted(Object.keys(JSON.parse(init.body)))).toEqual(
      sorted(endpoint.request),
    );
  });

  it('ASK-AC56: the turn confirmation posts the contract request fields with both token headers', async () => {
    const endpoint = endpointAt('/v1/conversations/confirm');
    fetchSpy.mockResolvedValue(new Response(null, { status: endpoint.status }));

    await client.confirmTurn('user-token', {
      conversationId: 'conversation-1',
      turnId: 'turn-1',
    });

    const { url, init } = lastRequest();
    expect(url.pathname).toBe(endpoint.path);
    expect(init.method).toBe(endpoint.method);
    expect(
      init.headers[CONTRACT.headers.serviceTokenHeader.toLowerCase()],
    ).toBe(SERVICE_CREDENTIAL);
    expect(init.headers[CONTRACT.headers.userTokenHeader.toLowerCase()]).toBe(
      'user-token',
    );
    expect(sorted(Object.keys(JSON.parse(init.body)))).toEqual(
      sorted(endpoint.request),
    );
  });

  it('ASK-AC56: a turn confirmation answered with another status fails', async () => {
    const endpoint = endpointAt('/v1/conversations/confirm');
    fetchSpy.mockResolvedValue(new Response('{}', { status: 200 }));

    await expect(
      client.confirmTurn('user-token', {
        conversationId: 'conversation-1',
        turnId: 'turn-1',
      }),
    ).rejects.toThrow('AI service answered HTTP 200');
    expect(endpoint.status).toBe(204);
  });

  it('ASK-AC56: a citations event without the contract turn id is malformed', async () => {
    const endpoint = endpointAt('/v1/ask');
    expect(endpoint.events!.citations).toContain('turnId');
    fetchSpy.mockResolvedValue(
      new Response(
        `${JSON.stringify({ type: 'citations', citations: [] })}\n`,
        { status: endpoint.status },
      ),
    );

    const events = await client.ask(
      'user-token',
      { question: 'Frage', conversationId: 'conversation-1' },
      new AbortController().signal,
    );

    await expect(events.next()).rejects.toThrow('malformed ask event');
  });

  it('extract contract: the extract call posts the contract request fields with both token headers', async () => {
    const endpoint = endpointAt('/v1/extract');
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify(EXTRACT_RESULTS.failed), {
        status: endpoint.status,
      }),
    );

    await client.extract(
      'user-token',
      { attachmentId: 'att-1', fileSize: 2048 },
      new AbortController().signal,
    );

    const { url, init } = lastRequest();
    expect(url.pathname).toBe(endpoint.path);
    expect(init.method).toBe(endpoint.method);
    expect(
      init.headers[CONTRACT.headers.serviceTokenHeader.toLowerCase()],
    ).toBe(SERVICE_CREDENTIAL);
    expect(init.headers[CONTRACT.headers.userTokenHeader.toLowerCase()]).toBe(
      'user-token',
    );
    expect(sorted(Object.keys(JSON.parse(init.body)))).toEqual(
      sorted(endpoint.request),
    );
  });

  it('extract contract: the bridge reads every contract outcome of /v1/extract with exactly its fields', async () => {
    const endpoint = endpointAt('/v1/extract');
    const read: unknown[] = [];
    for (const result of Object.values(EXTRACT_RESULTS)) {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(result), { status: endpoint.status }),
      );
      read.push(
        await client.extract(
          'user-token',
          { attachmentId: 'att-1', fileSize: 2048 },
          new AbortController().signal,
        ),
      );
    }

    expect(fieldsByOutcome(read)).toEqual(sortedOutcomes(endpoint.outcomes!));
  });

  it('extract contract: the bridge accepts exactly the contract field keys and reasons of /v1/extract', async () => {
    const endpoint = endpointAt('/v1/extract');
    const extractAnswering = async (body: object) => {
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify(body), { status: endpoint.status }),
      );
      return client
        .extract(
          'user-token',
          { attachmentId: 'att-1', fileSize: 2048 },
          new AbortController().signal,
        )
        .then(
          () => true,
          () => false,
        );
    };
    const extracted = EXTRACT_RESULTS.extracted as {
      fields: { key: string }[];
    };

    expect(extracted.fields.map((field) => field.key)).toEqual(
      endpoint.values!.fieldKey,
    );
    for (const reason of endpoint.values!.refusedReason) {
      expect(
        await extractAnswering({ ...EXTRACT_RESULTS.refused, reason }),
      ).toBe(true);
    }
    for (const reason of endpoint.values!.failedReason) {
      expect(await extractAnswering({ outcome: 'failed', reason })).toBe(true);
    }
    expect(
      await extractAnswering({ ...EXTRACT_RESULTS.refused, reason: 'other' }),
    ).toBe(false);
    expect(await extractAnswering({ outcome: 'failed', reason: 'other' })).toBe(
      false,
    );
  });

  it('BRIDGE-AC35: any other status than the contract status is a failed forward', async () => {
    const endpoint = endpointAt('/v1/jobs');
    fetchSpy.mockResolvedValue(
      new Response('{}', { status: endpoint.status + 1 }),
    );

    await expect(client.enqueueJob('page-created', {})).rejects.toThrow(
      `AI service answered HTTP ${endpoint.status + 1}`,
    );
  });
});

describe('tokens', () => {
  const decodeComplete = (token: string) =>
    jwtService.decode(token, { complete: true }) as {
      header: { alg: string };
      payload: Record<string, unknown> & { iat: number; exp: number };
    };

  it('BRIDGE-AC36: a user token carries exactly the contract claims, audience, type, algorithm and lifetime', async () => {
    const token = await aiTokenService.issueUserToken(USER);

    const { header, payload } = decodeComplete(token);
    expect(sorted(Object.keys(payload))).toEqual(
      sorted(CONTRACT.tokens.user.claims),
    );
    expect(header.alg).toBe(CONTRACT.tokens.algorithm);
    expect(payload.aud).toBe(CONTRACT.tokens.user.aud);
    expect(payload.type).toBe(CONTRACT.tokens.user.type);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(
      CONTRACT.tokens.user.maxLifetimeSeconds,
    );
  });

  it('BRIDGE-AC36: a task token carries exactly the contract claims, audience, type, algorithm and lifetime', async () => {
    const { taskToken } = await aiTokenService.issueTaskToken(USER, 'run-1');

    const { header, payload } = decodeComplete(taskToken);
    expect(sorted(Object.keys(payload))).toEqual(
      sorted(CONTRACT.tokens.task.claims),
    );
    expect(header.alg).toBe(CONTRACT.tokens.algorithm);
    expect(payload.aud).toBe(CONTRACT.tokens.task.aud);
    expect(payload.type).toBe(CONTRACT.tokens.task.type);
    expect(payload.exp - payload.iat).toBeLessThanOrEqual(
      CONTRACT.tokens.task.maxLifetimeSeconds,
    );
  });
});

describe('forwarded jobs', () => {
  const FULL_DATA = {
    pageIds: ['page-1'],
    spaceId: SPACE_ID,
    workspaceId: WORKSPACE_ID,
    content: 'secret page text',
    userId: 'user-1',
  };
  const aiServiceClient = { enqueueJob: jest.fn() };
  const processor = new AiQueueProcessor(
    stub<EnvironmentService>(environmentService),
    stub<AiServiceClient>(aiServiceClient),
  );
  const jobOf = (name: string) => stub<Job>({ name, data: FULL_DATA });

  beforeEach(() => {
    environmentService.isAiBridgeConfigured.mockReturnValue(true);
    aiServiceClient.enqueueJob.mockResolvedValue(undefined);
  });

  it.each(Object.entries(CONTRACT.jobs.forwarded))(
    'BRIDGE-AC36: %s is forwarded under its name with exactly the contract fields',
    async (name, fields) => {
      await processor.process(jobOf(name));

      const [forwardedName, data] = aiServiceClient.enqueueJob.mock.calls[0];
      expect(forwardedName).toBe(name);
      expect(sorted(Object.keys(data))).toEqual(sorted(fields));
    },
  );

  it('BRIDGE-AC36: every other queue job name is dropped', async () => {
    const others = Object.values(QueueJob).filter(
      (name) => !(name in CONTRACT.jobs.forwarded),
    );

    for (const name of others) await processor.process(jobOf(name));

    expect(others.length).toBeGreaterThan(0);
    expect(aiServiceClient.enqueueJob).not.toHaveBeenCalled();
  });
});
