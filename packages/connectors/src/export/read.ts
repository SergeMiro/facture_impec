// An ERP's list export read (D9): the workbook or CSV through `@fi/core`'s reader, the row of labels
// found, each column given its field. What cannot be imported stops here, before anything is
// written, as a `FatalError` whose code the API words and whose detail names what is missing.
import {
  type RawCell,
  type RawRow,
  readCompleteSheetFile,
  SheetFileError,
  type SheetSnapshot,
} from '@fi/core';
import { FatalError } from '@fi/domain';
import { type ExportList, type FieldOf, fieldOf, guessList, REQUIRED } from './columns';

export interface ExportFile {
  name: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/** A list export ready to read row by row. */
export interface ExportSheet<L extends ExportList = ExportList> {
  list: L;
  sheet: string;
  /** The row of labels; the data starts below it. */
  headerRow: number;
  /** The column of each field found, by letter (`B`). */
  columns: Partial<Record<FieldOf<L>, string>>;
  /** The labels of the row, as the file writes them: shown when a column is missing. */
  headers: string[];
  rows: RawRow[];
}

/** The codes of what stops an import; `api.error.*` in fr.json words each. */
export const EXPORT_ERRORS = [
  'export_unreadable',
  'export_too_large',
  'export_too_many_rows',
  'export_unsupported',
  'export_no_header',
  'export_list_unknown',
  'export_column_missing',
] as const;

const HEADER_SCAN_ROWS = 30;

const labelOf = (cell: RawCell) =>
  typeof cell.value === 'string' ? cell.value.trim() : cell.text.trim();

/** The row of the sheet where most cells name a field of some list (two at least). */
function headerOf(sheet: SheetSnapshot, list: ExportList | undefined) {
  let best: { row: RawRow; score: number } | undefined;
  for (const row of sheet.rows.slice(0, HEADER_SCAN_ROWS)) {
    const labels = row.cells.map(labelOf);
    const lists: readonly ExportList[] = list
      ? [list]
      : ['customers', 'chantiers', 'invoices', 'payments'];
    const score = Math.max(
      ...lists.map((l) => labels.filter((label) => fieldOf(l, label) !== undefined).length),
    );
    if (score >= 2 && (!best || score > best.score)) best = { row, score };
  }
  return best;
}

/**
 * Reads the file and finds its list: the one the person said, else the one its labels say. Throws a
 * `FatalError` when nothing can be imported from it; a missing column's message is the list and
 * the fields that would do (`customers:siren|siret`).
 */
export async function readExport(file: ExportFile, said?: ExportList): Promise<ExportSheet> {
  let sheets: SheetSnapshot[];
  try {
    sheets = (await readCompleteSheetFile(file.bytes, file.name)).sheets;
  } catch (error) {
    if (error instanceof SheetFileError) throw new FatalError(`export_${error.reason}`, file.name);
    throw error;
  }
  const found = sheets
    .map((sheet) => ({ sheet, header: headerOf(sheet, said) }))
    .filter((s) => s.header)
    .sort((a, b) => (b.header?.score ?? 0) - (a.header?.score ?? 0))[0];
  if (!found?.header) throw new FatalError('export_no_header', file.name);
  const { sheet } = found;
  const headerRow = found.header.row;
  const headers = headerRow.cells.map(labelOf).filter((l) => l !== '');
  const list = said ?? guessList(headers);
  if (!list) throw new FatalError('export_list_unknown', headers.join(', '));

  const columns: Partial<Record<string, string>> = {};
  for (const cell of headerRow.cells) {
    const field = fieldOf(list, labelOf(cell));
    // The first column of a field wins: « Adresse » then « Adresse chantier » keeps the first.
    if (field && !columns[field]) columns[field] = cell.col;
  }
  for (const oneOf of REQUIRED[list] as readonly (readonly string[])[]) {
    if (!oneOf.some((f) => columns[f])) {
      throw new FatalError('export_column_missing', `${list}:${oneOf.join('|')}`);
    }
  }
  return {
    list,
    sheet: sheet.sheet,
    headerRow: headerRow.row,
    columns,
    headers,
    rows: sheet.rows.filter((r) => r.row > headerRow.row),
  };
}

/** One data row as its fields' cells. */
export function cellsOf<L extends ExportList>(
  sheet: ExportSheet<L>,
  row: RawRow,
): Partial<Record<FieldOf<L>, RawCell>> {
  const out: Partial<Record<FieldOf<L>, RawCell>> = {};
  for (const [field, col] of Object.entries(sheet.columns) as [FieldOf<L>, string][]) {
    const cell = row.cells.find((c) => c.col === col);
    if (cell) out[field] = cell;
  }
  return out;
}
