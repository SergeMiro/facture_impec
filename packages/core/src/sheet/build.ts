// Sheet rows → invoice drafts, with the cell behind every field so an issue on `lines[1].vat.rate`
// selects `Feuil1!F15` (plan §5 « Corriger dans la feuille »). The seller side comes from the tenant;
// nothing the sheet lacks is invented, except what follows from the tenant's own settings.
import { t } from '@fi/shared';
import { computeInvoice } from '../compute';
import type { InvoiceDraft, Line } from '../model';
import { divRound, isDecimal, lineAmount, roundToCents } from '../money';
import { frMoney } from '../pdf/format';
import { cellAddress, isBlank, type RawCell, type SheetSnapshot } from './cells';
import { isTotalRow } from './detect';
import {
  InvoiceDefaults,
  type InvoiceField,
  type SellerProfile,
  type SheetMapping,
} from './fields';
import { dateOf, decimalOf, identifierOf, natureOf, rateOf, textOf } from './values';

export interface SheetProblem {
  code: 'group_conflict' | 'line_total_mismatch' | 'total_mismatch';
  cell: string;
  messageFr: string;
}

export interface SheetInvoice {
  /** The invoice's key in the sheet: its number, or `row:14` when it has none. */
  rowKey: string;
  rows: number[];
  draft: InvoiceDraft;
  /** Model path → cell address. */
  cells: Record<string, string>;
  /** What the sheet itself contradicts (warnings; the invoice is still built). */
  problems: SheetProblem[];
}

export interface SheetReading {
  invoices: SheetInvoice[];
  /** Total rows, skipped. */
  ignoredRows: number[];
}

interface Row {
  row: number;
  cells: ReadonlyMap<string, RawCell>;
}

const LINE_FIELDS: readonly InvoiceField[] = ['itemName', 'quantity', 'unitPrice', 'lineNet'];

/** Common French units → UN/ECE Rec 20 codes. Anything else is kept as typed (BR-CL-23 checks it). */
const UNITS: Readonly<Record<string, string>> = {
  j: 'DAY',
  jour: 'DAY',
  jours: 'DAY',
  h: 'HUR',
  heure: 'HUR',
  heures: 'HUR',
  u: 'C62',
  unite: 'C62',
  unites: 'C62',
  forfait: 'C62',
  piece: 'H87',
  pieces: 'H87',
  pce: 'H87',
  kg: 'KGM',
  m: 'MTR',
  m2: 'MTK',
  l: 'LTR',
  mois: 'MON',
};

const COUNTRIES: Readonly<Record<string, string>> = {
  france: 'FR',
  belgique: 'BE',
  suisse: 'CH',
  luxembourg: 'LU',
  allemagne: 'DE',
  espagne: 'ES',
  italie: 'IT',
};

const simple = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const unitOf = (cell: RawCell | undefined) => {
  const text = textOf(cell);
  return text === undefined ? undefined : (UNITS[simple(text)] ?? text);
};

const countryOf = (cell: RawCell | undefined) => {
  const text = textOf(cell);
  if (text === undefined) return undefined;
  return COUNTRIES[simple(text)] ?? (/^[a-z]{2}$/i.test(text) ? text.toUpperCase() : text);
};

const currencyOf = (cell: RawCell | undefined) => {
  const text = textOf(cell);
  if (text === undefined) return undefined;
  return text === '€' || /^euros?$/i.test(text) ? 'EUR' : text.toUpperCase();
};

/** French postcodes have 5 digits; Excel drops the leading zero of 01000. */
const postCodeOf = (cell: RawCell | undefined) => {
  if (cell && typeof cell.value === 'number' && Number.isInteger(cell.value) && cell.value < 1e5) {
    return String(cell.value).padStart(5, '0');
  }
  return textOf(cell);
};

const READERS: Readonly<Record<InvoiceField, (cell: RawCell | undefined) => string | undefined>> = {
  number: textOf,
  issueDate: dateOf,
  dueDate: dateOf,
  deliveryDate: dateOf,
  buyerName: textOf,
  buyerSiren: identifierOf,
  buyerSiret: identifierOf,
  buyerVatId: identifierOf,
  buyerEmail: textOf,
  buyerAddress: textOf,
  buyerPostCode: postCodeOf,
  buyerCity: textOf,
  buyerCountry: countryOf,
  purchaseOrder: textOf,
  paymentTerms: textOf,
  currency: currencyOf,
  itemName: textOf,
  quantity: decimalOf,
  unitCode: unitOf,
  unitPrice: decimalOf,
  lineNet: decimalOf,
  vatRate: rateOf,
  vatCategory: (c) => textOf(c)?.toUpperCase(),
  nature: natureOf,
  totalInclVat: decimalOf,
};

