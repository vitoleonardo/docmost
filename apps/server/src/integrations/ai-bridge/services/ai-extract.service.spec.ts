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
import { ForbiddenException, Logger } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { AttachmentRepo } from '@docmost/db/repos/attachment/attachment.repo';
import { Attachment, Page, Space, User } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../../../core/page/page-access/page-access.service';
import { EnvironmentService } from '../../environment/environment.service';
import { AiBridgeController } from '../ai-bridge.controller';
import { AiBridgeError } from '../ai-bridge.errors';
import { AiExtractDto } from '../dto/ai-extract.dto';
import { AiAskService } from './ai-ask.service';
import { AiExtractService } from './ai-extract.service';
import { AiPageAccessService } from './ai-page-access.service';
import {
  AI_EXTRACT_TIMEOUT_MS,
  AiServiceClient,
  AiServiceExtractResult,
} from './ai-service.client';
import { AiStatusService } from './ai-status.service';
import { AiTokenService } from './ai-token.service';

const WORKSPACE_ID = 'workspace-1';
const USER = { id: 'user-1', workspaceId: WORKSPACE_ID } as User;
const SERVICE_CREDENTIAL = 'test-service-token-0123456789abcdef';
const USER_CREDENTIAL = 'test-user-token';
const SPACE_IT = '0b7c5e8a-0000-4000-8000-000000000001';
const SPACE_FOREIGN = '0b7c5e8a-0000-4000-8000-000000000002';
const PAGE_CONTRACT = '1c2d3e4f-0000-4000-8000-000000000001';
const PAGE_READ_ONLY = '1c2d3e4f-0000-4000-8000-000000000002';
const PAGE_RESTRICTED = '1c2d3e4f-0000-4000-8000-000000000003';
const PAGE_TRASHED = '1c2d3e4f-0000-4000-8000-000000000004';
const PAGE_FOREIGN_SPACE = '1c2d3e4f-0000-4000-8000-000000000005';
const PAGE_MISSING = '1c2d3e4f-0000-4000-8000-000000000006';
const PAGE_OTHER = '1c2d3e4f-0000-4000-8000-000000000007';
const PDF_ID = '7a1b2c3d-0000-4000-8000-000000000001';
const READ_ONLY_PDF_ID = '7a1b2c3d-0000-4000-8000-000000000002';
const OTHER_PAGE_PDF_ID = '7a1b2c3d-0000-4000-8000-000000000003';
const IMAGE_ID = '7a1b2c3d-0000-4000-8000-000000000004';
const DELETED_PDF_ID = '7a1b2c3d-0000-4000-8000-000000000005';
const FOREIGN_WORKSPACE_PDF_ID = '7a1b2c3d-0000-4000-8000-000000000006';
const MISSING_ATTACHMENT_ID = '7a1b2c3d-0000-4000-8000-000000000007';

const FIELD_KEYS = ['parties', 'term', 'noticePeriod', 'value', 'renewal'];
const EXTRACTED: AiServiceExtractResult = {
  outcome: 'extracted',
  fields: FIELD_KEYS.map((key, index) => ({
    key: key as 'parties',
    value: index === 0 ? 'Planwerk Software GmbH und Ostmooimooi GmbH' : null,
    quote: index === 0 ? 'zwischen der Planwerk Software GmbH' : null,
    pdfPage: index === 0 ? 1 : null,
  })),
};
const MODEL_UNAVAILABLE = { outcome: 'failed', reason: 'model_unavailable' };

interface StoredPage {
  id: string;
  spaceId: string;
  trashed?: boolean;
}

interface RecordedRequest {
  url?: string;
  headers: IncomingMessage['headers'];
  body: string;
}

type Upstream = (request: IncomingMessage, response: ServerResponse) => void;

const pdf = (
  id: string,
  pageId: string,
  overrides: Partial<Attachment> = {},
): Attachment =>
  stub<Attachment>({
    id,
    pageId,
    workspaceId: WORKSPACE_ID,
    fileName: 'vertrag.pdf',
    mimeType: 'application/pdf',
    fileSize: '2048',
    deletedAt: null,
    ...overrides,
  });

