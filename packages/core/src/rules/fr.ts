// French rules: AFNOR XP Z12-012 (BR-FR-*), DGFiP (G*) and our own checks (FF-*), as specified in
// docs/research/FR_RULES.md ("Implementable rule table"). Sources and dates are in that file.
import { daysBetween, isIsoDate } from '../dates';
import {
  FR_VAT_SHAPE,
  hasValidFrenchVatKey,
  isValidIban,
  isValidSiren,
  isValidSiret,
} from '../ids';
import type { Invoice, Party } from '../model';
import { compareDecimal, decimalPlaces, isDecimal, normalizeDecimal } from '../money';
import type { Rule } from './types';
import {
  CORRECTIVE_TYPES,
  CREDIT_NOTE_TYPES,
  category,
  DOWN_PAYMENT_TYPES,
  dates,
  docAllowanceCharges,
  each,
  FR_ADDRESS_SCHEME,
  finding,
  frame,
  isDomesticB2B,
  missing,
  parties,
  present,
  rule,
  SIREN_SCHEME,
  SIRET_SCHEME,
  when,
} from './util';

const INVOICE_NUMBER = /^[A-Za-z0-9+\-_/]+$/;
const FR_TYPE_CODES = [
  '380',
  '389',
  '393',
  '501',
  '386',
  '500',
  '384',
  '471',
  '472',
  '473',
  '261',
  '262',
  '381',
  '396',
  '502',
  '503',
];
const PROCESS_TYPES = [
  'B1',
  'S1',
  'M1',
  'B2',
  'S2',
  'M2',
  'S3',
  'B4',
  'S4',
  'M4',
  'S5',
  'S6',
  'B7',
  'S7',
  'B8',
  'S8',
  'M8',
  'B9',
  'S9',
  'M9',
];
const FR_CATEGORIES = ['S', 'E', 'AE', 'K', 'G', 'O', 'Z'];
export const FR_RATES = [
  '0',
  '0.9',
  '1.05',
  '1.75',
  '2.1',
  '5.5',
  '7',
  '8.5',
  '9.2',
  '9.6',
  '10',
  '13',
  '19.6',
  '20',
  '20.6',
];
/** Mainland rates; the others are for Corsica, overseas departments or past periods (FF-RATE-02). */
const USUAL_RATES = ['0', '2.1', '5.5', '10', '20'];
const MANDATORY_NOTES = ['PMT', 'PMD', 'AAB'] as const;
const SINGLE_NOTES = ['PMD', 'PMT', 'AAB', 'TXD'];
/** DGFiP G2.32: exemption codes that take an invoice out of e-invoicing when they are alone. */
const G232_CODES = new Set([
  ...['1', '2', '3', '4', '5', '7', '8'].map((n) => `VATEX-FR-CGI261-${n}`),
  'VATEX-FR-CGI261A',
  'VATEX-FR-CGI261B',
  ...['1', '2', '3'].map((n) => `VATEX-FR-CGI261C-${n}`),
  'VATEX-FR-CGI261D-1',
  'VATEX-FR-CGI261D-1BIS',
  ...['2', '3', '4'].map((n) => `VATEX-FR-CGI261D-${n}`),
  ...['1', '2'].map((n) => `VATEX-FR-CGI261E-${n}`),
]);

const sirenOf = (party: Party) =>
  party.legalId?.scheme === SIREN_SCHEME ? party.legalId.id : undefined;

const rateIn = (rate: string | undefined, list: readonly string[]) =>
  rate !== undefined && isDecimal(rate) && list.includes(normalizeDecimal(rate) ?? '');

const notesWith = (inv: Invoice, code: string) =>
  inv.notes.filter((n) => n.subjectCode?.trim().toUpperCase() === code);

/** All VAT rates of the invoice with their paths. */
const rates = (inv: Invoice) => [
  ...inv.lines.map((l, i) => ({ path: `lines[${i}].vat.rate`, value: l.vat.rate })),
  ...docAllowanceCharges(inv).map((a) => ({ path: `${a.path}.vatRate`, value: a.item.vatRate })),
  ...inv.vatBreakdown.map((b, i) => ({ path: `vatBreakdown[${i}].rate`, value: b.rate })),
];

/** Identifiers and codes where surrounding spaces would change what a platform reads (FF-FMT-01). */
function codes(inv: Invoice): { path: string; value: string | undefined }[] {
  return [
    { path: 'number', value: inv.number },
    { path: 'processType', value: inv.processType },
    { path: 'typeCode', value: inv.typeCode },
    { path: 'currency', value: inv.currency },
    ...inv.precedingInvoices.map((p, i) => ({
      path: `precedingInvoices[${i}].number`,
      value: p.number,
    })),
    ...parties(inv).flatMap(({ key, party }) => [
      ...party.ids.map((id, i) => ({ path: `${key}.ids[${i}].id`, value: id.id })),
      { path: `${key}.legalId.id`, value: party.legalId?.id },
      { path: `${key}.vatId`, value: party.vatId },
      { path: `${key}.electronicAddress.id`, value: party.electronicAddress?.id },
    ]),
    ...inv.lines.flatMap((l, i) => [
      { path: `lines[${i}].vat.category`, value: l.vat.category },
      { path: `lines[${i}].unitCode`, value: l.unitCode },
    ]),
    ...inv.vatBreakdown.map((b, i) => ({
      path: `vatBreakdown[${i}].exemptionCode`,
      value: b.exemptionCode,
    })),
  ];
}

