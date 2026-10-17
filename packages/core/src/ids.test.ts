import { describe, expect, it } from 'vitest';
import {
  frenchVatKey,
  hasValidFrenchVatKey,
  isValidIban,
  isValidSiren,
  isValidSiret,
  luhn,
} from './ids';

describe('French identifiers', () => {
  it('checks SIREN with Luhn', () => {
    // AFNOR XP Z12-012 Annexe B examples.
    for (const siren of ['100000009', '200000008', '500000005', '356000000']) {
      expect(isValidSiren(siren)).toBe(true);
    }
    expect(isValidSiren('100000008')).toBe(false);
    expect(isValidSiren('12345678')).toBe(false);
    expect(isValidSiren('10000000A')).toBe(false);
  });

  it('checks SIRET with Luhn and the La Poste exception', () => {
    expect(isValidSiret('10000000900017')).toBe(luhn('10000000900017'));
    expect(isValidSiret('35600000000048')).toBe(true); // La Poste head office passes Luhn
    // Two active La Poste establishments that fail Luhn (Sirene register, FR_RULES Q5).
    expect(luhn('35600000069588')).toBe(false);
    expect(isValidSiret('35600000069588')).toBe(true);
    expect(isValidSiret('35600000009075')).toBe(true);
    expect(isValidSiret('35600000009076')).toBe(false);
    expect(isValidSiret('81234567600011')).toBe(false);
    expect(isValidSiret('8123456760001')).toBe(false);
  });

  it('computes the French VAT key', () => {
    // The three official AFNOR examples.
    expect(frenchVatKey('100000009')).toBe('88');
    expect(frenchVatKey('200000008')).toBe('37');
    expect(frenchVatKey('500000005')).toBe('78');
    expect(hasValidFrenchVatKey('FR88100000009')).toBe(true);
    expect(hasValidFrenchVatKey('FR89100000009')).toBe(false);
    expect(hasValidFrenchVatKey('FRXA100000009')).toBe(true); // letter key: not checkable offline
    expect(hasValidFrenchVatKey('DE123456789')).toBe(false);
  });

  it('checks IBAN with mod 97', () => {
    expect(isValidIban('FR7630006000011234567890189')).toBe(true);
    expect(isValidIban('DE89370400440532013000')).toBe(true);
    expect(isValidIban('FR7630006000011234567890188')).toBe(false);
    expect(isValidIban('FR76 3000 6000 0112 3456 7890 189')).toBe(false);
  });
});
