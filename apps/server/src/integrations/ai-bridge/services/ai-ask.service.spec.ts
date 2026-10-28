import { stub } from '../test-stub';
import { EventEmitter } from 'node:events';
import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from 'node:http';
import { AddressInfo } from 'node:net';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Logger } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { Page, Space, User } from '@docmost/db/types/entity.types';
import { EnvironmentService } from '../../environment/environment.service';
import { AiBridgeController } from '../ai-bridge.controller';
import { AiBridgeError } from '../ai-bridge.errors';
import { AiAskDto } from '../dto/ai-ask.dto';
import { AiAskEvent, AiAskService } from './ai-ask.service';
import { AiPageAccessService } from './ai-page-access.service';
import { AiServiceClient } from './ai-service.client';
import { AiStatusService } from './ai-status.service';
import { AiTokenService } from './ai-token.service';

const WORKSPACE_ID = 'workspace-1';
const USER = { id: 'user-1', workspaceId: WORKSPACE_ID } as User;
const SERVICE_CREDENTIAL = 'test-service-token-0123456789abcdef';
const USER_CREDENTIAL = 'test-user-token';
const CONVERSATION_ID = '6f1c2b8e-1d2a-4c3b-9e4f-5a6b7c8d9e0f';
const SPACE_GF = '0b7c5e8a-0000-4000-8000-000000000001';
const SPACE_ALLG = '0b7c5e8a-0000-4000-8000-000000000002';
const SPACE_FOREIGN = '0b7c5e8a-0000-4000-8000-000000000003';
const SPACE_DELETED = '0b7c5e8a-0000-4000-8000-000000000004';
const SPACE_MISSING = '0b7c5e8a-0000-4000-8000-000000000005';
const PAGE_BANDS = '1c2d3e4f-0000-4000-8000-000000000001';
const PAGE_NESTED = '1c2d3e4f-0000-4000-8000-000000000002';
const PAGE_RESTRICTED = '1c2d3e4f-0000-4000-8000-000000000003';
const PAGE_TRASHED = '1c2d3e4f-0000-4000-8000-000000000004';
const PAGE_MISSING = '1c2d3e4f-0000-4000-8000-000000000005';
const TURN_ID = '2d3e4f5a-0000-4000-8000-000000000001';
const CONFIRM_PATH = '/v1/conversations/confirm';

type Json = Record<string, unknown>;

const heading = (level: number, id: string, text: string, marks?: Json[]) => ({
  type: 'heading',
  attrs: { id, level },
  content: [{ type: 'text', text, ...(marks ? { marks } : {}) }],
});
const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

const BANDS_CONTENT = {
  type: 'doc',
  content: [
    heading(1, 'h-intro', 'Einleitung'),
    heading(2, 'h-intro-bands', 'Bänder'),
    paragraph('Vorwort'),
    heading(1, 'h-bands', 'Bänder'),
    paragraph('75.000'),
    heading(1, 'h-bold', 'Wichtig', [{ type: 'bold' }]),
  ],
};

const NESTED_CONTENT = {
  type: 'doc',
  content: [
    heading(1, 'h-b-top', 'B'),
    heading(1, 'h-a', 'A'),
    paragraph('Text'),
    heading(2, 'h-a-b', 'B'),
    heading(2, 'h-a-b-second', 'B'),
  ],
};

interface StoredPage {
  id: string;
  spaceId: string;
  title: string;
  slugId: string;
  content: Json;
  trashed?: boolean;
}

interface StoredSpace {
  id: string;
  name: string;
  slug: string;
  deleted?: boolean;
}

interface RecordedRequest {
  url?: string;
  headers: IncomingMessage['headers'];
  body: string;
  closedEarly: boolean;
}

type Upstream = (
  request: IncomingMessage,
  response: ServerResponse,
  recorded: RecordedRequest,
) => void;

const ndjson = (...events: object[]) =>
  events.map((event) => `${JSON.stringify(event)}\n`).join('');

const citation = (
  number: number,
  pageId: string,
  headingPath: string[],
  pdf?: { attachmentId: string; fileName: string; pdfPage: number },
) => ({
  number,
  pageId,
  headingPath,
  attachmentId: pdf?.attachmentId ?? null,
  fileName: pdf?.fileName ?? null,
  pdfPage: pdf?.pdfPage ?? null,
});