/** Decimal texts of the invoice (FF-FMT-04). Rates have their own wording (FF-RATE-01). */
function decimals(inv: Invoice): { path: string; value: string | undefined }[] {
  return inv.lines.flatMap((l, i) => [
    { path: `lines[${i}].quantity`, value: l.quantity },
    { path: `lines[${i}].price.net`, value: l.price.net },
    { path: `lines[${i}].price.gross`, value: l.price.gross },
    { path: `lines[${i}].price.discount`, value: l.price.discount },
    { path: `lines[${i}].price.baseQuantity`, value: l.price.baseQuantity },
  ]);
}

/** "F2026-0042" → { prefix: "F2026-", n: 42, width: 4 }. */
function series(number: string) {
  const m = /^(.*?)(\d+)$/.exec(number);
  if (!m) return null;
  const [, prefix = '', digits = ''] = m;
  return { prefix, n: Number(digits), width: digits.length };
}

const year = (date: string | undefined) => date?.slice(0, 4);

const fr = { severity: 'error', source: 'AFNOR', autoFixable: false } as const;
const ff = { severity: 'error', source: 'FF', autoFixable: false } as const;
const dgfip = { severity: 'error', source: 'DGFIP', autoFixable: false } as const;

export const FR_RULES: Rule[] = [
  // ── Formatting (auto-fixable) ──
  rule({
    ...ff,
    id: 'FF-FMT-01',
    scope: 'document',
    autoFixable: true,
    bt: [
      'BT-1',
      'BT-23',
      'BT-25',
      'BT-29',
      'BT-30',
      'BT-31',
      'BT-46',
      'BT-47',
      'BT-48',
      'BT-118',
      'BT-121',
    ],
    summary: 'Identifiers and codes have no leading or trailing spaces.',
    check: (inv) =>
      codes(inv)
        .filter((c) => c.value !== undefined && c.value !== c.value.trim() && c.value.trim() !== '')
        .map((c) => finding(c.path)),
  }),
  rule({
    ...ff,
    id: 'FF-FMT-02',
    scope: 'document',
    autoFixable: true,
    bt: ['BT-29', 'BT-30', 'BT-31', 'BT-46', 'BT-47', 'BT-48'],
    summary: 'SIREN, SIRET and VAT numbers are written without spaces, dots or lower case letters.',
    check: (inv) =>
      parties(inv).flatMap(({ key, party }) => {
        const values = [
          ...party.ids
            .map((id, i) => ({ path: `${key}.ids[${i}].id`, value: id.id, scheme: id.scheme }))
            .filter((v) => v.scheme === SIRET_SCHEME)
            .map(({ path, value }) => ({ path, value })),
          ...(party.legalId?.scheme === SIREN_SCHEME
            ? [{ path: `${key}.legalId.id`, value: party.legalId.id }]
            : []),
          { path: `${key}.vatId`, value: party.vatId },
        ];
        return values
          .filter((v) => v.value !== undefined && /[\s.]|[a-z]/.test(v.value.trim()))
          .map((v) => finding(v.path, { value: v.value ?? '' }));
      }),
  }),
  rule({
    ...ff,
    id: 'FF-FMT-03',
    scope: 'document',
    autoFixable: true,
    bt: ['BT-2', 'BT-7', 'BT-9', 'BT-26', 'BT-72', 'BT-73', 'BT-74'],
    summary: 'Dates are real calendar dates written YYYY-MM-DD.',
    check: (inv) =>
      dates(inv)
        .filter((d) => !isIsoDate(d.value))
        .map((d) => finding(d.path, { field: d.field })),
  }),
  rule({
    ...ff,
    id: 'FF-FMT-04',
    scope: 'lines',
    bt: ['BT-129', 'BT-146', 'BT-147', 'BT-148', 'BT-149'],
    summary: 'Quantities and prices are decimal numbers.',
    check: (inv) =>
      decimals(inv)
        .filter((d) => present(d.value) && !isDecimal(d.value))
        .map((d) => finding(d.path, { value: d.value ?? '' })),
  }),
  rule({
    ...ff,
    id: 'FF-RATE-01',
    scope: 'vat',
    autoFixable: true,
    bt: ['BT-96', 'BT-103', 'BT-119', 'BT-152'],
    summary: 'VAT rates are written with a decimal point ("5.5"), not a comma.',
    check: (inv) =>
      rates(inv)
        .filter((r) => r.value !== undefined && /^\d+,\d+$/.test(r.value.trim()))
        .map((r) => finding(r.path, { rate: r.value ?? '' })),
  }),

  // ── Invoice number, type, dates ──
  rule({
    ...fr,
    id: 'BR-FR-01',
    scope: 'document',
    bt: ['BT-1', 'BT-25'],
    summary: 'The invoice number and preceding invoice numbers have at most 35 characters.',
    check: (inv) => [
      ...when(present(inv.number) && inv.number.length > 35, 'number'),
      ...each(inv.precedingInvoices, 'precedingInvoices', (p) => (p.number ?? '').length > 35).map(
        (f) => ({ ...f, path: `${f.path}.number` }),
      ),
    ],
  }),
  rule({
    ...fr,
    id: 'BR-FR-02',
    scope: 'document',
    bt: ['BT-1', 'BT-25'],
    summary:
      'The invoice number and preceding invoice numbers only use A-Z a-z 0-9 - + _ / (no space).',
    check: (inv) => [
      ...when(present(inv.number) && !INVOICE_NUMBER.test(inv.number.trim()), 'number'),
      ...each(
        inv.precedingInvoices,
        'precedingInvoices',
        (p) => present(p.number) && !INVOICE_NUMBER.test(p.number.trim()),
      ).map((f) => ({ ...f, path: `${f.path}.number` })),
    ],
  }),
  rule({
    ...ff,
    id: 'FF-ID-01',
    severity: 'warning',
    scope: 'document',
    bt: ['BT-1'],
    summary:
      'The invoice number has at most 20 characters (flux 1 keeps only the last 19, BR-FR-MAP-01).',
    check: (inv) =>
      when(present(inv.number) && inv.number.length > 20 && inv.number.length <= 35, 'number'),
  }),
  rule({
    ...fr,
    id: 'BR-FR-03',
    scope: 'document',
    bt: ['BT-2', 'BT-7', 'BT-9', 'BT-26', 'BT-72', 'BT-73', 'BT-74'],
    summary: 'Every date has a year between 2000 and 2099.',
    check: (inv) =>
      dates(inv)
        .filter((d) => isIsoDate(d.value) && (d.value < '2000-01-01' || d.value > '2099-12-31'))
        .map((d) => finding(d.path, { field: d.field })),
  }),
  rule({
    ...fr,
    id: 'BR-FR-CO-01',
    scope: 'document',
    bt: ['BT-2'],
    summary: 'The issue date is not in the future (Europe/Paris).',
    check: (inv, ctx) =>
      when(
        present(inv.issueDate) && isIsoDate(inv.issueDate) && inv.issueDate > ctx.today,
        'issueDate',
      ),
  }),
  rule({
    ...fr,
    id: 'BR-FR-04',
    scope: 'document',
    bt: ['BT-3'],
    summary: 'The type code is one the French CIUS accepts (380, 381, 384, 386…).',
    check: (inv) =>
      when(present(inv.typeCode) && !FR_TYPE_CODES.includes(inv.typeCode.trim()), 'typeCode', {
        value: inv.typeCode ?? '',
      }),
  }),
  rule({
    ...fr,
    id: 'BR-FR-CO-02',
    scope: 'document',
    bt: ['BT-1', 'BT-2', 'BT-30'],
    summary: 'The number was not already used this year by the same seller (local history).',
    check: (inv, ctx) => {
      if (!ctx.history || missing(inv.number)) return [];
      const siren = sirenOf(inv.seller);
      const dup = ctx.history.some(
        (h) =>
          h.number === inv.number &&
          year(h.issueDate) === year(inv.issueDate) &&
          (h.sellerSiren === undefined || siren === undefined || h.sellerSiren === siren),
      );
      return when(dup, 'number');
    },
  }),
  rule({
    ...ff,
    id: 'FF-NUM-01',
    severity: 'warning',
    scope: 'document',
    bt: ['BT-1'],
    summary: 'In the same series, the number follows the last one issued, with no gap.',
    check: (inv, ctx) => {
      const current = present(inv.number) ? series(inv.number) : null;
      if (!ctx.history || !current) return [];
      const previous = ctx.history
        .map((h) => series(h.number))
        .filter((s) => s !== null && s.prefix === current.prefix)
        .map((s) => s?.n ?? 0);
      if (previous.length === 0 || previous.includes(current.n)) return [];
      const last = Math.max(...previous);
      if (current.n === last + 1 || current.n < last) return [];
      return [
        finding('number', {
          last: `${current.prefix}${String(last).padStart(current.width, '0')}`,
        }),
      ];
    },
  }),
  rule({
    ...ff,
    id: 'FF-NUM-02',
    severity: 'warning',
    scope: 'document',
    bt: ['BT-1', 'BT-2'],
    summary: 'In the same series, a higher number never carries an earlier issue date.',
    check: (inv, ctx) => {
      const current = present(inv.number) ? series(inv.number) : null;
      if (!ctx.history || !current || missing(inv.issueDate)) return [];
      const issue = inv.issueDate ?? '';
      const conflict = ctx.history.some((h) => {
        const s = series(h.number);
        return (
          s !== null &&
          s.prefix === current.prefix &&
          ((s.n < current.n && h.issueDate > issue) || (s.n > current.n && h.issueDate < issue))
        );
      });
      return when(conflict, 'issueDate');
    },
  }),

  // ── Notes (mentions obligatoires) ──
  rule({
    ...fr,
    id: 'BR-FR-05',
    scope: 'notes',
    bt: ['BT-21', 'BT-22'],
    variants: MANDATORY_NOTES,
    summary:
      'Notes PMT (40 € recovery indemnity), PMD (late-payment penalties) and AAB (early-payment discount) are present.',
    check: (inv) =>
      MANDATORY_NOTES.filter((code) => notesWith(inv, code).length === 0).map((code) =>
        finding('notes', undefined, code),
      ),
  }),
  rule({
    ...fr,
    id: 'BR-FR-06',
    scope: 'notes',
    bt: ['BT-21'],
    summary: 'Notes PMD, PMT, AAB and TXD appear at most once each.',
    check: (inv) =>
      SINGLE_NOTES.filter((code) => notesWith(inv, code).length > 1).map((code) =>
        finding('notes', { mention: code }),
      ),
  }),
  rule({
    ...ff,
    id: 'FF-PMD-01',
    severity: 'warning',
    scope: 'notes',
    bt: ['BT-22'],
    summary:
      'The late-payment penalty note gives a rate (a percentage or the legal interest rate).',
    check: (inv) =>
      inv.notes.flatMap((n, i) =>
        n.subjectCode?.trim().toUpperCase() === 'PMD' &&
        !/\d+(?:[.,]\d+)?\s*%|taux\s+d.int[ée]r[êe]t\s+l[ée]gal|taux\s+directeur|BCE|banque\s+centrale/i.test(
          n.text,
        )
          ? [finding(`notes[${i}].text`)]
          : [],
      ),
  }),

  // ── Payment terms ──
  rule({
    ...ff,
    id: 'FF-DUE-01',
    scope: 'payment',
    bt: ['BT-9'],
    summary: 'Invoices (380, 384) with an amount due have a payment due date (C. com. L441-9).',
    check: (inv) =>
      when(
        ['380', '384'].includes(inv.typeCode ?? '') &&
          (inv.totals.payable ?? 0) > 0 &&
          missing(inv.dueDate),
        'dueDate',
      ),
  }),
  rule({
    ...fr,
    id: 'BR-FR-CO-07',
    scope: 'payment',
    bt: ['BT-9', 'BT-2'],
    summary:
      'The due date is not before the issue date, except for down payments and already paid invoices.',
    check: (inv) =>
      when(
        present(inv.dueDate) &&
          present(inv.issueDate) &&
          isIsoDate(inv.dueDate) &&
          isIsoDate(inv.issueDate) &&
          inv.dueDate < inv.issueDate &&
          !DOWN_PAYMENT_TYPES.includes(inv.typeCode ?? '') &&
          frame(inv) !== '2',
        'dueDate',
      ),
  }),
  rule({
    ...ff,
    id: 'FF-DUE-02',
    severity: 'warning',
    scope: 'payment',
    bt: ['BT-9', 'BT-2'],
    summary: 'The payment period is at most 60 days (sector exceptions exist).',
    check: (inv) =>
      when(
        present(inv.dueDate) &&
          present(inv.issueDate) &&
          isIsoDate(inv.dueDate) &&
          isIsoDate(inv.issueDate) &&
          daysBetween(inv.issueDate, inv.dueDate) > 60,
        'dueDate',
      ),
  }),
  rule({
    ...ff,
    id: 'FF-PO-01',
    scope: 'document',
    bt: ['BT-13'],
    summary: 'The purchase order reference is present when the customer requires it.',
    check: (inv, ctx) =>
      when(
        ctx.buyer.requiresPurchaseOrder && missing(inv.purchaseOrderReference),
        'purchaseOrderReference',
      ),
  }),
  rule({
    ...ff,
    id: 'FF-IBAN-01',
    scope: 'payment',
    bt: ['BT-84'],
    summary: 'IBANs pass the ISO 7064 mod 97 check.',
    check: (inv) =>
      each(inv.payment?.accounts ?? [], 'payment.accounts', (a) =>
        present(a.iban) && /^[A-Z]{2}\d{2}/.test(a.iban) && !isValidIban(a.iban.replace(/\s/g, ''))
          ? { value: a.iban }
          : false,
      ).map((f) => ({ ...f, path: `${f.path}.iban` })),
  }),

  // ── Category of operation and VAT on debits (new mentions) ──
  rule({
    ...fr,
    id: 'BR-FR-08',
    scope: 'document',
    bt: ['BT-23'],
    summary: 'The billing frame (goods, services or both) is present and in the list B1…M9.',
    check: (inv) =>
      when(!PROCESS_TYPES.includes(inv.processType?.trim().toUpperCase() ?? ''), 'processType'),
  }),
  rule({
    ...ff,
    id: 'FF-CAT-01',
    scope: 'document',
    bt: ['BT-23'],
    summary:
      'The first letter of the billing frame matches the lines: all goods B, all services S, both M.',
    check: (inv) => {
      const natures = new Set(inv.lines.map((l) => l.nature).filter((n) => n !== undefined));
      if (
        natures.size === 0 ||
        !PROCESS_TYPES.includes(inv.processType?.trim().toUpperCase() ?? '')
      )
        return [];
      const expected = natures.size === 2 ? 'M' : natures.has('goods') ? 'B' : 'S';
      return when(category(inv) !== expected, 'processType');
    },
  }),
  rule({
    ...ff,
    id: 'FF-DEB-01',
    scope: 'document',
    bt: ['BT-8', 'BT-7', 'BT-23'],
    summary:
      'A seller who opted for VAT on debits marks service invoices with BT-8 = invoice date (CII 5, UBL 3).',
    check: (inv, ctx) =>
      when(
        ctx.seller.vatOnDebits &&
          ['S', 'M'].includes(category(inv)) &&
          (inv.vatDueOn !== 'invoice' || present(inv.taxPointDate)),
        'vatDueOn',
      ),
  }),

  // ── Seller and buyer identifiers ──
  rule({
    ...fr,
    id: 'BR-FR-10',
    scope: 'seller',
    bt: ['BT-30'],
    summary: 'The seller SIREN (scheme 0002) is present and has 9 digits.',
    check: ({ seller }) =>
      when(
        !(seller.legalId?.scheme === SIREN_SCHEME && /^\d{9}$/.test(seller.legalId.id)),
        'seller.legalId.id',
      ),
  }),
  rule({
    ...ff,
    id: 'FF-SIREN-01',
    scope: 'document',
    bt: ['BT-30', 'BT-47'],
    summary: 'SIREN numbers pass the Luhn check.',
    check: (inv) =>
      parties(inv).flatMap(({ key, party }) => {
        const siren = sirenOf(party);
        return when(
          siren !== undefined && /^\d{9}$/.test(siren) && !isValidSiren(siren),
          `${key}.legalId.id`,
          { value: siren ?? '' },
        );
      }),
  }),
  rule({
    ...fr,
    id: 'BR-FR-11',
    scope: 'buyer',
    bt: ['BT-47'],
    summary:
      'For a buyer established in France, the buyer SIREN (scheme 0002) is present and has 9 digits.',
    check: (inv) =>
      when(
        isDomesticB2B(inv) &&
          !(inv.buyer.legalId?.scheme === SIREN_SCHEME && /^\d{9}$/.test(inv.buyer.legalId.id)),
        'buyer.legalId.id',
      ),
  }),
  rule({
    ...fr,
    id: 'BR-FR-09',
    scope: 'document',
    bt: ['BT-29', 'BT-46'],
    summary: 'A SIRET (scheme 0009) has 14 digits and starts with the same party’s SIREN.',
    check: (inv) =>
      parties(inv).flatMap(({ key, party }) =>
        each(party.ids, `${key}.ids`, (id) => {
          if (id.scheme !== SIRET_SCHEME) return false;
          const siren = sirenOf(party);
          return !/^\d{14}$/.test(id.id) || (siren !== undefined && !id.id.startsWith(siren));
        }).map((f) => ({ ...f, path: `${f.path}.id` })),
      ),
  }),
  rule({
    ...ff,
    id: 'FF-SIRET-01',
    severity: 'warning',
    scope: 'document',
    bt: ['BT-29', 'BT-46'],
    summary: 'SIRET numbers pass the Luhn check (La Poste: digit sum multiple of 5).',
    check: (inv) =>
      parties(inv).flatMap(({ key, party }) =>
        each(party.ids, `${key}.ids`, (id) =>
          id.scheme === SIRET_SCHEME && /^\d{14}$/.test(id.id) && !isValidSiret(id.id)
            ? { value: id.id }
            : false,
        ).map((f) => ({ ...f, path: `${f.path}.id` })),
      ),
  }),
  rule({
    ...fr,
    id: 'BR-FR-32',
    scope: 'document',
    bt: ['BT-29', 'BT-46'],
    summary:
      'Party identifiers with scheme 0002 or 0231 have exactly 9 digits (legal identifiers: BR-FR-10/11).',
    check: (inv) =>
      parties(inv).flatMap(({ key, party }) =>
        each(
          party.ids,
          `${key}.ids`,
          (id) => ['0002', '0231'].includes(id.scheme ?? '') && !/^\d{9}$/.test(id.id),
        ).map((f) => ({ ...f, path: `${f.path}.id` })),
      ),
  }),
  rule({
    ...fr,
    id: 'BR-FR-CO-10',
    scope: 'document',
    bt: ['BT-29-1', 'BT-46-1'],
    summary: 'Each party identifier has a scheme, and each scheme appears at most once per party.',
    check: (inv) =>
      parties(inv).flatMap(({ key, party }) =>
        each(
          party.ids,
          `${key}.ids`,
          (id, i) =>
            missing(id.scheme) || party.ids.findIndex((other) => other.scheme === id.scheme) !== i,
        ).map((f) => ({ ...f, path: `${f.path}.scheme` })),
      ),
  }),
  rule({
    ...fr,
    id: 'BR-FR-13',
    scope: 'seller',
    bt: ['BT-34'],
    summary: 'The seller electronic address is present.',
    check: ({ seller }) =>
      when(missing(seller.electronicAddress?.id), 'seller.electronicAddress.id'),
  }),
  rule({
    ...fr,
    id: 'BR-FR-12',
    scope: 'buyer',
    bt: ['BT-49'],
    summary: 'The buyer electronic address is present.',
    check: ({ buyer }) => when(missing(buyer.electronicAddress?.id), 'buyer.electronicAddress.id'),
  }),
  rule({
    ...fr,
    id: 'BR-FR-21',
    scope: 'buyer',
    bt: ['BT-49', 'BT-47'],
    summary:
      'For a buyer established in France, the electronic address uses scheme 0225 and starts with the buyer SIREN.',
    check: (inv) => {
      const address = inv.buyer.electronicAddress;
      const siren = sirenOf(inv.buyer);
      if (!isDomesticB2B(inv) || !address || missing(address.id) || siren === undefined) return [];
      return when(
        address.scheme !== FR_ADDRESS_SCHEME || !address.id.startsWith(siren),
        'buyer.electronicAddress.id',
      );
    },
  }),
  rule({
    ...fr,
    id: 'BR-FR-23',
    scope: 'document',
    bt: ['BT-34', 'BT-49'],
    summary: 'Electronic addresses with scheme 0225 only use A-Z a-z 0-9 - _ .',
    check: (inv) =>
      parties(inv).flatMap(({ key, party }) =>
        when(
          party.electronicAddress?.scheme === FR_ADDRESS_SCHEME &&
            present(party.electronicAddress.id) &&
            !/^[A-Za-z0-9\-_.]+$/.test(party.electronicAddress.id),
          `${key}.electronicAddress.id`,
        ),
      ),
  }),
  rule({
    ...fr,
    id: 'BR-FR-25',
    scope: 'document',
    bt: ['BT-34', 'BT-49'],
    summary: 'Electronic addresses have at most 125 characters.',
    check: (inv) =>
      parties(inv).flatMap(({ key, party }) =>
        when((party.electronicAddress?.id ?? '').length > 125, `${key}.electronicAddress.id`),
      ),
  }),
  rule({
    ...ff,
    id: 'FF-VAT-01',
    scope: 'document',
    bt: ['BT-31', 'BT-48'],
    summary: 'French VAT numbers have the form FR + 2 characters + 9 digits.',
    check: (inv) =>
      parties(inv).flatMap(({ key, party }) =>
        when(
          present(party.vatId) && party.vatId.startsWith('FR') && !FR_VAT_SHAPE.test(party.vatId),
          `${key}.vatId`,
          { value: party.vatId ?? '' },
        ),
      ),
  }),
  rule({
    ...ff,
    id: 'FF-VAT-02',
    scope: 'document',
    bt: ['BT-31', 'BT-48'],
    summary: 'The numeric key of a French VAT number matches its SIREN.',
    check: (inv) =>
      parties(inv).flatMap(({ key, party }) =>
        when(
          present(party.vatId) &&
            FR_VAT_SHAPE.test(party.vatId) &&
            !hasValidFrenchVatKey(party.vatId),
          `${key}.vatId`,
          { value: party.vatId ?? '' },
        ),
      ),
  }),
  rule({
    ...ff,
    id: 'FF-VAT-03',
    severity: 'warning',
    scope: 'document',
    bt: ['BT-31', 'BT-30', 'BT-48', 'BT-47'],
    summary:
      'The 9 digits of a French VAT number equal the SIREN of the same party (not for a VAT group).',
    check: (inv) => {
      const vatGroup =
        notesWith(inv, 'TXD').length > 0 || inv.seller.ids.some((id) => id.scheme === '0231');
      return parties(inv).flatMap(({ key, party }) => {
        const siren = sirenOf(party);
        if (!present(party.vatId) || !FR_VAT_SHAPE.test(party.vatId) || siren === undefined)
          return [];
        if (key === 'seller' && vatGroup) return [];
        return when(party.vatId.slice(4) !== siren, `${key}.vatId`);
      });
    },
  }),

  // ── VAT ──
  rule({
    ...fr,
    id: 'BR-FR-15',
    scope: 'vat',
    bt: ['BT-95', 'BT-102', 'BT-118', 'BT-151'],
    summary: 'VAT categories are among S, E, AE, K, G, O, Z (L and M are not used in France).',
    check: (inv) =>
      [
        ...inv.lines.map((l, i) => ({ path: `lines[${i}].vat.category`, value: l.vat.category })),
        ...docAllowanceCharges(inv).map((a) => ({
          path: `${a.path}.vatCategory`,
          value: a.item.vatCategory,
        })),
        ...inv.vatBreakdown.map((b, i) => ({
          path: `vatBreakdown[${i}].category`,
          value: b.category,
        })),
      ]
        .filter((c) => present(c.value) && !FR_CATEGORIES.includes(c.value.trim()))
        .map((c) => finding(c.path, { value: c.value ?? '' })),
  }),
  rule({
    ...fr,
    id: 'BR-FR-16',
    scope: 'vat',
    bt: ['BT-96', 'BT-103', 'BT-119', 'BT-152'],
    summary:
      'VAT rates are in the French list (0, 0.9, 1.05, 1.75, 2.1, 5.5, 7, 8.5, 9.2, 9.6, 10, 13, 19.6, 20, 20.6).',
    check: (inv) =>
      rates(inv)
        .filter((r) => r.value !== undefined && isDecimal(r.value) && !rateIn(r.value, FR_RATES))
        .map((r) => finding(r.path, { rate: r.value ?? '' })),
  }),
  rule({
    ...ff,
    id: 'FF-RATE-02',
    severity: 'warning',
    scope: 'vat',
    bt: ['BT-152'],
    summary: 'Line VAT rates are the usual mainland rates (0, 2.1, 5.5, 10, 20).',
    check: (inv) =>
      each(inv.lines, 'lines', (l) =>
        rateIn(l.vat.rate, FR_RATES) && !rateIn(l.vat.rate, USUAL_RATES)
          ? { rate: l.vat.rate ?? '' }
          : false,
      ).map((f) => ({ ...f, path: `${f.path}.vat.rate` })),
  }),
  rule({
    ...dgfip,
    id: 'DGFIP-G1.41',
    scope: 'vat',
    bt: ['BT-120', 'BT-121'],
    summary:
      'An exempt (E) VAT breakdown has both the exemption code and the text, except on 384 and invoices under 150 €.',
    check: (inv) =>
      inv.typeCode === '384' || (inv.totals.taxInclusive ?? 0) < 15_000
        ? []
        : each(
            inv.vatBreakdown,
            'vatBreakdown',
            (b) =>
              b.category === 'E' &&
              (present(b.exemptionCode) || present(b.exemptionReason)) &&
              (missing(b.exemptionCode) || missing(b.exemptionReason)),
          ).map((f) => ({ ...f, path: `${f.path}.exemptionReason` })),
  }),
  rule({
    ...fr,
    id: 'BR-FR-CO-16',
    scope: 'vat',
    bt: ['BT-118', 'BT-121', 'BT-32'],
    summary:
      'Franchise en base: category E with VATEX-FR-FRANCHISE; a seller without VAT number repeats its SIREN as tax registration identifier.',
    check: (inv) => {
      const franchise = inv.vatBreakdown
        .map((b, i) => ({ b, i }))
        .filter(({ b }) => b.exemptionCode === 'VATEX-FR-FRANCHISE');
      if (franchise.length === 0) return [];
      const wrongCategory = franchise
        .filter(({ b }) => b.category !== 'E')
        .map(({ i }) => finding(`vatBreakdown[${i}].category`));
      const siren = sirenOf(inv.seller);
      const noFiscalId =
        missing(inv.seller.vatId) &&
        (siren === undefined || inv.seller.taxRegistrationId !== siren);
      return [...wrongCategory, ...when(noFiscalId, 'seller.taxRegistrationId')];
    },
  }),
  rule({
    ...ff,
    id: 'FF-TVA-01',
    scope: 'vat',
    bt: ['BT-120'],
    summary: 'Franchise en base: the exemption text is « TVA non applicable, art. 293 B du CGI ».',
    check: (inv) =>
      each(
        inv.vatBreakdown,
        'vatBreakdown',
        (b) =>
          b.exemptionCode === 'VATEX-FR-FRANCHISE' && !/293\s*B/i.test(b.exemptionReason ?? ''),
      ).map((f) => ({ ...f, path: `${f.path}.exemptionReason` })),
  }),
  rule({
    ...ff,
    id: 'FF-TVA-02',
    scope: 'vat',
    bt: ['BT-120', 'BT-121'],
    summary:
      'Reverse charge (AE): code VATEX-FR-AE or VATEX-EU-AE, and the text says « Autoliquidation ».',
    check: (inv) =>
      each(
        inv.vatBreakdown,
        'vatBreakdown',
        (b) =>
          b.category === 'AE' &&
          (!['VATEX-FR-AE', 'VATEX-EU-AE'].includes(b.exemptionCode ?? '') ||
            !/autoliquidation/i.test(b.exemptionReason ?? '')),
      ).map((f) => ({ ...f, path: `${f.path}.exemptionReason` })),
  }),
  rule({
    ...ff,
    id: 'FF-TVA-03',
    scope: 'vat',
    bt: ['BT-120', 'BT-121'],
    summary: 'Intra-community supply (K): code VATEX-EU-IC and an exemption text.',
    check: (inv) =>
      each(
        inv.vatBreakdown,
        'vatBreakdown',
        (b) =>
          b.category === 'K' && (b.exemptionCode !== 'VATEX-EU-IC' || missing(b.exemptionReason)),
      ).map((f) => ({ ...f, path: `${f.path}.exemptionCode` })),
  }),
  rule({
    ...dgfip,
    id: 'DGFIP-G2.32',
    severity: 'warning',
    scope: 'vat',
    bt: ['BT-118', 'BT-121'],
    summary:
      'An invoice with only category O, or only E with a VATEX-FR-CGI261… code, is outside B2B e-invoicing.',
    check: (inv, ctx) => {
      if (ctx.buyer.publicEntity || inv.vatBreakdown.length === 0) return [];
      const onlyO = inv.vatBreakdown.every((b) => b.category === 'O');
      const onlyE261 = inv.vatBreakdown.every(
        (b) => b.category === 'E' && G232_CODES.has(b.exemptionCode ?? ''),
      );
      return when(onlyO || onlyE261, 'vatBreakdown');
    },
  }),
  rule({
    ...dgfip,
    id: 'DGFIP-G6.21',
    scope: 'vat',
    bt: ['BT-121', 'BT-3'],
    summary: 'VATEX-FR-CNWVAT (credit note net of VAT) is only used on credit notes 381, 261, 396.',
    check: (inv) =>
      ['381', '261', '396'].includes(inv.typeCode ?? '')
        ? []
        : each(inv.vatBreakdown, 'vatBreakdown', (b) => b.exemptionCode === 'VATEX-FR-CNWVAT').map(
            (f) => ({ ...f, path: `${f.path}.exemptionCode` }),
          ),
  }),

  // ── Credit notes, corrective and down-payment invoices ──
  rule({
    ...fr,
    id: 'BR-FR-CO-05',
    scope: 'document',
    bt: ['BT-25', 'BT-26'],
    summary:
      'A credit note (381, 261, 396, 502, 503) references at least one invoice with its date.',
    check: (inv) =>
      when(
        CREDIT_NOTE_TYPES.includes(inv.typeCode ?? '') &&
          !inv.precedingInvoices.some((p) => present(p.number) && present(p.issueDate)),
        'precedingInvoices',
      ),
  }),
  rule({
    ...fr,
    id: 'BR-FR-CO-04',
    scope: 'document',
    bt: ['BT-25', 'BT-26'],
    summary:
      'A corrective invoice (384, 471, 472, 473) references exactly one invoice with its date.',
    check: (inv) =>
      when(
        CORRECTIVE_TYPES.includes(inv.typeCode ?? '') &&
          !(
            inv.precedingInvoices.length === 1 &&
            present(inv.precedingInvoices[0]?.number) &&
            present(inv.precedingInvoices[0]?.issueDate)
          ),
        'precedingInvoices',
      ),
  }),
  rule({
    ...ff,
    id: 'FF-CN-01',
    severity: 'warning',
    scope: 'document',
    bt: ['BT-25', 'BT-26'],
    summary:
      'A referenced invoice exists in the local history with that date, not after the issue date.',
    check: (inv, ctx) => {
      if (!ctx.history || ctx.history.length === 0) return [];
      const history = ctx.history;
      return each(inv.precedingInvoices, 'precedingInvoices', (p) => {
        if (missing(p.number)) return false;
        const found = history.find(
          (h) =>
            h.number === p.number && (p.issueDate === undefined || h.issueDate === p.issueDate),
        );
        return !found || (present(inv.issueDate) && found.issueDate > (inv.issueDate ?? ''));
      }).map((f) => ({ ...f, path: `${f.path}.number` }));
    },
  }),
  rule({
    ...fr,
    id: 'BR-FR-CO-03',
    scope: 'document',
    bt: ['BT-12', 'BG-14'],
    summary:
      'A global-discount credit note (262) has a contract reference and an invoicing period.',
    check: (inv) =>
      inv.typeCode === '262'
        ? [
            ...when(missing(inv.contractReference), 'contractReference'),
            ...when(inv.invoicePeriod === undefined, 'invoicePeriod'),
          ]
        : [],
  }),
  rule({
    ...fr,
    id: 'BR-FR-CO-08',
    scope: 'document',
    bt: ['BT-23', 'BT-3'],
    summary:
      'Frames B4, S4, M4 (final invoice after down payments) are not used on down-payment invoices.',
    check: (inv) =>
      when(frame(inv) === '4' && DOWN_PAYMENT_TYPES.includes(inv.typeCode ?? ''), 'processType'),
  }),
  rule({
    ...fr,
    id: 'BR-FR-CO-09',
    scope: 'totals',
    bt: ['BT-23', 'BT-113', 'BT-112', 'BT-115'],
    summary: 'Frames B2, S2, M2 (already paid): paid amount = total with VAT and amount due = 0.',
    check: (inv) =>
      when(
        frame(inv) === '2' &&
          ((inv.totals.prepaid ?? 0) !== (inv.totals.taxInclusive ?? 0) ||
            (inv.totals.payable ?? 0) !== 0),
        'totals.prepaid',
      ),
  }),
  rule({
    ...fr,
    id: 'BR-FR-CO-12',
    scope: 'totals',
    bt: ['BT-5', 'BT-6', 'BT-111'],
    summary: 'An invoice in a foreign currency gives the VAT total in euros (BT-6 = EUR, BT-111).',
    check: (inv) =>
      present(inv.currency) && inv.currency !== 'EUR'
        ? [
            ...when(inv.vatCurrency !== 'EUR', 'vatCurrency'),
            ...when(
              inv.totals.taxTotalAccountingCurrency === undefined,
              'totals.taxTotalAccountingCurrency',
            ),
          ]
        : [],
  }),
  rule({
    ...ff,
    id: 'FF-CUR-01',
    severity: 'warning',
    scope: 'document',
    bt: ['BT-5'],
    summary: 'The invoice is in euros; another currency is allowed but worth a second look.',
    check: (inv) =>
      when(
        present(inv.currency) && /^[A-Z]{3}$/.test(inv.currency) && inv.currency !== 'EUR',
        'currency',
        {
          value: inv.currency ?? '',
        },
      ),
  }),
  rule({
    ...ff,
    id: 'FF-QTY-01',
    severity: 'warning',
    scope: 'lines',
    bt: ['BT-129'],
    summary: 'Quantities are not negative, except on credit notes.',
    check: (inv) =>
      CREDIT_NOTE_TYPES.includes(inv.typeCode ?? '')
        ? []
        : each(
            inv.lines,
            'lines',
            (l) =>
              l.quantity !== undefined &&
              isDecimal(l.quantity) &&
              compareDecimal(l.quantity, '0') === -1,
          ).map((f) => ({ ...f, path: `${f.path}.quantity` })),
  }),

  // ── Delivery ──
  rule({
    ...fr,
    id: 'BR-FR-CO-17',
    severity: 'warning',
    scope: 'delivery',
    bt: ['BT-72', 'BG-14'],
    summary:
      'The delivery date or the invoicing period is given (needed when it differs from the issue date).',
    check: (inv) =>
      when(
        missing(inv.delivery?.date) &&
          missing(inv.invoicePeriod?.start) &&
          missing(inv.invoicePeriod?.end),
        'delivery.date',
      ),
  }),
  rule({
    ...fr,
    id: 'BR-FR-14',
    scope: 'delivery',
    bt: ['BG-15'],
    summary:
      'Goods delivered elsewhere than the billing address (customer setting) have a delivery address.',
    check: (inv, ctx) =>
      when(
        ctx.buyer.deliversElsewhere &&
          ['B', 'M'].includes(category(inv)) &&
          inv.delivery?.address === undefined,
        'delivery.address',
      ),
  }),
  rule({
    ...ff,
    id: 'FF-DLV-01',
    scope: 'delivery',
    bt: ['BT-75', 'BT-77', 'BT-78', 'BT-80'],
    summary: 'A delivery address has street, city, post code and country.',
    check: (inv) => {
      const a = inv.delivery?.address;
      if (!a) return [];
      return when(
        missing(a.line1) || missing(a.city) || missing(a.postCode) || missing(a.country),
        'delivery.address',
      );
    },
  }),

  // ── Decimals ──
  rule({
    ...fr,
    id: 'BR-FR-DEC-01',
    stage: 'import',
    scope: 'totals',
    bt: ['BT-92', 'BT-106', 'BT-109', 'BT-112', 'BT-115', 'BT-131'],
    summary:
      'Amounts have at most 2 decimals (checked when reading an XML file; the model holds cents).',
    check: () => [],
  }),
  rule({
    ...fr,
    id: 'BR-FR-DEC-02',
    scope: 'lines',
    bt: ['BT-129', 'BT-149'],
    summary: 'Quantities have at most 4 decimals.',
    check: (inv) =>
      inv.lines.flatMap((l, i) =>
        [
          { path: `lines[${i}].quantity`, value: l.quantity },
          { path: `lines[${i}].price.baseQuantity`, value: l.price.baseQuantity },
        ]
          .filter((q) => q.value !== undefined && isDecimal(q.value) && decimalPlaces(q.value) > 4)
          .map((q) => finding(q.path)),
      ),
  }),
  rule({
    ...fr,
    id: 'BR-FR-DEC-03',
    scope: 'lines',
    bt: ['BT-146', 'BT-147', 'BT-148'],
    summary: 'Unit prices have at most 6 decimals and are not negative (except frames 9).',
    check: (inv) =>
      inv.lines.flatMap((l, i) =>
        [
          { path: `lines[${i}].price.net`, value: l.price.net },
          { path: `lines[${i}].price.gross`, value: l.price.gross },
          { path: `lines[${i}].price.discount`, value: l.price.discount },
        ]
          .filter(
            (p) =>
              p.value !== undefined &&
              isDecimal(p.value) &&
              (decimalPlaces(p.value) > 6 ||
                (frame(inv) !== '9' && compareDecimal(p.value, '0') === -1)),
          )
          .map((p) => finding(p.path)),
      ),
  }),
  rule({
    ...fr,
    id: 'BR-FR-DEC-04',
    scope: 'vat',
    bt: ['BT-96', 'BT-103', 'BT-119', 'BT-152'],
    summary: 'VAT rates have at most 2 decimals and are not negative.',
    check: (inv) =>
      rates(inv)
        .filter(
          (r) =>
            r.value !== undefined &&
            isDecimal(r.value) &&
            (decimalPlaces(r.value) > 2 || compareDecimal(r.value, '0') === -1),
        )
        .map((r) => finding(r.path)),
  }),
];
