// Sheet rows → invoice drafts, with the cell behind every field so an issue on `lines[1].vat.rate`
// selects `Feuil1!F15` (plan §5 « Corriger dans la feuille »). The seller side comes from the tenant;
// nothing the sheet lacks is invented, except what follows from the tenant's own settings.
import { t } from '@fi/shared';
import type { SheetCheck } from '../checks/types';
import { computeInvoice } from '../compute';
import type { AllowanceCharge, BtpFacts, InvoiceDraft, Line, Note } from '../model';
import { divRound, formatAmount, isDecimal, lineAmount, percentOf, roundToCents } from '../money';
import { frDecimal, frMoney } from '../pdf/format';
import { cellAddress, isBlank, type RawCell, type SheetSnapshot } from './cells';
import { isTotalRow } from './detect';
import {
  InvoiceDefaults,
  type InvoiceField,
  type SellerProfile,
  type SheetMapping,
} from './fields';
import {
  amountOf,
  dateOf,
  decimalFromText,
  decimalOf,
  identifierOf,
  natureOf,
  percentValueOf,
  rateOf,
  textOf,
} from './values';

export interface SheetProblem {
  code: 'group_conflict' | 'line_total_mismatch' | 'total_mismatch' | 'unreadable';
  cell: string;
  messageFr: string;
  /** When the contradiction is a mistake a check names (A1–A3, R2): kept with the invoice. */
  check?: SheetCheck;
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

/** A unit as typed → its UN/ECE Rec 20 code when it is a common French one. */
export const unitOf = (cell: RawCell | undefined) => {
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
  itemRef: textOf,
  quantity: decimalOf,
  unitCode: unitOf,
  unitPrice: decimalOf,
  lineNet: decimalOf,
  lineDiscount: amountOf,
  lineDiscountPercent: percentValueOf,
  vatRate: rateOf,
  vatCategory: (c) => textOf(c)?.toUpperCase(),
  nature: natureOf,
  totalInclVat: decimalOf,
  chantier: textOf,
  retenue: amountOf,
  retenueRate: percentValueOf,
  situation: decimalOf,
  cumulative: decimalOf,
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
  chantier: ['projectReference'],
  retenue: ['btp.retenue.amount'],
  retenueRate: ['btp.retenue.rateBps'],
  situation: ['btp.situation.number'],
  cumulative: ['btp.situation.cumulative'],
};

const LINE_PATHS: Partial<Record<InvoiceField, string>> = {
  itemName: 'item.name',
  itemRef: 'item.sellerId',
  quantity: 'quantity',
  unitCode: 'unitCode',
  unitPrice: 'price.net',
  vatRate: 'vat.rate',
  vatCategory: 'vat.category',
  nature: 'nature',
  lineDiscount: 'allowances[0]',
  lineDiscountPercent: 'allowances[0]',
};

const PROCESS_TYPE = { goods: 'B1', services: 'S1', mixed: 'M1' } as const;

/**
 * The line before a discount of `percent` %, from the total after it: net × 100 / (100 − percent),
 * to the cent. The discount is then the difference, so the sheet's total stays exact.
 */
function grossBefore(netCents: number, percent: string): number {
  const [int = '', frac = ''] = percent.split('.');
  const scale = 10n ** BigInt(frac.length);
  const p = BigInt(int + frac);
  return Number(divRound(BigInt(netCents) * 100n * scale, 100n * scale - p));
}

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
  // Typed or computed, when the reader looked at formulas; unknown otherwise.
  const formula = (row: Row, field: InvoiceField) => {
    const cell = cellOf(row, field);
    return cell && snapshot.formulas ? cell.formula === true : undefined;
  };
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
    buildInvoice(rowKey, group, { read, formula, address, slot, hasLine, defaults, seller }),
  );
  return { invoices, ignoredRows };
}

interface BuildContext {
  read: (row: Row, field: InvoiceField) => string | undefined;
  formula: (row: Row, field: InvoiceField) => boolean | undefined;
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
  const chantier = head('chantier');
  const btp = btpFacts(head, cells, problems);

