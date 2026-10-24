import { readFileSync } from 'node:fs';
import { type Invoice, toCii } from '@fi/core';
import { computeGolden, FIXTURES, golden, TODAY } from '@fi/core/testing';
import { describe, expect, it } from 'vitest';
import {
  type EarlierInbound,
  type InboundRead,
  readInbound,
  retriageSubcontracting,
  triageInbound,
} from './inbound';

const BUYER = '200000008';
const IBAN = 'FR7630006000011234567890189';
const OTHER_IBAN = 'FR7630004000031234567890143';
const xml = (name: string, syntax: 'cii' | 'ubl' = 'cii') =>
  readFileSync(new URL(`golden/${name}.${syntax}.xml`, FIXTURES), 'utf8');
const read = (name: string, syntax: 'cii' | 'ubl' = 'cii') => readInbound(xml(name, syntax), TODAY);
const edited = (name: string, edit: (invoice: Invoice) => Invoice) =>
  readInbound(toCii(edit(computeGolden(golden(name)))), TODAY);
const ok = (r: InboundRead) => {
  if (!r.ok) throw new Error(r.reason);
  return r;
};

const earlier = (extra: Partial<EarlierInbound> = {}): EarlierInbound => ({
  id: 'earlier-1',
  supplierKey: 'siren:100000009',
  number: 'F2026-0041',
  issueDate: '2026-10-01',
  amount: 50_000,
  ibans: [IBAN],
  status: 'approved',
  // 23:30 UTC on the 16th is the 17th in Paris.
  receivedAt: new Date('2026-10-16T23:30:00Z'),
  ...extra,
});
const codes = (r: InboundRead, past: EarlierInbound[] = [], buyerSiren = BUYER) =>
  triageInbound(r, { buyerSiren, earlier: past }).flags.map((f) => f.code);

describe('InboundAgent reads a supplier invoice', () => {
  it('keeps what the later checks and the export need, from CII and UBL alike', () => {
    for (const syntax of ['cii', 'ubl'] as const) {
      const r = ok(read('01-services-standard-rate', syntax));
      expect(r.facts).toEqual({
        supplierKey: 'siren:100000009',
        supplierName: 'Atelier Dupont SARL',
        number: 'F2026-0042',
        issueDate: '2026-10-15',
        dueDate: '2026-11-14',
        amount: r.invoice.totals.taxInclusive,
        currency: 'EUR',
        ibans: [IBAN],
      });
      expect(r.issues.filter((i) => i.severity === 'error')).toEqual([]);
    }
  });

  it('says a file it cannot read is unreadable, and nothing else', () => {
    for (const bad of ['not xml at all <', '<Order xmlns="urn:x"/>']) {
      const r = readInbound(bad, TODAY);
      expect(r.ok).toBe(false);
      expect(triageInbound(r, { buyerSiren: BUYER, earlier: [] })).toEqual({
        flags: [{ code: 'unreadable' }],
      });
    }
  });
});

