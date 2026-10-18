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
    expect(Object.keys(pdp)).toEqual(['b2brouter']);
    expect(testPlatformFromEnv(sandbox, pdp)).toEqual({ provider: 'b2brouter', scenarios: null });
  });

  it('offers no mock in prod: « Mode test » goes to the sandbox through a second key, or nowhere', () => {
    const prod = { ...outside, FI_ENV: 'prod', B2BROUTER_API_KEY: 'prod_abc' };
    const alone = pdpFromEnv(env(prod));
    expect(Object.keys(alone)).toEqual(['b2brouter']);
    expect(testPlatformFromEnv(env(prod), alone)).toBeNull();

    const both = env({ ...prod, B2BROUTER_SANDBOX_API_KEY: 'test_abc' });
    const pdp = pdpFromEnv(both);
    expect(Object.keys(pdp)).toEqual(['b2brouter', 'b2brouter_test']);
    expect(pdp.b2brouter_test?.provider).toBe('b2brouter');
    expect(testPlatformFromEnv(both, pdp)).toEqual({ provider: 'b2brouter_test', scenarios: null });
  });

  it('takes a second key in prod only, and only a sandbox one', () => {
    expect(() => env({ B2BROUTER_SANDBOX_API_KEY: 'test_abc' })).toThrow(/only prod/);
    expect(() =>
      env({
        ...outside,
        FI_ENV: 'prod',
        B2BROUTER_API_KEY: 'prod_abc',
        B2BROUTER_SANDBOX_API_KEY: 'prod_def',
      }),
    ).toThrow(/sandbox key/);
    expect(() => env({ MAIL_SMTP_URL: 'smtp://mail.example.test' })).toThrow(/MAIL_FROM/);
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
