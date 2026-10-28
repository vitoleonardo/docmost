import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { EnvironmentVariables } from './environment.validation';

const aiBridgeProperties = [
  'AI_BRIDGE_SECRET',
  'AI_SERVICE_TOKEN',
  'AI_SERVICE_URL',
];

function aiBridgeErrors(config: Record<string, string>) {
  const instance = plainToInstance(EnvironmentVariables, config);
  return validateSync(instance).filter((error) =>
    aiBridgeProperties.includes(error.property),
  );
}

describe('EnvironmentVariables AI bridge settings', () => {
  it('BRIDGE-AC44: rejects a bridge secret shorter than 32 characters', () => {
    const errors = aiBridgeErrors({ AI_BRIDGE_SECRET: 'a'.repeat(31) });

    expect(errors).toHaveLength(1);
    expect(errors[0].property).toBe('AI_BRIDGE_SECRET');
    expect(Object.values(errors[0].constraints)[0]).toContain('32');
  });

  it('BRIDGE-AC44: accepts a bridge secret of 32 characters', () => {
    expect(aiBridgeErrors({ AI_BRIDGE_SECRET: 'a'.repeat(32) })).toEqual([]);
  });

  it('BRIDGE-AC44: accepts all AI bridge variables unset', () => {
    expect(aiBridgeErrors({})).toEqual([]);
  });

  it('BRIDGE-AC44: rejects a service token shorter than 32 characters', () => {
    const errors = aiBridgeErrors({ AI_SERVICE_TOKEN: 'short' });

    expect(errors.map((error) => error.property)).toEqual([
      'AI_SERVICE_TOKEN',
    ]);
  });

  it('BRIDGE-AC44: rejects a service url that is not a url', () => {
    const errors = aiBridgeErrors({ AI_SERVICE_URL: 'not a url' });

    expect(errors.map((error) => error.property)).toEqual(['AI_SERVICE_URL']);
  });

  it('BRIDGE-AC44: accepts a local service url without a tld', () => {
    expect(
      aiBridgeErrors({ AI_SERVICE_URL: 'http://127.0.0.1:8100' }),
    ).toEqual([]);
    expect(aiBridgeErrors({ AI_SERVICE_URL: 'http://ai-service:8100' })).toEqual(
      [],
    );
  });
});
