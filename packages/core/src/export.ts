// The accountant export of supplier invoices (plan §3 screen 5, §6 InboundAgent): a CSV for a
// spreadsheet and a purchase journal in the layout of the FEC, article A47 A-1 of the Livre des
// procédures fiscales (text in docs/ACCOUNTING_EXPORT.md). It is a file to import, not the company's
// legal FEC: only its accounting software holds the whole year.
import { t } from '@fi/shared';
import { parisToday } from './dates';
import { isCreditNote, partySiren } from './inbound';
import type { Invoice } from './model';
import type { Cents } from './money';
import { frDate } from './pdf/format';

/** One supplier invoice as the export needs it (purchaseItem). */
export interface PurchaseItem {
  number: string;
  issueDate: string;
  dueDate?: string;
  creditNote: boolean;
  currency: string;
  supplier: { name: string; siren?: string; vatId?: string };
  taxExclusive: Cents;
  taxTotal: Cents;
  taxInclusive: Cents;
  payable: Cents;
  /** BG-23: taxable amount and VAT per category and rate. */
  vat: { category?: string; rate?: string; taxable: Cents; tax: Cents }[];
  iban?: string;
  pdpRef: string;
  /** ISO timestamp. */
  receivedAt: string;
}

/** The export's view of a parsed invoice; amounts the file lacks count as zero. */
export function purchaseItem(
  invoice: Invoice,
  meta: { pdpRef: string; receivedAt: string },
): PurchaseItem {
  const totals = invoice.totals;
  const taxInclusive = totals.taxInclusive ?? 0;
  const siren = partySiren(invoice.seller);
  return {
    number: invoice.number ?? '',
    issueDate: invoice.issueDate ?? '',
    ...(invoice.dueDate && { dueDate: invoice.dueDate }),
    creditNote: isCreditNote(invoice),
    currency: invoice.currency ?? 'EUR',
    supplier: {
      name: invoice.seller.name ?? '',
      ...(siren && { siren }),
      ...(invoice.seller.vatId && { vatId: invoice.seller.vatId }),
    },
    taxExclusive: totals.taxExclusive ?? 0,
    taxTotal: totals.taxTotal ?? 0,
    taxInclusive,
    payable: totals.payable ?? taxInclusive,
    vat: invoice.vatBreakdown.map((v) => ({
      ...(v.category && { category: v.category }),
      ...(v.rate && { rate: v.rate }),
      taxable: v.taxableAmount ?? 0,
      tax: v.taxAmount ?? 0,
    })),
    ...(invoice.payment?.accounts[0]?.iban && {
      iban: invoice.payment.accounts[0].iban.replace(/\s+/g, ''),
    }),
    ...meta,
  };
}

/**
 * Whether the FEC can hold the item: amounts in euros (the FEC is kept in euros, and the export has no
 * exchange rate), and VAT lines that add up to the total, so the entry balances.
 */
export function fecReady(item: PurchaseItem): boolean {
  const lines = item.vat.reduce((n, v) => n + v.taxable + v.tax, 0);
  return item.currency === 'EUR' && item.vat.length > 0 && lines === item.taxInclusive;
}

// ── FEC ──────────────────────────────────────────────────────────────────────────────────────────

/** The 18 fields, in the order of article A47 A-1, VII 1°. */
export const FEC_FIELDS = [
  'JournalCode',
  'JournalLib',
  'EcritureNum',
  'EcritureDate',
  'CompteNum',
  'CompteLib',
  'CompAuxNum',
  'CompAuxLib',
  'PieceRef',
  'PieceDate',
  'EcritureLib',
  'Debit',
  'Credit',
  'EcritureLet',
  'DateLet',
  'ValidDate',
  'Montantdevise',
  'Idevise',
] as const;

/**
 * Plan comptable général accounts a purchase goes to: one charge account for every supplier (the
 * accountant reclassifies; per-supplier accounts are in docs/DEFERRED.md), deductible VAT, suppliers.
 */
export const PURCHASE_ACCOUNTS = { charge: '606000', vat: '445660', supplier: '401000' } as const;
type PurchaseAccount = (typeof PURCHASE_ACCOUNTS)[keyof typeof PURCHASE_ACCOUNTS];
export const PURCHASE_JOURNAL = 'ACH';

/** VI 1° c: fields are separated by a tab; I: records by a carriage return and/or line feed. */
const TAB = '\t';
const CRLF = '\r\n';

/** XII 2°: decimal comma, no thousands separator. Both sides are written, the empty one as zero. */
export function fecAmount(cents: Cents): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** XII 4°: AAAAMMJJ, no separator. */
export const fecDate = (iso: string) => iso.replaceAll('-', '');

