import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EnvironmentService } from './environment.service';

const fullConfig: Record<string, string> = {
  AI_BRIDGE_SECRET: 'b'.repeat(32),
  AI_SERVICE_TOKEN: 't'.repeat(32),
  AI_SERVICE_URL: 'http://127.0.0.1:8100',
};

async function serviceWith(config: Record<string, string>) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EnvironmentService,
      {
        provide: ConfigService,
        useValue: {
          get: (key: string, fallback?: unknown) => config[key] ?? fallback,
        },
      },
    ],
  }).compile();

  return module.get<EnvironmentService>(EnvironmentService);
}

describe('EnvironmentService', () => {
  it('should be defined', async () => {
    expect(await serviceWith({})).toBeDefined();
  });

  it('BRIDGE-AC1: isAiBridgeConfigured is true when secret, token and url are set', async () => {
    const service = await serviceWith(fullConfig);

    expect(service.isAiBridgeConfigured()).toBe(true);
    expect(service.getAiBridgeSecret()).toBe(fullConfig.AI_BRIDGE_SECRET);
    expect(service.getAiServiceToken()).toBe(fullConfig.AI_SERVICE_TOKEN);
    expect(service.getAiServiceUrl()).toBe(fullConfig.AI_SERVICE_URL);
  });

  it.each(['AI_BRIDGE_SECRET', 'AI_SERVICE_TOKEN', 'AI_SERVICE_URL'])(
    'BRIDGE-AC1: isAiBridgeConfigured is false when %s is missing',
    async (missing) => {
      const { [missing]: _removed, ...rest } = fullConfig;
      const service = await serviceWith(rest);

      expect(service.isAiBridgeConfigured()).toBe(false);
    },
  );

  it('BRIDGE-AC1: isAiBridgeConfigured is false when a value is an empty string', async () => {
    const service = await serviceWith({ ...fullConfig, AI_SERVICE_URL: '' });

    expect(service.isAiBridgeConfigured()).toBe(false);
  });
});