/** Where each invoice-level field lands in the model (for the cell map). */
const INVOICE_PATHS: Partial<Record<InvoiceField, readonly string[]>> = {
  number: ['number'],
  issueDate: ['issueDate'],
  dueDate: ['dueDate'],
  deliveryDate: ['delivery.date'],
  buyerName: ['buyer.name'],
  buyerSiren: ['buyer.legalId.id', 'buyer.electronicAddress.id'],
  buyerSiret: ['buyer.ids[0].id'],
  buyerVatId: ['buyer.vatId'],
  buyerEmail: ['buyer.contact.email'],
  buyerAddress: ['buyer.address.line1'],
  buyerPostCode: ['buyer.address.postCode'],
  buyerCity: ['buyer.address.city'],
  buyerCountry: ['buyer.address.country'],
  purchaseOrder: ['purchaseOrderReference'],
  paymentTerms: ['paymentTerms'],
  currency: ['currency'],
};

const LINE_PATHS: Partial<Record<InvoiceField, string>> = {
  itemName: 'item.name',
  quantity: 'quantity',
  unitCode: 'unitCode',
  unitPrice: 'price.net',
  vatRate: 'vat.rate',
  vatCategory: 'vat.category',
  nature: 'nature',
};

const PROCESS_TYPE = { goods: 'B1', services: 'S1', mixed: 'M1' } as const;

/** a ÷ b on decimal text, rounded to 4 decimals; undefined when b is zero or not a decimal. */
function divideDecimal(a: string, b: string): string | undefined {
  const scaled = (v: string) => {
    const [int = '', frac = ''] = v.replace('-', '').split('.');
    const units = BigInt(int + frac) * (v.startsWith('-') ? -1n : 1n);
    return { units, scale: frac.length };
  };
  if (!isDecimal(a) || !isDecimal(b)) return undefined;
  const x = scaled(a);
  const y = scaled(b);
  if (y.units === 0n) return undefined;
  const q = divRound(x.units * 10n ** BigInt(4 + y.scale), y.units * 10n ** BigInt(x.scale));
  const negative = q < 0n;
  const digits = (negative ? -q : q).toString().padStart(5, '0');
  const text = `${digits.slice(0, -4)}.${digits.slice(-4)}`.replace(/\.?0+$/, '');
  return `${negative ? '-' : ''}${text}`;
}

export function readSheet(
  snapshot: SheetSnapshot,
  mapping: SheetMapping,
  seller: SellerProfile,
): SheetReading {
  const defaults = InvoiceDefaults.parse(seller.defaults);
  const sheet = snapshot.sheet;
  const rows: Row[] = snapshot.rows
    .filter((r) => r.row > mapping.headerRow)
    .sort((a, b) => a.row - b.row)
    .map((r) => ({ row: r.row, cells: new Map(r.cells.map((c) => [c.col, c])) }));
  const cellOf = (row: Row, field: InvoiceField) => {
    const m = mapping.mapping[field];
    const cell = m ? row.cells.get(m.column) : undefined;
    return isBlank(cell) ? undefined : cell;
  };
  const read = (row: Row, field: InvoiceField) => READERS[field](cellOf(row, field));
  const address = (row: Row, field: InvoiceField) => {
    const cell = cellOf(row, field);
    return cell ? cellAddress(sheet, cell.col, row.row) : undefined;
  };
  // The cell where a missing value belongs: « Corriger dans la feuille » selects the empty cell.
  const slot = (row: Row, field: InvoiceField) => {
    const m = mapping.mapping[field];
    return m ? cellAddress(sheet, m.column, row.row) : undefined;
  };
  const hasLine = (row: Row) => LINE_FIELDS.some((f) => cellOf(row, f));
  const hasAny = (row: Row) =>
    Object.keys(mapping.mapping).some((f) => cellOf(row, f as InvoiceField));

  // Rows → groups (one per invoice).
  const groups = new Map<string, Row[]>();
  const ignoredRows: number[] = [];
  let current: Row[] | undefined;
  for (const row of rows) {
    if (!hasAny(row)) continue;
    const number = read(row, 'number');
    const totalLabel = number === undefined || /^(sous.?)?total|^net a payer/i.test(simple(number));
    if (totalLabel && isTotalRow({ row: row.row, cells: [...row.cells.values()] })) {
      ignoredRows.push(row.row);
      continue;
    }
    if (mapping.grouping) {
      const key = textOf(row.cells.get(mapping.grouping.by));
      if (key === undefined && current && hasLine(row)) {
        current.push(row);
        continue;
      }
      const k = key ?? `row:${row.row}`;
      current = groups.get(k) ?? [];
      groups.set(k, current);
      current.push(row);
    } else {
      const base = number ?? `row:${row.row}`;
      groups.set(groups.has(base) ? `${base}@${row.row}` : base, [row]);
    }
  }

  const invoices = [...groups.entries()].map(([rowKey, group]) =>
    buildInvoice(rowKey, group, { read, address, slot, hasLine, defaults, seller }),
  );
  return { invoices, ignoredRows };
}