/** A field never holds the separator or a line break; blanks stay empty (BOFiP CF-IOR-60-40-20 § 70). */
const field = (value: string) =>
  value
    .replace(/[\t\r\n|]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();

/** The supplier's auxiliary account: « F » and its SIREN, else its VAT number, else its name. */
export function supplierAccount(supplier: PurchaseItem['supplier']): string {
  const id =
    supplier.siren ??
    supplier.vatId?.replace(/\s+/g, '').toUpperCase() ??
    supplier.name
      .normalize('NFD')
      .replace(/[^A-Za-z0-9]/g, '')
      .toUpperCase()
      .slice(0, 12);
  return `F${id}`;
}

export interface FecFile {
  /** IX: SirenFECAAAAMMJJ (the export day here, as it is an extract and not a closed year). */
  name: string;
  text: string;
  entries: number;
  /** The last entry number written: the next export continues after it (VII 1°, a continuous sequence). */
  lastEntry: number;
}

/**
 * The purchase journal of `items` (only fecReady ones), one balanced entry per invoice: the charge and
 * the VAT of each rate on one side, the supplier on the other. A credit note swaps the sides.
 */
export function buildFec(
  items: readonly PurchaseItem[],
  options: { siren: string; firstEntry: number; validDate: string },
): FecFile {
  const journal = t('export.fec.journal');
  const valid = fecDate(options.validDate);
  const rows: string[] = [FEC_FIELDS.join(TAB)];
  const sorted = [...items].sort(
    (a, b) => a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number),
  );
  let entry = options.firstEntry - 1;
  for (const item of sorted) {
    if (!fecReady(item)) throw new Error(`invoice ${item.number} cannot go into the FEC`);
    entry++;
    const common = {
      num: String(entry),
      date: fecDate(item.issueDate),
      piece: field(item.number),
      lib: field(`${item.supplier.name} ${item.number}`).slice(0, 100),
    };
    const line = (
      account: PurchaseAccount,
      debit: Cents,
      credit: Cents,
      aux?: [string, string],
    ) => {
      const [d, c] = item.creditNote ? [credit, debit] : [debit, credit];
      rows.push(
        [
          PURCHASE_JOURNAL,
          journal,
          common.num,
          common.date,
          account,
          t(`export.fec.account.${account}`),
          aux ? field(aux[0]) : '',
          aux ? field(aux[1]) : '',
          common.piece,
          common.date,
          common.lib,
          fecAmount(d),
          fecAmount(c),
          '',
          '',
          valid,
          '',
          '',
        ].join(TAB),
      );
    };
    for (const v of item.vat) {
      if (v.taxable !== 0) line(PURCHASE_ACCOUNTS.charge, v.taxable, 0);
      if (v.tax !== 0) line(PURCHASE_ACCOUNTS.vat, v.tax, 0);
    }
    line(PURCHASE_ACCOUNTS.supplier, 0, item.taxInclusive, [
      supplierAccount(item.supplier),
      item.supplier.name,
    ]);
  }
  return {
    name: `${options.siren}FEC${valid}`,
    text: rows.join(CRLF) + CRLF,
    entries: sorted.length,
    lastEntry: entry,
  };
}

// ── CSV ──────────────────────────────────────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  'supplier',
  'siren',
  'vatId',
  'type',
  'number',
  'issueDate',
  'dueDate',
  'taxExclusive',
  'taxTotal',
  'taxInclusive',
  'payable',
  'currency',
  'iban',
  'receivedOn',
  'pdpRef',
] as const;

/**
 * Text a spreadsheet would run as a formula (=, +, -, @ first) gets a leading apostrophe: the names
 * come from the supplier's file.
 */
const csvText = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);

const csvCell = (value: string) =>
  /[;"\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

/** Amounts as French spreadsheets read them: decimal comma, a credit note negative. */
const csvAmount = (item: PurchaseItem, cents: Cents) => fecAmount(item.creditNote ? -cents : cents);

/**
 * One line per invoice, `;`-separated, UTF-8 with a BOM so that Excel reads the accents, CRLF line
 * ends, dates as JJ/MM/AAAA.
 */
export function buildCsv(items: readonly PurchaseItem[]): string {
  const header = CSV_COLUMNS.map((c) => t(`export.csv.${c}`));
  const rows = items.map((item) => {
    const cells: Record<(typeof CSV_COLUMNS)[number], string> = {
      supplier: csvText(item.supplier.name),
      siren: item.supplier.siren ?? '',
      vatId: csvText(item.supplier.vatId ?? ''),
      type: t(item.creditNote ? 'export.csv.creditNote' : 'export.csv.invoice'),
      number: csvText(item.number),
      issueDate: item.issueDate ? frDate(item.issueDate) : '',
      dueDate: item.dueDate ? frDate(item.dueDate) : '',
      taxExclusive: csvAmount(item, item.taxExclusive),
      taxTotal: csvAmount(item, item.taxTotal),
      taxInclusive: csvAmount(item, item.taxInclusive),
      payable: csvAmount(item, item.payable),
      currency: csvText(item.currency),
      iban: csvText(item.iban ?? ''),
      receivedOn: frDate(parisToday(new Date(item.receivedAt))),
      pdpRef: csvText(item.pdpRef),
    };
    return CSV_COLUMNS.map((c) => csvCell(cells[c])).join(';');
  });
  return `﻿${[header.map(csvCell).join(';'), ...rows].join(CRLF)}${CRLF}`;
}
