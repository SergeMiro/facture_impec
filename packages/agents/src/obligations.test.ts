import { describe, expect, it } from 'vitest';
import type { DocumentFields } from './document-fields';
import { deriveObligations, kindOf, type SettleInput, settleDocument } from './obligations';

const OWN = '200000008';
const SOUS_TRAITANT = '100000009';
const OTHER = '300000007';

const fields = (f: Partial<DocumentFields> = {}): DocumentFields => ({
  issuedOn: null,
  validFrom: null,
  validTo: null,
  receptionOn: null,
  sirens: [],
  ...f,
});

const settle = (input: Partial<SettleInput> & Pick<SettleInput, 'label'>) =>
  settleDocument({
    documentId: 'doc-1',
    fields: fields(),
    own: OWN,
    parties: new Map(),
    isTest: false,
    ...input,
  });

describe('a document settled', () => {
  it('an attestation de vigilance of a known sous-traitant: renewal six months after issue', () => {
    expect(
      settle({
        label: 'attestation_vigilance',
        fields: fields({ issuedOn: '2026-08-31', sirens: [OWN, SOUS_TRAITANT] }),
        parties: new Map([[SOUS_TRAITANT, 'party-1']]),
      }),
    ).toEqual({
      kind: 'attestation_vigilance',
      stage: 'done',
      reviewReason: null,
      partyId: 'party-1',
      siren: SOUS_TRAITANT,
      confirm: null,
      obligations: [
        {
          kind: 'attestation_vigilance_renouvellement',
          key: `attestation_vigilance_renouvellement:${SOUS_TRAITANT}`,
          dueOn: '2027-02-28',
          amount: null,
          siren: SOUS_TRAITANT,
        },
      ],
    });
  });

  it('an unknown SIREN on a Kbis: its deadline still, and the company asked to confirm it', () => {
    const r = settle({
      label: 'kbis',
      fields: fields({ issuedOn: '2026-10-01', sirens: [OTHER] }),
    });
    expect(r).toMatchObject({ stage: 'done', partyId: null, siren: OTHER, confirm: OTHER });
    expect(r.obligations).toEqual([
      expect.objectContaining({ kind: 'kbis_renouvellement', dueOn: '2027-04-01' }),
    ]);
  });

  it("the company's own attestation renews too, with nothing to confirm", () => {
    const r = settle({
      label: 'attestation_vigilance',
      fields: fields({ issuedOn: '2026-10-01', sirens: [OWN] }),
    });
    expect(r).toMatchObject({ siren: OWN, confirm: null, stage: 'done' });
    expect(r.obligations[0]?.key).toBe(`attestation_vigilance_renouvellement:${OWN}`);
  });

  it('insurance: the end of its cover, décennale and RC apart', () => {
    const decennale = settle({
      label: 'attestation_assurance_decennale',
      fields: fields({ validTo: '2026-12-31', sirens: [SOUS_TRAITANT] }),
    });
    const rc = settle({
      label: 'attestation_assurance_rc',
      fields: fields({ validTo: '2026-12-31', sirens: [SOUS_TRAITANT] }),
    });
    expect(decennale.obligations[0]).toMatchObject({
      kind: 'assurance_expiration',
      key: `assurance_expiration:${SOUS_TRAITANT}:decennale`,
      dueOn: '2026-12-31',
    });
    expect(rc.obligations[0]?.key).toBe(`assurance_expiration:${SOUS_TRAITANT}:rc`);
  });

  it('a PV de réception: the retenue released a year later', () => {
    const r = settle({ label: 'pv_reception', fields: fields({ receptionOn: '2026-09-14' }) });
    expect(r.obligations).toEqual([
      {
        kind: 'retenue_garantie_liberation',
        key: 'retenue_garantie_liberation:doc-1',
        dueOn: '2027-09-14',
        amount: null,
        siren: null,
      },
    ]);
  });

  it('goes to a person when its date, its company or its data is missing', () => {
    expect(settle({ label: 'kbis', fields: fields({ sirens: [OTHER] }) })).toMatchObject({
      stage: 'needs_review',
      reviewReason: 'dates_missing',
      obligations: [],
      confirm: null,
    });
    expect(
      settle({
        label: 'attestation_vigilance',
        fields: fields({ issuedOn: '2026-10-01', sirens: [OTHER, SOUS_TRAITANT] }),
      }),
    ).toMatchObject({ stage: 'needs_review', reviewReason: 'party_unclear' });
    expect(
      settle({ label: 'attestation_assurance_rc', fields: fields({ validTo: '2027-01-01' }) }),
    ).toMatchObject({ reviewReason: 'party_unclear' });
    expect(settle({ label: 'pv_reception' })).toMatchObject({ reviewReason: 'dates_missing' });
    // An invoice without its XML: its amounts wait for the owner's decision (D7).
    expect(
      settle({ label: 'facture', fields: fields({ sirens: [SOUS_TRAITANT, OWN] }) }),
    ).toMatchObject({
      kind: 'facture_achat',
      stage: 'needs_review',
      reviewReason: 'invoice_without_data',
    });
    expect(settle({ label: 'situation' })).toMatchObject({ reviewReason: 'invoice_without_data' });
  });

  it('is done without a deadline for the kinds that make none', () => {
    for (const label of ['devis', 'contrat_sous_traitance', 'dgd', 'autre'] as const) {
      expect(settle({ label, fields: fields({ sirens: [SOUS_TRAITANT] }) })).toMatchObject({
        stage: 'done',
        obligations: [],
        confirm: null,
      });
    }
  });

  it('keeps Mode test apart in every key', () => {
    const r = settle({
      label: 'kbis',
      fields: fields({ issuedOn: '2026-10-01', sirens: [OTHER] }),
      isTest: true,
    });
    expect(r.obligations[0]?.key).toBe(`test:kbis_renouvellement:${OTHER}`);
  });
});

