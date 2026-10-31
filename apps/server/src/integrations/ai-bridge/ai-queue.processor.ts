import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { EnvironmentService } from '../environment/environment.service';
import { QueueJob, QueueName } from '../queue/constants';
import { AiServiceClient } from './services/ai-service.client';

const FORWARDED_JOB_FIELDS = new Map<string, string[]>([
  [QueueJob.PAGE_CREATED, ['pageIds', 'workspaceId']],
  [QueueJob.PAGE_CONTENT_UPDATED, ['pageIds', 'workspaceId']],
  [QueueJob.PAGE_SOFT_DELETED, ['pageIds', 'workspaceId']],
  [QueueJob.PAGE_RESTORED, ['pageIds', 'workspaceId']],
  [QueueJob.PAGE_DELETED, ['pageIds', 'workspaceId']],
  [QueueJob.PAGE_MOVED_TO_SPACE, ['pageIds', 'spaceId', 'workspaceId']],
  [QueueJob.SPACE_DELETED, ['spaceId', 'workspaceId']],
  [QueueJob.WORKSPACE_DELETED, ['workspaceId']],
]);

@Processor(QueueName.AI_QUEUE)
export class AiQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(AiQueueProcessor.name);

  constructor(
    private readonly environmentService: EnvironmentService,
    private readonly aiServiceClient: AiServiceClient,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (!this.environmentService.isAiBridgeConfigured()) return;
    const fields = FORWARDED_JOB_FIELDS.get(job.name);
    if (!fields) return;

    const data = Object.fromEntries(
      fields
        .filter((field) => job.data?.[field] !== undefined)
        .map((field) => [field, job.data[field]]),
    );
    try {
      await this.aiServiceClient.enqueueJob(job.name, data);
    } catch (error) {
      const cause = error instanceof Error ? error.message : String(error);
      const pageIds = Array.isArray(data.pageIds)
        ? data.pageIds.join(', ')
        : 'none';
      this.logger.warn(
        `Forwarding ${job.name} to AI service failed: ${cause} (pageIds: ${pageIds})`,
      );
    }
  }
}