describe('AiAskService', () => {
  let server: Server;
  let baseUrl: string;
  let url: string;
  let upstream: Upstream;
  let requests: RecordedRequest[];
  let configured: boolean;
  let memberSpaceIds: string[];
  let spaces: StoredSpace[];
  let pages: StoredPage[];
  let restrictedPageIds: Set<string>;
  let confirmStatus: number;

  const spaceMemberRepo = {
    getUserSpaceIds: async () => [...memberSpaceIds],
  };
  const spaceRepo = {
    findById: async (spaceId: string, workspaceId: string) => {
      const space = spaces.find((entry) => entry.id === spaceId);
      if (!space || workspaceId !== WORKSPACE_ID) return undefined;
      return {
        id: space.id,
        name: space.name,
        slug: space.slug,
        workspaceId,
        deletedAt: space.deleted ? new Date() : null,
      } as Space;
    },
  };
  const toPage = (page: StoredPage) =>
    ({
      id: page.id,
      spaceId: page.spaceId,
      title: page.title,
      slugId: page.slugId,
      workspaceId: WORKSPACE_ID,
      content: page.content,
      deletedAt: page.trashed ? new Date() : null,
    }) as unknown as Page;
  const pageRepo = {
    findManyByIds: async (ids: string[], opts?: { workspaceId?: string }) =>
      pages
        .filter((page) => ids.includes(page.id))
        .filter((page) => !opts?.workspaceId || !page.trashed)
        .map(toPage),
    findById: async (id: string) => {
      const page = pages.find((entry) => entry.id === id);
      return page ? toPage(page) : undefined;
    },
  };
  const pagePermissionRepo = {
    filterAccessiblePageIds: async ({ pageIds }: { pageIds: string[] }) =>
      pageIds.filter((id) => !restrictedPageIds.has(id)),
  };

  const accessService = new AiPageAccessService(
    stub<SpaceMemberRepo>(spaceMemberRepo),
    stub<SpaceRepo>(spaceRepo),
    stub<PageRepo>(pageRepo),
    stub<PagePermissionRepo>(pagePermissionRepo),
  );
  const environmentService = stub<EnvironmentService>({
    isAiBridgeConfigured: () => configured,
    getAiServiceUrl: () => url,
    getAiServiceToken: () => SERVICE_CREDENTIAL,
  });
  const service = new AiAskService(
    environmentService,
    stub<AiTokenService>({ issueUserToken: async () => USER_CREDENTIAL }),
    new AiServiceClient(environmentService),
    accessService,
    stub<SpaceRepo>(spaceRepo),
  );

  const answerWith = (body: string, beforeEnd?: () => void): Upstream => {
    return (_request, response) => {
      response.writeHead(200, { 'content-type': 'application/x-ndjson' });
      beforeEnd?.();
      response.end(body);
    };
  };

  const ask = (overrides: Partial<AiAskDto> = {}, signal?: AbortSignal) =>
    service.ask(
      USER,
      {
        question: 'Welche Bänder gelten?',
        conversationId: CONVERSATION_ID,
        ...overrides,
      },
      signal ?? new AbortController().signal,
    );

  const collect = async (events: AsyncIterable<AiAskEvent>) => {
    const received: AiAskEvent[] = [];
    for await (const event of events) received.push(event);
    return received;
  };

  const askAndCollect = async (overrides: Partial<AiAskDto> = {}) =>
    collect(await ask(overrides));

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
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
          closedEarly: false,
        };
        requests.push(recorded);
        res.on('close', () => {
          recorded.closedEarly = !res.writableFinished;
        });
        if (req.url === CONFIRM_PATH) {
          res.writeHead(confirmStatus);
          res.end();
          return;
        }
        upstream(req, res, recorded);
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
    memberSpaceIds = [SPACE_GF, SPACE_ALLG, SPACE_DELETED];
    spaces = [
      { id: SPACE_GF, name: 'Geschäftsführung', slug: 'geschaeftsfuehrung' },
      { id: SPACE_ALLG, name: 'Allgemein', slug: 'allgemein' },
      { id: SPACE_FOREIGN, name: 'Vertrieb', slug: 'vertrieb' },
      { id: SPACE_DELETED, name: 'Alt', slug: 'alt', deleted: true },
    ];
    pages = [
      {
        id: PAGE_BANDS,
        spaceId: SPACE_GF,
        title: 'Gehaltsbänder',
        slugId: 'bands1',
        content: BANDS_CONTENT,
      },
      {
        id: PAGE_NESTED,
        spaceId: SPACE_ALLG,
        title: 'Verschachtelt',
        slugId: 'nest1',
        content: NESTED_CONTENT,
      },
      {
        id: PAGE_RESTRICTED,
        spaceId: SPACE_ALLG,
        title: 'Umstrukturierung 2027',
        slugId: 'restr1',
        content: NESTED_CONTENT,
      },
      {
        id: PAGE_TRASHED,
        spaceId: SPACE_ALLG,
        title: 'Alt',
        slugId: 'trash1',
        content: NESTED_CONTENT,
        trashed: true,
      },
    ];
    restrictedPageIds = new Set([PAGE_RESTRICTED]);
    confirmStatus = 204;
    upstream = answerWith(ndjson({ type: 'no_source' }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const confirmRequests = () =>
    requests.filter((request) => request.url === CONFIRM_PATH);

  describe('request validation', () => {
    const errorsFor = (body: Json) =>
      validate(plainToInstance(AiAskDto, body), { whitelist: true });

    it('ASK-AC61: accepts a trimmed question of 1 to 2,000 characters with an optional space or page', async () => {
      expect(
        await errorsFor({ question: '  ?  ', conversationId: CONVERSATION_ID }),
      ).toEqual([]);
      expect(
        await errorsFor({
          question: `  ${'x'.repeat(2000)}  `,
          conversationId: CONVERSATION_ID,
          spaceId: SPACE_GF,
        }),
      ).toEqual([]);
      expect(
        await errorsFor({
          question: 'Frage',
          conversationId: CONVERSATION_ID,
          pageId: PAGE_BANDS,
        }),
      ).toEqual([]);
    });

    it.each([
      ['an empty question', { question: '' }],
      ['a whitespace-only question', { question: '   ' }],
      ['a question of 2,001 characters', { question: 'x'.repeat(2001) }],
      ['a question that is not a string', { question: 42 }],
      ['a missing conversation id', { conversationId: undefined }],
      ['a malformed conversation id', { conversationId: 'not-a-uuid' }],
      ['a malformed space id', { spaceId: 'space-1' }],
      ['a malformed page id', { pageId: 'page-1' }],
      ['both a space and a page', { spaceId: SPACE_GF, pageId: PAGE_BANDS }],
    ])('ASK-AC61: rejects %s', async (_case, overrides) => {
      const errors = await errorsFor({
        question: 'Frage',
        conversationId: CONVERSATION_ID,
        ...overrides,
      });

      expect(errors).not.toEqual([]);
    });
  });

  describe('checks before the stream', () => {
    it('ASK-AC65: a switched-off assistant answers 503 assistant_disabled and calls nothing', async () => {
      configured = false;

      expect(await rejectionOf(ask())).toEqual({
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
      'ASK-AC62: %s answers 404 space_not_found and calls nothing',
      async (_case, spaceId) => {
        expect(await rejectionOf(ask({ spaceId }))).toEqual({
          code: 'space_not_found',
          status: 404,
        });
        expect(requests).toHaveLength(0);
      },
    );

    it.each([
      ['a page the user may not view', PAGE_RESTRICTED],
      ['a page in the trash', PAGE_TRASHED],
      ['a page id that does not exist', PAGE_MISSING],
    ])(
      'ASK-AC63: %s answers 404 page_not_found and calls nothing',
      async (_case, pageId) => {
        expect(await rejectionOf(ask({ pageId }))).toEqual({
          code: 'page_not_found',
          status: 404,
        });
        expect(requests).toHaveLength(0);
      },
    );

    it('ASK-AC62: a page of a space the user left answers 404 page_not_found', async () => {
      memberSpaceIds = [SPACE_ALLG];

      expect(await rejectionOf(ask({ pageId: PAGE_BANDS }))).toEqual({
        code: 'page_not_found',
        status: 404,
      });
    });

    it('ASK-AC66: a refused connection answers 503 assistant_unavailable', async () => {
      url = await closedPortUrl();

      expect(await rejectionOf(ask())).toEqual({
        code: 'assistant_unavailable',
        status: 503,
      });
    });

    it.each([401, 400, 500])(
      'ASK-AC66: HTTP %i from the AI service answers 503 assistant_unavailable',
      async (status) => {
        upstream = (_request, response) => {
          response.writeHead(status, { 'content-type': 'application/json' });
          response.end('{"code":"x","message":"y"}');
        };

        expect(await rejectionOf(ask())).toEqual({
          code: 'assistant_unavailable',
          status: 503,
        });
      },
    );

    it('ASK-AC66: an AI service that sends no response head within the timeout answers 503 assistant_unavailable', async () => {
      upstream = () => undefined;
      const started = Date.now();

      expect(await rejectionOf(ask())).toEqual({
        code: 'assistant_unavailable',
        status: 503,
      });
      expect(Date.now() - started).toBeLessThan(5000);
    }, 10_000);

    it('ASK-AC61: sends the trimmed question, conversation and scope with both tokens to POST /v1/ask', async () => {
      await askAndCollect({ spaceId: SPACE_GF });

      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe('/v1/ask');
      expect(requests[0].headers['x-service-token']).toBe(SERVICE_CREDENTIAL);
      expect(requests[0].headers['x-user-token']).toBe(USER_CREDENTIAL);
      expect(JSON.parse(requests[0].body)).toEqual({
        question: 'Welche Bänder gelten?',
        conversationId: CONVERSATION_ID,
        spaceId: SPACE_GF,
      });
    });

    it('ASK-AC63: a viewable page scope is sent as pageId only', async () => {
      await askAndCollect({ pageId: PAGE_BANDS });

      expect(JSON.parse(requests[0].body)).toEqual({
        question: 'Welche Bänder gelten?',
        conversationId: CONVERSATION_ID,
        pageId: PAGE_BANDS,
      });
    });
  });

  describe('relay', () => {
    it('ASK-AC9: relays deltas in order, also when lines are split across chunks', async () => {
      const body = ndjson(
        { type: 'delta', text: 'Die Bänder ' },
        { type: 'delta', text: 'gelten [1].' },
        { type: 'no_source' },
      );
      upstream = (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/x-ndjson' });
        const cut = body.indexOf('gelten') + 2;
        response.write(body.slice(0, 5));
        setTimeout(() => {
          response.write(body.slice(5, cut));
          setTimeout(() => response.end(body.slice(cut)), 10);
        }, 10);
      };

      expect(await askAndCollect()).toEqual([
        { type: 'delta', text: 'Die Bänder ' },
        { type: 'delta', text: 'gelten [1].' },
        { type: 'no_source' },
      ]);
    });

    it('ASK-AC67: an error event from the AI service is relayed as model_unavailable', async () => {
      upstream = answerWith(
        ndjson(
          { type: 'delta', text: 'Teil' },
          { type: 'error', code: 'model_unavailable' },
        ),
      );

      expect(await askAndCollect()).toEqual([
        { type: 'delta', text: 'Teil' },
        { type: 'error', code: 'model_unavailable' },
      ]);
    });

    it('ASK-AC69: a stream that ends without a final event ends with model_unavailable', async () => {
      upstream = answerWith(ndjson({ type: 'delta', text: 'Teil' }));

      expect(await askAndCollect()).toEqual([
        { type: 'delta', text: 'Teil' },
        { type: 'error', code: 'model_unavailable' },
      ]);
    });

    it('ASK-AC69: a stream that breaks off ends with model_unavailable', async () => {
      upstream = (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/x-ndjson' });
        response.write(ndjson({ type: 'delta', text: 'Teil' }));
        setTimeout(() => response.destroy(), 20);
      };

      expect(await askAndCollect()).toEqual([
        { type: 'delta', text: 'Teil' },
        { type: 'error', code: 'model_unavailable' },
      ]);
    });

    it('ASK-AC69: a malformed line ends with model_unavailable', async () => {
      upstream = answerWith(
        `${ndjson({ type: 'delta', text: 'Teil' })}not json\n${ndjson({ type: 'no_source' })}`,
      );

      expect(await askAndCollect()).toEqual([
        { type: 'delta', text: 'Teil' },
        { type: 'error', code: 'model_unavailable' },
      ]);
    });

    it('ASK-AC25: no_source from the AI service is relayed as no_source', async () => {
      expect(await askAndCollect()).toEqual([{ type: 'no_source' }]);
    });

    it('ASK-AC13: aborting the request closes the AI service request and sends no further event', async () => {
      upstream = (_request, response) => {
        response.writeHead(200, { 'content-type': 'application/x-ndjson' });
        response.write(ndjson({ type: 'delta', text: 'Teil' }));
      };
      const abort = new AbortController();
      const events = await ask({}, abort.signal);
      const iterator = events[Symbol.asyncIterator]();

      expect((await iterator.next()).value).toEqual({
        type: 'delta',
        text: 'Teil',
      });
      abort.abort();
      const rest = await iterator.next();

      expect(rest.done).toBe(true);
      await waitUntil(() => requests[0].closedEarly);
    });
  });

  describe('final check and sources', () => {
    const answerCiting = (
      citations: ReturnType<typeof citation>[],
      beforeEnd?: () => void,
    ) => {
      upstream = answerWith(
        ndjson(
          { type: 'delta', text: 'Antwort [1]' },
          { type: 'citations', turnId: TURN_ID, citations },
        ),
        beforeEnd,
      );
    };

    const finalEventOf = async () => (await askAndCollect()).slice(-1)[0];

    it('ASK-AC17: a section with the heading path ["Bänder"] in Geschäftsführung gets title, space name, path and the anchor of the first heading with that path', async () => {
      answerCiting([citation(1, PAGE_BANDS, ['Bänder'])]);

      expect(await finalEventOf()).toEqual({
        type: 'sources',
        sources: [
          {
            number: 1,
            pageId: PAGE_BANDS,
            title: 'Gehaltsbänder',
            spaceName: 'Geschäftsführung',
            headingPath: ['Bänder'],
            fileName: null,
            pdfPage: null,
            url: '/s/geschaeftsfuehrung/p/bands1#h-bands',
          },
        ],
      });
    });

    it('ASK-AC18: a section with the heading path ["A", "B"] in Allgemein links the first B under A, not an earlier top-level B', async () => {
      answerCiting([citation(1, PAGE_NESTED, ['A', 'B'])]);

      expect(await finalEventOf()).toEqual({
        type: 'sources',
        sources: [
          expect.objectContaining({
            title: 'Verschachtelt',
            spaceName: 'Allgemein',
            headingPath: ['A', 'B'],
            url: '/s/allgemein/p/nest1#h-a-b',
          }),
        ],
      });
    });

    it('ASK-AC18: a heading path is matched against the Markdown text of the heading, as the index builds it', async () => {
      answerCiting([citation(1, PAGE_BANDS, ['**Wichtig**'])]);

      expect(await finalEventOf()).toEqual({
        type: 'sources',
        sources: [
          expect.objectContaining({
            url: '/s/geschaeftsfuehrung/p/bands1#h-bold',
          }),
        ],
      });
    });

    it('ASK-AC19: a section with an empty heading path gets the space name only and no anchor', async () => {
      answerCiting([citation(1, PAGE_BANDS, [])]);

      expect(await finalEventOf()).toEqual({
        type: 'sources',
        sources: [
          expect.objectContaining({
            spaceName: 'Geschäftsführung',
            headingPath: [],
            fileName: null,
            pdfPage: null,
            url: '/s/geschaeftsfuehrung/p/bands1',
          }),
        ],
      });
    });

    it('ASK-AC21: a heading path that matches no heading gets no anchor', async () => {
      answerCiting([citation(1, PAGE_BANDS, ['Einleitung', 'Fehlt'])]);

      expect(await finalEventOf()).toEqual({
        type: 'sources',
        sources: [
          expect.objectContaining({ url: '/s/geschaeftsfuehrung/p/bands1' }),
        ],
      });
    });

    it('ASK-AC20: a PDF section gets the file name and PDF page and no anchor', async () => {
      answerCiting([
        citation(1, PAGE_BANDS, [], {
          attachmentId: 'att-1',
          fileName: 'tarif.pdf',
          pdfPage: 3,
        }),
      ]);

      expect(await finalEventOf()).toEqual({
        type: 'sources',
        sources: [
          {
            number: 1,
            pageId: PAGE_BANDS,
            title: 'Gehaltsbänder',
            spaceName: 'Geschäftsführung',
            headingPath: [],
            fileName: 'tarif.pdf',
            pdfPage: 3,
            url: '/s/geschaeftsfuehrung/p/bands1',
          },
        ],
      });
    });

    it('ASK-AC15: keeps the numbering and order of the citations, one source per citation', async () => {
      answerCiting([
        citation(1, PAGE_NESTED, ['A', 'B']),
        citation(2, PAGE_BANDS, ['Bänder']),
        citation(3, PAGE_BANDS, []),
      ]);

      const final = await finalEventOf();

      expect(final).toMatchObject({ type: 'sources' });
      expect(
        (final as Extract<AiAskEvent, { type: 'sources' }>).sources.map(
          (source) => [source.number, source.pageId],
        ),
      ).toEqual([
        [1, PAGE_NESTED],
        [2, PAGE_BANDS],
        [3, PAGE_BANDS],
      ]);
    });

    it('ASK-AC26: a cited page moved to the trash during the answer withdraws it with no_source', async () => {
      answerCiting(
        [citation(1, PAGE_NESTED, ['A', 'B']), citation(2, PAGE_BANDS, [])],
        () => {
          pages.find((page) => page.id === PAGE_BANDS)!.trashed = true;
        },
      );

      expect(await askAndCollect()).toEqual([
        { type: 'delta', text: 'Antwort [1]' },
        { type: 'no_source' },
      ]);
    });

    it('ASK-AC27: a cited page whose space the user was removed from during the answer withdraws it with no_source', async () => {
      answerCiting([citation(1, PAGE_BANDS, ['Bänder'])], () => {
        memberSpaceIds = [SPACE_ALLG];
      });

      expect(await finalEventOf()).toEqual({ type: 'no_source' });
    });

    it('ASK-AC28: a cited page that got a restriction excluding the user during the answer withdraws it with no_source', async () => {
      answerCiting([citation(1, PAGE_NESTED, [])], () => {
        restrictedPageIds.add(PAGE_NESTED);
      });

      expect(await finalEventOf()).toEqual({ type: 'no_source' });
    });

    it('ASK-AC25: a citations event without citations is answered with no_source', async () => {
      answerCiting([]);

      expect(await finalEventOf()).toEqual({ type: 'no_source' });
    });

    it('ASK-AC70: a failing final check ends with model_unavailable', async () => {
      answerCiting([citation(1, PAGE_BANDS, [])], () => {
        pagePermissionRepo.filterAccessiblePageIds = async () => {
          throw new Error('database down');
        };
      });
      const original = pagePermissionRepo.filterAccessiblePageIds;

      try {
        expect(await finalEventOf()).toEqual({
          type: 'error',
          code: 'model_unavailable',
        });
        expect(confirmRequests()).toEqual([]);
      } finally {
        pagePermissionRepo.filterAccessiblePageIds = original;
      }
    });

    describe('history confirmation', () => {
      it('ASK-AC56: confirms the turn with both tokens only after the sources event was taken', async () => {
        answerCiting([citation(1, PAGE_BANDS, ['Bänder'])]);
        const iterator = (await ask())[Symbol.asyncIterator]();

        expect((await iterator.next()).value).toMatchObject({ type: 'delta' });
        expect((await iterator.next()).value).toMatchObject({
          type: 'sources',
        });
        expect(confirmRequests()).toEqual([]);
        expect((await iterator.next()).done).toBe(true);

        const [confirm] = confirmRequests();
        expect(JSON.parse(confirm.body)).toEqual({
          conversationId: CONVERSATION_ID,
          turnId: TURN_ID,
        });
        expect(confirm.headers['x-service-token']).toBe(SERVICE_CREDENTIAL);
        expect(confirm.headers['x-user-token']).toBe(USER_CREDENTIAL);
      });

      it('ASK-AC56: an answer withdrawn by the final check is not confirmed', async () => {
        answerCiting([citation(1, PAGE_RESTRICTED, [])]);

        expect(await finalEventOf()).toEqual({ type: 'no_source' });
        expect(confirmRequests()).toEqual([]);
      });

      it('ASK-AC56: an upstream error or no_source is not confirmed', async () => {
        upstream = answerWith(
          ndjson(
            { type: 'delta', text: 'Teil' },
            { type: 'error', code: 'model_unavailable' },
          ),
        );
        await askAndCollect();
        upstream = answerWith(ndjson({ type: 'no_source' }));
        await askAndCollect();

        expect(confirmRequests()).toEqual([]);
      });

      it('ASK-AC56: a client that stops before the sources event leaves the turn unconfirmed', async () => {
        const abort = new AbortController();
        answerCiting([citation(1, PAGE_BANDS, [])]);
        const iterator = (await ask({}, abort.signal))[Symbol.asyncIterator]();

        expect((await iterator.next()).value).toMatchObject({ type: 'delta' });
        abort.abort();
        while (!(await iterator.next()).done);

        expect(confirmRequests()).toEqual([]);
      });

      it('ASK-AC56: a failed confirm keeps the shown answer and logs no answer text', async () => {
        confirmStatus = 500;
        const warn = jest.spyOn(Logger.prototype, 'warn');
        answerCiting([citation(1, PAGE_BANDS, [])]);

        const events = await askAndCollect();

        expect(events.map((event) => event.type)).toEqual(['delta', 'sources']);
        expect(confirmRequests()).toHaveLength(1);
        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0][0])).not.toContain('Antwort');
      });
    });
  });

  describe('failures that are not the answer', () => {
    it('ASK-AC75: a line that is not JSON is logged without its content', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn');
      upstream = answerWith(
        `${ndjson({ type: 'delta', text: 'Teil' })}Geheimer Antworttext\n`,
      );

      expect((await askAndCollect()).slice(-1)).toEqual([
        { type: 'error', code: 'model_unavailable' },
      ]);
      const logged = warn.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(logged).not.toContain('Geheim');
      expect(logged).toContain('not JSON');
    });

    it('ASK-AC13: a client that leaves before the AI service answers ends quietly', async () => {
      const abort = new AbortController();
      upstream = () => abort.abort();

      await expect(ask({}, abort.signal)).resolves.toBeNull();
    });
  });
});

