import { describe, expect, it } from 'vitest';
import { computeGolden, goldens, TODAY } from '../test/fixtures';
import { computeInvoice } from './compute';
import { creditNoteDraft, nextCreditNumber } from './credit';
import { InvoiceDraft } from './model';
import { validate } from './rules';

describe('credit notes', () => {
  it.each(goldens.filter((g) => g.draft.typeCode !== '381').map((g) => [g.name, g] as const))(
    'credits %s in full, with no error',
    (_, g) => {
      const issued = computeGolden(g);
      const draft = creditNoteDraft(
        InvoiceDraft.parse(g.draft),
        { number: issued.number ?? '', issueDate: issued.issueDate ?? '' },
        { number: 'AV2026-0001', issueDate: TODAY },
      );
      const credit = computeInvoice(InvoiceDraft.parse(draft));
      expect(credit).toMatchObject({
        typeCode: '381',
        number: 'AV2026-0001',
        issueDate: TODAY,
        precedingInvoices: [{ number: issued.number, issueDate: issued.issueDate }],
      });
      expect(credit.dueDate).toBeUndefined();
      expect(credit.totals.payable).toBe(issued.totals.payable);
      const errors = validate(credit, { today: TODAY, ...g.context }).filter(
        (i) => i.severity === 'error',
      );
      expect(errors.map((i) => i.ruleId)).toEqual([]);
    },
  );

  it('leaves the original draft as it was', () => {
    const g = goldens[0];
    if (!g) throw new Error('no golden');
    const original = InvoiceDraft.parse(g.draft);
    const before = structuredClone(original);
    creditNoteDraft(
      original,
      { number: 'F1', issueDate: TODAY },
      { number: 'AV1', issueDate: TODAY },
    );
    expect(original).toEqual(before);
  });

  it('numbers credit notes in their own series, per year', () => {
    expect(nextCreditNumber('2026', [])).toBe('AV2026-0001');
    expect(nextCreditNumber('2026', ['AV2026-0007', 'AV2026-0012', 'F2026-0099'])).toBe(
      'AV2026-0013',
    );
    expect(nextCreditNumber('2027', ['AV2026-0012'])).toBe('AV2027-0001');
    expect(nextCreditNumber('2026', ['AV2026-12345'])).toBe('AV2026-12346');
  });
});
