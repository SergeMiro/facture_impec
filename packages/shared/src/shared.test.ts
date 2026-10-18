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
    });
  });

  it('coerces numbers and flags from strings, and reads an empty value as unset', () => {
    const env = ServerEnvSchema.parse({ API_PORT: '5000', API_WORKERS: 'false', DATABASE_URL: '' });
    expect(env.API_PORT).toBe(5000);
    expect(env.API_WORKERS).toBe(false);
    expect(env.DATABASE_URL).toBeUndefined();
    expect(ServerEnvSchema.parse({ PGLITE_DIR: '/var/fi' }).PGLITE_DIR).toBe('/var/fi');
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

  it('is what .env.example lists, plus the add-in port Vite reads', () => {
    const example = readFileSync(resolve(REPO_ROOT, '.env.example'), 'utf8');
    const listed = [...example.matchAll(/^([A-Z_]+)=/gm)].map((m) => m[1]);
    expect(listed.sort()).toEqual([...Object.keys(ServerEnvSchema.in.shape), 'ADDIN_PORT'].sort());
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
