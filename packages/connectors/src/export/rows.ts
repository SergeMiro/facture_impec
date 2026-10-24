// A row of a list export → the entity row its schema checks (src/schemas.ts), or the reason it is
// skipped. A field that cannot be read (an e-mail without « @ », a date that is no date) is left
// out and the row kept; only a missing key skips the row.
import {
  dateOf,
  decimalOf,
  identifierOf,
  isTotalRow,
  isValidSiren,
  isValidSiret,
  normalizeHeader,
  percentValueOf,
  type RawCell,
  type RawRow,
  roundToCents,
  textOf,
} from '@fi/core';
import {
  type ChantierRow,
  ChantierRow as ChantierSchema,
  type ErpAddress,
  type FactureRow,
  FactureRow as FactureSchema,
  type PartyRef,
  type ReglementRow,
  ReglementRow as ReglementSchema,
  type Skipped,
  type TiersRow,
  TiersRow as TiersSchema,
} from '../schemas';
import type { ChantierField, InvoiceField, PaymentField, TiersField } from './columns';
import { cellsOf, type ExportSheet } from './read';

export type Parsed<T> = { ok: true; value: T } | { ok: false; skipped: Skipped };

const words = (cell: RawCell | undefined) => normalizeHeader(textOf(cell) ?? '');

const COUNTRIES: Record<string, string> = { france: 'FR', fr: 'FR', fra: 'FR' };

function addressOf(
  cells: Partial<Record<'line1' | 'line2' | 'postcode' | 'city' | 'country', RawCell>>,
): ErpAddress | undefined {
  const country = COUNTRIES[words(cells.country)];
  const address = {
    line1: textOf(cells.line1),
    line2: textOf(cells.line2),
    // A postcode typed as a number loses its zero: 1000 is Bourg-en-Bresse's 01000.
    postCode: postcodeOf(cells.postcode),
    city: textOf(cells.city),
    country,
  };
  const kept = Object.fromEntries(Object.entries(address).filter(([, v]) => v !== undefined));
  return Object.keys(kept).length ? (kept as ErpAddress) : undefined;
}

function postcodeOf(cell: RawCell | undefined): string | undefined {
  const text = textOf(cell);
  if (text === undefined) return undefined;
  return /^\d{4}$/.test(text) ? `0${text}` : text;
}

/** SIREN and SIRET from their columns: a SIRET gives its SIREN; a SIREN column wins when both disagree. */
function idsOf(sirenCell: RawCell | undefined, siretCell: RawCell | undefined) {
  const digits = (cell: RawCell | undefined) => identifierOf(cell)?.replace(/\D/g, '') ?? '';
  const candidates = [digits(sirenCell), digits(siretCell)].filter((d) => d !== '');
  const siret = candidates.find((d) => d.length === 14 && isValidSiret(d));
  const siren = candidates.find((d) => d.length === 9 && isValidSiren(d)) ?? siret?.slice(0, 9);
  return {
    siren,
    siret: siret && siren && siret.startsWith(siren) ? siret : undefined,
    given: candidates.length > 0,
  };
}

/** « Oui », « X », « 1 », « Vrai » in a « Sous-traitant » column; a family named « Sous-traitants ». */
function subcontractingOf(flag: RawCell | undefined, category: RawCell | undefined) {
  if (flag && flag.value !== null && textOf(flag) !== undefined) {
    if (typeof flag.value === 'boolean') return flag.value;
    return ['oui', 'o', 'x', '1', 'vrai', 'yes', 'true'].includes(words(flag));
  }
  if (/\bsous trait/.test(words(category))) return true;
  return undefined;
}

const email = (cell: RawCell | undefined) => {
  const text = textOf(cell)?.replace(/^mailto:/i, '');
  return text && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text.toLowerCase() : undefined;
};

const isoDate = (cell: RawCell | undefined) => {
  const d = dateOf(cell);
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;
};

/** « 5 », « 5 % », a 5 % cell: basis points; anything above the legal 5 % is left out. */
function retenueOf(cell: RawCell | undefined): number | undefined {
  const value = Number(percentValueOf(cell)?.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0 || value > 5) return undefined;
  return Math.round(value * 100);
}

const CLOSED = /^(termine|clos|cloture|solde|archive|acheve|ferme|annule|fini)/;

function statusOf(cell: RawCell | undefined): 'open' | 'closed' | undefined {
  const w = words(cell);
  if (w === '') return undefined;
  return CLOSED.test(w) ? 'closed' : 'open';
}

/** An amount in cents: « 1 234,50 € », 1234.5; undefined when the cell holds no number. */
function centsOf(cell: RawCell | undefined): number | undefined {
  const decimal = decimalOf(cell);
  return decimal === undefined ? undefined : (roundToCents(decimal) ?? undefined);
}

/** An invoice's number as the ERP writes it: an Excel number without « .0 », text as typed. */
const numberOf = (cell: RawCell | undefined) =>
  cell && typeof cell.value === 'number' && Number.isSafeInteger(cell.value)
    ? String(cell.value)
    : textOf(cell);

/** Who a row names, when it names anyone. */
function partyRefOf(
  code: RawCell | undefined,
  name: RawCell | undefined,
  siren: RawCell | undefined,
  siret: RawCell | undefined,
): PartyRef | undefined {
  const ref = { code: textOf(code), siren: idsOf(siren, siret).siren, name: textOf(name) };
  return Object.values(ref).some((v) => v !== undefined) ? ref : undefined;
}

