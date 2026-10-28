import { createServer, IncomingMessage, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { EnvironmentService } from '../../environment/environment.service';
import { AiServiceClient } from './ai-service.client';

const SERVICE_TOKEN = 'test-service-token-0123456789abcdef';
const USER_TOKEN = 'test-user-token';

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

  const environmentService = {
    getAiServiceUrl: () => url,
    getAiServiceToken: () => SERVICE_TOKEN,
  } as unknown as EnvironmentService;
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
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
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
      await expect(client.checkSession(USER_TOKEN)).resolves.toBe(true);

      expect(requests).toHaveLength(1);
      expect(requests[0].method).toBe('POST');
      expect(requests[0].url).toBe('/v1/session');
      expect(requests[0].headers['x-service-token']).toBe(SERVICE_TOKEN);
      expect(requests[0].headers['x-user-token']).toBe(USER_TOKEN);
    });

    it('BRIDGE-AC38: answers false when the connection is refused', async () => {
      url = await closedPortUrl();

      await expect(client.checkSession(USER_TOKEN)).resolves.toBe(false);
    });

    it('BRIDGE-AC39: answers false within 5 s when the service never answers', async () => {
      behaviour = 'hang';
      const started = Date.now();

      await expect(client.checkSession(USER_TOKEN)).resolves.toBe(false);

      expect(Date.now() - started).toBeLessThan(5000);
    }, 10_000);

    it('BRIDGE-AC40: answers false on HTTP 500', async () => {
      behaviour = 'error';

      await expect(client.checkSession(USER_TOKEN)).resolves.toBe(false);
    });

    it('BRIDGE-AC41: answers false on HTTP 401', async () => {
      behaviour = 'unauthorized';

      await expect(client.checkSession(USER_TOKEN)).resolves.toBe(false);
    });

    it('BRIDGE-AC3: does not accept 202 as an available session', async () => {
      behaviour = 'accepted';

      await expect(client.checkSession(USER_TOKEN)).resolves.toBe(false);
    });

    it('BRIDGE-AC38: rejects a programming error such as an invalid service URL', async () => {
      url = 'not a url';

      await expect(client.checkSession(USER_TOKEN)).rejects.toThrow();
    });
  });

  describe('enqueueJob', () => {
    it('BRIDGE-AC29: resolves on 202 and posts name and data to /v1/jobs with the service token', async () => {
      behaviour = 'accepted';

      await expect(
        client.enqueueJob('page-created', { pageIds: ['p1'], workspaceId: 'w1' }),
      ).resolves.toBeUndefined();

      expect(requests[0].url).toBe('/v1/jobs');
      expect(requests[0].headers['x-service-token']).toBe(SERVICE_TOKEN);
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

      expect(String(error.message)).not.toContain(SERVICE_TOKEN);
    });
  });
});
