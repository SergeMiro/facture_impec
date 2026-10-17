import { describe, expect, it } from 'vitest';
import { ServerEnvSchema } from './env';
import { isMessageKey, t } from './i18n';

describe('ServerEnvSchema', () => {
  it('defaults to the local environment and standard ports', () => {
    expect(ServerEnvSchema.parse({})).toEqual({
      FI_ENV: 'local',
      API_PORT: 4000,
      MOCK_PDP_PORT: 4010,
    });
  });

  it('coerces ports from strings', () => {
    expect(ServerEnvSchema.parse({ API_PORT: '5000' }).API_PORT).toBe(5000);
  });

  it('rejects an unknown environment', () => {
    expect(() => ServerEnvSchema.parse({ FI_ENV: 'staging' })).toThrow();
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