interface BuildContext {
  read: (row: Row, field: InvoiceField) => string | undefined;
  address: (row: Row, field: InvoiceField) => string | undefined;
  /** The mapped column's cell on that row, even when blank. */
  slot: (row: Row, field: InvoiceField) => string | undefined;
  hasLine: (row: Row) => boolean;
  defaults: InvoiceDefaults;
  seller: SellerProfile;
}

function buildInvoice(rowKey: string, group: Row[], ctx: BuildContext): SheetInvoice {
  const { read, address, defaults, seller } = ctx;
  const cells: Record<string, string> = {};
  const problems: SheetProblem[] = [];

  // Invoice-level fields: the first row that has the value; a different value further down is flagged.
  const head = (field: InvoiceField) => {
    let found: { value: string; row: Row } | undefined;
    for (const row of group) {
      const value = read(row, field);
      if (value === undefined) continue;
      if (!found) {
        found = { value, row };
        for (const path of INVOICE_PATHS[field] ?? []) {
          const at = address(row, field);
          if (at) cells[path] = at;
        }
      } else if (value !== found.value) {
        problems.push({
          code: 'group_conflict',
          cell: address(row, field) ?? '',
          messageFr: t('sheet.problem.group_conflict', { first: found.value, value }),
        });
      }
    }
    const top = group[0];
    if (!found && top) {
      for (const path of INVOICE_PATHS[field] ?? []) {
        const at = ctx.slot(top, field);
        if (at) cells[path] = at;
      }
    }
    return found?.value;
  };

  const number = head('number');
  const issueDate = head('issueDate');
  const siret = head('buyerSiret');
  let siren = head('buyerSiren');
  if (siren === undefined && siret !== undefined && /^\d{14}$/.test(siret)) {
    siren = siret.slice(0, 9);
    if (cells['buyer.ids[0].id']) {
      cells['buyer.legalId.id'] = cells['buyer.ids[0].id'];
      cells['buyer.electronicAddress.id'] = cells['buyer.ids[0].id'];
    }
  }
  let dueDate = head('dueDate');
  if (dueDate === undefined && defaults.paymentDays !== undefined && issueDate?.length === 10) {
    const ms = Date.parse(`${issueDate}T00:00:00Z`) + defaults.paymentDays * 86_400_000;
    if (Number.isFinite(ms)) dueDate = new Date(ms).toISOString().slice(0, 10);
  }
  const line1 = head('buyerAddress');
  const postCode = head('buyerPostCode');
  const city = head('buyerCity');
  const country = head('buyerCountry') ?? (siren && (line1 || postCode || city) ? 'FR' : undefined);
  const email = head('buyerEmail');
  const deliveryDate = head('deliveryDate');
  const currency = head('currency') ?? defaults.currency;
  const paymentTerms =
    head('paymentTerms') ??
    defaults.paymentTerms ??
    (defaults.paymentDays !== undefined
      ? t('invoice.default.paymentTerms', { days: defaults.paymentDays })
      : undefined);
  const purchaseOrder = head('purchaseOrder');
  const buyerName = head('buyerName');
  const buyerVatId = head('buyerVatId');

  const lineRows = group.filter(ctx.hasLine);
  const lines = lineRows.map((row, i): Omit<Line, 'netAmount'> => {
    const at = (field: InvoiceField) => address(row, field);
    for (const [field, path] of Object.entries(LINE_PATHS)) {
      const cell = at(field as InvoiceField) ?? ctx.slot(row, field as InvoiceField);
      if (cell) cells[`lines[${i}].${path}`] = cell;
    }
    let quantity = read(row, 'quantity');
    let price = read(row, 'unitPrice');
    const net = read(row, 'lineNet');
    const netCell = at('lineNet');
    if (price === undefined && net !== undefined) {
      price = quantity === undefined ? net : (divideDecimal(net, quantity) ?? net);
      if (netCell) cells[`lines[${i}].price.net`] = netCell;
    } else if (net !== undefined && quantity !== undefined && price !== undefined && netCell) {
      const computed = lineAmount(quantity, price);
      const typed = roundToCents(net);
      if (computed !== null && typed !== null && computed !== typed) {
        problems.push({
          code: 'line_total_mismatch',
          cell: netCell,
          messageFr: t('sheet.problem.line_total_mismatch', {
            sheet: frMoney(typed, currency),
            computed: frMoney(computed, currency),
          }),
        });
      }
    }
    if (quantity === undefined && price !== undefined) quantity = '1';
    const rate = read(row, 'vatRate');
    const category =
      read(row, 'vatCategory') ??
      (rate !== undefined && isDecimal(rate) && Number(rate) > 0 ? 'S' : undefined);
    const nature =
      (read(row, 'nature') as 'goods' | 'services' | undefined) ??
      (defaults.operationCategory === 'goods' || defaults.operationCategory === 'services'
        ? defaults.operationCategory
        : undefined);
    return {
      id: String(i + 1),
      quantity,
      unitCode: read(row, 'unitCode') ?? 'C62',
      allowances: [],
      charges: [],
      price: { net: price },
      vat: { category, rate },
      item: { name: read(row, 'itemName') },
      ...(nature && { nature }),
    };
  });

  const draft: InvoiceDraft = {
    ...(defaults.operationCategory && { processType: PROCESS_TYPE[defaults.operationCategory] }),
    number,
    issueDate,
    typeCode: '380',
    currency,
    dueDate,
    paymentTerms,
    purchaseOrderReference: purchaseOrder,
    notes: [
      { subjectCode: 'PMT', text: defaults.recoveryFeeNote ?? t('invoice.default.note.PMT') },
      { subjectCode: 'PMD', text: defaults.latePenaltyNote ?? t('invoice.default.note.PMD') },
      { subjectCode: 'AAB', text: defaults.discountNote ?? t('invoice.default.note.AAB') },
    ],
    seller: {
      name: seller.name,
      ids: defaults.siret ? [{ id: defaults.siret, scheme: '0009' }] : [],
      legalId: { id: seller.siren, scheme: '0002' },
      ...(seller.vatId && { vatId: seller.vatId }),
      electronicAddress: { id: seller.siren, scheme: '0225' },
      ...(seller.address && { address: seller.address }),
    },
    buyer: {
      name: buyerName,
      ids: siret ? [{ id: siret, scheme: '0009' }] : [],
      ...(siren && {
        legalId: { id: siren, scheme: '0002' },
        electronicAddress: { id: siren, scheme: '0225' },
      }),
      vatId: buyerVatId,
      ...((line1 || postCode || city || country) && {
        address: { line1, postCode, city, country },
      }),
      ...(email && { contact: { email } }),
    },
    ...(deliveryDate && { delivery: { date: deliveryDate } }),
    payment: {
      meansCode: defaults.paymentMeansCode,
      accounts: defaults.iban
        ? [{ iban: defaults.iban, name: seller.name, bic: defaults.bic }]
        : [],
    },
    lines,
  };

  const total = sheetTotal(group, ctx);
  if (total) {
    const computed = taxInclusive(draft);
    const typed = roundToCents(total.value);
    if (computed !== undefined && typed !== null && computed !== typed) {
      problems.push({
        code: 'total_mismatch',
        cell: total.cell,
        messageFr: t('sheet.problem.total_mismatch', {
          sheet: frMoney(typed, currency),
          computed: frMoney(computed, currency),
        }),
      });
    }
  }

  return { rowKey, rows: group.map((r) => r.row), draft, cells, problems };
}