  const notes: Note[] = [
    { subjectCode: 'PMT', text: defaults.recoveryFeeNote ?? t('invoice.default.note.PMT') },
    { subjectCode: 'PMD', text: defaults.latePenaltyNote ?? t('invoice.default.note.PMD') },
    { subjectCode: 'AAB', text: defaults.discountNote ?? t('invoice.default.note.AAB') },
  ];

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
    // A discount in euros (BT-136), typed 50 or -50: 50 € off; or a percentage (BT-138) from the
    // « Remise % » column, or typed « 10 % » in the euros one, taken off the line's gross amount.
    // Anything else stays a discount without an amount, so BR-41 stops the invoice on that cell
    // instead of dropping it.
    const discountText = read(row, 'lineDiscount');
    const euros = discountText?.endsWith('%') ? undefined : discountText;
    const percentText =
      read(row, 'lineDiscountPercent') ??
      (discountText?.endsWith('%')
        ? (decimalFromText(discountText.slice(0, -1)) ?? discountText)
        : undefined);
    const discountCents = euros !== undefined && isDecimal(euros) ? roundToCents(euros) : null;
    const percent =
      percentText !== undefined && isDecimal(percentText) ? percentText.replace(/^-/, '') : null;
    const unreadable =
      (euros !== undefined && discountCents === null) ||
      (percentText !== undefined && percent === null);
    let off = Math.abs(discountCents ?? 0);
    /** A percentage turned into euros here: only when the sheet gives the total, not the price. */
    let fromTotal: { amount: number; baseAmount: number } | null = null;
    if (price === undefined && net !== undefined) {
      // The line total is after the discount: the price is what it was before.
      const netCents = isDecimal(net) ? roundToCents(net) : null;
      if (off === 0 && percent !== null && netCents !== null && Number(percent) < 100) {
        const baseAmount = grossBefore(netCents, percent);
        off = baseAmount - netCents;
        if (off > 0) fromTotal = { amount: off, baseAmount };
      }
      const gross = off > 0 && netCents !== null ? formatAmount(netCents + off) : net;
      price = quantity === undefined ? gross : (divideDecimal(gross, quantity) ?? gross);
      if (netCell) cells[`lines[${i}].price.net`] = netCell;
    } else if (off === 0 && percent !== null && price !== undefined) {
      const gross = lineAmount(quantity ?? '1', price);
      off = gross === null ? 0 : (percentOf(gross, percent) ?? 0);
    }
    const allowances: AllowanceCharge[] = [];
    if (unreadable || off > 0) {
      allowances.push({
        ...(discountCents !== null && { amount: Math.abs(discountCents) }),
        ...(percentText !== undefined && { percentage: percent ?? percentText }),
        ...fromTotal,
        reasonCode: '95',
        reason: t('invoice.default.discountReason'),
      });
    }
    if (fromTotal) {
      // Nothing to compare: the total is the sheet's, and the price follows from it.
    } else if (
      // A discount that is not an amount is already stopped on its own cell.
      !unreadable &&
      net !== undefined &&
      quantity !== undefined &&
      price !== undefined &&
      netCell
    ) {
      const amount = lineAmount(quantity, price);
      const typed = roundToCents(net);
      if (amount !== null && typed !== null && amount - off !== typed) {
        const computed = amount - off;
        const key = off > 0 ? 'line_total_mismatch_discount' : 'line_total_mismatch';
        const values = { sheet: frMoney(typed, currency), computed: frMoney(computed, currency) };
        const check = lineCheck({
          amount,
          off,
          typed,
          discount: euros,
          rate: read(row, 'vatRate'),
          formula: ctx.formula(row, 'lineNet'),
          params: { ...values, invoice: number ?? t('check.noNumber'), cell: netCell },
          currency,
        });
        problems.push({
          code: 'line_total_mismatch',
          cell: netCell,
          messageFr: check
            ? t(`check.message.${check.message}`, check.params)
            : t(`sheet.problem.${key}`, values),
          ...(check && { check }),
        });
      }
    }
    if (quantity === undefined && price !== undefined) quantity = '1';
    const rate = read(row, 'vatRate');
    const itemRef = read(row, 'itemRef');
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
      allowances,
      charges: [],
      price: { net: price },
      vat: { category, rate },
      item: { name: read(row, 'itemName'), ...(itemRef && { sellerId: itemRef }) },
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
    ...(chantier && { projectReference: chantier }),
    notes,
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
  if (btp) {
    const { retenue, situation } = btp;
    // A rate alone holds that share of the TTC (loi n° 71-584, art. 1: « leur montant »).
    const ttc = retenue?.rateBps && retenue.amount === undefined ? taxInclusive(draft) : undefined;
    if (retenue && ttc !== undefined)
      retenue.amount = Math.round((ttc * (retenue.rateBps ?? 0)) / 10_000);
    // XP Z12-014 annexe A cas n°26: the retenue is a note ABU; a situation has no field at all, so a
    // note AAI. TODO(verify) that a PDP passes AAI through unchanged (docs/TODO.md).
    if (retenue) notes.push({ subjectCode: 'ABU', text: retenueNote(retenue, currency) });
    if (situation) {
      const number = String(situation.number);
      notes.push({
        subjectCode: 'AAI',
        text:
          situation.cumulative === undefined
            ? t('invoice.default.note.AAI.situation', { number })
            : t('invoice.default.note.AAI.cumulative', {
                number,
                cumulative: frMoney(situation.cumulative, currency),
              }),
      });
    }
    draft.btp = btp;
  }

