import { describe, expect, it } from 'vitest';
import { computeGolden, golden, TODAY } from '../../test/fixtures';
import type { ContextInput } from './index';
import { validate } from './index';

const situation = golden('26-btp-situation-retenue');
const btp = situation.context?.btp ?? {};
const ids = (g: typeof situation, context: ContextInput) =>
  validate(computeGolden(g), { today: TODAY, ...context })
    .filter((i) => i.ruleId.startsWith('BTP-'))
    .map((i) => i.ruleId);

describe('BTP rules', () => {
  it('stay silent for a company that is not a building firm', () => {
    expect(ids(golden('01-services-standard-rate'), {})).toEqual([]);
    expect(ids(golden('05-reverse-charge-construction'), {})).toEqual([]);
    expect(ids(situation, {})).toEqual([]);
  });

  it('call a sous-traitant invoice with VAT an error, in plain French', () => {
    const [issue] = validate(computeGolden(golden('01-services-standard-rate')), {
      today: TODAY,
      btp: { subcontracting: true },
    }).filter((i) => i.ruleId === 'BTP-AUTOLIQ-01');
    expect(issue).toMatchObject({ severity: 'error', path: 'vatBreakdown[0].category' });
    expect(issue?.messageFr).toBe(
      "Entre un sous-traitant du bâtiment et l'entreprise qui lui confie les travaux, la TVA est autoliquidée : cette facture ne doit pas porter de TVA (article 283, 2 nonies du CGI).",
    );
  });

  it('accept a retenue of exactly 5 % of the TTC, refuse a cent more', () => {
    expect(ids(situation, { btp: { ...btp, retenue: { amount: 132_000 } } })).toEqual([]);
    expect(ids(situation, { btp: { ...btp, retenue: { amount: 132_001 } } })).toEqual([
      'BTP-RG-01',
    ]);
    expect(ids(situation, { btp: { ...btp, retenue: { rateBps: 500 } } })).toEqual([]);
  });

  it('say which situation number was expected, and the two cumulative amounts', () => {
    const issues = validate(computeGolden(situation), {
      today: TODAY,
      btp: {
        ...btp,
        situation: {
          number: 5,
          cumulative: 3_950_050,
          previous: { number: 3, cumulative: 4_000_000 },
        },
      },
    });
    const text = (id: string) => issues.find((i) => i.ruleId === id);
    expect(text('BTP-SIT-01')?.messageFr).toBe(
      'Cette situation porte le n° 5, alors que la précédente de ce chantier était la n° 3.',
    );
    expect(text('BTP-SIT-01')?.fixHintFr).toBe(
      "Numérotez-la 4, ou vérifiez qu'aucune situation ne manque.",
    );
    expect(text('BTP-SIT-02')?.messageFr.replace(/\s/g, ' ')).toBe(
      'Le cumul des travaux de cette situation (39 500,50 €) est inférieur à celui de la précédente (40 000,00 €).',
    );
  });

  it('know nothing of a first situation, or of a chantier not linked', () => {
    expect(ids(situation, { btp: { ...btp, situation: { number: 1 } } })).toEqual([]);
    const { chantier: _chantier, ...unlinked } = btp;
    expect(ids(situation, { btp: unlinked })).toEqual([]);
  });
});
