// EN 16931 core rules (CEN validation artefacts 1.3.17): mandatory fields (BR-01…BR-65) and
// calculations (BR-CO-*). Semantics follow the CEN XSLT, tolerances included. Rules about groups the
// model does not have (payee, tax representative, attachments, item attributes, card payment) are
// listed in docs/RULES.md as not applicable.

import { countryCodes } from '../codelists/generated';
import { lineNetAmount } from '../compute';
import type { Invoice } from '../model';
import { compareDecimal, divRound, isDecimal, sum } from '../money';
import type { Finding } from './types';
import {
  docAllowanceCharges,
  each,
  finding,
  lineAllowanceCharges,
  missing,
  parties,
  present,
  rule,
  when,
} from './util';

const isBefore = (start: string | undefined, end: string | undefined) =>
  present(start) && present(end) && end < start;

const negative = (value: string | undefined) =>
  value !== undefined && isDecimal(value) && compareDecimal(value, '0') === -1;

const roundsToZero = (rate: string) =>
  compareDecimal(rate, '-0.5') !== -1 && compareDecimal(rate, '0.5') === -1;

/** CEN rounding of taxable × rate / 100 to 2 decimals, half away from zero, on absolute values. */
const expectedTax = (taxable: number, rate: string): number | null => {
  if (!isDecimal(rate)) return null;
  const [int, frac = ''] = rate.replace('-', '').split('.');
  const scale = 10n ** BigInt(frac.length);
  const r = BigInt(int + frac) * (rate.startsWith('-') ? -1n : 1n);
  return Number(divRound(BigInt(Math.abs(taxable)) * r, 100n * scale));
};

/** CEN tolerance on VAT amounts: strictly less than one currency unit (BR-CO-17, BR-S-08/09). */
export const withinOneUnit = (a: number, b: number) => Math.abs(a - b) < 100;

const totals = (inv: Invoice) => inv.totals;

