import { B2BROUTER_HOSTS } from '@fi/pdp-adapter';
import { ServerEnvSchema } from '@fi/shared/env';
import { describe, expect, it } from 'vitest';
import { pdpFromEnv, testPlatformFromEnv } from './runtime';

const outside = { DATABASE_URL: 'postgres://fi@db/fi', ADMIN_TOKEN: 'x'.repeat(24) };
const env = (values: Record<string, string>) => ServerEnvSchema.parse(values);

describe('platforms from the environment', () => {
  it('offers the mock platform alone without a B2Brouter key, and tests on it', () => {
    const pdp = pdpFromEnv(env({}));
    expect(Object.keys(pdp)).toEqual(['mock']);
    expect(testPlatformFromEnv(env({}), pdp)).toMatchObject({ provider: 'mock' });
  });

  it('sends « Mode test » to B2Brouter when the key is a sandbox key, without scenarios', () => {
    const sandbox = env({ ...outside, FI_ENV: 'sandbox', B2BROUTER_API_KEY: 'test_abc' });
    const pdp = pdpFromEnv(sandbox);
    expect(pdp.b2brouter?.provider).toBe('b2brouter');
    expect(testPlatformFromEnv(sandbox, pdp)).toEqual({ provider: 'b2brouter', scenarios: null });
  });

  it('keeps « Mode test » on the mock platform with a production key', () => {
    const prod = env({ ...outside, FI_ENV: 'prod', B2BROUTER_API_KEY: 'prod_abc' });
    const pdp = pdpFromEnv(prod);
    expect(pdp.b2brouter).toBeDefined();
    expect(testPlatformFromEnv(prod, pdp)).toMatchObject({ provider: 'mock' });
  });

  it('accepts the stand-in in local only, and a key only on its own B2Brouter host', () => {
    const standIn = {
      B2BROUTER_API_KEY: 'test_abc',
      B2BROUTER_BASE_URL: 'http://localhost:4010/b2brouter',
    };
    expect(pdpFromEnv(env(standIn)).b2brouter).toBeDefined();
    expect(() => pdpFromEnv(env({ ...outside, ...standIn, FI_ENV: 'sandbox' }))).toThrow(
      /only local may use a stand-in/,
    );
    expect(() =>
      pdpFromEnv(
        env({ B2BROUTER_API_KEY: 'test_abc', B2BROUTER_BASE_URL: B2BROUTER_HOSTS.staging }),
      ),
    ).toThrow(/B2BROUTER_API_KEY: a sandbox key/);
  });
});