  const total = sheetTotal(group, ctx);
  if (total) {
    const computed = taxInclusive(draft);
    const typed = roundToCents(total.value);
    if (computed !== undefined && typed !== null && computed !== typed) {
      const values = { sheet: frMoney(typed, currency), computed: frMoney(computed, currency) };
      // A2: a total typed as a number, that no formula keeps in step with the lines.
      const gap = Math.abs(typed - computed);
      const check: SheetCheck | undefined = total.typed
        ? {
            rule: 'A2',
            message: 'A2.total',
            cell: total.cell,
            amount: gap,
            params: {
              ...values,
              invoice: number ?? t('check.noNumber'),
              cell: total.cell,
              amount: frMoney(gap, currency),
            },
          }
        : undefined;
      problems.push({
        code: 'total_mismatch',
        cell: total.cell,
        messageFr: check
          ? t('check.message.A2.total', check.params)
          : t('sheet.problem.total_mismatch', values),
        ...(check && { check }),
      });
    }
  }

  return { rowKey, rows: group.map((r) => r.row), draft, cells, problems };
}

/**
 * The BTP columns: a retenue in euros (or a percent cell in that column) or in %, a situation's
 * number and cumulative works HT. What cannot be read is left out, on a warning that names its cell.
 * A retenue of 0 is none.
 */
function btpFacts(
  head: (field: InvoiceField) => string | undefined,
  cells: Record<string, string>,
  problems: SheetProblem[],
): BtpFacts | undefined {
  const unreadable = (field: InvoiceField, path: string, value: string) => {
    problems.push({
      code: 'unreadable',
      cell: cells[path] ?? '',
      messageFr: t('sheet.problem.unreadable', { field: t(`sheet.field.${field}`), value }),
    });
    return undefined;
  };
  const centsOf = (field: InvoiceField, path: string, text: string | undefined) => {
    if (text === undefined) return undefined;
    const cents = isDecimal(text) ? roundToCents(text) : null;
    return cents === null ? unreadable(field, path, text) : Math.abs(cents);
  };

  const retenueText = head('retenue');
  const inPercent = retenueText?.endsWith('%');
  const amount = centsOf('retenue', 'btp.retenue.amount', inPercent ? undefined : retenueText);
  const rateText =
    head('retenueRate') ??
    (inPercent && retenueText
      ? (decimalFromText(retenueText.slice(0, -1)) ?? retenueText)
      : undefined);
  let rateBps: number | undefined;
  if (rateText !== undefined) {
    const percent = isDecimal(rateText) ? Math.abs(Number(rateText)) : Number.NaN;
    if (percent <= 100) rateBps = Math.round(percent * 100);
    else
      unreadable(
        inPercent ? 'retenue' : 'retenueRate',
        inPercent ? 'btp.retenue.amount' : 'btp.retenue.rateBps',
        rateText,
      );
  }
  const retenue =
    (amount ?? 0) > 0 || (rateBps ?? 0) > 0
      ? { ...(rateBps !== undefined && { rateBps }), ...(amount !== undefined && { amount }) }
      : undefined;

  // « 3 », « S3 », « Situation n° 3 »: the one number it holds.
  const situationText = head('situation');
  const digits =
    situationText === undefined ? undefined : /^\D*(\d{1,4})$/.exec(situationText)?.[1];
  const number = digits === undefined ? undefined : Number(digits);
  if (situationText !== undefined && !number) {
    unreadable('situation', 'btp.situation.number', situationText);
  }
  const cumulative = centsOf('cumulative', 'btp.situation.cumulative', head('cumulative'));
  const situation = number
    ? { number, ...(cumulative !== undefined && { cumulative }) }
    : undefined;

  if (!retenue && !situation) return undefined;
  return { ...(retenue && { retenue }), ...(situation && { situation }) };
}