describe('InboundAgent triage', () => {
  it('only notes a new supplier on a clean first invoice', () => {
    expect(codes(read('01-services-standard-rate'))).toEqual(['new_supplier']);
    expect(codes(read('01-services-standard-rate'), [earlier()])).toEqual([]);
  });

  it('blocks an invoice addressed to another company', () => {
    const flags = triageInbound(read('01-services-standard-rate'), {
      buyerSiren: '300000006',
      earlier: [],
    }).flags;
    expect(flags[0]).toEqual({ code: 'other_buyer', params: { siren: BUYER } });
  });

  it('blocks the same number twice from one supplier, unless the first was disputed', () => {
    const r = read('01-services-standard-rate');
    const first = earlier({ number: 'f2026-0042' });
    const { flags } = triageInbound(r, { buyerSiren: BUYER, earlier: [first] });
    expect(flags).toEqual([
      {
        code: 'duplicate',
        params: { number: 'f2026-0042', date: '17/10/2026' },
        relatedId: 'earlier-1',
      },
    ]);
    // Another supplier's number is not a duplicate; a corrected copy of a disputed invoice is welcome.
    expect(codes(r, [{ ...first, supplierKey: 'siren:300000006' }])).toEqual(['new_supplier']);
    expect(codes(r, [{ ...first, status: 'disputed' }])).toEqual([]);
  });

  it('warns when another number has the same amount and date', () => {
    const r = ok(read('01-services-standard-rate'));
    const twin = earlier({ issueDate: '2026-10-15', amount: r.facts.amount });
    expect(codes(r, [twin])).toEqual(['possible_duplicate']);
    expect(codes(r, [{ ...twin, issueDate: '2026-10-14' }])).toEqual([]);
  });

  it('raises the alert when the IBAN is not one the supplier used before', () => {
    const r = read('01-services-standard-rate');
    const { flags } = triageInbound(r, {
      buyerSiren: BUYER,
      earlier: [
        earlier({ id: 'old', ibans: [IBAN], receivedAt: new Date('2026-09-01T10:00:00Z') }),
        earlier({ ibans: [OTHER_IBAN] }),
      ],
    });
    // The current IBAN was used in September: no alert, the supplier is going back to it.
    expect(flags).toEqual([]);
    expect(
      triageInbound(r, { buyerSiren: BUYER, earlier: [earlier({ ibans: [OTHER_IBAN] })] }).flags,
    ).toEqual([
      {
        code: 'iban_changed',
        params: { before: 'FR76 •••• •••• 0143', after: 'FR76 •••• •••• 0189' },
      },
    ]);
    // Nothing to compare with: an earlier invoice without an IBAN, or a disputed one.
    expect(codes(r, [earlier({ ibans: [] })])).toEqual([]);
    expect(codes(r, [earlier({ ibans: [OTHER_IBAN], status: 'disputed' })])).toEqual([]);
  });

  it('warns about an IBAN whose check digits are wrong', () => {
    const r = edited('01-services-standard-rate', (inv) => ({
      ...inv,
      payment: { ...inv.payment, accounts: [{ iban: 'FR7630006000011234567890188' }] },
    }));
    const flags = triageInbound(r, { buyerSiren: BUYER, earlier: [earlier()] }).flags;
    expect(flags).toContainEqual({ code: 'iban_invalid', params: { iban: 'FR76 •••• •••• 0188' } });
  });

  it('blocks totals that are not the sum of what was bought, ahead of any other flag', () => {
    const r = edited('01-services-standard-rate', (inv) => ({
      ...inv,
      totals: { ...inv.totals, taxInclusive: (inv.totals.taxInclusive ?? 0) + 100 },
    }));
    const { flags } = triageInbound(r, { buyerSiren: BUYER, earlier: [] });
    expect(flags[0]?.code).toBe('amounts');
    expect(flags[0]?.details?.length).toBeGreaterThan(0);
    expect(flags.at(-1)?.code).toBe('new_supplier');
  });

  it('lists the other rule errors for information', () => {
    const r = edited('01-services-standard-rate', (inv) => ({ ...inv, number: undefined }));
    const flags = triageInbound(r, { buyerSiren: BUYER, earlier: [earlier()] }).flags;
    const rules = flags.find((f) => f.code === 'rules');
    expect(rules?.params?.count).toBeGreaterThan(0);
    expect(rules?.details?.[0]).toEqual(expect.any(String));
  });

  it('notes a credit note and a foreign currency', () => {
    expect(codes(read('10-credit-note'), [earlier()])).toEqual(['credit_note']);
    expect(
      triageInbound(read('16-foreign-currency'), { buyerSiren: BUYER, earlier: [earlier()] }).flags,
    ).toContainEqual({
      code: 'foreign_currency',
      params: { currency: 'USD' },
    });
  });
});

describe('InboundAgent for a building firm (BTP)', () => {
  const marked = { subcontractors: new Set(['100000009']) };
  const btp = (name: string, given = marked) => readInbound(xml(name), TODAY, given);

  it('flags VAT charged by a supplier the company marked as its sous-traitant, nothing else', () => {
    expect(codes(btp('01-services-standard-rate'))).toEqual(['subcontracting_vat', 'new_supplier']);
    // Under reverse charge, as a sous-traitant must invoice; an unmarked supplier, or no BTP: silent.
    expect(codes(btp('05-reverse-charge-construction'))).toEqual(['new_supplier']);
    expect(codes(btp('01-services-standard-rate', { subcontractors: new Set() }))).toEqual([
      'new_supplier',
    ]);
    expect(codes(read('01-services-standard-rate'))).toEqual(['new_supplier']);
  });

  it("makes only that flag again when the company's word moves", () => {
    const before = triageInbound(ok(read('01-services-standard-rate')), {
      buyerSiren: BUYER,
      earlier: [earlier({ number: 'F2026-0042' })],
    });
    expect(before.flags.map((f) => f.code)).toEqual(['duplicate']);
    const marked = retriageSubcontracting(before, btp('01-services-standard-rate'));
    expect(marked.flags.map((f) => f.code)).toEqual(['duplicate', 'subcontracting_vat']);
    const unmarked = retriageSubcontracting(marked, read('01-services-standard-rate'));
    expect(unmarked).toEqual(before);
    expect(retriageSubcontracting(before, readInbound('not xml <', TODAY))).toEqual(before);
  });
});
