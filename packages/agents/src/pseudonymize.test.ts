import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Pseudonymizer } from './pseudonymize';

const digits = (n: number) =>
  fc.array(fc.integer({ min: 0, max: 9 }), { minLength: n, maxLength: n });
const siren = digits(9).map((d) => d.join(''));
const iban = digits(23).map((d) => `FR76${d.join('')}`);
const email = fc
  .tuple(fc.stringMatching(/^[a-z]{2,8}$/), fc.stringMatching(/^[a-z]{2,8}$/))
  .map(([a, b]) => `${a}@${b}.fr`);
const phone = digits(8).map((d) => `06${d.join('')}`);
const fakeToken = fc.integer({ min: 1, max: 99 }).map((n) => `{{PARTY_${n}}}`);
const secret = fc.oneof(siren, iban, email, phone);
const filler = fc.oneof(
  fc.string({ maxLength: 12 }),
  fc.constantFrom(' ', ', ', ' – ', 'Prestation de conseil ', '1 250,00 € ', '17/10/2026 '),
);

describe('Pseudonymizer', () => {
  it('masks identifiers, contacts, names and street lines, and keeps amounts and dates', () => {
    const p = new Pseudonymizer();
    const text =
      'Facture pour SARL Boulangerie Martin (SIREN 732 829 320, TVA FR44732829320), M. Jean Dupont, ' +
      'jean.dupont@exemple.fr, 06 12 34 56 78, 12 bis rue des Lilas, IBAN FR76 3000 6000 0112 3456 7890 189. ' +
      'Total 1 250,00 € au 17/10/2026, SIRET 73282932000074.';
    const masked = p.mask(text);
    for (const leak of [
      'Martin',
      '732 829 320',
      'FR44732829320',
      'Dupont',
      'jean.dupont',
      '06 12',
      'Lilas',
      'FR76 3000',
      '73282932000074',
    ])
      expect(masked).not.toContain(leak);
    expect(masked).toContain('1 250,00 €');
    expect(masked).toContain('17/10/2026');
    expect(masked).toMatch(/\{\{PARTY_1\}\}.*\{\{SIREN_1\}\}.*\{\{VAT_1\}\}.*\{\{PERSON_1\}\}/);
    expect(p.unmask(masked).text).toBe(text);
  });

  it('gives the same value the same token, and declared values win over patterns', () => {
    const p = new Pseudonymizer()
      .protect('PARTY', 'Atelier Dubois')
      .protect('ADDRESS', '4 place Ney');
    expect(p.mask('Atelier Dubois, 4 place Ney')).toBe('{{PARTY_1}}, {{ADDRESS_1}}');
    expect(p.mask('Encore Atelier Dubois')).toBe('Encore {{PARTY_1}}');
    expect(p.protect('PARTY', ' ').protect('PARTY', undefined).mask('x')).toBe('x');
  });

  it('masks text that already looks like a token, so it comes back untouched', () => {
    const p = new Pseudonymizer();
    const masked = p.mask('Voir {{PARTY_1}} et {{IBAN_2}}');
    expect(masked).toBe('Voir {{LITERAL_1}} et {{LITERAL_2}}');
    expect(p.unmask(masked).text).toBe('Voir {{PARTY_1}} et {{IBAN_2}}');
  });

  it('reports tokens it never issued instead of passing them on', () => {
    const p = new Pseudonymizer();
    p.mask('SIREN 732829320');
    expect(p.unmask('{{SIREN_1}} et {{PARTY_7}}')).toEqual({
      text: '732829320 et {{PARTY_7}}',
      unknown: ['{{PARTY_7}}'],
    });
    expect(p.unmaskDeep({ a: ['{{SIREN_1}}', 3], b: { c: '{{X_1}}' }, d: null })).toEqual({
      value: { a: ['732829320', 3], b: { c: '{{X_1}}' }, d: null },
      unknown: ['{{X_1}}'],
    });
  });

  it('round-trips any text (property)', () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(filler, secret, fakeToken), { maxLength: 12 }), (parts) => {
        const p = new Pseudonymizer();
        const text = parts.join(' ');
        const masked = p.mask(text);
        expect(p.unmask(masked)).toEqual({ text, unknown: [] });
      }),
      { numRuns: 500 },
    );
  });

  it('never lets a generated identifier, IBAN, e-mail or phone through (property)', () => {
    fc.assert(
      fc.property(fc.array(secret, { minLength: 1, maxLength: 5 }), filler, (secrets, glue) => {
        const p = new Pseudonymizer();
        const masked = p.mask(secrets.join(` ${glue.replace(/[\w@.]/g, '')} `));
        for (const s of secrets) expect(masked).not.toContain(s);
      }),
      { numRuns: 300 },
    );
  });

  it('keeps tokens stable across calls (property)', () => {
    fc.assert(
      fc.property(secret, (s) => {
        const p = new Pseudonymizer();
        expect(p.mask(`a ${s} b`)).toBe(p.mask(`a ${s} b`));
      }),
    );
  });
});
