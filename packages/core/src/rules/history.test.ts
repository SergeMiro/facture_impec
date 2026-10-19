import { describe, expect, it } from 'vitest';
import { goldens, TODAY } from '../../test/fixtures';
import { computeInvoice } from '../compute';
import { type Invoice, InvoiceDraft } from '../model';
import { type HistoryEntry, NumberingHistory } from './history';
import { validate } from './index';

const golden = goldens[0];
if (!golden) throw new Error('no golden fixture');
const base = computeInvoice(InvoiceDraft.parse(golden.draft));
const SIREN = base.seller.legalId?.id ?? '';

/** mulberry32: the same random histories on every run. */
function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PREFIXES = ['F2026-', 'F2026-', 'AV-', ''];
const DATES = ['2025-12-30', '2026-01-05', '2026-03-01', '2026-03-01', '2026-06-15', '2026-10-15'];

function scenario(next: () => number) {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(next() * list.length)] as T;
  const number = () =>
    next() < 0.1
      ? pick(['ABC', 'F2026-X', ' '])
      : `${pick(PREFIXES)}${String(1 + Math.floor(next() * 12)).padStart(pick([1, 2, 4]), '0')}`;
  const history: HistoryEntry[] = Array.from({ length: Math.floor(next() * 14) }, (_, i) => ({
    id: `h${i}`,
    number: number(),
    issueDate: pick(DATES),
    ...(next() < 0.8 && { sellerSiren: next() < 0.9 ? SIREN : '300000004' }),
  }));
  const self = history.length > 0 && next() < 0.4 ? pick(history).id : undefined;
  const invoice: Invoice = {
    ...base,
    ...(next() < 0.9 ? { number: number() } : { number: undefined }),
    ...(next() < 0.9 ? { issueDate: pick(DATES) } : { issueDate: undefined }),
    precedingInvoices: Array.from(
      { length: next() < 0.6 ? 0 : 1 + Math.floor(next() * 2) },
      () => ({
        ...(next() < 0.9 && {
          number: next() < 0.6 && history.length > 0 ? pick(history).number : number(),
        }),
        ...(next() < 0.5 && { issueDate: pick(DATES) }),
      }),
    ),
  };
  return { history, self, invoice };
}

describe('NumberingHistory', () => {
  it('gives every history rule the verdict of the whole list (1 000 random histories)', () => {
    const next = random(20261019);
    let withHistoryIssues = 0;
    for (let i = 0; i < 1_000; i++) {
      const { history, self, invoice } = scenario(next);
      const index = new NumberingHistory(history);
      const all = index.entries.filter((e) => e.id !== self);
      const context = { today: TODAY, seller: { vatOnDebits: false } };
      const full = validate(invoice, { ...context, history: all });
      const few = validate(invoice, { ...context, history: index.for(invoice, self) });
      expect(few, JSON.stringify({ history, self, invoice: invoice.number })).toEqual(full);
      const ids = new Set(['BR-FR-CO-02', 'FF-NUM-01', 'FF-NUM-02', 'FF-CN-01']);
      if (full.some((issue) => ids.has(issue.ruleId))) withHistoryIssues++;
    }
    // The random histories do raise the rules, not just stay quiet.
    expect(withHistoryIssues).toBeGreaterThan(200);
  }, 30_000);

  it('hands each invoice a few entries, never itself', () => {
    const history = Array.from({ length: 5_000 }, (_, i) => ({
      id: `h${i}`,
      number: `F2026-${String(i + 1).padStart(5, '0')}`,
      issueDate: '2026-10-01',
      sellerSiren: SIREN,
    }));
    const index = new NumberingHistory(history);
    const subject = { ...base, number: 'F2026-00042', issueDate: '2026-10-01' };
    expect(index.for(subject, 'h41')).toEqual([
      { number: 'F2026-00043', issueDate: '2026-10-01', sellerSiren: SIREN },
    ]);
    expect(index.for({ ...subject, number: 'F2026-05001' })).toEqual([
      { number: 'F2026-05000', issueDate: '2026-10-01', sellerSiren: SIREN },
    ]);
  });
});