export const EN16931_RULES = [
  rule({
    id: 'BR-01',
    severity: 'error',
    scope: 'document',
    source: 'EN16931',
    bt: ['BT-24'],
    autoFixable: false,
    summary: 'The specification identifier is present.',
    check: (inv) => when(missing(inv.specificationId), 'specificationId'),
  }),
  rule({
    id: 'BR-02',
    severity: 'error',
    scope: 'document',
    source: 'EN16931',
    bt: ['BT-1'],
    autoFixable: false,
    summary: 'The invoice number is present.',
    check: (inv) => when(missing(inv.number), 'number'),
  }),
  rule({
    id: 'BR-03',
    severity: 'error',
    scope: 'document',
    source: 'EN16931',
    bt: ['BT-2'],
    autoFixable: false,
    summary: 'The issue date is present.',
    check: (inv) => when(missing(inv.issueDate), 'issueDate'),
  }),
  rule({
    id: 'BR-04',
    severity: 'error',
    scope: 'document',
    source: 'EN16931',
    bt: ['BT-3'],
    autoFixable: false,
    summary: 'The invoice type code is present.',
    check: (inv) => when(missing(inv.typeCode), 'typeCode'),
  }),
  rule({
    id: 'BR-05',
    severity: 'error',
    scope: 'document',
    source: 'EN16931',
    bt: ['BT-5'],
    autoFixable: false,
    summary: 'The invoice currency code is present.',
    check: (inv) => when(missing(inv.currency), 'currency'),
  }),
  rule({
    id: 'BR-06',
    severity: 'error',
    scope: 'seller',
    source: 'EN16931',
    bt: ['BT-27'],
    autoFixable: false,
    summary: 'The seller name is present.',
    check: (inv) => when(missing(inv.seller.name), 'seller.name'),
  }),
  rule({
    id: 'BR-07',
    severity: 'error',
    scope: 'buyer',
    source: 'EN16931',
    bt: ['BT-44'],
    autoFixable: false,
    summary: 'The buyer name is present.',
    check: (inv) => when(missing(inv.buyer.name), 'buyer.name'),
  }),
  rule({
    id: 'BR-08',
    severity: 'error',
    scope: 'seller',
    source: 'EN16931',
    bt: ['BG-5'],
    autoFixable: false,
    summary: 'The seller postal address is present.',
    check: (inv) => when(inv.seller.address === undefined, 'seller.address'),
  }),
  rule({
    id: 'BR-09',
    severity: 'error',
    scope: 'seller',
    source: 'EN16931',
    bt: ['BT-40'],
    autoFixable: false,
    summary: 'The seller address has a country code.',
    check: (inv) =>
      when(
        inv.seller.address !== undefined && missing(inv.seller.address.country),
        'seller.address.country',
      ),
  }),
  rule({
    id: 'BR-10',
    severity: 'error',
    scope: 'buyer',
    source: 'EN16931',
    bt: ['BG-8'],
    autoFixable: false,
    summary: 'The buyer postal address is present.',
    check: (inv) => when(inv.buyer.address === undefined, 'buyer.address'),
  }),
  rule({
    id: 'BR-11',
    severity: 'error',
    scope: 'buyer',
    source: 'EN16931',
    bt: ['BT-55'],
    autoFixable: false,
    summary: 'The buyer address has a country code.',
    check: (inv) =>
      when(
        inv.buyer.address !== undefined && missing(inv.buyer.address.country),
        'buyer.address.country',
      ),
  }),
  rule({
    id: 'BR-12',
    severity: 'error',
    scope: 'totals',
    source: 'EN16931',
    bt: ['BT-106'],
    autoFixable: false,
    summary: 'The sum of invoice line net amounts is present.',
    check: (inv) => when(totals(inv).lineTotal === undefined, 'totals.lineTotal'),
  }),
  rule({
    id: 'BR-13',
    severity: 'error',
    scope: 'totals',
    source: 'EN16931',
    bt: ['BT-109'],
    autoFixable: false,
    summary: 'The invoice total without VAT is present.',
    check: (inv) => when(totals(inv).taxExclusive === undefined, 'totals.taxExclusive'),
  }),
  rule({
    id: 'BR-14',
    severity: 'error',
    scope: 'totals',
    source: 'EN16931',
    bt: ['BT-112'],
    autoFixable: false,
    summary: 'The invoice total with VAT is present.',
    check: (inv) => when(totals(inv).taxInclusive === undefined, 'totals.taxInclusive'),
  }),
  rule({
    id: 'BR-15',
    severity: 'error',
    scope: 'totals',
    source: 'EN16931',
    bt: ['BT-115'],
    autoFixable: false,
    summary: 'The amount due for payment is present.',
    check: (inv) => when(totals(inv).payable === undefined, 'totals.payable'),
  }),
  rule({
    id: 'BR-16',
    severity: 'error',
    scope: 'lines',
    source: 'EN16931',
    bt: ['BG-25'],
    autoFixable: false,
    summary: 'The invoice has at least one line.',
    check: (inv) => when(inv.lines.length === 0, 'lines'),
  }),
  rule({
    id: 'BR-21',
    severity: 'error',
    scope: 'lines',
    source: 'EN16931',
    bt: ['BT-126'],
    autoFixable: false,
    summary: 'Each line has a line identifier.',
    check: (inv) => each(inv.lines, 'lines', (l) => missing(l.id)).map(at('id')),
  }),
  rule({
    id: 'BR-22',
    severity: 'error',
    scope: 'lines',
    source: 'EN16931',
    bt: ['BT-129'],
    autoFixable: false,
    summary: 'Each line has an invoiced quantity.',
    check: (inv) => each(inv.lines, 'lines', (l) => missing(l.quantity)).map(at('quantity')),
  }),
  rule({
    id: 'BR-23',
    severity: 'error',
    scope: 'lines',
    source: 'EN16931',
    bt: ['BT-130'],
    autoFixable: false,
    summary: 'Each line has a unit of measure code.',
    check: (inv) => each(inv.lines, 'lines', (l) => missing(l.unitCode)).map(at('unitCode')),
  }),
  rule({
    id: 'BR-24',
    severity: 'error',
    scope: 'lines',
    source: 'EN16931',
    bt: ['BT-131'],
    autoFixable: false,
    summary: 'Each line has a net amount.',
    check: (inv) => each(inv.lines, 'lines', (l) => l.netAmount === undefined).map(at('netAmount')),
  }),
  rule({
    id: 'BR-25',
    severity: 'error',
    scope: 'lines',
    source: 'EN16931',
    bt: ['BT-153'],
    autoFixable: false,
    summary: 'Each line has an item name.',
    check: (inv) => each(inv.lines, 'lines', (l) => missing(l.item.name)).map(at('item.name')),
  }),
  rule({
    id: 'BR-26',
    severity: 'error',
    scope: 'lines',
    source: 'EN16931',
    bt: ['BT-146'],
    autoFixable: false,
    summary: 'Each line has an item net price.',
    check: (inv) => each(inv.lines, 'lines', (l) => missing(l.price.net)).map(at('price.net')),
  }),
  rule({
    id: 'BR-27',
    severity: 'error',
    scope: 'lines',
    source: 'EN16931',
    bt: ['BT-146'],
    autoFixable: false,
    summary: 'The item net price is not negative.',
    check: (inv) => each(inv.lines, 'lines', (l) => negative(l.price.net)).map(at('price.net')),
  }),
  rule({
    id: 'BR-28',
    severity: 'error',
    scope: 'lines',
    source: 'EN16931',
    bt: ['BT-148'],
    autoFixable: false,
    summary: 'The item gross price is not negative.',
    check: (inv) => each(inv.lines, 'lines', (l) => negative(l.price.gross)).map(at('price.gross')),
  }),
  rule({
    id: 'BR-29',
    severity: 'error',
    scope: 'document',
    source: 'EN16931',
    bt: ['BT-73', 'BT-74'],
    autoFixable: false,
    summary: 'The invoicing period end date is not before its start date.',
    check: (inv) =>
      when(isBefore(inv.invoicePeriod?.start, inv.invoicePeriod?.end), 'invoicePeriod.end'),
  }),
  rule({
    id: 'BR-30',
    severity: 'error',
    scope: 'lines',
    source: 'EN16931',
    bt: ['BT-134', 'BT-135'],
    autoFixable: false,
    summary: 'A line period end date is not before its start date.',
    check: (inv) =>
      each(inv.lines, 'lines', (l) => isBefore(l.period?.start, l.period?.end)).map(
        at('period.end'),
      ),
  }),
  ...allowanceChargeRules(),
  rule({
    id: 'BR-45',
    severity: 'error',
    scope: 'vat',
    source: 'EN16931',
    bt: ['BT-116'],
    autoFixable: false,
    summary: 'Each VAT breakdown has a taxable amount.',
    check: (inv) =>
      each(inv.vatBreakdown, 'vatBreakdown', (b) => b.taxableAmount === undefined).map(
        at('taxableAmount'),
      ),
  }),
  rule({
    id: 'BR-46',
    severity: 'error',
    scope: 'vat',
    source: 'EN16931',
    bt: ['BT-117'],
    autoFixable: false,
    summary: 'Each VAT breakdown has a tax amount.',
    check: (inv) =>
      each(inv.vatBreakdown, 'vatBreakdown', (b) => b.taxAmount === undefined).map(at('taxAmount')),
  }),
  rule({
    id: 'BR-47',
    severity: 'error',
    scope: 'vat',
    source: 'EN16931',
    bt: ['BT-118'],
    autoFixable: false,
    summary: 'Each VAT breakdown has a VAT category code.',
    check: (inv) =>
      each(inv.vatBreakdown, 'vatBreakdown', (b) => missing(b.category)).map(at('category')),
  }),
  rule({
    id: 'BR-48',
    severity: 'error',
    scope: 'vat',
    source: 'EN16931',
    bt: ['BT-119'],
    autoFixable: false,
    summary: 'Each VAT breakdown has a rate, except category O (not subject to VAT).',
    check: (inv) =>
      each(inv.vatBreakdown, 'vatBreakdown', (b) => b.category !== 'O' && missing(b.rate)).map(
        at('rate'),
      ),
  }),
  rule({
    id: 'BR-49',
    severity: 'error',
    scope: 'payment',
    source: 'EN16931',
    bt: ['BT-81'],
    autoFixable: false,
    summary: 'Payment instructions have a payment means type code.',
    check: (inv) =>
      when(inv.payment !== undefined && missing(inv.payment.meansCode), 'payment.meansCode'),
  }),
  rule({
    id: 'BR-50',
    severity: 'error',
    scope: 'payment',
    source: 'EN16931',
    bt: ['BT-84'],
    autoFixable: false,
    summary: 'Each credit transfer account has an account identifier (IBAN).',
    check: (inv) =>
      ['30', '58'].includes(inv.payment?.meansCode ?? '')
        ? each(inv.payment?.accounts ?? [], 'payment.accounts', (a) => missing(a.iban)).map(
            at('iban'),
          )
        : [],
  }),
  rule({
    id: 'BR-53',
    severity: 'error',
    scope: 'totals',
    source: 'EN16931',
    bt: ['BT-6', 'BT-111'],
    autoFixable: false,
    summary: 'When a VAT accounting currency is given, the VAT total in that currency is present.',
    // As in CEN UBL: when BT-6 is the invoice currency, BT-110 is the VAT total in BT-6. CEN CII
    // rejects BT-6 = BT-5 outright, so the CII builder leaves such a BT-6 out (cii.ts).
    check: (inv) =>
      when(
        present(inv.vatCurrency) &&
          inv.totals.taxTotalAccountingCurrency === undefined &&
          !(inv.vatCurrency === inv.currency && inv.totals.taxTotal !== undefined),
        'totals.taxTotalAccountingCurrency',
      ),
  }),
  rule({
    id: 'BR-55',
    severity: 'error',
    scope: 'document',
    source: 'EN16931',
    bt: ['BT-25'],
    autoFixable: false,
    summary: 'Each preceding invoice reference has the preceding invoice number.',
    check: (inv) =>
      each(inv.precedingInvoices, 'precedingInvoices', (p) => missing(p.number)).map(at('number')),
  }),
  rule({
    id: 'BR-57',
    severity: 'error',
    scope: 'delivery',
    source: 'EN16931',
    bt: ['BT-80'],
    autoFixable: false,
    summary: 'A deliver-to address has a country code.',
    check: (inv) =>
      when(
        inv.delivery?.address !== undefined && missing(inv.delivery.address.country),
        'delivery.address.country',
      ),
  }),
  rule({
    id: 'BR-61',
    severity: 'error',
    scope: 'payment',
    source: 'EN16931',
    bt: ['BT-81', 'BT-84'],
    autoFixable: false,
    summary: 'A credit transfer (codes 30, 58) gives the account to pay into.',
    check: (inv) =>
      when(
        ['30', '58'].includes(inv.payment?.meansCode ?? '') &&
          (inv.payment?.accounts ?? []).length === 0,
        'payment.accounts',
      ),
  }),
  rule({
    id: 'BR-62',
    severity: 'error',
    scope: 'seller',
    source: 'EN16931',
    bt: ['BT-34-1'],
    autoFixable: false,
    summary: 'The seller electronic address has a scheme identifier.',
    check: (inv) =>
      when(
        inv.seller.electronicAddress !== undefined && missing(inv.seller.electronicAddress.scheme),
        'seller.electronicAddress.scheme',
      ),
  }),
  rule({
    id: 'BR-63',
    severity: 'error',
    scope: 'buyer',
    source: 'EN16931',
    bt: ['BT-49-1'],
    autoFixable: false,
    summary: 'The buyer electronic address has a scheme identifier.',
    check: (inv) =>
      when(
        inv.buyer.electronicAddress !== undefined && missing(inv.buyer.electronicAddress.scheme),
        'buyer.electronicAddress.scheme',
      ),
  }),
  rule({
    id: 'BR-64',
    severity: 'error',
    scope: 'lines',
    source: 'EN16931',
    bt: ['BT-157-1'],
    autoFixable: false,
    summary: 'An item standard identifier has a scheme identifier.',
    check: (inv) =>
      each(
        inv.lines,
        'lines',
        (l) => l.item.standardId !== undefined && missing(l.item.standardId.scheme),
      ).map(at('item.standardId.scheme')),
  }),

  // ── Calculations and coherence (BR-CO) ──
  rule({
    id: 'BR-CO-03',
    severity: 'error',
    scope: 'document',
    source: 'EN16931',
    bt: ['BT-7', 'BT-8'],
    autoFixable: false,
    summary: 'The VAT point date and the VAT point date code are not both given.',
    check: (inv) => when(present(inv.taxPointDate) && inv.vatDueOn !== undefined, 'vatDueOn'),
  }),
  rule({
    id: 'BR-CO-04',
    severity: 'error',
    scope: 'lines',
    source: 'EN16931',
    bt: ['BT-151'],
    autoFixable: false,
    summary: 'Each line has a VAT category code.',
    check: (inv) =>
      each(inv.lines, 'lines', (l) => missing(l.vat.category)).map(at('vat.category')),
  }),
  rule({
    id: 'BR-CO-09',
    severity: 'error',
    scope: 'document',
    source: 'EN16931',
    bt: ['BT-31', 'BT-48'],
    autoFixable: false,
    summary: 'VAT identifiers start with an ISO 3166-1 country code (EL for Greece).',
    check: (inv) =>
      parties(inv).flatMap(({ key, party }) => {
        if (!present(party.vatId)) return [];
        const prefix = party.vatId.slice(0, 2);
        return when(prefix !== 'EL' && !countryCodes.has(prefix), `${key}.vatId`, {
          value: party.vatId,
        });
      }),
  }),
  rule({
    id: 'BR-CO-10',
    severity: 'error',
    scope: 'totals',
    source: 'EN16931',
    bt: ['BT-106', 'BT-131'],
    autoFixable: false,
    summary: 'The sum of line net amounts equals the sum of the invoice lines.',
    check: (inv) =>
      when(
        inv.totals.lineTotal !== undefined &&
          inv.totals.lineTotal !== sum(inv.lines.map((l) => l.netAmount ?? 0)),
        'totals.lineTotal',
      ),
  }),
  rule({
    id: 'BR-CO-11',
    severity: 'error',
    scope: 'totals',
    source: 'EN16931',
    bt: ['BT-107', 'BT-92'],
    autoFixable: false,
    summary: 'The sum of allowances equals the document level allowances.',
    check: (inv) =>
      when(
        inv.totals.allowanceTotal !== undefined &&
          inv.totals.allowanceTotal !== sum(inv.allowances.map((a) => a.amount ?? 0)),
        'totals.allowanceTotal',
      ),
  }),
  rule({
    id: 'BR-CO-12',
    severity: 'error',
    scope: 'totals',
    source: 'EN16931',
    bt: ['BT-108', 'BT-99'],
    autoFixable: false,
    summary: 'The sum of charges equals the document level charges.',
    check: (inv) =>
      when(
        inv.totals.chargeTotal !== undefined &&
          inv.totals.chargeTotal !== sum(inv.charges.map((c) => c.amount ?? 0)),
        'totals.chargeTotal',
      ),
  }),
  rule({
    id: 'BR-CO-13',
    severity: 'error',
    scope: 'totals',
    source: 'EN16931',
    bt: ['BT-109', 'BT-106', 'BT-107', 'BT-108'],
    autoFixable: false,
    summary: 'Total without VAT = sum of lines − allowances + charges.',
    check: ({ totals: t }) =>
      when(
        t.taxExclusive !== undefined &&
          t.lineTotal !== undefined &&
          t.taxExclusive !== t.lineTotal - (t.allowanceTotal ?? 0) + (t.chargeTotal ?? 0),
        'totals.taxExclusive',
      ),
  }),
  rule({
    id: 'BR-CO-14',
    severity: 'error',
    scope: 'totals',
    source: 'EN16931',
    bt: ['BT-110', 'BT-117'],
    autoFixable: false,
    summary: 'The invoice VAT total equals the sum of the VAT breakdown tax amounts.',
    check: (inv) =>
      when(
        inv.totals.taxTotal !== undefined &&
          inv.vatBreakdown.length > 0 &&
          inv.totals.taxTotal !== sum(inv.vatBreakdown.map((b) => b.taxAmount ?? 0)),
        'totals.taxTotal',
      ),
  }),
  rule({
    id: 'BR-CO-15',
    severity: 'error',
    scope: 'totals',
    source: 'EN16931',
    bt: ['BT-112', 'BT-109', 'BT-110'],
    autoFixable: false,
    summary: 'Total with VAT = total without VAT + VAT total.',
    check: ({ totals: t }) =>
      when(
        t.taxInclusive !== undefined &&
          t.taxExclusive !== undefined &&
          t.taxInclusive !== t.taxExclusive + (t.taxTotal ?? 0),
        'totals.taxInclusive',
      ),
  }),
  rule({
    id: 'BR-CO-16',
    severity: 'error',
    scope: 'totals',
    source: 'EN16931',
    bt: ['BT-115', 'BT-112', 'BT-113', 'BT-114'],
    autoFixable: false,
    summary: 'Amount due = total with VAT − paid amount + rounding amount.',
    check: ({ totals: t }) =>
      when(
        t.payable !== undefined &&
          t.taxInclusive !== undefined &&
          t.payable !== t.taxInclusive - (t.prepaid ?? 0) + (t.rounding ?? 0),
        'totals.payable',
      ),
  }),
  rule({
    id: 'BR-CO-17',
    severity: 'error',
    scope: 'vat',
    source: 'EN16931',
    bt: ['BT-117', 'BT-116', 'BT-119'],
    autoFixable: false,
    summary:
      'Each VAT breakdown tax amount = taxable amount × rate / 100, within one currency unit.',
    check: (inv) =>
      each(inv.vatBreakdown, 'vatBreakdown', (b) => {
        if (b.taxAmount === undefined) return false;
        // XPath round(): a rate below 0.5 and a tax amount below 0.50 both count as zero.
        if (!present(b.rate) || roundsToZero(b.rate))
          return !(b.taxAmount >= -50 && b.taxAmount < 50);
        if (b.taxableAmount === undefined) return false;
        const expected = expectedTax(b.taxableAmount, b.rate);
        if (expected === null) return false;
        return !withinOneUnit(Math.abs(b.taxAmount), expected);
      }).map(at('taxAmount')),
  }),
  rule({
    id: 'BR-CO-18',
    severity: 'error',
    scope: 'vat',
    source: 'EN16931',
    bt: ['BG-23'],
    autoFixable: false,
    summary: 'The invoice has at least one VAT breakdown.',
    check: (inv) => when(inv.vatBreakdown.length === 0, 'vatBreakdown'),
  }),
  rule({
    id: 'BR-CO-19',
    severity: 'error',
    scope: 'document',
    source: 'EN16931',
    bt: ['BG-14'],
    autoFixable: false,
    summary: 'An invoicing period has a start date, an end date or both.',
    check: (inv) =>
      when(
        inv.invoicePeriod !== undefined &&
          missing(inv.invoicePeriod.start) &&
          missing(inv.invoicePeriod.end),
        'invoicePeriod',
      ),
  }),
  rule({
    id: 'BR-CO-20',
    severity: 'error',
    scope: 'lines',
    source: 'EN16931',
    bt: ['BG-26'],
    autoFixable: false,
    summary: 'A line period has a start date, an end date or both.',
    check: (inv) =>
      each(
        inv.lines,
        'lines',
        (l) => l.period !== undefined && missing(l.period.start) && missing(l.period.end),
      ).map(at('period')),
  }),
  rule({
    id: 'BR-CO-26',
    severity: 'error',
    scope: 'seller',
    source: 'EN16931',
    bt: ['BT-29', 'BT-30', 'BT-31'],
    autoFixable: false,
    summary: 'The seller has an identifier, a legal registration identifier or a VAT identifier.',
    check: ({ seller: s }) =>
      when(
        !s.ids.some((i) => present(i.id)) && missing(s.legalId?.id) && missing(s.vatId),
        'seller.legalId',
      ),
  }),
  rule({
    id: 'FF-LINE-CALC',
    severity: 'error',
    scope: 'lines',
    source: 'FF',
    bt: ['BT-131', 'BT-129', 'BT-146', 'BT-149'],
    autoFixable: false,
    summary:
      'Line net amount = quantity × net price / base quantity − line allowances + line charges, rounded to the cent.',
    check: (inv) =>
      each(
        inv.lines,
        'lines',
        (l) => l.netAmount !== undefined && l.netAmount !== lineNetAmount(l),
      ).map(at('netAmount')),
  }),
];

