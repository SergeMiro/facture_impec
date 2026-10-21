// A workbook file the company keeps outside the open workbook (R4: OneDrive; R6: an upload), read into
// the same SheetSnapshot the pane sends: .xlsx through its zip and XML parts, .csv as one sheet. Only
// what a check reads is kept: the value Excel stores, a text for it, its number format, and whether a
// formula computed it. The file comes from outside: every size is capped before it is inflated.
import { DOMParser, type Element } from '@xmldom/xmldom';
import { columnLetters, type RawCell, type RawRow, type SheetSnapshot } from './cells';
import { numberText, serialToIso } from './values';

export interface FileLimits {
  /** The file itself. */
  maxBytes: number;
  /** All the parts read, once inflated: a zip bomb stops here. */
  maxInflatedBytes: number;
  /** Rows kept per sheet; a longer sheet is cut and said so. */
  maxRows: number;
}

export const FILE_LIMITS: FileLimits = {
  maxBytes: 10 * 1024 * 1024,
  maxInflatedBytes: 60 * 1024 * 1024,
  maxRows: 5_000,
};

export type FileFormat = 'xlsx' | 'csv';

export interface SheetFile {
  format: FileFormat;
  sheets: SheetSnapshot[];
  /** Sheets cut at `maxRows`. */
  truncated: string[];
}

/** The file cannot be read: what the person is told depends on the reason. */
export class SheetFileError extends Error {
  constructor(
    readonly reason: 'too_large' | 'unreadable' | 'unsupported',
    detail: string,
  ) {
    super(detail);
    this.name = 'SheetFileError';
  }
}

/** The format a file name says, if we read it. */
export function fileFormat(name: string): FileFormat | undefined {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx';
  if (ext === 'csv') return 'csv';
  return undefined;
}

export async function readSheetFile(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
  limits: FileLimits = FILE_LIMITS,
): Promise<SheetFile> {
  if (bytes.byteLength > limits.maxBytes) {
    throw new SheetFileError('too_large', `${bytes.byteLength} bytes`);
  }
  const format = fileFormat(name);
  if (format === 'csv') return readCsv(bytes, name, limits);
  if (format === 'xlsx') return readXlsx(bytes, limits);
  throw new SheetFileError('unsupported', name);
}

// ---------------------------------------------------------------------------------------------- zip

interface ZipEntry {
  name: string;
  method: number;
  compressed: number;
  size: number;
  offset: number;
}

const u16 = (b: Uint8Array, at: number) => (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
const u32 = (b: Uint8Array, at: number) => (u16(b, at) | (u16(b, at + 2) << 16)) >>> 0;

/** The central directory: the file's own list of its parts. Zip64 is refused (no sheet needs it). */
function zipEntries(b: Uint8Array): Map<string, ZipEntry> {
  let end = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (u32(b, i) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new SheetFileError('unreadable', 'not a zip file');
  const count = u16(b, end + 10);
  let at = u32(b, end + 16);
  if (count === 0xffff || at === 0xffffffff) throw new SheetFileError('unreadable', 'zip64');
  const entries = new Map<string, ZipEntry>();
  const utf8 = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (u32(b, at) !== 0x02014b50) throw new SheetFileError('unreadable', 'broken directory');
    const nameLength = u16(b, at + 28);
    const entry: ZipEntry = {
      method: u16(b, at + 10),
      compressed: u32(b, at + 20),
      size: u32(b, at + 24),
      offset: u32(b, at + 42),
      name: utf8.decode(b.subarray(at + 46, at + 46 + nameLength)),
    };
    entries.set(entry.name, entry);
    at += 46 + nameLength + u16(b, at + 30) + u16(b, at + 32);
  }
  return entries;
}

class Inflater {
  #left: number;

  constructor(
    private readonly bytes: Uint8Array<ArrayBuffer>,
    private readonly entries: Map<string, ZipEntry>,
    limit: number,
  ) {
    this.#left = limit;
  }

  has(name: string): boolean {
    return this.entries.has(name);
  }

  /** A part as text; undefined when the file has no such part. */
  async text(name: string): Promise<string | undefined> {
    const entry = this.entries.get(name);
    if (!entry) return undefined;
    const b = this.bytes;
    if (u32(b, entry.offset) !== 0x04034b50) throw new SheetFileError('unreadable', name);
    const start = entry.offset + 30 + u16(b, entry.offset + 26) + u16(b, entry.offset + 28);
    const data = b.subarray(start, start + entry.compressed);
    if (entry.method === 0) return this.#decode(name, [data]);
    if (entry.method !== 8)
      throw new SheetFileError('unreadable', `${name}: method ${entry.method}`);
    // Counted as it inflates, whatever size the directory claims.
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        this.#spend(name, value.byteLength);
        chunks.push(value);
      }
    } catch (error) {
      if (error instanceof SheetFileError) throw error;
      throw new SheetFileError('unreadable', `${name}: ${String(error)}`);
    } finally {
      reader.releaseLock();
    }
    return this.#decode(name, chunks, true);
  }

  #spend(name: string, bytes: number) {
    this.#left -= bytes;
    if (this.#left < 0) throw new SheetFileError('too_large', `${name} inflates too much`);
  }

  #decode(name: string, chunks: Uint8Array[], counted = false): string {
    const size = chunks.reduce((n, c) => n + c.byteLength, 0);
    if (!counted) this.#spend(name, size);
    const all = new Uint8Array(size);
    let at = 0;
    for (const c of chunks) {
      all.set(c, at);
      at += c.byteLength;
    }
    return new TextDecoder().decode(all);
  }
}

