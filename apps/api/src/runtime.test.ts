import { B2BROUTER_HOSTS } from '@fi/pdp-adapter';
import { ServerEnvSchema } from '@fi/shared/env';
import { describe, expect, it, vi } from 'vitest';
import {
  mailExchangesFromDns,
  microsoftFromEnv,
  ownPdpFromEnv,
  pdpFromEnv,
  testPlatformFromEnv,
} from './runtime';

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

  it('takes company keys only with PDP_KEY_SEALING_KEY, and only keys of its own environment', () => {
    expect(ownPdpFromEnv(env({}), {})).toBeNull();
    expect(() => env({ PDP_KEY_SEALING_KEY: 'c2hvcnQ=' })).toThrow(/32 bytes/);
    const sealing = { PDP_KEY_SEALING_KEY: Buffer.alloc(32, 9).toString('base64') };
    const local = env(sealing);
    const pdp = pdpFromEnv(local);
    const own = ownPdpFromEnv(local, pdp);
    expect(own?.adapter('mock', 'any_key_1234')).toBe(pdp.mock);
    expect(own?.adapter('b2brouter_test', 'test_company')).toBeNull();

    const sandbox = env({
      ...outside,
      ...sealing,
      FI_ENV: 'sandbox',
      B2BROUTER_API_KEY: 'test_abc',
    });
    const inSandbox = ownPdpFromEnv(sandbox, pdpFromEnv(sandbox));
    expect(inSandbox?.adapter('b2brouter', 'test_company')?.provider).toBe('b2brouter');
    expect(() => inSandbox?.adapter('b2brouter', 'prod_company')).toThrow(/sandbox key/);
    const prod = env({ ...outside, ...sealing, FI_ENV: 'prod', B2BROUTER_API_KEY: 'prod_abc' });
    const inProd = ownPdpFromEnv(prod, pdpFromEnv(prod));
    expect(() => inProd?.adapter('b2brouter', 'test_company')).toThrow(/production key/);
    expect(() => inProd?.adapter('b2brouter', 'stag_company')).toThrow(
      /company key: a staging key/,
    );
  });
});

describe('the OneDrive connector from the environment', () => {
  const app = {
    MICROSOFT_CLIENT_ID: '00000000-0000-4000-8000-00000000f1f1',
    MICROSOFT_CLIENT_SECRET: 'local-microsoft-client-secret',
    CONNECTOR_SEALING_KEY: Buffer.alloc(32, 5).toString('base64'),
  };

  it('is offered only with the app registration, its secret and the sealing key', () => {
    expect(microsoftFromEnv(env({}))).toBeNull();
    expect(() => env({ MICROSOFT_CLIENT_ID: app.MICROSOFT_CLIENT_ID })).toThrow(
      /required with MICROSOFT_CLIENT_ID/,
    );
    const local = microsoftFromEnv(
      env({ ...app, MICROSOFT_LOGIN_URL: 'http://localhost:4010/microsoft' }),
    );
    expect(local).toMatchObject({
      clientId: app.MICROSOFT_CLIENT_ID,
      notificationUrl: 'http://localhost:4000/webhooks/microsoft',
    });
  });

  it('talks only to Microsoft outside local, and is polled without an https address', () => {
    const prod = { ...outside, ...app, FI_ENV: 'prod' };
    expect(() =>
      microsoftFromEnv(env({ ...prod, MICROSOFT_GRAPH_URL: 'http://localhost:4010/graph' })),
    ).toThrow(/MICROSOFT_GRAPH_URL: only local/);
    expect(
      microsoftFromEnv(env({ ...prod, API_PUBLIC_URL: 'https://api.facture-impec.fr' }))
        ?.notificationUrl,
    ).toBe('https://api.facture-impec.fr/webhooks/microsoft');
    expect(
      microsoftFromEnv(env({ ...prod, API_PUBLIC_URL: 'http://10.0.0.2:4000' }))?.notificationUrl,
    ).toBeNull();
  });
});

describe('mailExchangesFromDns', () => {
  it('asks DNS once a day per domain, and takes no answer as none', async () => {
    let now = 0;
    const asked: string[] = [];
    const mx = mailExchangesFromDns(
      async (domain) => {
        asked.push(domain);
        if (domain === 'broken.test') throw new Error('ESERVFAIL');
        return [{ exchange: `${domain.replace('.', '-')}.mail.protection.outlook.com` }];
      },
      () => now,
    );
    expect(await mx('durand.test')).toEqual(['durand-test.mail.protection.outlook.com']);
    expect(await mx('durand.test')).toHaveLength(1);
    expect(await mx('broken.test')).toEqual([]);
    now += 24 * 3_600_000;
    await mx('durand.test');
    expect(asked).toEqual(['durand.test', 'broken.test', 'durand.test']);
  });

  it('gives up after 2 seconds', async () => {
    vi.useFakeTimers();
    try {
      const mx = mailExchangesFromDns(() => new Promise(() => {}));
      const answer = mx('slow.test');
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await answer).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });
});
