// Every invalid fixture whose rule comes from EN 16931 is written in both syntaxes and run through
// the CEN schematrons: (a) the schematron fires the expected rule, and (b) every EN 16931 error our
// rules raise is one the schematron raises too, in at least one syntax. Cases with a French or
// sanity rule stay out: the schematron knows nothing of them, and some would not even run (a VAT
// rate of "5,5" stops the stylesheet).
import { describe, expect, it } from 'vitest';
import { getRule, validate } from '../../src/rules';
import { toCii, toUbl } from '../../src/xml';
import { buildCase, invalidCases } from '../fixtures';
import { fatal, runSchematron } from './schematron';

type Syntax = 'cii' | 'ubl';

/** Rule and syntax pairs a CEN artefact does not check the way EN 16931 and our rule do. */
const NOT_IN_ARTEFACT: Record<string, { syntaxes: Syntax[]; why: string }> = {
  'BR-61': {
    syntaxes: ['cii'],
    why: 'CEN CII checks the IBAN only inside a ram:PayeePartyCreditorFinancialAccount; an account without IBAN writes none',
  },
  'BR-O-01': {
    syntaxes: ['cii'],
    why: 'CEN CII asserts it only from a VAT breakdown with category O',
  },
  'BR-CO-17': {
    syntaxes: ['cii'],
    why: 'CEN CII tolerates exactly one unit of difference (<=), CEN UBL does not (<); we follow UBL',
  },
  'BR-CO-19': {
    syntaxes: ['cii', 'ubl'],
    why: 'an empty invoice period cannot be written: the builders leave out empty elements',
  },
  'BR-CO-20': {
    syntaxes: ['cii', 'ubl'],
    why: 'an empty line period cannot be written: the builders leave out empty elements',
  },
};

/**
 * The artefacts split the VAT category code lists by element: BT-118 is BR-CL-18 in CEN CII
 * (ram:ApplicableTradeTax) and BR-CL-17 in CEN UBL (cac:TaxCategory). Our ids follow CII.
 */
const normalize = (id: string) => (id === 'BR-CL-18' ? 'BR-CL-17' : id);

/** Rules no CEN artefact can see: left out of check (b). */
const blind = (id: string) => NOT_IN_ARTEFACT[id]?.syntaxes.length === 2;

const cenCases = invalidCases.filter((c) => getRule(c.rule).source === 'EN16931');
const used = new Set<string>();

describe('invalid fixtures through the CEN schematrons', () => {
  it('covers the EN 16931 cases', () => {
    expect(cenCases.length).toBeGreaterThanOrEqual(60);
  });

  it.each(cenCases.map((c) => [`${c.rule} on ${c.base}${c.why ? ` (${c.why})` : ''}`, c] as const))(
    '%s',
    async (_, c) => {
      const { invoice, context } = buildCase(c);
      const fired: Record<Syntax, Set<string>> = {
        cii: new Set(
          fatal(await runSchematron('cen-cii', toCii(invoice))).map((h) => normalize(h.id)),
        ),
        ubl: new Set(
          fatal(await runSchematron('cen-ubl', toUbl(invoice))).map((h) => normalize(h.id)),
        ),
      };
      const skip = NOT_IN_ARTEFACT[c.rule];

      for (const syntax of ['cii', 'ubl'] as const) {
        const hit = fired[syntax].has(normalize(c.rule));
        if (skip?.syntaxes.includes(syntax) && !hit) used.add(c.rule);
        else expect(hit, `${c.rule} in CEN ${syntax.toUpperCase()}`).toBe(true);
      }

      const ours = validate(invoice, context)
        .filter((i) => i.severity === 'error' && getRule(i.ruleId).source === 'EN16931')
        .map((i) => normalize(i.ruleId))
        .filter((id) => !blind(id));
      const unknown = ours.filter((id) => !fired.cii.has(id) && !fired.ubl.has(id));
      expect(unknown, 'our EN 16931 errors the schematrons do not raise').toEqual([]);
    },
  );

  it('needs every documented artefact difference', () => {
    expect([...used].sort()).toEqual(Object.keys(NOT_IN_ARTEFACT).sort());
  });
});