/** The sheet's own TTC: one value repeated (or alone) is the invoice total; several are line totals. */
function sheetTotal(group: Row[], ctx: BuildContext): { value: string; cell: string } | undefined {
  const found = group
    .map((row) => ({
      value: ctx.read(row, 'totalInclVat'),
      cell: ctx.address(row, 'totalInclVat'),
    }))
    .filter((v): v is { value: string; cell: string } => v.value !== undefined && !!v.cell)
    .filter((v) => isDecimal(v.value));
  const first = found[0];
  if (!first) return undefined;
  if (found.every((v) => v.value === first.value)) return first;
  const cents = found.map((v) => roundToCents(v.value) ?? 0).reduce((a, b) => a + b, 0);
  return { value: (cents / 100).toFixed(2), cell: first.cell };
}

function taxInclusive(draft: InvoiceDraft): number | undefined {
  try {
    return computeInvoice(draft).totals.taxInclusive;
  } catch {
    return undefined;
  }
}

/** The cell behind an issue path: itself, its nearest mapped parent, or its first mapped child. */
export function cellForPath(
  cells: Readonly<Record<string, string>>,
  path: string,
): string | undefined {
  if (cells[path]) return cells[path];
  for (let p = path; /[.[]/.test(p); ) {
    p = p.replace(/(?:\.[^.[]+|\[\d+\])$/, '');
    if (cells[p]) return cells[p];
  }
  const child = Object.keys(cells).find(
    (k) => k.startsWith(`${path}.`) || k.startsWith(`${path}[`),
  );
  return child ? cells[child] : undefined;
}
