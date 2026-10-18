import { describe, expect, it } from 'vitest';
import { computeGolden, golden } from '../test/fixtures';
import {
  inboundTransition,
  invoiceIbans,
  isCreditNote,
  maskIban,
  partySiren,
  supplierKey,
} from './inbound';

describe('supplier invoices received', () => {
  it('move new → approved or disputed → exported, and never back from exported', () => {
    expect(inboundTransition('new', 'approve')).toBe('approved');
    expect(inboundTransition('new', 'dispute')).toBe('disputed');
    expect(inboundTransition('disputed', 'approve')).toBe('approved');
    expect(inboundTransition('approved', 'dispute')).toBe('disputed');
    expect(inboundTransition('approved', 'export')).toBe('exported');
    expect(inboundTransition('new', 'export')).toBeNull();
    expect(inboundTransition('exported', 'dispute')).toBeNull();
    expect(inboundTransition('exported', 'approve')).toBeNull();
  });

  it('recognise a supplier by SIREN, SIRET or French VAT number, then VAT number, then name', () => {
    expect(partySiren({ ids: [], legalId: { id: '100 000 009', scheme: '0002' } })).toBe(
      '100000009',
    );
    expect(partySiren({ ids: [{ id: '10000000900017', scheme: '0009' }] })).toBe('100000009');
    expect(partySiren({ ids: [], vatId: 'FR88100000009' })).toBe('100000009');
    expect(partySiren({ ids: [], legalId: { id: 'B 123 456', scheme: '0199' } })).toBeUndefined();
    expect(supplierKey({ ids: [], legalId: { id: '100000009' } })).toBe('siren:100000009');
    expect(supplierKey({ ids: [], vatId: 'de 123456789' })).toBe('vat:DE123456789');
    expect(supplierKey({ ids: [], name: '  Élan  & Fils, S.A.R.L. ' })).toBe(
      'name:elan fils s a r l',
    );
    expect(supplierKey({ ids: [] })).toBeUndefined();
  });

  it('read the IBANs to pay, mask them for the screen, and tell a credit note', () => {
    const invoice = computeGolden(golden('02-goods-two-rates'));
    expect(invoiceIbans(invoice)).toEqual(['FR7630006000011234567890189']);
    expect(
      invoiceIbans({
        ...invoice,
        payment: { accounts: [{ iban: 'fr76 3000 6000 0112 3456 7890 189' }, { iban: '' }] },
      }),
    ).toEqual(['FR7630006000011234567890189']);
    expect(invoiceIbans({ ...invoice, payment: undefined })).toEqual([]);
    expect(maskIban('FR76 3000 6000 0112 3456 7890 189')).toBe('FR76 •••• •••• 0189');
    expect(maskIban('FR76')).toBe('FR76');
    expect(isCreditNote(invoice)).toBe(false);
    expect(isCreditNote(computeGolden(golden('10-credit-note')))).toBe(true);
  });
});