// --------------------------------------------------------------------------------------------- xlsx

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function parse(xml: string, part: string): Element {
  if (/<!DOCTYPE/i.test(xml)) throw new SheetFileError('unreadable', `${part}: DOCTYPE`);
  try {
    const root = new DOMParser({
      onError: (level, message) => {
        if (level !== 'warning') throw new SheetFileError('unreadable', `${part}: ${message}`);
      },
    }).parseFromString(xml, 'text/xml').documentElement;
    if (!root) throw new SheetFileError('unreadable', `${part}: no root`);
    return root;
  } catch (error) {
    if (error instanceof SheetFileError) throw error;
    throw new SheetFileError('unreadable', `${part}: ${String(error)}`);
  }
}

const children = (parent: Element | undefined, local: string): Element[] =>
  parent
    ? Array.from(parent.childNodes).filter(
        (n): n is Element => n.nodeType === 1 && (n as Element).localName === local,
      )
    : [];
const child = (parent: Element | undefined, local: string) => children(parent, local)[0];

/** OOXML writes a character XML cannot hold as `_x000D_`; `_x005F_` escapes a literal underscore. */
const unescapeOoxml = (s: string) =>
  s.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, 16)),
  );

/** A shared or inline string: its runs joined, the phonetic guides left out. */
function stringOf(si: Element | undefined): string {
  if (!si) return '';
  const t = child(si, 't');
  if (t) return unescapeOoxml(t.textContent ?? '');
  return children(si, 'r')
    .map((r) => unescapeOoxml(child(r, 't')?.textContent ?? ''))
    .join('');
}

/** The formats Excel numbers itself (ECMA-376 §18.8.30): the ones a check tells apart. */
const BUILT_IN_FORMATS: Record<number, string> = {
  0: 'General',
  1: '0',
  2: '0.00',
  3: '#,##0',
  4: '#,##0.00',
  9: '0%',
  10: '0.00%',
  11: '0.00E+00',
  14: 'dd/mm/yyyy',
  15: 'd-mmm-yy',
  16: 'd-mmm',
  17: 'mmm-yy',
  18: 'h:mm AM/PM',
  19: 'h:mm:ss AM/PM',
  20: 'h:mm',
  21: 'h:mm:ss',
  22: 'dd/mm/yyyy h:mm',
  45: 'mm:ss',
  46: '[h]:mm:ss',
  47: 'mmss.0',
  49: '@',
};

/** Number format of each cell style, by its index (the `s` of a cell). */
function cellFormats(styles: Element | undefined): string[] {
  if (!styles) return [];
  const custom = new Map<number, string>();
  for (const f of children(child(styles, 'numFmts'), 'numFmt')) {
    custom.set(Number(f.getAttribute('numFmtId')), f.getAttribute('formatCode') ?? 'General');
  }
  return children(child(styles, 'cellXfs'), 'xf').map((xf) => {
    const id = Number(xf.getAttribute('numFmtId') ?? 0);
    return custom.get(id) ?? BUILT_IN_FORMATS[id] ?? 'General';
  });
}

const isDateFormat = (format: string) =>
  /[dmy]/i.test(format.replace(/\[[^\]]*\]|"[^"]*"|\\./g, '')) && !format.includes('%');

/** What Excel would show, near enough for a check: the French way for dates and decimals. */
function displayOf(value: RawCell['value'], format: string): string {
  if (typeof value === 'boolean') return value ? 'VRAI' : 'FAUX';
  if (typeof value !== 'number') return value ?? '';
  if (isDateFormat(format)) {
    const iso = serialToIso(value);
    if (iso) return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  }
  if (format.includes('%')) {
    const percent = numberText(value * 100);
    if (percent !== undefined) return `${percent.replace('.', ',')} %`;
  }
  return (numberText(value) ?? String(value)).replace('.', ',');
}

const CELL_REF = /^([A-Z]{1,3})(\d+)$/;

/** The sheets in the workbook's order, each with the part that holds it. */
async function sheetParts(zip: Inflater): Promise<{ name: string; part: string }[]> {
  const book = await zip.text('xl/workbook.xml');
  const rels = await zip.text('xl/_rels/workbook.xml.rels');
  if (!book || !rels) throw new SheetFileError('unreadable', 'not a workbook');
  const targets = new Map(
    children(parse(rels, 'workbook.xml.rels'), 'Relationship').map((r) => [
      r.getAttribute('Id') ?? '',
      r.getAttribute('Target') ?? '',
    ]),
  );
  return children(child(parse(book, 'workbook.xml'), 'sheets'), 'sheet').flatMap((s) => {
    const target = targets.get(s.getAttributeNS(REL, 'id') ?? '');
    if (!target) return [];
    const part = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
    return zip.has(part) ? [{ name: s.getAttribute('name') ?? '', part }] : [];
  });
}