function retenueNote(retenue: NonNullable<BtpFacts['retenue']>, currency: string | undefined) {
  const amount = retenue.amount === undefined ? undefined : frMoney(retenue.amount, currency);
  if (!retenue.rateBps) return t('invoice.default.note.ABU.amount', { amount: amount ?? '' });
  const rate = frDecimal(String(retenue.rateBps / 100));
  return amount === undefined
    ? t('invoice.default.note.ABU.rateOnly', { rate })
    : t('invoice.default.note.ABU.rate', { rate, amount });
}

/**
 * A line whose amount the sheet contradicts, when a mistake explains it: the TTC in the HT column
 * (A1), the discount taken twice or a percentage typed as euros (A3), else a typed amount no formula
 * keeps in step (A2). A formula that computes something else, or a sheet read without formulas, is
 * only the problem's warning.
 */
function lineCheck(c: {
  amount: number;
  off: number;
  typed: number;
  discount: string | undefined;
  rate: string | undefined;
  formula: boolean | undefined;
  params: Record<string, string>;
  currency: string;
}): SheetCheck | undefined {
  const { amount, off, typed, params } = c;
  const computed = amount - off;
  const cell = params.cell ?? '';
  const near = (a: number, b: number) => Math.abs(a - b) <= 1;
  const rate = c.rate !== undefined && isDecimal(c.rate) && Number(c.rate) > 0 ? c.rate : undefined;
  const vat = rate ? percentOf(computed, rate) : null;
  if (rate && vat !== null && near(typed, computed + vat)) {
    const params2 = {
      ...params,
      rate: frDecimal(rate),
      amount: frMoney(typed - computed, c.currency),
    };
    return { rule: 'A1', message: 'A1.sheet', cell, amount: typed - computed, params: params2 };
  }
  const discount = frMoney(off, c.currency);
  if (off > 0 && near(typed, amount - 2 * off)) {
    return { rule: 'A3', message: 'A3.twice', cell, amount: off, params: { ...params, discount } };
  }
  const percent = c.discount !== undefined ? Math.abs(Number(c.discount)) : 0;
  const asPercent = percent > 0 && percent <= 100 ? percentOf(amount, String(percent)) : null;
  if (asPercent !== null && near(typed, amount - asPercent)) {
    return {
      rule: 'A3',
      message: 'A3.percent',
      cell,
      amount: Math.abs(computed - typed),
      params: { ...params, discount, percent: frDecimal(String(percent)) },
    };
  }
  if (c.formula !== false) return undefined;
  const gap = Math.abs(typed - computed);
  return {
    rule: 'A2',
    message: 'A2.line',
    cell,
    amount: gap,
    params: { ...params, amount: frMoney(gap, c.currency) },
  };
}

/** The sheet's own TTC: one value repeated (or alone) is the invoice total; several are line totals. */
function sheetTotal(
  group: Row[],
  ctx: BuildContext,
): { value: string; cell: string; typed: boolean } | undefined {
  const found = group
    .map((row) => ({
      value: ctx.read(row, 'totalInclVat'),
      cell: ctx.address(row, 'totalInclVat'),
      formula: ctx.formula(row, 'totalInclVat'),
    }))
    .filter(
      (v): v is { value: string; cell: string; formula: boolean | undefined } =>
        v.value !== undefined && !!v.cell,
    )
    .filter((v) => isDecimal(v.value));
  const first = found[0];
  if (!first) return undefined;
  // Typed when none of its cells is a formula, as far as the reader knows.
  const typed = found.every((v) => v.formula === false);
  if (found.every((v) => v.value === first.value)) return { ...first, typed };
  const cents = found.map((v) => roundToCents(v.value) ?? 0).reduce((a, b) => a + b, 0);
  return { value: (cents / 100).toFixed(2), cell: first.cell, typed };
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
