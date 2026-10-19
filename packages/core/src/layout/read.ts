// A confirmed layout's rows → registry documents (the Normalizer of R1): money in cents, units as
// codes, dates as ISO, and the cell each value came from. Nothing the sheet lacks is invented; a row
// that holds something but no field of the layout is counted, so the pane can say what it skipped.
import { lineAmount, roundToCents } from '../money';
import { unitOf } from '../sheet/build';
import { cellAddress, isBlank, type RawCell, type SheetSnapshot } from '../sheet/cells';
import { isTotalRow } from '../sheet/detect';
import { dateOf, decimalOf, identifierOf, rateOf, textOf } from '../sheet/values';
import type { LayoutField, LayoutMapping } from './fields';

export interface LayoutLine {
  row: number;
  /** The cell of its designation (or of its first mapped value): a click selects it. */
  cell: string;
  itemRef?: string;
  itemName?: string;
  /** Decimal text, as in the invoice model. */
  quantity?: string;
  unit?: string;
  unitPrice?: string;
  /** The line's net amount: its own column, else quantity × price; null when neither is there. */
  netAmount: number | null;
  vatRate?: string;
}

export interface LayoutDoc {
  /** The document's key in the sheet: its number, or `row:14` when it has none. */
  key: string;
  rows: number[];
  /** The cell of its number, or of its first value. */
  cell: string;
  number?: string;
  date?: string;
  partyName?: string;
  /** Nine digits when the sheet gives a SIREN or a SIRET. */
  partySiren?: string;
  /** On a delivery note: the order it delivers. */
  orderRef?: string;
  lines: LayoutLine[];
}

export interface LayoutReading {
  docs: LayoutDoc[];
  /** Rows below the header that hold something. */
  rows: number;
  /** « Total » rows, and the section titles of a price list (« MENUISERIE »), skipped. */
  ignoredRows: number[];
  /** Rows that hold something, but in no column of the layout. */
  unreadRows: number[];
}

const READERS: Readonly<Record<LayoutField, (cell: RawCell | undefined) => string | undefined>> = {
  docNumber: textOf,
  docDate: dateOf,
  partyName: textOf,
  partySiren: identifierOf,
  orderRef: textOf,
  itemRef: textOf,
  itemName: textOf,
  quantity: decimalOf,
  unit: unitOf,
  unitPrice: decimalOf,
  lineNet: decimalOf,
  vatRate: rateOf,
};

const LINE_FIELDS: readonly LayoutField[] = [
  'itemRef',
  'itemName',
  'quantity',
  'unitPrice',
  'lineNet',
];

interface Row {
  row: number;
  cells: ReadonlyMap<string, RawCell>;
  filled: boolean;
}

export function readLayout(snapshot: SheetSnapshot, layout: LayoutMapping): LayoutReading {
  const { sheet } = snapshot;
  const rows: Row[] = snapshot.rows
    .filter((r) => r.row > layout.headerRow)
    .sort((a, b) => a.row - b.row)
    .map((r) => ({
      row: r.row,
      cells: new Map(r.cells.map((c) => [c.col, c])),
      filled: r.cells.some((c) => !isBlank(c)),
    }))
    .filter((r) => r.filled);
  const cellOf = (row: Row, field: LayoutField) => {
    const m = layout.mapping[field];
    const cell = m ? row.cells.get(m.column) : undefined;
    return isBlank(cell) ? undefined : cell;
  };
  const read = (row: Row, field: LayoutField) => READERS[field](cellOf(row, field));
  const at = (row: Row, field: LayoutField) => {
    const cell = cellOf(row, field);
    return cell ? cellAddress(sheet, cell.col, row.row) : undefined;
  };
  const fields = Object.keys(layout.mapping) as LayoutField[];
  const firstCell = (row: Row, among: readonly LayoutField[]) =>
    among.map((f) => at(row, f)).find((a) => a !== undefined) ?? cellAddress(sheet, 'A', row.row);
  const hasLine = (row: Row) => LINE_FIELDS.some((f) => cellOf(row, f));

  const ignoredRows: number[] = [];
  const unreadRows: number[] = [];
  const groups = new Map<string, Row[]>();
  let current: Row[] | undefined;
  for (const row of rows) {
    if (!fields.some((f) => cellOf(row, f))) {
      unreadRows.push(row.row);
      continue;
    }
    const named = cellOf(row, 'itemName') || cellOf(row, 'itemRef');
    if (!named && isTotalRow({ row: row.row, cells: [...row.cells.values()] })) {
      ignoredRows.push(row.row);
      continue;
    }
    if (layout.kind === 'price_list') {
      // An article has a price, or a reference and a name; a lone label is a section title.
      const priced = cellOf(row, 'unitPrice') || cellOf(row, 'lineNet');
      const article = priced || (cellOf(row, 'itemRef') && cellOf(row, 'itemName'));
      if (!article) {
        (hasLine(row) ? ignoredRows : unreadRows).push(row.row);
        continue;
      }
      current = groups.get('sheet') ?? [];
      groups.set('sheet', current);
      current.push(row);
      continue;
    }
    const number = read(row, 'docNumber');
    if (number === undefined && current && hasLine(row)) {
      current.push(row);
      continue;
    }
    const key = number ?? `row:${row.row}`;
    current = groups.get(key) ?? [];
    groups.set(key, current);
    current.push(row);
  }

  const docs = [...groups.entries()].map(([key, group]): LayoutDoc => {
    const head = (field: LayoutField) => {
      for (const row of group) {
        const value = read(row, field);
        if (value !== undefined) return value;
      }
      return undefined;
    };
    const siren = head('partySiren');
    const lines = group.filter(hasLine).map((row): LayoutLine => {
      const quantity = read(row, 'quantity');
      const unitPrice = read(row, 'unitPrice');
      const net = read(row, 'lineNet');
      const fromNet = net === undefined ? null : roundToCents(net);
      const netAmount =
        fromNet ?? (unitPrice === undefined ? null : lineAmount(quantity ?? '1', unitPrice));
      return {
        row: row.row,
        cell: firstCell(row, ['itemName', 'itemRef', ...LINE_FIELDS]),
        ...defined({
          itemRef: read(row, 'itemRef'),
          itemName: read(row, 'itemName'),
          quantity,
          unit: read(row, 'unit'),
          unitPrice,
          vatRate: read(row, 'vatRate'),
        }),
        netAmount,
      };
    });
    const top = group[0] as Row;
    return {
      key,
      rows: group.map((r) => r.row),
      cell: firstCell(top, ['docNumber', ...fields]),
      ...defined({
        number: head('docNumber'),
        date: head('docDate'),
        partyName: head('partyName'),
        partySiren: siren && /^\d{14}$/.test(siren) ? siren.slice(0, 9) : siren,
        orderRef: head('orderRef'),
      }),
      lines,
    };
  });
  return { docs, rows: rows.length, ignoredRows, unreadRows };
}

/** The object without its undefined values: what is not in the sheet is not in the document. */
function defined<T extends Record<string, string | undefined>>(o: T) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as {
    [K in keyof T]?: string;
  };
}