/** Data rows only: no empty row, no « Total » row an export may end with. */
export const dataRows = (rows: readonly RawRow[]) =>
  rows.filter((r) => r.cells.some((c) => textOf(c) !== undefined) && !isTotalRow(r));

export function tiersRow(sheet: ExportSheet, row: RawRow): Parsed<TiersRow> {
  const cells = cellsOf(sheet as ExportSheet<'customers'>, row) as Partial<
    Record<TiersField, RawCell>
  >;
  const name = textOf(cells.name) ?? null;
  const skip = (reason: Skipped['reason']): Parsed<TiersRow> => ({
    ok: false,
    skipped: { row: row.row, name, reason },
  });
  if (!name) return skip('no_name');
  const ids = idsOf(cells.siren, cells.siret);
  if (!ids.siren) return skip(ids.given ? 'siren_invalid' : 'no_siren');
  const parsed = TiersSchema.safeParse({
    row: row.row,
    code: textOf(cells.code),
    name,
    siren: ids.siren,
    siret: ids.siret,
    email: email(cells.email),
    address: addressOf(cells),
    subcontracting: subcontractingOf(cells.subcontracting, cells.category),
  });
  return parsed.success ? { ok: true, value: parsed.data } : skip('invalid');
}

export function chantierRow(sheet: ExportSheet, row: RawRow): Parsed<ChantierRow> {
  const cells = cellsOf(sheet as ExportSheet<'chantiers'>, row) as Partial<
    Record<ChantierField, RawCell>
  >;
  const name = textOf(cells.name) ?? null;
  const skip = (reason: Skipped['reason']): Parsed<ChantierRow> => ({
    ok: false,
    skipped: { row: row.row, name, reason },
  });
  const code = textOf(cells.code);
  if (!code) return skip('no_code');
  if (!name) return skip('no_name');
  const parsed = ChantierSchema.safeParse({
    row: row.row,
    code,
    name,
    customer: partyRefOf(
      cells.customerCode,
      cells.customerName,
      cells.customerSiren,
      cells.customerSiret,
    ),
    address: addressOf(cells),
    status: statusOf(cells.status),
    receptionOn: isoDate(cells.receptionOn),
    reservesLiftedOn: isoDate(cells.reservesLiftedOn),
    retenueBps: retenueOf(cells.retenue),
  });
  return parsed.success ? { ok: true, value: parsed.data } : skip('invalid');
}

/** Not an invoice: nothing is owed on it. */
const NOT_INVOICE = /^(devis|pro ?forma|bon de commande|commande|bon de livraison|bl)\b/;

/**
 * A row of an invoice list: a sale or a situation with its due date and what is owed. An avoir (by
 * its type or a negative amount), a devis or a pro forma is skipped with its reason.
 */
export function factureRow(sheet: ExportSheet, row: RawRow): Parsed<FactureRow> {
  const cells = cellsOf(sheet as ExportSheet<'invoices'>, row) as Partial<
    Record<InvoiceField, RawCell>
  >;
  const number = numberOf(cells.number);
  const skip = (reason: Skipped['reason']): Parsed<FactureRow> => ({
    ok: false,
    skipped: { row: row.row, name: number ?? textOf(cells.customerName) ?? null, reason },
  });
  const type = words(cells.type);
  if (NOT_INVOICE.test(type)) return skip('not_invoice');
  if (/^avoir/.test(type)) return skip('credit_note');
  if (!number) return skip('no_number');
  const total = centsOf(cells.total);
  const left = centsOf(cells.left);
  if ((total ?? 0) < 0 || (left ?? 0) < 0) return skip('credit_note');
  const dueOn = isoDate(cells.dueOn);
  if (!dueOn) return skip('no_due_date');
  if (!total && left === undefined) return skip('no_amount');
  const chantier = { code: textOf(cells.chantierCode), name: textOf(cells.chantierName) };
  const parsed = FactureSchema.safeParse({
    row: row.row,
    number,
    kind: /situation/.test(type) || textOf(cells.situation) ? 'situation' : 'facture',
    issuedOn: isoDate(cells.issuedOn),
    dueOn,
    customer: partyRefOf(
      cells.customerCode,
      cells.customerName,
      cells.customerSiren,
      cells.customerSiret,
    ),
    chantier: chantier.code || chantier.name ? chantier : undefined,
    total: total || undefined,
    left,
  });
  return parsed.success ? { ok: true, value: parsed.data } : skip('invalid');
}

/** A row of a payment list: the invoice it pays and how much. A refund is no payment. */
export function reglementRow(sheet: ExportSheet, row: RawRow): Parsed<ReglementRow> {
  const cells = cellsOf(sheet as ExportSheet<'payments'>, row) as Partial<
    Record<PaymentField, RawCell>
  >;
  const invoice = numberOf(cells.invoiceNumber);
  const skip = (reason: Skipped['reason']): Parsed<ReglementRow> => ({
    ok: false,
    skipped: { row: row.row, name: invoice ?? textOf(cells.customerName) ?? null, reason },
  });
  if (!invoice) return skip('no_number');
  const amount = centsOf(cells.amount);
  if (!amount) return skip('no_amount');
  if (amount < 0) return skip('credit_note');
  const parsed = ReglementSchema.safeParse({
    row: row.row,
    invoice,
    paidOn: isoDate(cells.paidOn),
    amount,
    mode: textOf(cells.mode),
    reference: textOf(cells.reference),
  });
  return parsed.success ? { ok: true, value: parsed.data } : skip('invalid');
}
