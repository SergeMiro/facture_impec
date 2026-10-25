import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, ServerEnvSchema } from './env';
import { isMessageKey, t } from './i18n';
import { newRunnerKey } from './relay';

describe('ServerEnvSchema', () => {
  it('defaults to the local environment, standard ports and an embedded database', () => {
    expect(ServerEnvSchema.parse({})).toEqual({
      FI_ENV: 'local',
      API_PORT: 4000,
      API_HOST: '127.0.0.1',
      MOCK_PDP_PORT: 4010,
      PGLITE_DIR: `${REPO_ROOT}.data/pglite`,
      RUNNER_CONTAINER: false,
      API_WORKERS: true,
      PDP_SYNC_INTERVAL_SECONDS: 300,
      MOCK_PDP_URL: 'http://localhost:4010',
      MOCK_PDP_WEBHOOK_SECRET: 'local-mock-pdp-webhook-secret',
      MOCK_PDP_SPEED: 86_400,
      API_PUBLIC_URL: 'http://localhost:4000',
      ADDIN_ORIGINS: ['https://localhost:3000'],
      AI_RUN_TOKENS: 30_000,
      AI_DAILY_TOKENS: 300_000,
      AI_STRUCTURED_OUTPUTS: false,
      SIRENE_URL: 'https://recherche-entreprises.api.gouv.fr',
      VIES_URL: 'https://ec.europa.eu/taxation_customs/vies/rest-api',
      STRIPE_AUTOMATIC_TAX: false,
      MOCK_STRIPE_WEBHOOK_SECRET: 'whsec_local-mock-stripe-secret',
      RELAY_POLL_SECONDS: 15,
      RELAY_PORT: 4020,
      RELAY_PGLITE_DIR: `${REPO_ROOT}.data/relay`,
      TELEGRAM_API_URL: 'https://api.telegram.org',
    });
  });

  it('coerces numbers and flags from strings, and reads an empty value as unset', () => {
    const env = ServerEnvSchema.parse({ API_PORT: '5000', API_WORKERS: 'false', DATABASE_URL: '' });
    expect(env.API_PORT).toBe(5000);
    expect(env.API_WORKERS).toBe(false);
    expect(env.DATABASE_URL).toBeUndefined();
    expect(ServerEnvSchema.parse({ PGLITE_DIR: '/var/fi' }).PGLITE_DIR).toBe('/var/fi');
    expect(
      ServerEnvSchema.parse({ ADDIN_ORIGINS: 'https://a.fr, https://b.fr,' }).ADDIN_ORIGINS,
    ).toEqual(['https://a.fr', 'https://b.fr']);
  });

  it('accepts only a 32-byte sealing key', () => {
    expect(() => ServerEnvSchema.parse({ AI_KEY_SEALING_KEY: 'c2hvcnQ=' })).toThrow(/32 bytes/);
    const key = Buffer.alloc(32, 7).toString('base64');
    expect(ServerEnvSchema.parse({ AI_KEY_SEALING_KEY: key }).AI_KEY_SEALING_KEY).toBe(key);
  });

  it('takes the B2Brouter key of its own environment, and requires one in sandbox', () => {
    const outside = { DATABASE_URL: 'postgres://fi@db/fi', ADMIN_TOKEN: 'x'.repeat(24) };
    expect(() => ServerEnvSchema.parse({ ...outside, FI_ENV: 'sandbox' })).toThrow(
      /B2BROUTER_API_KEY/,
    );
    expect(() =>
      ServerEnvSchema.parse({ ...outside, FI_ENV: 'sandbox', B2BROUTER_API_KEY: 'prod_abc' }),
    ).toThrow(/sandbox key/);
    expect(() =>
      ServerEnvSchema.parse({ ...outside, FI_ENV: 'prod', B2BROUTER_API_KEY: 'test_abc' }),
    ).toThrow(/production key/);
    const sandbox = ServerEnvSchema.parse({
      ...outside,
      FI_ENV: 'sandbox',
      B2BROUTER_API_KEY: 'test_abc',
      B2BROUTER_BASE_URL: '',
    });
    expect(sandbox.B2BROUTER_API_KEY).toBe('test_abc');
    expect(sandbox.B2BROUTER_BASE_URL).toBeUndefined();
    // Local takes any key: the stand-in in apps/mock-pdp wants a test_ one.
    expect(ServerEnvSchema.parse({ B2BROUTER_API_KEY: 'test_local' }).B2BROUTER_API_KEY).toBe(
      'test_local',
    );
  });

  it('rejects an unknown environment', () => {
    expect(() => ServerEnvSchema.parse({ FI_ENV: 'staging' })).toThrow();
  });

  it('requires a real database and an admin token outside local', () => {
    expect(() => ServerEnvSchema.parse({ FI_ENV: 'sandbox' })).toThrow(/DATABASE_URL/);
    const env = ServerEnvSchema.parse({
      FI_ENV: 'prod',
      DATABASE_URL: 'postgres://fi@db/fi',
      ADMIN_TOKEN: 'x'.repeat(24),
    });
    expect(env.FI_ENV).toBe('prod');
  });

  it('keeps the runner on its machine, its database out of the vault and in PGlite', () => {
    const runner = { VAULT_DIR: 'vault', PGLITE_DIR: '.data/pglite' };
    const env = ServerEnvSchema.parse({ ...runner, FI_ENV: 'prod', ADMIN_TOKEN: 'x'.repeat(24) });
    expect(env.VAULT_DIR).toBe(resolve(REPO_ROOT, 'vault'));
    expect(env.DATABASE_URL).toBeUndefined();

    const refused = (values: Record<string, string>, field: RegExp) =>
      expect(() => ServerEnvSchema.parse({ ...runner, ...values })).toThrow(field);
    refused({ DATABASE_URL: 'postgres://fi@db/fi' }, /DATABASE_URL/);
    refused({ PGLITE_DIR: 'vault/_system/base' }, /outside VAULT_DIR/);
    refused({ VAULT_DIR: '.data' }, /outside VAULT_DIR/);
    refused({ API_HOST: '0.0.0.0' }, /this machine only/);
    const boxed = ServerEnvSchema.parse({
      ...runner,
      API_HOST: '0.0.0.0',
      RUNNER_CONTAINER: 'true',
    });
    expect(boxed.API_HOST).toBe('0.0.0.0');
    expect(ServerEnvSchema.parse({ ...runner, API_HOST: 'localhost' }).API_HOST).toBe('localhost');
  });

  it('lets a runner only speak to a relay, with its licence and its own Ed25519 key', () => {
    const relay = {
      VAULT_DIR: 'vault',
      RELAY_URL: 'https://relay.example',
      RELAY_LICENCE: 'l'.repeat(32),
      RELAY_RUNNER_KEY: newRunnerKey(),
    };
    expect(ServerEnvSchema.parse(relay).RELAY_URL).toBe('https://relay.example');
    const refused = (values: Record<string, string>, message: RegExp) =>
      expect(() => ServerEnvSchema.parse({ ...relay, ...values })).toThrow(message);
    refused({ VAULT_DIR: '' }, /only a runner/);
    refused({ RELAY_LICENCE: '' }, /RELAY_LICENCE/);
    refused({ RELAY_RUNNER_KEY: '' }, /runner:key/);
    const rsa = generateKeyPairSync('rsa', { modulusLength: 1024 }).privateKey;
    refused(
      { RELAY_RUNNER_KEY: rsa.export({ format: 'der', type: 'pkcs8' }).toString('base64url') },
      /Ed25519/,
    );
    refused({ RELAY_RUNNER_KEY: 'not-a-key' }, /Ed25519/);
    expect(() => ServerEnvSchema.parse({ TELEGRAM_WEBHOOK_SECRET: 'short' })).toThrow(/16 to 256/);
  });

  it('is what .env.example lists, with the variables Vite and Astro read', () => {
    // apps/addin/vite.config.ts and the astro:env schema of apps/site/astro.config.mjs.
    const elsewhere = [
      'ADDIN_PORT',
      'ADDIN_API_URL',
      'SITE_PORT',
      'PUBLIC_SITE_URL',
      'PUBLIC_CONTACT_EMAIL',
      'SUPABASE_URL',
      'SUPABASE_PUBLISHABLE_KEY',
      'TRIAL_NOTIFY_TELEGRAM_BOT_TOKEN',
      'TRIAL_NOTIFY_TELEGRAM_CHAT_ID',
    ];
    const example = readFileSync(resolve(REPO_ROOT, '.env.example'), 'utf8');
    const listed = [...example.matchAll(/^([A-Z0-9_]+)=/gm)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...Object.keys(ServerEnvSchema.in.shape), ...elsewhere].sort());
  });
});

describe('t', () => {
  it('returns the French string for a key', () => {
    expect(t('app.title')).toBe('Facture Impec');
  });

  it('fills placeholders and recognises keys built at run time', () => {
    expect(t('rule.FF-IBAN-01.message', { value: 'FR76 X' })).toBe(
      "L'IBAN « FR76 X » semble mal recopié.",
    );
    expect(t('rule.FF-IBAN-01.message', { other: 1 })).toContain('{value}');
    expect(isMessageKey('app.title')).toBe(true);
    expect(isMessageKey('app.nope')).toBe(false);
    expect(isMessageKey('toString')).toBe(false);
  });
});