describe('AiBridgeController.ask', () => {
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

  const controllerAnswering = (
    open: (signal: AbortSignal) => AsyncIterable<AiAskEvent>,
  ) => {
    const askService = stub<AiAskService>({
      ask: async (_user: User, _dto: AiAskDto, signal: AbortSignal) =>
        open(signal),
    });
    return new AiBridgeController(stub<AiStatusService>({}), askService);
  };

  const DTO = { question: 'Frage', conversationId: CONVERSATION_ID };

  it('ASK-AC9: writes each event as one server-sent event and ends the response', async () => {
    const { raw, reply } = sseReply();
    const controller = controllerAnswering(async function* () {
      yield { type: 'delta', text: 'Teil' };
      yield { type: 'no_source' };
    });

    await controller.ask(DTO, USER, reply);

    expect(raw.setHeader).toHaveBeenCalledWith('x-request-id', 'r-1');
    expect(raw.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
      }),
    );
    expect(raw.write.mock.calls.map(([frame]) => frame)).toEqual([
      'data: {"type":"delta","text":"Teil"}\n\n',
      'data: {"type":"no_source"}\n\n',
    ]);
    expect(raw.end).toHaveBeenCalledTimes(1);
  });

  it('ASK-AC13: closing the client connection aborts the signal passed to the service', async () => {
    const { raw, reply } = sseReply();
    let seen: AbortSignal | undefined;
    const controller = controllerAnswering(async function* (signal) {
      seen = signal;
      yield { type: 'delta', text: 'Teil' };
      raw.emit('close');
      expect(signal.aborted).toBe(true);
    });

    await controller.ask(DTO, USER, reply);

    expect(seen?.aborted).toBe(true);
  });

  it('ASK-AC13: a client that left before the stream gets nothing written', async () => {
    const { raw, reply } = sseReply();
    const controller = new AiBridgeController(
      stub<AiStatusService>({}),
      stub<AiAskService>({ ask: async () => null }),
    );

    await controller.ask(DTO, USER, reply);

    expect(raw.writeHead).not.toHaveBeenCalled();
    expect(raw.write).not.toHaveBeenCalled();
    expect(raw.end).not.toHaveBeenCalled();
  });

  it('ASK-AC65: an error before the stream is thrown before any header is written', async () => {
    const { raw, reply } = sseReply();
    const controller = new AiBridgeController(
      stub<AiStatusService>({}),
      stub<AiAskService>({
        ask: async () => {
          throw new AiBridgeError('assistant_disabled', 'off');
        },
      }),
    );

    await expect(controller.ask(DTO, USER, reply)).rejects.toMatchObject({
      code: 'assistant_disabled',
    });
    expect(raw.writeHead).not.toHaveBeenCalled();
  });
});

async function waitUntil(condition: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
