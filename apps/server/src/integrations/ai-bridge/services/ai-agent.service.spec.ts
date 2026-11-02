import { stub } from '../test-stub';
import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http';
import { AddressInfo } from 'node:net';
import {
  ArgumentsHost,
  BadRequestException,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import {
  EXCEPTION_FILTERS_METADATA,
  GUARDS_METADATA,
} from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { FastifyReply } from 'fastify';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { Space, User } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../../../core/page/page-access/page-access.service';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { EnvironmentService } from '../../environment/environment.service';
import { AiAgentController } from '../ai-agent.controller';
import { AiBridgeError } from '../ai-bridge.errors';
import { AiAgentRunDto } from '../dto/ai-agent.dto';
import { AiBridgeExceptionFilter } from '../filters/ai-bridge-exception.filter';
import { KnownBodyFieldsGuard } from '../guards/known-body-fields.guard';
import { AiAgentProposalService } from './ai-agent-proposal.service';
import { AiAgentService } from './ai-agent.service';
import { AiPageAccessService } from './ai-page-access.service';
import { AiServiceAgentEvent, AiServiceClient } from './ai-service.client';
import { AiTokenService } from './ai-token.service';

const WORKSPACE_ID = 'workspace-1';
const USER = { id: 'user-1', workspaceId: WORKSPACE_ID } as User;
const SERVICE_CREDENTIAL = 'test-service-token-0123456789abcdef';
const USER_CREDENTIAL = 'test-user-token';
const SPACE_ALLG = '0b7c5e8a-0000-4000-8000-000000000002';
const SPACE_FOREIGN = '0b7c5e8a-0000-4000-8000-000000000003';
const SPACE_DELETED = '0b7c5e8a-0000-4000-8000-000000000004';
const SPACE_MISSING = '0b7c5e8a-0000-4000-8000-000000000005';
const RUN_ID = '3e4f5a6b-0000-4000-8000-000000000001';
const PROPOSAL_ID = '4f5a6b7c-0000-4000-8000-000000000001';
const PAGE_ID = '1c2d3e4f-0000-4000-8000-000000000001';
const TASK = 'Finde veraltete Seiten zu Reisekosten';
const RUN_PATH = '/v1/agent/runs';

interface RecordedRequest {
  url?: string;
  method?: string;
  headers: IncomingMessage['headers'];
  body: string;
  closedEarly: boolean;
}

type Upstream = (request: IncomingMessage, response: ServerResponse) => void;

const ndjson = (...events: object[]) =>
  events.map((event) => `${JSON.stringify(event)}\n`).join('');

const RUN_EVENT = { type: 'run', runId: RUN_ID };
const SEARCH_STEP = {
  type: 'step',
  steps: 1,
  label: { kind: 'search', query: 'Reisekosten', count: 2 },
};
const READ_STEP = {
  type: 'step',
  steps: 2,
  label: { kind: 'read', title: 'Reisekosten Richtlinie 2022' },
};
const PROPOSE_STEP = {
  type: 'step',
  steps: 3,
  label: { kind: 'propose', title: 'Reisekosten Richtlinie 2022' },
};
const REFUSED_STEP = { type: 'step', steps: 4, label: { kind: 'refused' } };
const PROPOSAL_EVENT = {
  type: 'proposal',
  proposal: {
    id: PROPOSAL_ID,
    pageId: PAGE_ID,
    pageTitle: 'Reisekosten Richtlinie 2022',
    reason: 'Die Pauschale ist veraltet.',
    added: 3,
    removed: 3,
  },
};
const END_EVENT = {
  type: 'end',
  outcome: 'finished',
  pagesRead: 1,
  message: 'Eine Seite ist veraltet.',
};

describe('AiAgentService', () => {
  let server: Server;
  let baseUrl: string;
  let url: string;
  let upstream: Upstream;
  let requests: RecordedRequest[];
  let configured: boolean;
  let memberSpaceIds: string[];
  let spaces: { id: string; deleted?: boolean }[];

  const spaceRepo = {
    findById: async (spaceId: string, workspaceId: string) => {
      const space = spaces.find((entry) => entry.id === spaceId);
      if (!space || workspaceId !== WORKSPACE_ID) return undefined;
      return {
        id: space.id,
        workspaceId,
        deletedAt: space.deleted ? new Date() : null,
      } as Space;
    },
  };
  const accessService = new AiPageAccessService(
    stub<SpaceMemberRepo>({ getUserSpaceIds: async () => [...memberSpaceIds] }),
    stub<SpaceRepo>(spaceRepo),
    stub<PageRepo>({}),
    stub<PagePermissionRepo>({}),
    stub<PageAccessService>({}),
  );
  const environmentService = stub<EnvironmentService>({
    isAiBridgeConfigured: () => configured,
    getAiServiceUrl: () => url,
    getAiServiceToken: () => SERVICE_CREDENTIAL,
  });
  const service = new AiAgentService(
    environmentService,
    stub<AiTokenService>({ issueUserToken: async () => USER_CREDENTIAL }),
    new AiServiceClient(environmentService),
    accessService,
  );

  const streamWith = (body: string): Upstream => {
    return (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/x-ndjson' });
      response.end(body);
    };
  };

  const refuseWith = (status: number, code: string): Upstream => {
    return (_request, response) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ code, message: 'refused' }));
    };
  };

  const run = (overrides: Partial<AiAgentRunDto> = {}, signal?: AbortSignal) =>
    service.run(
      USER,
      { spaceId: SPACE_ALLG, task: TASK, ...overrides },
      signal ?? new AbortController().signal,
    );

  const collect = async (events: AsyncIterable<AiServiceAgentEvent> | null) => {
    const received: AiServiceAgentEvent[] = [];
    for await (const event of events ?? []) received.push(event);
    return received;
  };

  const runAndCollect = async () => collect(await run());

  const rejectionOf = async (promise: Promise<unknown>) => {
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

  const closedPortUrl = async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise((resolve) => probe.close(resolve));
    return `http://127.0.0.1:${port}`;
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const recorded: RecordedRequest = {
          url: req.url,
          method: req.method,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          closedEarly: false,
        };
        requests.push(recorded);
        res.on('close', () => {
          recorded.closedEarly = !res.writableFinished;
        });
        upstream(req, res);
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    url = baseUrl;
    requests = [];
    configured = true;
    memberSpaceIds = [SPACE_ALLG, SPACE_DELETED];
    spaces = [
      { id: SPACE_ALLG },
      { id: SPACE_FOREIGN },
      { id: SPACE_DELETED, deleted: true },
    ];
    upstream = streamWith(ndjson(RUN_EVENT, END_EVENT));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('request validation', () => {
    const errorsFor = (body: Record<string, unknown>) =>
      validate(plainToInstance(AiAgentRunDto, body), { whitelist: true });

    const answerOf = (body: Record<string, unknown>) =>
      validationAnswerOf(body, AiAgentRunDto);

    it('AGENT-AC104: accepts a space id and a task of 1 to 2,000 characters after trimming', async () => {
      expect(await errorsFor({ spaceId: SPACE_ALLG, task: '  x  ' })).toEqual(
        [],
      );
      expect(
        await errorsFor({
          spaceId: SPACE_ALLG.toUpperCase(),
          task: `  ${'x'.repeat(2000)}  `,
        }),
      ).toEqual([]);
    });

    it('AGENT-AC104: trims the task and lowercases the space id', async () => {
      const dto = (await pipeline.transform(
        { spaceId: SPACE_ALLG.toUpperCase(), task: `  ${TASK}\n` },
        { type: 'body', metatype: AiAgentRunDto },
      )) as AiAgentRunDto;

      expect({ ...dto }).toEqual({ spaceId: SPACE_ALLG, task: TASK });
    });

    it.each([
      ['a missing space id', { spaceId: undefined }],
      ['a malformed space id', { spaceId: 'space-1' }],
      ['a space id that is not a string', { spaceId: 42 }],
      ['a task of 2,001 characters', { task: 'x'.repeat(2001) }],
      ['a whitespace-only task', { task: ' \n\t ' }],
      ['an empty task', { task: '' }],
      ['a missing task', { task: undefined }],
      ['a task that is not a string', { task: ['Aufgabe'] }],
    ])(
      'AGENT-AC104: %s answers 400 invalid_request',
      async (_case, overrides) => {
        const body = { spaceId: SPACE_ALLG, task: TASK, ...overrides };

        expect(await errorsFor(body)).not.toEqual([]);
        expect(await answerOf(body)).toEqual({
          status: 400,
          body: expect.objectContaining({ code: 'invalid_request' }),
        });
      },
    );
  });

  describe('checks before the stream', () => {
    it('AGENT-AC107: a switched-off assistant answers 503 assistant_disabled and calls nothing', async () => {
      configured = false;

      expect(await rejectionOf(run())).toEqual({
        code: 'assistant_disabled',
        status: 503,
      });
      expect(requests).toHaveLength(0);
    });

    it.each([
      ['a space the user is not a member of', SPACE_FOREIGN],
      ['a space marked as deleted', SPACE_DELETED],
      ['a space id that does not exist', SPACE_MISSING],
    ])(
      'AGENT-AC103: %s answers 404 space_not_found and the AI service is not called',
      async (_case, spaceId) => {
        expect(await rejectionOf(run({ spaceId }))).toEqual({
          code: 'space_not_found',
          status: 404,
        });
        expect(requests).toHaveLength(0);
      },
    );

    it('AGENT-AC103: a space the user was removed from answers 404 space_not_found', async () => {
      memberSpaceIds = [];

      expect(await rejectionOf(run())).toEqual({
        code: 'space_not_found',
        status: 404,
      });
      expect(requests).toHaveLength(0);
    });

    it('AGENT-AC69: a refused connection answers 503 assistant_unavailable', async () => {
      url = await closedPortUrl();

      expect(await rejectionOf(run())).toEqual({
        code: 'assistant_unavailable',
        status: 503,
      });
    });

    it.each([
      [500, 'internal'],
      [503, 'assistant_unavailable'],
      [401, 'user_token_expired'],
      [400, 'invalid_request'],
    ])(
      'AGENT-AC69: HTTP %i (%s) from the AI service answers 503 assistant_unavailable',
      async (status, code) => {
        upstream = refuseWith(status, code);

        expect(await rejectionOf(run())).toEqual({
          code: 'assistant_unavailable',
          status: 503,
        });
      },
    );

    it('AGENT-AC69: an AI service that sends no response head within the timeout answers 503 assistant_unavailable', async () => {
      upstream = () => undefined;
      const started = Date.now();

      expect(await rejectionOf(run())).toEqual({
        code: 'assistant_unavailable',
        status: 503,
      });
      expect(Date.now() - started).toBeLessThan(5000);
      await waitUntil(() => requests[0]?.closedEarly);
    }, 10_000);

    it('AGENT-AC70: run_in_progress from the AI service answers 409 run_in_progress', async () => {
      upstream = refuseWith(409, 'run_in_progress');

      expect(await rejectionOf(run())).toEqual({
        code: 'run_in_progress',
        status: 409,
      });
    });

    it('AGENT-AC70: a 409 with another code answers 503 assistant_unavailable', async () => {
      upstream = refuseWith(409, 'proposal_not_open');

      expect(await rejectionOf(run())).toEqual({
        code: 'assistant_unavailable',
        status: 503,
      });
    });

    it('AGENT-AC104: sends exactly the space id and the task with both tokens to POST /v1/agent/runs', async () => {
      await runAndCollect();

      expect(requests).toHaveLength(1);
      const [request] = requests;
      expect(request.method).toBe('POST');
      expect(request.url).toBe(RUN_PATH);
      expect(request.headers['x-service-token']).toBe(SERVICE_CREDENTIAL);
      expect(request.headers['x-user-token']).toBe(USER_CREDENTIAL);
      expect(request.headers['content-type']).toBe('application/json');
      expect(JSON.parse(request.body)).toEqual({
        spaceId: SPACE_ALLG,
        task: TASK,
      });
    });

    it('AGENT-AC65: a client that leaves before the AI service answers ends quietly', async () => {
      const abort = new AbortController();
      upstream = () => abort.abort();

      await expect(run({}, abort.signal)).resolves.toBeNull();
    });

    it('AGENT-AC65: a client that left before the request is sent ends quietly', async () => {
      const abort = new AbortController();
      abort.abort();

      await expect(run({}, abort.signal)).resolves.toBeNull();
    });
  });

  describe('events', () => {
    it('AGENT-AC17: relays the run, step, proposal and end events in their order', async () => {
      upstream = streamWith(
        ndjson(
          RUN_EVENT,
          SEARCH_STEP,
          READ_STEP,
          PROPOSE_STEP,
          PROPOSAL_EVENT,
          REFUSED_STEP,
          END_EVENT,
        ),
      );

      expect(await runAndCollect()).toEqual([
        RUN_EVENT,
        SEARCH_STEP,
        READ_STEP,
        PROPOSE_STEP,
        PROPOSAL_EVENT,
        REFUSED_STEP,
        END_EVENT,
      ]);
    });

    it.each([
      'out_of_scope',
      'step_limit',
      'time_limit',
      'token_limit',
      'context_too_small',
      'model_failed',
    ])('AGENT-AC59: relays an end with outcome %s', async (outcome) => {
      const end = { type: 'end', outcome, pagesRead: 0, message: null };
      upstream = streamWith(ndjson(RUN_EVENT, end));

      expect(await runAndCollect()).toEqual([RUN_EVENT, end]);
    });

    it('AGENT-AC17: relays only the fields of the contract', async () => {
      upstream = streamWith(
        ndjson(
          { ...RUN_EVENT, userId: 'user-1' },
          { ...READ_STEP, label: { ...READ_STEP.label, pageId: PAGE_ID } },
          {
            ...PROPOSAL_EVENT,
            proposal: { ...PROPOSAL_EVENT.proposal, fingerprint: 'f' },
          },
          { ...END_EVENT, tokens: 123 },
        ),
      );

      expect(await runAndCollect()).toEqual([
        RUN_EVENT,
        READ_STEP,
        PROPOSAL_EVENT,
        END_EVENT,
      ]);
    });

    it('AGENT-AC64: a stream that ends without an end event ends without one', async () => {
      upstream = streamWith(ndjson(RUN_EVENT, PROPOSAL_EVENT));

      expect(await runAndCollect()).toEqual([RUN_EVENT, PROPOSAL_EVENT]);
    });

    it('AGENT-AC67: a line that is not JSON ends the stream without an end event and is logged without its content', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn');
      upstream = streamWith(
        `${ndjson(RUN_EVENT)}Geheime Seite\n${ndjson(END_EVENT)}`,
      );

      expect(await runAndCollect()).toEqual([RUN_EVENT]);
      const logged = warn.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(logged).toContain('not JSON');
      expect(logged).not.toContain('Geheim');
    });

    it.each([
      ['an unknown event type', { type: 'delta', text: 'x' }],
      [
        'a step with an unknown label kind',
        { ...READ_STEP, label: { kind: 'write' } },
      ],
      [
        'a step without a count',
        { ...SEARCH_STEP, label: { kind: 'search', query: 'q' } },
      ],
      ['a step count that is not a number', { ...READ_STEP, steps: '2' }],
      [
        'a proposal without a reason',
        {
          type: 'proposal',
          proposal: { ...PROPOSAL_EVENT.proposal, reason: undefined },
        },
      ],
      [
        'an end with an unknown outcome',
        { ...END_EVENT, outcome: 'cancelled' },
      ],
      ['an end without pagesRead', { ...END_EVENT, pagesRead: undefined }],
      ['a run without a run id', { type: 'run' }],
      ['an array', [RUN_EVENT]],
    ])(
      'AGENT-AC67: %s ends the stream without an end event',
      async (_case, malformed) => {
        jest
          .spyOn(Logger.prototype, 'warn')
          .mockImplementation(() => undefined);
        upstream = streamWith(ndjson(RUN_EVENT, malformed, END_EVENT));

        expect(await runAndCollect()).toEqual([RUN_EVENT]);
      },
    );

    it('AGENT-AC67: a body that breaks off ends the stream without an end event', async () => {
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      upstream = (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/x-ndjson' });
        response.write(ndjson(RUN_EVENT, SEARCH_STEP));
        setTimeout(() => response.destroy(), 20);
      };

      expect(await runAndCollect()).toEqual([RUN_EVENT, SEARCH_STEP]);
    });

    it('AGENT-AC64: aborting the request closes the AI service request and sends no further event', async () => {
      upstream = (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/x-ndjson' });
        response.write(ndjson(RUN_EVENT));
      };
      const abort = new AbortController();
      const warn = jest.spyOn(Logger.prototype, 'warn');
      const events = await run({}, abort.signal);
      const iterator = events![Symbol.asyncIterator]();

      expect((await iterator.next()).value).toEqual(RUN_EVENT);
      abort.abort();
      const rest = await iterator.next();

      expect(rest.done).toBe(true);
      await waitUntil(() => requests[0].closedEarly);
      expect(warn).not.toHaveBeenCalled();
    });

    it('AGENT-AC64: a long run is not cut off by the head timeout', async () => {
      upstream = (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/x-ndjson' });
        response.write(ndjson(RUN_EVENT));
        setTimeout(() => response.end(ndjson(END_EVENT)), 3500);
      };

      expect(await runAndCollect()).toEqual([RUN_EVENT, END_EVENT]);
    }, 10_000);
  });
});

