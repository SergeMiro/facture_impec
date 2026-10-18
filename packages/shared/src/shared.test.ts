import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, ServerEnvSchema } from './env';
import { isMessageKey, t } from './i18n';

describe('ServerEnvSchema', () => {
  it('defaults to the local environment, standard ports and an embedded database', () => {
    expect(ServerEnvSchema.parse({})).toEqual({
      FI_ENV: 'local',
      API_PORT: 4000,
      MOCK_PDP_PORT: 4010,
      PGLITE_DIR: `${REPO_ROOT}.data/pglite`,
      API_WORKERS: true,
      PDP_SYNC_INTERVAL_SECONDS: 300,
      MOCK_PDP_URL: 'http://localhost:4010',
      MOCK_PDP_WEBHOOK_SECRET: 'local-mock-pdp-webhook-secret',
      MOCK_PDP_SPEED: 86_400,
      API_PUBLIC_URL: 'http://localhost:4000',
      ADDIN_ORIGINS: ['https://localhost:3000'],
      AI_RUN_TOKENS: 30_000,
      AI_DAILY_TOKENS: 300_000,
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

  it('is what .env.example lists, with the variables Vite and Astro read', () => {
    // apps/addin/vite.config.ts and the astro:env schema of apps/site/astro.config.mjs.
    const elsewhere = [
      'ADDIN_PORT',
      'ADDIN_API_URL',
      'SITE_PORT',
      'PUBLIC_SITE_URL',
      'PUBLIC_CONTACT_EMAIL',
      'SUPABASE_URL',
      'SUPABASE_SECRET_KEY',
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
