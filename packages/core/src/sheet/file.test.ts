import { describe, expect, it } from 'vitest';
import { zipOf } from '../../test/xlsx';
import { FILE_LIMITS, readCompleteSheetFile, readSheetFile, SheetFileError } from './file';
import { amountOf, dateOf, decimalOf } from './values';

const NS =
  'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

/** « Commandes » then « Achats », in the workbook's order (not the parts'), and a chart sheet. */
function workbook(commandes: string, extra: Record<string, string> = {}) {
  return zipOf({
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook ${NS}><sheets>
  <sheet name="Commandes" sheetId="2" r:id="rId2"/>
  <sheet name="Achats" sheetId="1" r:id="rId1"/>
  <sheet name="Graphique" sheetId="3" r:id="rId3"/>
</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="worksheet" Target="/xl/worksheets/sheet2.xml"/>
  <Relationship Id="rId3" Type="chartsheet" Target="chartsheets/sheet1.xml"/>
  <Relationship Id="rId4" Type="styles" Target="styles.xml"/>
</Relationships>`,
    'xl/sharedStrings.xml': `<sst ${NS} count="5" uniqueCount="5">
  <si><t>N° commande</t></si>
  <si><t>Date</t></si>
  <si><r><t>Chaise </t></r><r><rPr><b/></rPr><t>pliante</t></r><rPh><t>ignored</t></rPh></si>
  <si><t xml:space="preserve">Ligne 1_x000D_
Ligne 2</t></si>
  <si><t>Prix &amp; remise</t></si>
</sst>`,
    'xl/styles.xml': `<styleSheet ${NS}>
  <numFmts count="1"><numFmt numFmtId="164" formatCode="d\\ mmmm\\ yyyy"/></numFmts>
  <cellXfs count="5">
    <xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="9"/><xf numFmtId="4"/>
  </cellXfs>
</styleSheet>`,
    'xl/worksheets/sheet1.xml': `<worksheet ${NS}><sheetData>
  <row r="1"><c r="A1" t="inlineStr"><is><t>Article</t></is></c></row>
</sheetData></worksheet>`,
    'xl/worksheets/sheet2.xml': `<worksheet ${NS}><sheetData>${commandes}</sheetData></worksheet>`,
    'xl/chartsheets/sheet1.xml': `<chartsheet ${NS}/>`,
    ...extra,
  });
}

const ROWS = `
  <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>4</v></c></row>
  <row r="3" spans="1:8">
    <c r="A3"><v>118</v></c>
    <c r="B3" s="1"><v>46275</v></c>
    <c r="C3" s="4"><v>40</v></c>
    <c r="D3" s="3"><v>0.1</v></c>
    <c r="E3" t="s"><v>2</v></c>
    <c r="F3" s="4"><f>C3*10</f><v>400</v></c>
    <c r="G3" t="b"><v>1</v></c>
    <c r="H3" s="2"/>
    <c r="I3" s="2"><v>46276</v></c>
    <c r="J3" t="e"><v>#N/A</v></c>
    <c r="K3" t="str"><f>"C-"&amp;A3</f><v>C-118</v></c>
    <c r="L3" t="s"><v>3</v></c>
  </row>`;

describe('a workbook file read like the pane reads a sheet (R4)', () => {
  it('gives each sheet in the workbook’s order, with values, texts, formats and formulas', async () => {
    const file = await readSheetFile(workbook(ROWS), 'Commandes 2026.xlsx');
    expect(file.format).toBe('xlsx');
    expect(file.truncated).toEqual([]);
    expect(file.sheets.map((s) => s.sheet)).toEqual(['Commandes', 'Achats']);
    const [commandes] = file.sheets;
    expect(commandes?.formulas).toBe(true);
    expect(commandes?.rows.map((r) => r.row)).toEqual([1, 3]);
    expect(commandes?.rows[0]?.cells.map((c) => c.value)).toEqual([
      'N° commande',
      'Date',
      'Prix & remise',
    ]);
    const row = commandes?.rows[1]?.cells ?? [];
    const at = (col: string) => row.find((c) => c.col === col);
    expect(at('A')).toEqual({ col: 'A', value: 118, text: '118', format: 'General' });
    expect(at('B')).toEqual({ col: 'B', value: 46275, text: '10/09/2026', format: 'dd/mm/yyyy' });
    expect(at('C')).toMatchObject({ value: 40, text: '40', format: '#,##0.00' });
    expect(at('D')).toMatchObject({ value: 0.1, text: '10 %', format: '0%' });
    expect(at('E')?.value).toBe('Chaise pliante');
    expect(at('F')).toMatchObject({ value: 400, formula: true });
    expect(at('C')?.formula).toBeUndefined();
    expect(at('G')).toMatchObject({ value: true, text: 'VRAI' });
    expect(at('H')).toBeUndefined();
    expect(at('I')).toMatchObject({ text: '11/09/2026', format: 'd\\ mmmm\\ yyyy' });
    expect(at('J')?.value).toBe('#N/A');
    expect(at('K')).toMatchObject({ value: 'C-118', formula: true });
    expect(at('L')?.value).toBe('Ligne 1\r\nLigne 2');
  });

  it('reads them with the same helpers as a sheet of the open workbook', async () => {
    const [commandes] = (await readSheetFile(workbook(ROWS), 'c.xlsx')).sheets;
    const row = commandes?.rows[1]?.cells ?? [];
    const at = (col: string) => row.find((c) => c.col === col);
    expect(dateOf(at('B'))).toBe('2026-09-10');
    expect(dateOf(at('I'))).toBe('2026-09-11');
    expect(decimalOf(at('C'))).toBe('40');
    expect(amountOf(at('D'))).toBe('10 %');
    // A number in a General cell is not a date.
    expect(dateOf(at('A'))).toBe('118');
  });

  it('keeps the first rows of a long sheet and says it was cut', async () => {
    const rows = Array.from(
      { length: 12 },
      (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`,
    ).join('');
    const file = await readSheetFile(workbook(rows), 'c.xlsx', { ...FILE_LIMITS, maxRows: 10 });
    expect(file.sheets[0]?.rows).toHaveLength(10);
    expect(file.truncated).toEqual(['Commandes']);
  });

  it('reads a part stored without compression', async () => {
    const bytes = zipOf(
      {
        'xl/workbook.xml': `<workbook ${NS}><sheets><sheet name="F" sheetId="1" r:id="r1"/></sheets></workbook>`,
        'xl/_rels/workbook.xml.rels':
          '<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
        'xl/worksheets/sheet1.xml': `<worksheet ${NS}><sheetData><row r="2"><c r="B2"><v>7</v></c></row></sheetData></worksheet>`,
      },
      { store: true },
    );
    const file = await readSheetFile(bytes, 'f.xlsm');
    expect(file.sheets).toEqual([
      {
        sheet: 'F',
        formulas: true,
        rows: [{ row: 2, cells: [{ col: 'B', value: 7, text: '7', format: 'General' }] }],
      },
    ]);
  });

  it('refuses what is not a workbook it reads, before inflating too much', async () => {
    const reason = (p: Promise<unknown>) =>
      p.then(
        () => 'read',
        (e: unknown) => (e instanceof SheetFileError ? e.reason : String(e)),
      );
    expect(await reason(readSheetFile(new Uint8Array([1, 2, 3]), 'a.xlsx'))).toBe('unreadable');
    expect(await reason(readSheetFile(workbook(ROWS), 'a.pdf'))).toBe('unsupported');
    expect(
      await reason(readSheetFile(workbook(ROWS), 'a.xlsx', { ...FILE_LIMITS, maxBytes: 100 })),
    ).toBe('too_large');
    // A part that inflates past the limit stops there: 2 MB of zeros, under 3 kB on disk.
    const bomb = workbook(ROWS, {
      'xl/worksheets/sheet2.xml': `<worksheet ${NS}><sheetData>${'0'.repeat(2_000_000)}</sheetData></worksheet>`,
    });
    expect(bomb.byteLength).toBeLessThan(10_000);
    expect(
      await reason(readSheetFile(bomb, 'a.xlsx', { ...FILE_LIMITS, maxInflatedBytes: 1_000_000 })),
    ).toBe('too_large');
    const doctype = workbook(ROWS, {
      'xl/sharedStrings.xml': '<!DOCTYPE x [<!ENTITY a "b">]><sst/>',
    });
    expect(await reason(readSheetFile(doctype, 'a.xlsx'))).toBe('unreadable');
    const broken = workbook(ROWS, { 'xl/worksheets/sheet2.xml': '<worksheet' });
    expect(await reason(readSheetFile(broken, 'a.xlsx'))).toBe('unreadable');
  });
});