describe('AiAgentController.agentRun', () => {
  const DTO = { spaceId: SPACE_ALLG, task: TASK };

  const sseReply = () => {
    const raw = Object.assign(new EventEmitter(), {
      setHeader: jest.fn(),
      writeHead: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
    });
    const reply = stub<FastifyReply>({
      raw,
      hijack: jest.fn(),
      getHeaders: () => ({ 'x-request-id': 'r-1' }),
    });
    return { raw, reply };
  };

  const controllerWith = (agentService: object) =>
    new AiAgentController(
      stub<AiAgentService>(agentService),
      stub<AiAgentProposalService>({}),
    );

  it('AGENT-AC17: writes each event as one server-sent event and ends the response', async () => {
    const { raw, reply } = sseReply();
    const controller = controllerWith({
      run: async function* () {
        yield RUN_EVENT;
        yield END_EVENT;
      },
    });

    await controller.agentRun(DTO, USER, reply);

    expect(raw.setHeader).toHaveBeenCalledWith('x-request-id', 'r-1');
    expect(raw.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
      }),
    );
    expect(raw.write.mock.calls.map(([frame]) => frame)).toEqual([
      `data: ${JSON.stringify(RUN_EVENT)}\n\n`,
      `data: ${JSON.stringify(END_EVENT)}\n\n`,
    ]);
    expect(raw.end).toHaveBeenCalledTimes(1);
  });

  it('AGENT-AC64: closing the client connection aborts the signal passed to the service', async () => {
    const { raw, reply } = sseReply();
    let seen: AbortSignal | undefined;
    const controller = controllerWith({
      run: async (_user: User, dto: AiAgentRunDto, signal: AbortSignal) => {
        expect(dto).toEqual(DTO);
        seen = signal;
        return (async function* () {
          yield RUN_EVENT;
          raw.emit('close');
        })();
      },
    });

    await controller.agentRun(DTO, USER, reply);

    expect(seen?.aborted).toBe(true);
  });

  it('AGENT-AC65: a client that left before the stream gets nothing written', async () => {
    const { raw, reply } = sseReply();
    const controller = controllerWith({ run: async () => null });

    await controller.agentRun(DTO, USER, reply);

    expect(raw.writeHead).not.toHaveBeenCalled();
    expect(raw.write).not.toHaveBeenCalled();
    expect(raw.end).not.toHaveBeenCalled();
  });

  it.each([
    ['assistant_disabled', 503],
    ['space_not_found', 404],
    ['run_in_progress', 409],
    ['assistant_unavailable', 503],
  ] as const)(
    'AGENT-AC107: %s is thrown before any header is written',
    async (code, status) => {
      const { raw, reply } = sseReply();
      const controller = controllerWith({
        run: async () => {
          throw new AiBridgeError(code, 'refused');
        },
      });

      await expect(controller.agentRun(DTO, USER, reply)).rejects.toMatchObject(
        { code, status },
      );
      expect(raw.writeHead).not.toHaveBeenCalled();
      expect(reply.hijack).not.toHaveBeenCalled();
    },
  );

  it('AGENT-AC106: the run route sits behind the session guard of the controller, then the body field guard and the bridge filter', () => {
    const handler = AiAgentController.prototype.agentRun;

    expect(Reflect.getMetadata(GUARDS_METADATA, AiAgentController)).toEqual([
      JwtAuthGuard,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      KnownBodyFieldsGuard,
    ]);
    expect(Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, handler)).toEqual([
      AiBridgeExceptionFilter,
    ]);
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

async function waitUntil(condition: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