describe('AiExtractService', () => {
  let server: Server;
  let baseUrl: string;
  let url: string;
  let upstream: Upstream;
  let requests: RecordedRequest[];
  let configured: boolean;
  let editablePageIds: Set<string>;

  const pages: StoredPage[] = [
    { id: PAGE_CONTRACT, spaceId: SPACE_IT },
    { id: PAGE_READ_ONLY, spaceId: SPACE_IT },
    { id: PAGE_RESTRICTED, spaceId: SPACE_IT },
    { id: PAGE_TRASHED, spaceId: SPACE_IT, trashed: true },
    { id: PAGE_FOREIGN_SPACE, spaceId: SPACE_FOREIGN },
    { id: PAGE_OTHER, spaceId: SPACE_IT },
  ];
  const attachments: Attachment[] = [
    pdf(PDF_ID, PAGE_CONTRACT),
    pdf(READ_ONLY_PDF_ID, PAGE_READ_ONLY),
    pdf(OTHER_PAGE_PDF_ID, PAGE_OTHER),
    pdf(IMAGE_ID, PAGE_CONTRACT, {
      fileName: 'vertrag.png',
      mimeType: 'image/png',
    }),
    pdf(DELETED_PDF_ID, PAGE_CONTRACT, { deletedAt: new Date() }),
    pdf(FOREIGN_WORKSPACE_PDF_ID, PAGE_CONTRACT, {
      workspaceId: 'workspace-2',
    }),
  ];

  const pageAccessService = stub<PageAccessService>({
    validateCanEdit: async (page: Page) => {
      if (!editablePageIds.has(page.id)) throw new ForbiddenException();
      return { hasRestriction: false };
    },
  });
  const toPage = (page: StoredPage) =>
    stub<Page>({
      id: page.id,
      spaceId: page.spaceId,
      workspaceId: WORKSPACE_ID,
      deletedAt: page.trashed ? new Date() : null,
    });
  const accessService = new AiPageAccessService(
    stub<SpaceMemberRepo>({ getUserSpaceIds: async () => [SPACE_IT] }),
    stub<SpaceRepo>({
      findById: async (id: string) =>
        stub<Space>({ id, workspaceId: WORKSPACE_ID, deletedAt: null }),
    }),
    stub<PageRepo>({
      findManyByIds: async (ids: string[]) =>
        pages
          .filter((page) => ids.includes(page.id) && !page.trashed)
          .map(toPage),
      findById: async (id: string) => {
        const page = pages.find((entry) => entry.id === id);
        return page ? toPage(page) : undefined;
      },
    }),
    stub<PagePermissionRepo>({
      filterAccessiblePageIds: async ({ pageIds }: { pageIds: string[] }) =>
        pageIds.filter((id) => id !== PAGE_RESTRICTED),
    }),
    pageAccessService,
  );
  const attachmentRepo = stub<AttachmentRepo>({
    findById: async (id: string) =>
      attachments.find((attachment) => attachment.id === id),
  });
  const environmentService = stub<EnvironmentService>({
    isAiBridgeConfigured: () => configured,
    getAiServiceUrl: () => url,
    getAiServiceToken: () => SERVICE_CREDENTIAL,
  });
  const service = new AiExtractService(
    environmentService,
    accessService,
    attachmentRepo,
    stub<AiTokenService>({ issueUserToken: async () => USER_CREDENTIAL }),
    new AiServiceClient(environmentService),
  );

  const answerWith =
    (status: number, body: unknown): Upstream =>
    (_request, response) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };

  const extract = (
    overrides: Partial<AiExtractDto> = {},
    signal = new AbortController().signal,
  ) =>
    service.extract(
      USER,
      { pageId: PAGE_CONTRACT, attachmentId: PDF_ID, ...overrides },
      signal,
    );

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
        requests.push({
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
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
    editablePageIds = new Set([PAGE_CONTRACT, PAGE_OTHER]);
    upstream = answerWith(200, EXTRACTED);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('request validation', () => {
    const errorsFor = (body: Record<string, unknown>) =>
      validate(plainToInstance(AiExtractDto, body), { whitelist: true });

    it('EXTRACT-AC47: accepts a page id and an attachment id', async () => {
      expect(
        await errorsFor({ pageId: PAGE_CONTRACT, attachmentId: PDF_ID }),
      ).toEqual([]);
    });

    it.each([
      ['a missing page id', { pageId: undefined }],
      ['a missing attachment id', { attachmentId: undefined }],
      ['a malformed page id', { pageId: 'page-1' }],
      ['a malformed attachment id', { attachmentId: 'att-1' }],
      ['a page id that is not a string', { pageId: 42 }],
      ['an empty attachment id', { attachmentId: '' }],
    ])('EXTRACT-AC47: rejects %s', async (_case, overrides) => {
      const errors = await errorsFor({
        pageId: PAGE_CONTRACT,
        attachmentId: PDF_ID,
        ...overrides,
      });

      expect(errors).not.toEqual([]);
    });
  });

  describe('checks before the AI service', () => {
    it('EXTRACT-AC49: a switched-off assistant answers 503 assistant_disabled and calls nothing', async () => {
      configured = false;

      expect(await rejectionOf(extract())).toEqual({
        code: 'assistant_disabled',
        status: 503,
      });
      expect(requests).toHaveLength(0);
    });

    it.each([
      ['a page the user may not view', PAGE_RESTRICTED],
      ['a page in the trash', PAGE_TRASHED],
      ['a page of a space the user is not a member of', PAGE_FOREIGN_SPACE],
      ['a page id that does not exist', PAGE_MISSING],
    ])(
      'EXTRACT-AC45: %s answers 404 page_not_found and calls nothing',
      async (_case, pageId) => {
        expect(await rejectionOf(extract({ pageId }))).toEqual({
          code: 'page_not_found',
          status: 404,
        });
        expect(requests).toHaveLength(0);
      },
    );

    it('EXTRACT-AC44: a page the user may view but not edit answers 403 page_not_editable and calls nothing', async () => {
      expect(
        await rejectionOf(
          extract({ pageId: PAGE_READ_ONLY, attachmentId: READ_ONLY_PDF_ID }),
        ),
      ).toEqual({ code: 'page_not_editable', status: 403 });
      expect(requests).toHaveLength(0);
    });

    it('EXTRACT-AC42: a user who lost the edit right after the button was shown gets 403 page_not_editable', async () => {
      await extract();
      editablePageIds.delete(PAGE_CONTRACT);

      expect(await rejectionOf(extract())).toEqual({
        code: 'page_not_editable',
        status: 403,
      });
      expect(requests).toHaveLength(1);
    });

    it('EXTRACT-AC44: an error of the edit check that is not a denial is not turned into 403', async () => {
      const broken = new Error('database down');
      jest
        .spyOn(pageAccessService, 'validateCanEdit')
        .mockRejectedValue(broken);

      await expect(extract()).rejects.toBe(broken);
      expect(requests).toHaveLength(0);
    });

    it.each([
      ['an attachment that does not exist', MISSING_ATTACHMENT_ID],
      ['an attachment of another page', OTHER_PAGE_PDF_ID],
      ['an attachment of type image/png', IMAGE_ID],
      ['a deleted attachment', DELETED_PDF_ID],
      ['an attachment of another workspace', FOREIGN_WORKSPACE_PDF_ID],
    ])(
      'EXTRACT-AC46: %s answers 404 attachment_not_found and calls nothing',
      async (_case, attachmentId) => {
        expect(await rejectionOf(extract({ attachmentId }))).toEqual({
          code: 'attachment_not_found',
          status: 404,
        });
        expect(requests).toHaveLength(0);
      },
    );
  });

  describe('the call to the AI service', () => {
    it('extract contract: an editor with a PDF gets the result of the AI service', async () => {
      await expect(extract()).resolves.toEqual(EXTRACTED);
    });

    it('extract contract: sends exactly attachment id and file size with both tokens to POST /v1/extract', async () => {
      await extract();

      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe('/v1/extract');
      expect(requests[0].headers['x-service-token']).toBe(SERVICE_CREDENTIAL);
      expect(requests[0].headers['x-user-token']).toBe(USER_CREDENTIAL);
      expect(JSON.parse(requests[0].body)).toEqual({
        attachmentId: PDF_ID,
        fileSize: 2048,
      });
      expect(requests[0].body).not.toContain(USER.id);
    });

    it.each([
      [
        'refused',
        {
          outcome: 'refused',
          reason: 'too_many_pages',
          pageCount: 11,
          fileSize: null,
          characterCount: null,
        },
      ],
      ['failed', MODEL_UNAVAILABLE],
    ])('extract contract: relays a %s result', async (_outcome, body) => {
      upstream = answerWith(200, body);

      await expect(extract()).resolves.toEqual(body);
    });

    it('EXTRACT-AC41: a refused connection answers 503 assistant_unavailable', async () => {
      url = await closedPortUrl();

      expect(await rejectionOf(extract())).toEqual({
        code: 'assistant_unavailable',
        status: 503,
      });
    });

    it.each([503, 500, 401])(
      'EXTRACT-AC41: HTTP %i from the AI service answers 503 assistant_unavailable',
      async (status) => {
        upstream = answerWith(status, { code: 'x', message: 'y' });

        expect(await rejectionOf(extract())).toEqual({
          code: 'assistant_unavailable',
          status: 503,
        });
      },
    );

    it('EXTRACT-AC46: attachment_not_found from the AI service answers 404 attachment_not_found', async () => {
      upstream = answerWith(404, {
        code: 'attachment_not_found',
        message: 'gone',
      });

      expect(await rejectionOf(extract())).toEqual({
        code: 'attachment_not_found',
        status: 404,
      });
    });

    it('EXTRACT-AC67: an AI service slower than 200 s gives the model failure result', async () => {
      jest.useFakeTimers({
        doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      });
      const warn = jest.spyOn(Logger, 'warn');
      upstream = () => undefined;
      let settled = false;
      const result = extract().finally(() => {
        settled = true;
      });

      await jest.advanceTimersByTimeAsync(AI_EXTRACT_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);

      await expect(result).resolves.toEqual(MODEL_UNAVAILABLE);
      expect(warn).toHaveBeenCalledTimes(1);
    });

    it('extract contract: a malformed result gives the model failure result and logs no content', async () => {
      const warn = jest.spyOn(Logger, 'warn');
      upstream = answerWith(200, {
        outcome: 'extracted',
        fields: [{ key: 'parties', value: 'Geheimer Vertragspartner' }],
      });

      await expect(extract()).resolves.toEqual(MODEL_UNAVAILABLE);
      const logged = warn.mock.calls.map((call) => call.join(' ')).join('\n');
      expect(logged).toContain('malformed');
      expect(logged).not.toContain('Geheim');
      expect(logged).not.toContain(USER_CREDENTIAL);
    });

    it('extract contract: a client that leaves before the AI service answers ends quietly', async () => {
      const abort = new AbortController();
      const warn = jest.spyOn(Logger, 'warn');
      upstream = () => abort.abort();

      await expect(extract({}, abort.signal)).resolves.toBeNull();
      expect(warn).not.toHaveBeenCalled();
    });
  });
});

describe('AiBridgeController.extract', () => {
  const DTO = { pageId: PAGE_CONTRACT, attachmentId: PDF_ID };

  const replyWithRaw = () => {
    const raw = new EventEmitter();
    return { raw, reply: stub<FastifyReply>({ raw }) };
  };

  const controllerWith = (extractService: object) =>
    new AiBridgeController(
      stub<AiStatusService>({}),
      stub<AiAskService>({}),
      stub<AiExtractService>(extractService),
    );

  it('extract contract: returns the result of the service as the response body', async () => {
    const { reply } = replyWithRaw();
    const controller = controllerWith({ extract: async () => EXTRACTED });

    await expect(controller.extract(DTO, USER, reply)).resolves.toEqual(
      EXTRACTED,
    );
  });

  it('extract contract: closing the client connection aborts the signal passed to the service', async () => {
    const { raw, reply } = replyWithRaw();
    let seen: AbortSignal | undefined;
    const controller = controllerWith({
      extract: async (_user: User, _dto: AiExtractDto, signal: AbortSignal) => {
        seen = signal;
        raw.emit('close');
        return null;
      },
    });

    await controller.extract(DTO, USER, reply);

    expect(seen?.aborted).toBe(true);
  });
});