describe('a CSV file (R4)', () => {
  it('reads Excel’s French CSV: semicolons, Windows-1252, quotes', async () => {
    // « CSV (séparateur : point-virgule) » from Excel in France: Windows-1252, CRLF.
    const text =
      'N° commande;Désignation;Prix\r\nC-118;"Chaise; pliante";"1 234,50 €"\r\n\r\nC-119;"Dit ""oui""\r\nà la ligne";40\r\n';
    const bytes = new Uint8Array([...text].map((ch) => (ch === '€' ? 0x80 : ch.charCodeAt(0))));
    const file = await readSheetFile(bytes, 'Commandes [2026]: export.csv');
    expect(file.format).toBe('csv');
    const [sheet] = file.sheets;
    expect(sheet?.sheet).toBe('Commandes  2026   export');
    expect(sheet?.rows.map((r) => [r.row, r.cells.map((c) => c.value)])).toEqual([
      [1, ['N° commande', 'Désignation', 'Prix']],
      [2, ['C-118', 'Chaise; pliante', '1 234,50 €']],
      [4, ['C-119', 'Dit "oui"\r\nà la ligne', '40']],
    ]);
    expect(decimalOf(sheet?.rows[1]?.cells[2])).toBe('1234.50');
  });

  it('takes UTF-8 with its BOM, a comma or a tab, and keeps the first rows of a long file', async () => {
    const utf8 = new TextEncoder().encode('﻿Réf,Qté\n"A-1",3\n');
    const [comma] = (await readSheetFile(utf8, 'a.csv')).sheets;
    expect(comma?.rows[0]?.cells.map((c) => c.value)).toEqual(['Réf', 'Qté']);
    expect(comma?.rows[1]?.cells).toEqual([
      { col: 'A', value: 'A-1', text: 'A-1' },
      { col: 'B', value: '3', text: '3' },
    ]);
    const tab = new TextEncoder().encode('a\tb\n1\t2');
    expect((await readSheetFile(tab, 't.csv')).sheets[0]?.rows[1]?.cells[1]?.value).toBe('2');
    const long = new TextEncoder().encode(
      Array.from({ length: 20 }, (_, i) => `${i};x`).join('\n'),
    );
    const cut = await readSheetFile(long, 'l.csv', { ...FILE_LIMITS, maxRows: 5 });
    expect(cut.sheets[0]?.rows).toHaveLength(5);
    expect(cut.truncated).toEqual(['l']);
  });
});

