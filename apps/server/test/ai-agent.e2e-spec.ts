import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Kysely } from 'kysely';
import { JwtService } from '@nestjs/jwt';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DB } from '@docmost/db/types/db';
import type { User } from '@docmost/db/types/entity.types';
import type { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import type { UserRepo } from '@docmost/db/repos/user/user.repo';
import type { CollaborationGateway } from '../src/collaboration/collaboration.gateway';
import type { PersistenceExtension } from '../src/collaboration/extensions/persistence.extension';
import type {
  AgentBlock,
  AgentDiffOp,
} from '../src/integrations/ai-bridge/services/agent-document';
import type { AiReadBlocksResult } from '../src/integrations/ai-bridge/services/ai-agent-tools.service';
import type { AiTokenService } from '../src/integrations/ai-bridge/services/ai-token.service';
import type { SeedWorkspaceResult } from '../src/integrations/seed/seed.service';
import { prepareSeedReset } from '../src/integrations/seed/seed-preflight';
import {
  SEED_DEMO_PASSWORD,
  SEED_SPACES,
  SEED_USERS,
  SeedUserKey,
} from '../src/integrations/seed/seed-definition';
import {
  bootSeededHttpApp,
  createMigratedTestDatabase,
  dropTestDatabase,
  expectError,
  flushRedis,
  loadAppModulesFor,
  loginCookie,
  pageIdByTitle,
  providerOf,
  TEST_POSTGRES_SERVER,
} from './test-database';

const TEST_DATABASE = 'docmost_ai_agent_test';
const TEST_DATABASE_URL = `${TEST_POSTGRES_SERVER}/${TEST_DATABASE}`;
const TEST_REDIS_URL = 'redis://127.0.0.1:6380/12';
const TEST_AI_BRIDGE_KEY = 'test-ai-bridge-secret-0123456789abcdef';
const TEST_AI_SERVICE_CREDENTIAL = 'test-ai-service-token-0123456789abcdef';

type ProposalStatus = 'open' | 'applying' | 'applied' | 'discarded' | 'stale';

const TRANSITION_SOURCES: Record<ProposalStatus, ProposalStatus[]> = {
  applying: ['open'],
  applied: ['applying'],
  open: ['applying'],
  stale: ['open', 'applying'],
  discarded: ['open'],
};

interface StubProposal {
  id: string;
  runId: string;
  userId: string;
  pageId: string;
  pageTitle: string;
  spaceId: string;
  reason: string;
  fingerprint: string;
  changes: {
    block: number;
    heading: string | null;
    oldText: string;
    newText: string;
    ops: AgentDiffOp[];
  }[];
  added: number;
  removed: number;
  status: ProposalStatus;
  appliedBy: string | null;
  appliedAt: string | null;
}

type Editor = Awaited<ReturnType<CollaborationGateway['openDirectConnection']>>;

interface InjectedResponse {
  statusCode: number;
  json: () => unknown;
}

interface AgentApp {
  app: NestFastifyApplication;
  seed: SeedWorkspaceResult;
  gateway: CollaborationGateway;
  persistence: PersistenceExtension;
  aiTokenService: AiTokenService;
  spaceMemberRepo: SpaceMemberRepo;
  userRepo: UserRepo;
  yjs: typeof import('yjs');
  agentDocument: typeof import('../src/integrations/ai-bridge/services/agent-document');
}

function bootSeededAgentApp(
  storageRoot: string,
  aiServiceUrl: string,
): Promise<AgentApp> {
  process.env.REDIS_URL = TEST_REDIS_URL;
  process.env.AI_BRIDGE_SECRET = TEST_AI_BRIDGE_KEY;
  process.env.AI_SERVICE_TOKEN = TEST_AI_SERVICE_CREDENTIAL;
  process.env.AI_SERVICE_URL = aiServiceUrl;
  process.env.COLLAB_DISABLE_REDIS = 'false';
  return loadAppModulesFor(TEST_DATABASE_URL, async (): Promise<AgentApp> => {
    const { app, seed } = await bootSeededHttpApp(storageRoot);
    const provider = providerOf(app);
    const collaboration =
      await import('../src/collaboration/collaboration.gateway');
    const persistence =
      await import('../src/collaboration/extensions/persistence.extension');
    const tokens =
      await import('../src/integrations/ai-bridge/services/ai-token.service');
    const spaceMembers =
      await import('@docmost/db/repos/space/space-member.repo');
    const userRepos = await import('@docmost/db/repos/user/user.repo');
    return {
      app,
      seed,
      gateway: provider(collaboration.CollaborationGateway),
      persistence: provider(persistence.PersistenceExtension),
      aiTokenService: provider(tokens.AiTokenService),
      spaceMemberRepo: provider(spaceMembers.SpaceMemberRepo),
      userRepo: provider(userRepos.UserRepo),
      yjs: await import('yjs'),
      agentDocument:
        await import('../src/integrations/ai-bridge/services/agent-document'),
    };
  });
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function startAiServiceStub(proposals: Map<string, StubProposal>) {
  const jwt = new JwtService();
  const transitions: { proposalId: string; to: ProposalStatus }[] = [];

  const ownerOf = (token: string): string | undefined => {
    try {
      return jwt.verify<{ sub: string }>(token, {
        secret: TEST_AI_BRIDGE_KEY,
        audience: 'ai-service',
      }).sub;
    } catch {
      return undefined;
    }
  };

  const answer = (request: IncomingMessage, body: string): [number, object] => {
    if (request.headers['x-service-token'] !== TEST_AI_SERVICE_CREDENTIAL) {
      return [401, { code: 'service_token_invalid', message: 'wrong' }];
    }
    const owner = ownerOf(String(request.headers['x-user-token'] ?? ''));
    if (!owner) return [401, { code: 'user_token_invalid', message: 'bad' }];
    const { proposalId, to } = JSON.parse(body) as {
      proposalId: string;
      to?: ProposalStatus;
    };
    const proposal = proposals.get(proposalId);
    if (!proposal || proposal.userId !== owner) {
      return [404, { code: 'proposal_not_found', message: 'not found' }];
    }
    if (request.url === '/v1/agent/proposals/get') return [200, proposal];
    if (request.url !== '/v1/agent/proposals/transition' || !to) {
      return [404, { code: 'not_found', message: 'unknown route' }];
    }
    transitions.push({ proposalId, to });
    if (!TRANSITION_SOURCES[to].includes(proposal.status)) {
      return [409, { code: 'proposal_not_open', message: 'not open' }];
    }
    proposal.status = to;
    if (to === 'applied') {
      proposal.appliedBy = owner;
      proposal.appliedAt = new Date().toISOString();
    }
    return [200, proposal];
  };

  const server: Server = createServer((request, response) => {
    void readBody(request)
      .then((body) => {
        const [status, payload] = answer(request, body);
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(payload));
      })
      .catch((error: unknown) => {
        response.writeHead(500, { 'content-type': 'text/plain' });
        response.end(String(error));
      });
  });
  return { server, transitions };
}

function expectApplied(response: InjectedResponse) {
  expect({ status: response.statusCode, body: response.json() }).toEqual({
    status: 200,
    body: { status: 'applied' },
  });
}

function textOfBlock(blocks: AgentBlock[], number: number) {
  return blocks.find((block) => block.number === number)?.text;
}

describe('AI agent live document (e2e)', () => {
  const clientAddress = `192.0.2.${Math.floor(Math.random() * 254) + 1}`;
  const proposals = new Map<string, StubProposal>();
  const stub = startAiServiceStub(proposals);
  let admin: Kysely<DB>;
  let db: Kysely<DB>;
  let storageRoot: string;
  let agent: AgentApp;
  let openEditors: Editor[] = [];
  const users = {} as Record<SeedUserKey, User>;

  const spaceId = (name: string) =>
    agent.seed.spaceIds[SEED_SPACES.find((space) => space.name === name)!.slug];

  const pageId = (title: string) => pageIdByTitle(db, title);

  const storedPage = (id: string) =>
    db
      .selectFrom('pages')
      .select(['content', 'updatedAt', 'lastUpdatedById'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();

  const storedText = async (id: string) =>
    JSON.stringify((await storedPage(id)).content);

  const readBlocksWith = (token: string, id: string, space: string) =>
    agent.app.inject({
      method: 'POST',
      url: '/api/ai-bridge/internal/tools/read-blocks',
      remoteAddress: clientAddress,
      headers: {
        'x-service-token': TEST_AI_SERVICE_CREDENTIAL,
        'x-user-token': token,
      },
      payload: { pageId: id, spaceId: spaceId(space) },
    });

  const readBlocksAs = async (
    key: SeedUserKey,
    id: string,
    space: string,
  ): Promise<AiReadBlocksResult> => {
    const response = await readBlocksWith(
      await agent.aiTokenService.issueUserToken(users[key]),
      id,
      space,
    );
    expect(response.statusCode).toBe(200);
    return response.json();
  };

  const editableParagraphs = (read: AiReadBlocksResult) =>
    read.blocks.filter((block) => block.editable && !block.isHeading);

  const callAgent = async (
    key: SeedUserKey,
    path: 'proposal' | 'proposal/apply',
    proposalId: string,
  ) =>
    agent.app.inject({
      method: 'POST',
      url: `/api/ai/agent/${path}`,
      remoteAddress: clientAddress,
      headers: await loginCookie(
        agent.app,
        { email: users[key].email, password: SEED_DEMO_PASSWORD },
        clientAddress,
      ),
      payload: { proposalId },
    });

  const proposeAddition = (
    owner: SeedUserKey,
    read: AiReadBlocksResult,
    block: AgentBlock,
    addition: string,
  ): StubProposal => {
    const proposal: StubProposal = {
      id: randomUUID(),
      runId: randomUUID(),
      userId: users[owner].id,
      pageId: read.id,
      pageTitle: read.title,
      spaceId: read.spaceId,
      reason: 'Die Angabe ist veraltet.',
      fingerprint: read.fingerprint,
      changes: [
        {
          block: block.number,
          heading: block.heading,
          oldText: block.text,
          newText: `${block.text} ${addition}`,
          ops: [
            { op: 'keep', text: block.text },
            { op: 'add', text: ` ${addition}` },
          ],
        },
      ],
      added: addition.split(' ').length,
      removed: 0,
      status: 'open',
      appliedBy: null,
      appliedAt: null,
    };
    proposals.set(proposal.id, proposal);
    return proposal;
  };

  const transitionsOf = (proposal: StubProposal) =>
    stub.transitions
      .filter(({ proposalId }) => proposalId === proposal.id)
      .map(({ to }) => to);

  const openEditor = async (id: string, key: SeedUserKey) => {
    const editor = await agent.gateway.openDirectConnection(`page.${id}`, {
      user: users[key],
    });
    openEditors.push(editor);
    return editor;
  };

  const liveBlocksOf = (editor: Editor) => {
    if (!editor.document) throw new Error('the editor is closed');
    return agent.agentDocument.readAgentBlocks(editor.document).blocks;
  };

  const typeAtStartOf = (editor: Editor, blockText: string, typed: string) =>
    editor.transact((doc) => {
      const Y = agent.yjs;
      const textOf = (element: InstanceType<typeof Y.XmlElement>) =>
        element
          .toArray()
          .filter((child) => child instanceof Y.XmlText)
          .map((child) => child.toString())
          .join('');
      const find = (
        node: unknown,
      ): InstanceType<typeof Y.XmlText> | undefined => {
        if (!(node instanceof Y.XmlElement)) return undefined;
        const first = node.toArray()[0];
        if (node.nodeName === 'paragraph' && textOf(node) === blockText) {
          return first instanceof Y.XmlText ? first : undefined;
        }
        return node.toArray().map(find).find(Boolean);
      };
      const target = doc
        .getXmlFragment('default')
        .toArray()
        .map(find)
        .find(Boolean);
      if (!target) throw new Error(`no plain paragraph "${blockText}"`);
      target.insert(0, typed);
    });

  const watchStores = () => jest.spyOn(agent.persistence, 'onStoreDocument');

  const waitFor = async <T>(
    probe: () => Promise<T | undefined>,
    timeoutMs: number,
  ): Promise<T> => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = await probe();
      if (found !== undefined) return found;
      if (Date.now() > deadline) throw new Error('timed out waiting');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };

  beforeAll(async () => {
    await new Promise<void>((resolve) =>
      stub.server.listen(0, '127.0.0.1', resolve),
    );
    const stubUrl = `http://127.0.0.1:${(stub.server.address() as AddressInfo).port}`;
    await flushRedis(TEST_REDIS_URL);
    ({ admin, db } = await createMigratedTestDatabase(TEST_DATABASE));
    storageRoot = await mkdtemp(join(tmpdir(), 'ai-agent-storage-'));
    const reset = await prepareSeedReset({
      databaseUrl: TEST_DATABASE_URL,
      storageDriver: 'local',
      confirmNonLocal: false,
      storageRoot,
    });
    try {
      agent = await bootSeededAgentApp(storageRoot, stubUrl);
    } finally {
      await reset.release();
    }
    for (const { key } of SEED_USERS) {
      users[key] = await agent.userRepo.findById(
        agent.seed.userIds[key],
        agent.seed.workspaceId,
      );
    }
  }, 180_000);

  afterEach(async () => {
    jest.restoreAllMocks();
    for (const editor of openEditors) await editor.disconnect();
    openEditors = [];
  });

  afterAll(async () => {
    await agent?.app.close();
    stub.server.closeAllConnections();
    await new Promise((resolve) => stub.server.close(resolve));
    await dropTestDatabase(admin, db, TEST_DATABASE);
    if (storageRoot) await rm(storageRoot, { recursive: true, force: true });
  });

  it('AGENT-AC33: read-blocks holds a character typed in an open editor that the wiki has not saved, and stores nothing', async () => {
    const id = await pageId('Vertriebsprozess Anlagenbau');
    const [target] = editableParagraphs(
      await readBlocksAs('VT', id, 'Vertrieb'),
    );
    const editor = await openEditor(id, 'GF');

    await typeAtStartOf(editor, target.text, 'Entwurf ');
    expect(await storedText(id)).not.toContain('Entwurf ');
    const stores = watchStores();
    const read = await readBlocksAs('VT', id, 'Vertrieb');

    expect(read.blocks.find((block) => block.number === target.number)).toEqual(
      { ...target, text: `Entwurf ${target.text}` },
    );
    expect(stores).not.toHaveBeenCalled();
    expect(await storedText(id)).not.toContain('Entwurf ');
  });

  it('AGENT-AC37: a read through read-blocks attempts no store and leaves the stored page and its updated_at unchanged', async () => {
    const id = await pageId('Kundenvertrag Stadtwerke Beispielstadt');
    const before = await storedPage(id);
    const stores = watchStores();
    const loads = jest.spyOn(agent.persistence, 'onLoadDocument');

    await readBlocksAs('VT', id, 'Vertrieb');
    await readBlocksAs('GF', id, 'Vertrieb');

    expect(stores).not.toHaveBeenCalled();
    expect(loads).not.toHaveBeenCalled();
    expect(await storedPage(id)).toEqual(before);
  });

  it('AGENT-AC89: a read of a page nobody has open has the fingerprint apply finds, so the proposal applies', async () => {
    const id = await pageId('Willkommen bei Ostmooimooi');
    const read = await readBlocksAs('VT', id, 'Allgemein');
    const [changed] = editableParagraphs(read);
    const proposal = proposeAddition('VT', read, changed, 'Stand 2026');

    const applied = await callAgent('VT', 'proposal/apply', proposal.id);

    expectApplied(applied);
    expect(proposal.status).toBe('applied');
    expect(await storedText(id)).toContain(' Stand 2026');
  });

  it('AGENT-AC90: a character typed in an open editor after the proposal was shown makes apply answer 409 proposal_stale and keeps only that character', async () => {
    const id = await pageId('Preisliste Standardkomponenten');
    const read = await readBlocksAs('VT', id, 'Vertrieb');
    const [changed, other] = editableParagraphs(read);
    const proposal = proposeAddition('VT', read, changed, 'Stand Oktober 2026');
    const shown = await callAgent('VT', 'proposal', proposal.id);
    expect(shown.json()).toMatchObject({ status: 'open', canEdit: true });
    const editor = await openEditor(id, 'GF');

    await typeAtStartOf(editor, other.text, 'X');
    const applied = await callAgent('VT', 'proposal/apply', proposal.id);

    expectError(applied, 409, 'proposal_stale');
    const live = liveBlocksOf(editor);
    expect(textOfBlock(live, other.number)).toBe(`X${other.text}`);
    expect(JSON.stringify(live)).not.toContain('Stand Oktober 2026');
    expect(transitionsOf(proposal)).toEqual(['applying', 'stale']);
    expect(proposal.status).toBe('stale');
  });

  it('AGENT-AC94: an edit typed after the read the proposal is based on makes apply answer 409 proposal_stale', async () => {
    const id = await pageId('Bürozeiten und Erreichbarkeit');
    const read = await readBlocksAs('VT', id, 'Allgemein');
    const [changed] = editableParagraphs(read);
    const editor = await openEditor(id, 'GF');
    await typeAtStartOf(editor, changed.text, 'Neu: ');
    const proposal = proposeAddition('VT', read, changed, 'ab sofort');

    const applied = await callAgent('VT', 'proposal/apply', proposal.id);

    expectError(applied, 409, 'proposal_stale');
    const live = liveBlocksOf(editor);
    expect(textOfBlock(live, changed.number)).toBe(`Neu: ${changed.text}`);
    expect(JSON.stringify(live)).not.toContain('ab sofort');
    expect(transitionsOf(proposal)).toEqual(['applying', 'stale']);
  });

  it('AGENT-AC80: an applied proposal shows in another open editor without reloading', async () => {
    const id = await pageId('Rahmenvertrag Wasserverband Muster');
    const otherEditor = await openEditor(id, 'GF');
    const read = await readBlocksAs('VT', id, 'Vertrieb');
    const [changed] = editableParagraphs(read);
    const proposal = proposeAddition('VT', read, changed, 'gültig bis 2028');

    const applied = await callAgent('VT', 'proposal/apply', proposal.id);

    expectApplied(applied);
    const newText = `${changed.text} gültig bis 2028`;
    expect(textOfBlock(liveBlocksOf(otherEditor), changed.number)).toBe(
      newText,
    );
    const laterEditor = await openEditor(id, 'PL');
    expect(textOfBlock(liveBlocksOf(laterEditor), changed.number)).toBe(
      newText,
    );
    expect(transitionsOf(proposal)).toEqual(['applying', 'applied']);
    expect(proposal.appliedBy).toBe(users.VT.id);
  });

  it('AGENT-AC81: once the wiki has saved an applied page it names the applying user as last editor', async () => {
    const id = await pageId('Reisekosten Richtlinie 2022');
    expect((await storedPage(id)).lastUpdatedById).not.toBe(users.VT.id);
    const read = await readBlocksAs('VT', id, 'Allgemein');
    const [changed] = editableParagraphs(read);
    const proposal = proposeAddition('VT', read, changed, 'ersetzt durch 2026');

    expectApplied(await callAgent('VT', 'proposal/apply', proposal.id));
    const saved = await waitFor(async () => {
      const page = await storedPage(id);
      return JSON.stringify(page.content).includes('ersetzt durch 2026')
        ? page
        : undefined;
    }, 30_000);

    expect(saved.lastUpdatedById).toBe(users.VT.id);
  });

  it('AGENT-AC87: after a write failure answered 503 write_failed and left the proposal open, applying again writes the new text', async () => {
    const id = await pageId('Reisekosten Richtlinie 2026');
    const read = await readBlocksAs('VT', id, 'Allgemein');
    const [changed] = editableParagraphs(read);
    const proposal = proposeAddition('VT', read, changed, 'laut Vorstand');
    jest
      .spyOn(agent.gateway, 'handleYjsEvent')
      .mockRejectedValueOnce(new Error('TIMEOUT'));

    const failed = await callAgent('VT', 'proposal/apply', proposal.id);

    expectError(failed, 503, 'write_failed');
    expect(proposal.status).toBe('open');
    expect(
      JSON.stringify(await readBlocksAs('VT', id, 'Allgemein')),
    ).not.toContain('laut Vorstand');

    expectApplied(await callAgent('VT', 'proposal/apply', proposal.id));

    const after = await readBlocksAs('VT', id, 'Allgemein');
    expect(textOfBlock(after.blocks, changed.number)).toBe(
      `${changed.text} laut Vorstand`,
    );
    expect(transitionsOf(proposal)).toEqual([
      'applying',
      'open',
      'applying',
      'applied',
    ]);
  });

  it('AGENT-AC31: a member removed from the run space gets 404 page_not_found on read-blocks with a still valid token', async () => {
    const id = await pageId('Vertriebsprozess Anlagenbau');
    const vertriebId = spaceId('Vertrieb');
    const token = await agent.aiTokenService.issueUserToken(users.VT);
    expect((await readBlocksWith(token, id, 'Vertrieb')).statusCode).toBe(200);
    const member = await agent.spaceMemberRepo.getSpaceMemberByTypeId(
      vertriebId,
      { userId: users.VT.id },
    );

    await agent.spaceMemberRepo.removeSpaceMemberById(
      member.id,
      vertriebId,
      {},
    );
    try {
      expectError(
        await readBlocksWith(token, id, 'Vertrieb'),
        404,
        'page_not_found',
      );
    } finally {
      await agent.spaceMemberRepo.insertSpaceMember(member);
    }
  });

  it('AGENT-AC32: three minutes into a run the task token still reads blocks while the user token has expired', async () => {
    const id = await pageId('Vertriebsprozess Anlagenbau');
    const userToken = await agent.aiTokenService.issueUserToken(users.VT);
    const exchanged = await agent.app.inject({
      method: 'POST',
      url: '/api/ai-bridge/internal/task-token',
      remoteAddress: clientAddress,
      headers: {
        'x-service-token': TEST_AI_SERVICE_CREDENTIAL,
        'x-user-token': userToken,
      },
      payload: { runId: randomUUID() },
    });
    expect(exchanged.statusCode).toBe(200);
    const { taskToken } = exchanged.json() as { taskToken: string };
    const fresh = await readBlocksWith(taskToken, id, 'Vertrieb');
    jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 3 * 60_000);

    const expired = await readBlocksWith(userToken, id, 'Vertrieb');
    const later = await readBlocksWith(taskToken, id, 'Vertrieb');

    expectError(expired, 401, 'user_token_expired');
    expect({ status: later.statusCode, body: later.json() }).toEqual({
      status: 200,
      body: fresh.json(),
    });
  });
});
