import { describe, expect, it } from 'vitest';
import { nextInvoiceNumber } from './numbering';

describe('the next invoice number', () => {
  it('starts a series when the company has issued nothing', () => {
    expect(nextInvoiceNumber([], '2026-10-25')).toBe('F2026-0001');
    expect(
      nextInvoiceNumber([{ number: 'sans numéro', issueDate: '2026-10-01' }], '2026-10-25'),
    ).toBe('F2026-0001');
  });

  it('follows the series of the latest invoice, as wide, past its highest number; not the credit notes’', () => {
    const issued = [
      { number: 'F-2026-039', issueDate: '2026-10-01' },
      { number: 'F-2026-041', issueDate: '2026-10-20' },
      { number: 'F-2026-040', issueDate: '2026-10-20' },
      { number: 'AV2026-0003', issueDate: '2026-10-22' },
    ];
    expect(nextInvoiceNumber(issued, '2026-10-25')).toBe('F-2026-042');
    expect(nextInvoiceNumber([{ number: ' 2026-9 ', issueDate: '2026-01-02' }], '2026-01-03')).toBe(
      '2026-10',
    );
  });

  it('starts again at 1 in a new year when the series names its year', () => {
    const issued = [{ number: 'F-2026-120', issueDate: '2026-12-30' }];
    expect(nextInvoiceNumber(issued, '2027-01-04')).toBe('F-2027-001');
    expect(
      nextInvoiceNumber(
        [...issued, { number: 'F-2027-001', issueDate: '2027-01-04' }],
        '2027-01-05',
      ),
    ).toBe('F-2027-002');
    // A series without its year goes on.
    expect(nextInvoiceNumber([{ number: 'FA-0812', issueDate: '2026-12-30' }], '2027-01-04')).toBe(
      'FA-0813',
    );
  });
});