describe('complete files for registry checks', () => {
  const limits = { ...FILE_LIMITS, maxRows: 2 };
  const text = (value: string) => new TextEncoder().encode(value);
  const row = (n: number) => `<row r="${n}"><c r="A${n}"><v>${n}</v></c></row>`;

  it('accepts the exact CSV limit with or without a final newline and empty rows', async () => {
    for (const suffix of ['', '\n', '\r\n;\r\n  ;  \r\n']) {
      const file = await readCompleteSheetFile(text(`a;b\n1;2${suffix}`), 'f.csv', limits);
      expect(file.sheets[0]?.rows).toHaveLength(2);
      expect(file.truncated).toEqual([]);
    }
  });

  it('accepts the exact XLSX limit followed by empty formatted rows', async () => {
    const bytes = workbook(`${row(1)}${row(2)}<row r="3"><c r="A3" s="1"/></row>`);
    const file = await readCompleteSheetFile(bytes, 'f.xlsx', limits);
    expect(file.sheets[0]?.rows).toHaveLength(2);
    expect(file.truncated).toEqual([]);
  });

  it('refuses a partial CSV or XLSX, including an extra CSV row without a newline', async () => {
    for (const suffix of ['', '\n']) {
      await expect(
        readCompleteSheetFile(text(`a;b\n1;2\n3;4${suffix}`), 'f.csv', limits),
      ).rejects.toMatchObject({ reason: 'too_many_rows' });
    }
    await expect(
      readCompleteSheetFile(workbook(row(1) + row(2) + row(3)), 'f.xlsx', limits),
    ).rejects.toMatchObject({ reason: 'too_many_rows', message: 'Commandes' });
  });
});
