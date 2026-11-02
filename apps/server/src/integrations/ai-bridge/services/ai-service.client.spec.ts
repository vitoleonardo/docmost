import { stub } from '../test-stub';
import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { EnvironmentService } from '../../environment/environment.service';
import { AiBridgeError } from '../ai-bridge.errors';
import {
  AI_EXTRACT_TIMEOUT_MS,
  AiServiceClient,
  AiServiceMalformedResponseError,
  AiServiceTimeoutError,
  AiServiceUnreachableError,
} from './ai-service.client';

const SERVICE_CREDENTIAL = 'test-service-token-0123456789abcdef';
const USER_CREDENTIAL = 'test-user-token';

interface RecordedRequest {
  method?: string;
  url?: string;
  headers: IncomingMessage['headers'];
  body: string;
}

type Behaviour = 'ok' | 'accepted' | 'unauthorized' | 'error' | 'hang';

describe('AiServiceClient', () => {
  let server: Server;
  let baseUrl: string;
  let behaviour: Behaviour;
  let requests: RecordedRequest[];
  let url: string | undefined;
  let extractReply: { status: number; body: string } | undefined;

  const environmentService = stub<EnvironmentService>({
    getAiServiceUrl: () => url,
    getAiServiceToken: () => SERVICE_CREDENTIAL,
  });
  const client = new AiServiceClient(environmentService);

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        requests.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
        if (behaviour === 'hang') return;
        if (req.url === '/v1/extract' && extractReply) {
          res.writeHead(extractReply.status, {
            'content-type': 'application/json',
          });
          res.end(extractReply.body);
          return;
        }
        const status = {
          ok: 200,
          accepted: 202,
          unauthorized: 401,
          error: 500,
        }[behaviour];
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end('{}');
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
    requests = [];
    behaviour = 'ok';
    url = baseUrl;
    extractReply = undefined;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const closedPortUrl = async () => {
    const probe = createServer();
    await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as AddressInfo).port;
    await new Promise((resolve) => probe.close(resolve));
    return `http://127.0.0.1:${port}`;
  };

  describe('checkSession', () => {
    it('BRIDGE-AC3: answers true on HTTP 200 and sends both tokens to POST /v1/session', async () => {
      await expect(client.checkSession(USER_CREDENTIAL)).resolves.toBe(true);

      expect(requests).toHaveLength(1);
      expect(requests[0].method).toBe('POST');
      expect(requests[0].url).toBe('/v1/session');
      expect(requests[0].headers['x-service-token']).toBe(SERVICE_CREDENTIAL);
      expect(requests[0].headers['x-user-token']).toBe(USER_CREDENTIAL);
    });

    it('BRIDGE-AC38: answers false when the connection is refused', async () => {
      url = await closedPortUrl();

      await expect(client.checkSession(USER_CREDENTIAL)).resolves.toBe(false);
    });

    it('BRIDGE-AC39: answers false within 5 s when the service never answers', async () => {
      behaviour = 'hang';
      const started = Date.now();

      await expect(client.checkSession(USER_CREDENTIAL)).resolves.toBe(false);

      expect(Date.now() - started).toBeLessThan(5000);
    }, 10_000);

    it('BRIDGE-AC40: answers false on HTTP 500', async () => {
      behaviour = 'error';

      await expect(client.checkSession(USER_CREDENTIAL)).resolves.toBe(false);
    });

    it('BRIDGE-AC41: answers false on HTTP 401', async () => {
      behaviour = 'unauthorized';

      await expect(client.checkSession(USER_CREDENTIAL)).resolves.toBe(false);
    });

    it('BRIDGE-AC3: does not accept 202 as an available session', async () => {
      behaviour = 'accepted';

      await expect(client.checkSession(USER_CREDENTIAL)).resolves.toBe(false);
    });

    it('BRIDGE-AC38: rejects a programming error such as an invalid service URL', async () => {
      url = 'not a url';

      await expect(client.checkSession(USER_CREDENTIAL)).rejects.toThrow();
    });
  });

  describe('enqueueJob', () => {
    it('BRIDGE-AC29: resolves on 202 and posts name and data to /v1/jobs with the service token', async () => {
      behaviour = 'accepted';

      await expect(
        client.enqueueJob('page-created', {
          pageIds: ['p1'],
          workspaceId: 'w1',
        }),
      ).resolves.toBeUndefined();

      expect(requests[0].url).toBe('/v1/jobs');
      expect(requests[0].headers['x-service-token']).toBe(SERVICE_CREDENTIAL);
      expect(JSON.parse(requests[0].body)).toEqual({
        name: 'page-created',
        data: { pageIds: ['p1'], workspaceId: 'w1' },
      });
    });

    it('BRIDGE-AC68: rejects naming the status code on 401', async () => {
      behaviour = 'unauthorized';

      await expect(client.enqueueJob('page-created', {})).rejects.toThrow(
        'HTTP 401',
      );
    });

    it('BRIDGE-AC68: rejects naming the status code on 500', async () => {
      behaviour = 'error';

      await expect(client.enqueueJob('page-created', {})).rejects.toThrow(
        'HTTP 500',
      );
    });

    it('BRIDGE-AC68: rejects naming the connection error when refused', async () => {
      url = await closedPortUrl();

      await expect(client.enqueueJob('page-created', {})).rejects.toThrow(
        /connection error \(ECONNREFUSED\)/,
      );
    });

    it('BRIDGE-AC68: rejects naming the timeout when the service never answers', async () => {
      behaviour = 'hang';

      await expect(client.enqueueJob('page-created', {})).rejects.toThrow(
        /timeout/,
      );
    }, 10_000);

    it('BRIDGE-AC68: error messages never contain the service token', async () => {
      behaviour = 'error';

      const error = await client.enqueueJob('page-created', {}).catch((e) => e);

      expect(String(error.message)).not.toContain(SERVICE_CREDENTIAL);
    });
  });

  describe('extract', () => {
    const ATTACHMENT_ID = '7a1b2c3d-0000-4000-8000-000000000001';
    const EXTRACTED = {
      outcome: 'extracted',
      fields: ['parties', 'term', 'noticePeriod', 'value', 'renewal'].map(
        (key) => ({ key, value: null, quote: null, pdfPage: null }),
      ),
    };
    const REFUSED = {
      outcome: 'refused',
      reason: 'too_many_pages',
      pageCount: 11,
      fileSize: null,
      characterCount: null,
    };
    const FAILED = { outcome: 'failed', reason: 'model_unavailable' };

    const answer = (status: number, body: unknown) => {
      extractReply = {
        status,
        body: typeof body === 'string' ? body : JSON.stringify(body),
      };
    };

    const extract = (signal = new AbortController().signal) =>
      client.extract(
        USER_CREDENTIAL,
        { attachmentId: ATTACHMENT_ID, fileSize: 2048 },
        signal,
      );

    const failureOf = (promise: Promise<unknown>) =>
      promise.then(
        () => undefined,
        (caught: unknown) => caught,
      );

    it.each([
      ['extracted', EXTRACTED],
      ['refused', REFUSED],
      ['failed', FAILED],
    ])(
      'extract contract: relays a %s result and posts attachment id and file size with both tokens to /v1/extract',
      async (_outcome, body) => {
        answer(200, body);

        await expect(extract()).resolves.toEqual(body);

        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe('POST');
        expect(requests[0].url).toBe('/v1/extract');
        expect(requests[0].headers['x-service-token']).toBe(SERVICE_CREDENTIAL);
        expect(requests[0].headers['x-user-token']).toBe(USER_CREDENTIAL);
        expect(JSON.parse(requests[0].body)).toEqual({
          attachmentId: ATTACHMENT_ID,
          fileSize: 2048,
        });
      },
    );

    it('extract contract: drops fields of the AI service the contract does not name', async () => {
      answer(200, {
        ...FAILED,
        detail: 'Vertragstext',
      });

      await expect(extract()).resolves.toEqual(FAILED);
    });

    it('EXTRACT-AC46: HTTP 404 attachment_not_found from the AI service is attachment_not_found', async () => {
      answer(404, { code: 'attachment_not_found', message: 'gone' });

      const error = await failureOf(extract());

      expect(error).toBeInstanceOf(AiBridgeError);
      expect((error as AiBridgeError).code).toBe('attachment_not_found');
    });

    it.each([
      [503, { code: 'assistant_unavailable', message: 'x' }],
      [500, { code: 'x', message: 'y' }],
      [401, { code: 'user_token_invalid', message: 'y' }],
      [404, { detail: 'Not Found' }],
    ])(
      'EXTRACT-AC41: HTTP %i from the AI service is unreachable',
      async (status, body) => {
        answer(status, body);

        await expect(extract()).rejects.toBeInstanceOf(
          AiServiceUnreachableError,
        );
      },
    );

    it('EXTRACT-AC41: a refused connection is unreachable', async () => {
      url = await closedPortUrl();

      await expect(extract()).rejects.toBeInstanceOf(AiServiceUnreachableError);
    });

    it.each([
      ['a body that is not JSON', 'Vertragstext'],
      ['an unknown outcome', { outcome: 'done' }],
      ['four fields', { ...EXTRACTED, fields: EXTRACTED.fields.slice(1) }],
      [
        'fields out of schema order',
        { ...EXTRACTED, fields: [...EXTRACTED.fields].reverse() },
      ],
      [
        'a value that is a number',
        {
          ...EXTRACTED,
          fields: EXTRACTED.fields.map((field) => ({ ...field, value: 42 })),
        },
      ],
      ['an unknown refusal reason', { ...REFUSED, reason: 'too_old' }],
      [
        'a refusal without its counts',
        { outcome: 'refused', reason: 'too_large' },
      ],
      ['an unknown failure reason', { outcome: 'failed', reason: 'oops' }],
    ])('extract contract: %s is a malformed result', async (_case, body) => {
      answer(200, body);

      const error = await failureOf(extract());

      expect(error).toBeInstanceOf(AiServiceMalformedResponseError);
      expect(String((error as Error).message)).not.toContain('Vertragstext');
    });

    it('EXTRACT-AC67: an AI service that has not answered after 200 s times out, not earlier', async () => {
      jest.useFakeTimers({
        doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'],
      });
      behaviour = 'hang';
      let settled = false;
      const pending = failureOf(extract()).finally(() => {
        settled = true;
      });

      await jest.advanceTimersByTimeAsync(AI_EXTRACT_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);

      expect(await pending).toBeInstanceOf(AiServiceTimeoutError);
      expect(AI_EXTRACT_TIMEOUT_MS).toBe(200_000);
    });

    it('extract contract: the caller aborting is an abort, not a timeout', async () => {
      behaviour = 'hang';
      const caller = new AbortController();
      const pending = failureOf(extract(caller.signal));
      await waitForRequest();

      caller.abort();

      const error = await pending;
      expect(error).not.toBeInstanceOf(AiServiceTimeoutError);
      expect(error).toBeDefined();
    });

    const waitForRequest = async () => {
      const deadline = Date.now() + 2000;
      while (requests.length === 0) {
        if (Date.now() > deadline) throw new Error('timed out waiting');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
  });
});
