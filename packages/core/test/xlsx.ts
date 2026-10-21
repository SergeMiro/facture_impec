// Workbook files as Excel writes them, for the tests and the E2E run of the file connector (R4): a zip
// of deflated parts, and a small workbook of plain cells built on it. Node only.
import { deflateRawSync } from 'node:zlib';

/** A zip as Excel writes one: deflated parts (or stored ones), a central directory at the end. */
export function zipOf(
  parts: Record<string, string>,
  { store = false } = {},
): Uint8Array<ArrayBuffer> {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(parts)) {
    const data = Buffer.from(text, 'utf8');
    const body = store ? data : deflateRawSync(data);
    const n = Buffer.from(name, 'utf8');
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(store ? 0 : 8, 8);
    head.writeUInt32LE(body.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(n.length, 26);
    local.push(head, n, body);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(store ? 0 : 8, 10);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(n.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, n);
    offset += 30 + n.length + body.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(parts).length, 8);
  end.writeUInt16LE(Object.keys(parts).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...local, directory, end]));
}

export const SPREADSHEET_NS =
  'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** A cell: text, a number, or a date as Excel stores it (a serial number in a date format). */
export type XlsxCell = string | number | { date: number } | null;

const xmlText = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function columnOf(n: number): string {
  let s = '';
  for (let i = n; i > 0; i = Math.floor((i - 1) / 26))
    s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

/** A workbook of the given sheets, in that order, rows from 1; texts inline, dates dd/mm/yyyy. */
export function xlsxOf(sheets: Record<string, XlsxCell[][]>): Uint8Array<ArrayBuffer> {
  const names = Object.keys(sheets);
  const parts: Record<string, string> = {
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': `<workbook ${SPREADSHEET_NS}><sheets>${names
      .map((n, i) => `<sheet name="${xmlText(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('')}</Relationships>`,
    'xl/styles.xml': `<styleSheet ${SPREADSHEET_NS}><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>`,
  };
  names.forEach((name, i) => {
    const rows = (sheets[name] ?? [])
      .map((cells, r) => {
        const xml = cells
          .map((cell, c) => {
            const ref = `${columnOf(c + 1)}${r + 1}`;
            if (cell === null) return '';
            if (typeof cell === 'number') return `<c r="${ref}"><v>${cell}</v></c>`;
            if (typeof cell === 'object') return `<c r="${ref}" s="1"><v>${cell.date}</v></c>`;
            return `<c r="${ref}" t="inlineStr"><is><t>${xmlText(cell)}</t></is></c>`;
          })
          .join('');
        return `<row r="${r + 1}">${xml}</row>`;
      })
      .join('');
    parts[`xl/worksheets/sheet${i + 1}.xml`] =
      `<worksheet ${SPREADSHEET_NS}><sheetData>${rows}</sheetData></worksheet>`;
  });
  return zipOf(parts);
}