async function readXlsx(bytes: Uint8Array<ArrayBuffer>, limits: FileLimits): Promise<SheetFile> {
  const zip = new Inflater(bytes, zipEntries(bytes), limits.maxInflatedBytes);
  const parts = await sheetParts(zip);
  const shared = await zip.text('xl/sharedStrings.xml');
  const strings = shared ? children(parse(shared, 'sharedStrings.xml'), 'si').map(stringOf) : [];
  const stylesXml = await zip.text('xl/styles.xml');
  const formats = cellFormats(stylesXml ? parse(stylesXml, 'styles.xml') : undefined);

  const sheets: SheetSnapshot[] = [];
  const truncated: string[] = [];
  for (const { name, part } of parts) {
    const xml = await zip.text(part);
    const root = xml === undefined ? undefined : parse(xml, part);
    // A chart sheet, a dialog or a macro sheet holds no rows.
    if (root?.localName !== 'worksheet' || root.namespaceURI !== MAIN) continue;
    const rows: RawRow[] = [];
    for (const row of children(child(root, 'sheetData'), 'row')) {
      if (rows.length >= limits.maxRows) {
        truncated.push(name);
        break;
      }
      const cells: RawCell[] = [];
      let rowNumber = Number(row.getAttribute('r') ?? 0);
      for (const c of children(row, 'c')) {
        const ref = CELL_REF.exec(c.getAttribute('r') ?? '');
        if (!ref?.[1]) continue;
        rowNumber ||= Number(ref[2]);
        const cell = cellOf(c, ref[1], strings, formats);
        if (cell) cells.push(cell);
      }
      if (cells.length && rowNumber > 0) rows.push({ row: rowNumber, cells });
    }
    sheets.push({ sheet: name.slice(0, 31), rows, formulas: true });
  }
  return { format: 'xlsx', sheets, truncated };
}

function cellOf(
  c: Element,
  col: string,
  strings: string[],
  formats: string[],
): RawCell | undefined {
  const type = c.getAttribute('t') ?? 'n';
  const raw = child(c, 'v')?.textContent ?? undefined;
  const format = formats[Number(c.getAttribute('s') ?? 0)] ?? 'General';
  let value: RawCell['value'];
  if (type === 's') value = raw === undefined ? null : (strings[Number(raw)] ?? null);
  else if (type === 'inlineStr') value = stringOf(child(c, 'is'));
  else if (type === 'str' || type === 'e') value = raw === undefined ? null : unescapeOoxml(raw);
  else if (type === 'b') value = raw === undefined ? null : raw === '1';
  else if (type === 'd') value = raw ?? null;
  else {
    const n = raw === undefined ? Number.NaN : Number(raw);
    value = raw === undefined ? null : Number.isFinite(n) ? n : raw;
  }
  if (value === null || value === '') return undefined;
  return {
    col,
    value,
    text: displayOf(value, format),
    format,
    ...(child(c, 'f') && { formula: true as const }),
  };
}

// ---------------------------------------------------------------------------------------------- csv

/** UTF-8 when it is; else Windows-1252, what Excel in France saves a « CSV (séparateur : ;) » in. */
function decodeCsv(bytes: Uint8Array<ArrayBuffer>): string {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** The separator the first line uses most, outside quotes. */
function separatorOf(text: string): string {
  const firstLine = text.slice(0, text.search(/\r?\n|$/)).replace(/"[^"]*"/g, '');
  const counts = [';', ',', '\t'].map((s) => [s, firstLine.split(s).length - 1] as const);
  return counts.reduce((best, c) => (c[1] > best[1] ? c : best))[0];
}

function readCsv(bytes: Uint8Array<ArrayBuffer>, name: string, limits: FileLimits): SheetFile {
  const text = decodeCsv(bytes);
  const sep = separatorOf(text);
  const sheet = (
    name
      .replace(/\.[^.]*$/, '')
      .replace(/[[\]:*?/\\]/g, ' ')
      .trim() || 'CSV'
  ).slice(0, 31);
  const rows: RawRow[] = [];
  let truncated = false;
  let cells: RawCell[] = [];
  let field = '';
  let col = 1;
  let quoted = false;
  let rowNumber = 1;
  const endField = () => {
    const value = field.trim();
    // Excel's last column is XFD (16 384).
    if (value !== '' && col <= 16_384) cells.push({ col: columnLetters(col), value, text: value });
    field = '';
    col++;
  };
  const endRow = () => {
    endField();
    if (cells.length) rows.push({ row: rowNumber, cells });
    cells = [];
    col = 1;
    rowNumber++;
  };
  for (let i = 0; i < text.length && !truncated; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.trim() === '') {
      field = '';
      quoted = true;
    } else if (ch === sep) endField();
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
      truncated = rows.length >= limits.maxRows;
    } else field += ch;
  }
  if (!truncated && (field !== '' || cells.length)) endRow();
  return { format: 'csv', sheets: [{ sheet, rows }], truncated: truncated ? [sheet] : [] };
}