describe('deadlines of an invoice read from its XML', () => {
  const invoice = { number: 'F-12', sellerSiren: OWN, dueDate: '2026-11-30', payable: 120_000 };

  it('a sale: its due date and what is left to pay, keyed by seller and number', () => {
    expect(
      deriveObligations({
        documentId: 'doc-2',
        kind: 'facture_vente',
        fields: fields(),
        siren: SOUS_TRAITANT,
        invoice,
        isTest: false,
      }),
    ).toEqual([
      {
        kind: 'facture_echeance',
        key: `facture_echeance:${OWN}:F-12`,
        dueOn: '2026-11-30',
        amount: 120_000,
        siren: SOUS_TRAITANT,
      },
    ]);
  });

  it('nothing for a purchase, a sale without a due date, a number or anything to pay', () => {
    const base = { documentId: 'd', fields: fields(), siren: null, isTest: false };
    expect(deriveObligations({ ...base, kind: 'facture_achat', invoice })).toEqual([]);
    expect(
      deriveObligations({ ...base, kind: 'facture_vente', invoice: { ...invoice, dueDate: null } }),
    ).toEqual([]);
    expect(
      deriveObligations({ ...base, kind: 'facture_vente', invoice: { ...invoice, payable: 0 } }),
    ).toEqual([]);
    expect(
      deriveObligations({ ...base, kind: 'facture_vente', invoice: { ...invoice, number: '' } }),
    ).toEqual([]);
  });

  it('a text invoice is a sale only when the company alone is named', () => {
    expect(kindOf('facture', [OWN], OWN)).toBe('facture_vente');
    expect(kindOf('facture', [OWN, OTHER], OWN)).toBe('facture_achat');
    expect(kindOf('facture', [], OWN)).toBe('facture_achat');
    expect(kindOf('kbis', [OWN], OWN)).toBe('kbis');
  });
});
