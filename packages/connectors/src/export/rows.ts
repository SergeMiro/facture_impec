// A row of a list export → the entity row its schema checks (src/schemas.ts), or the reason it is
// skipped. A field that cannot be read (an e-mail without « @ », a date that is no date) is left
// out and the row kept; only a missing key skips the row.
import {
  dateOf,
  identifierOf,
  isTotalRow,
  isValidSiren,
  isValidSiret,
  normalizeHeader,
  percentValueOf,
  type RawCell,
  type RawRow,
  textOf,
} from '@fi/core';
import {
  type ChantierRow,
  ChantierRow as ChantierSchema,
  type ErpAddress,
  type Skipped,
  type TiersRow,
  TiersRow as TiersSchema,
} from '../schemas';
import type { ChantierField, TiersField } from './columns';
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
  const customerIds = idsOf(cells.customerSiren, cells.customerSiret);
  const customer = {
    code: textOf(cells.customerCode),
    siren: customerIds.siren,
    name: textOf(cells.customerName),
  };
  const parsed = ChantierSchema.safeParse({
    row: row.row,
    code,
    name,
    customer: Object.values(customer).some((v) => v !== undefined) ? customer : undefined,
    address: addressOf(cells),
    status: statusOf(cells.status),
    receptionOn: isoDate(cells.receptionOn),
    reservesLiftedOn: isoDate(cells.reservesLiftedOn),
    retenueBps: retenueOf(cells.retenue),
  });
  return parsed.success ? { ok: true, value: parsed.data } : skip('invalid');
}
