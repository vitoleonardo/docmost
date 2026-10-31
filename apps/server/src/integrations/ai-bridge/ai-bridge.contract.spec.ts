import { stub } from './test-stub';
import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RequestMethod } from '@nestjs/common';
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
import { AiBridgeController } from './ai-bridge.controller';
import { AiBridgeInternalController } from './ai-bridge-internal.controller';
import { AiQueueProcessor } from './ai-queue.processor';
import { AI_BRIDGE_USER_TOKEN_KEY } from './decorators/ai-bridge-auth.decorator';
import { AiAskDto } from './dto/ai-ask.dto';
import { AiAskService } from './services/ai-ask.service';
import { AiInternalAuthGuard } from './guards/ai-internal-auth.guard';
import { AiContentService } from './services/ai-content.service';
import { AiPageAccessService } from './services/ai-page-access.service';
import { AiPageListService } from './services/ai-page-list.service';
import {
  AiServiceAskEvent,
  AiServiceClient,
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
  values?: Record<string, string[]>;
  maxQuestionLength?: number;
  status: number;
  errors: string[];
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

const CONTROLLERS = [AiBridgeController, AiBridgeInternalController];

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
};
const pageRepo = { findById: jest.fn() };
const spaceRepo = { findById: jest.fn() };
const aiPageListRepo = { listIndexablePages: jest.fn() };
const attachmentRepo = { findById: jest.fn(), findPageAttachments: jest.fn() };
const storageService = { readStream: jest.fn() };
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

const RESPONSE_BODIES: Record<string, () => Promise<unknown>> = {
  '/api/ai/status': () =>
    new AiBridgeController(statusService(true, true), stub({})).status(USER),
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
};

beforeEach(() => {
  jest.resetAllMocks();
  environmentService.getAiBridgeSecret.mockReturnValue(BRIDGE_KEY);
  environmentService.getAiServiceToken.mockReturnValue(SERVICE_CREDENTIAL);
  environmentService.getAiServiceUrl.mockReturnValue('http://127.0.0.1:8100');
  aiPageAccessService.readableSpaceIds.mockResolvedValue([SPACE_ID]);
  aiPageAccessService.filterViewablePageIds.mockResolvedValue([PAGE_ID]);
  aiPageAccessService.findViewablePage.mockResolvedValue(PAGE);
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
        endpoint.responseType === 'sse'
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
    for (const endpoint of SERVED_ENDPOINTS) {
      const guarded =
        endpoint.side === 'bridge'
          ? endpoint.auth.includes('service')
          : endpoint.auth.includes('session');
      expect(guarded).toBe(true);
    }
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
        new AiBridgeController(service, stub({})).status(USER),
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

    await new AiBridgeController(statusService(true, true), askService).ask(
      { question: 'Frage', conversationId: CONVERSATION_ID },
      USER,
      reply,
    );

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
    expect(init.headers[CONTRACT.headers.serviceTokenHeader.toLowerCase()]).toBe(
      SERVICE_CREDENTIAL,
    );
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
