import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { SeedModule } from './seed.module';
import { formatSeedSummary, SeedService } from './seed.service';
import { SeedContentService } from './seed-content.service';
import {
  loadSeedEnvironment,
  prepareSeedReset,
  readSeedPreflightOptions,
} from './seed-preflight';

async function rebuildSeed(): Promise<void> {
  const reset = await prepareSeedReset(
    readSeedPreflightOptions(process.argv, loadSeedEnvironment()),
  );
  try {
    const app = await NestFactory.create<NestFastifyApplication>(
      SeedModule,
      new FastifyAdapter(),
      { logger: ['error'] },
    );
    try {
      app.setGlobalPrefix('api');
      await app.init();
      const workspace = await app.get(SeedService).seedWorkspace();
      const pageCounts = await app.get(SeedContentService).seedPages(workspace);
      console.log(formatSeedSummary({ ...workspace.counts, ...pageCounts }));
    } finally {
      await app.close();
    }
  } finally {
    await reset.release();
  }
}

rebuildSeed().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  },
);
