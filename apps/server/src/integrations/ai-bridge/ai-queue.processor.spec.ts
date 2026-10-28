import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { EnvironmentService } from '../environment/environment.service';
import { AiQueueProcessor } from './ai-queue.processor';
import { AiServiceClient } from './services/ai-service.client';

const SERVICE_TOKEN = 'test-service-token-0123456789abcdef';

const FORWARDED_JOBS: Record<string, string[]> = {
  'page-created': ['pageIds', 'workspaceId'],
  'page-content-updated': ['pageIds', 'workspaceId'],
  'page-soft-deleted': ['pageIds', 'workspaceId'],
  'page-restored': ['pageIds', 'workspaceId'],
  'page-deleted': ['pageIds', 'workspaceId'],
  'page-moved-to-space': ['pageIds', 'spaceId', 'workspaceId'],
  'space-deleted': ['spaceId', 'workspaceId'],
  'workspace-deleted': ['workspaceId'],
};

const FULL_DATA = {
  pageIds: ['page-1', 'page-2'],
  spaceId: 'space-1',
  workspaceId: 'workspace-1',
  content: 'secret page text',
  userId: 'user-1',
  title: 'Secret title',
};

const jobOf = (name: string, data: object = FULL_DATA) =>
  ({ name, data }) as unknown as Job;

describe('AiQueueProcessor', () => {
  const environmentService = { isAiBridgeConfigured: jest.fn() };
  const aiServiceClient = { enqueueJob: jest.fn() };
  const processor = new AiQueueProcessor(
    environmentService as unknown as EnvironmentService,
    aiServiceClient as unknown as AiServiceClient,
  );
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.resetAllMocks();
    environmentService.isAiBridgeConfigured.mockReturnValue(true);
    aiServiceClient.enqueueJob.mockResolvedValue(undefined);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
  });

  afterEach(() => warn.mockRestore());

  it.each(Object.entries(FORWARDED_JOBS))(
    'BRIDGE-AC30: %s is forwarded with exactly the listed fields',
    async (name, fields) => {
      await processor.process(jobOf(name));

      expect(aiServiceClient.enqueueJob).toHaveBeenCalledTimes(1);
      const [forwardedName, data] = aiServiceClient.enqueueJob.mock.calls[0];
      expect(forwardedName).toBe(name);
      expect(Object.keys(data).sort()).toEqual([...fields].sort());
      for (const field of fields) {
        expect(data[field]).toEqual(FULL_DATA[field as keyof typeof FULL_DATA]);
      }
    },
  );

  it('BRIDGE-AC30: a listed field missing from the job data is not invented', async () => {
    await processor.process(jobOf('page-moved-to-space', { pageIds: ['p'] }));

    expect(aiServiceClient.enqueueJob).toHaveBeenCalledWith(
      'page-moved-to-space',
      { pageIds: ['p'] },
    );
  });

  it('BRIDGE-AC69: completes without any request when the assistant is not configured', async () => {
    environmentService.isAiBridgeConfigured.mockReturnValue(false);

    await expect(
      processor.process(jobOf('page-created')),
    ).resolves.toBeUndefined();

    expect(aiServiceClient.enqueueJob).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    'workspace-create-embeddings',
    'generate-page-embeddings',
    'space-created',
    'unknown-job',
  ])('BRIDGE-AC70: %s is dropped without a request', async (name) => {
    await expect(processor.process(jobOf(name))).resolves.toBeUndefined();

    expect(aiServiceClient.enqueueJob).not.toHaveBeenCalled();
  });

  it.each([
    ['refused', 'AI service unreachable: connection error (ECONNREFUSED)'],
    ['401', 'AI service answered HTTP 401'],
    ['500', 'AI service answered HTTP 500'],
  ])(
    'BRIDGE-AC68: a %s failure warns with job, page ids and cause and completes the job',
    async (_label, cause) => {
      aiServiceClient.enqueueJob.mockRejectedValue(new Error(cause));

      await expect(
        processor.process(jobOf('page-created')),
      ).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toBe(
        `Forwarding page-created to AI service failed: ${cause} (pageIds: page-1, page-2)`,
      );
      expect(message).not.toContain(FULL_DATA.content);
      expect(message).not.toContain(FULL_DATA.title);
      expect(message).not.toContain(SERVICE_TOKEN);
    },
  );

  it('BRIDGE-AC68: a job without page ids warns with an empty id list', async () => {
    aiServiceClient.enqueueJob.mockRejectedValue(new Error('timeout'));

    await processor.process(jobOf('space-deleted'));

    expect(String(warn.mock.calls[0][0])).toBe(
      'Forwarding space-deleted to AI service failed: timeout (pageIds: none)',
    );
  });
});