/** Appends a field to the path of each finding: `lines[2]` → `lines[2].quantity`. */
function at(field: string) {
  return (f: Finding): Finding => ({ ...f, path: `${f.path}.${field}` });
}

/** BR-31…BR-44: document and line level allowances and charges. */
function allowanceChargeRules() {
  const doc =
    (kind: 'allowance' | 'charge', test: (i: Invoice['allowances'][number]) => boolean) =>
    (inv: Invoice) =>
      docAllowanceCharges(inv)
        .filter((a) => a.kind === kind && test(a.item))
        .map((a) => finding(a.path));
  const line =
    (kind: 'allowance' | 'charge', test: (i: Invoice['allowances'][number]) => boolean) =>
    (inv: Invoice) =>
      lineAllowanceCharges(inv)
        .filter((a) => a.kind === kind && test(a.item))
        .map((a) => finding(a.path));
  const noAmount = (a: Invoice['allowances'][number]) => a.amount === undefined;
  const noCategory = (a: Invoice['allowances'][number]) => missing(a.vatCategory);
  const noReason = (a: Invoice['allowances'][number]) => missing(a.reason) && missing(a.reasonCode);
  const base = { severity: 'error', source: 'EN16931', autoFixable: false } as const;
  return [
    rule({
      ...base,
      id: 'BR-31',
      scope: 'totals',
      bt: ['BT-92'],
      summary: 'Each document level allowance has an amount.',
      check: doc('allowance', noAmount),
    }),
    rule({
      ...base,
      id: 'BR-32',
      scope: 'totals',
      bt: ['BT-95'],
      summary: 'Each document level allowance has a VAT category code.',
      check: doc('allowance', noCategory),
    }),
    rule({
      ...base,
      id: 'BR-33',
      scope: 'totals',
      bt: ['BT-97', 'BT-98'],
      summary: 'Each document level allowance has a reason or a reason code.',
      check: doc('allowance', noReason),
    }),
    rule({
      ...base,
      id: 'BR-36',
      scope: 'totals',
      bt: ['BT-99'],
      summary: 'Each document level charge has an amount.',
      check: doc('charge', noAmount),
    }),
    rule({
      ...base,
      id: 'BR-37',
      scope: 'totals',
      bt: ['BT-102'],
      summary: 'Each document level charge has a VAT category code.',
      check: doc('charge', noCategory),
    }),
    rule({
      ...base,
      id: 'BR-38',
      scope: 'totals',
      bt: ['BT-104', 'BT-105'],
      summary: 'Each document level charge has a reason or a reason code.',
      check: doc('charge', noReason),
    }),
    rule({
      ...base,
      id: 'BR-41',
      scope: 'lines',
      bt: ['BT-136'],
      summary: 'Each line allowance has an amount.',
      check: line('allowance', noAmount),
    }),
    rule({
      ...base,
      id: 'BR-42',
      scope: 'lines',
      bt: ['BT-139', 'BT-140'],
      summary: 'Each line allowance has a reason or a reason code.',
      check: line('allowance', noReason),
    }),
    rule({
      ...base,
      id: 'BR-43',
      scope: 'lines',
      bt: ['BT-141'],
      summary: 'Each line charge has an amount.',
      check: line('charge', noAmount),
    }),
    rule({
      ...base,
      id: 'BR-44',
      scope: 'lines',
      bt: ['BT-144', 'BT-145'],
      summary: 'Each line charge has a reason or a reason code.',
      check: line('charge', noReason),
    }),
  ];
}

export { expectedTax };
