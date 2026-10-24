import { t } from '@fi/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeWorkbook } from '../excel/fake';
import type { StatusPlan } from '../excel/port';
import { readUsedRange } from '../excel/reader';
import { fakeGoogleSheets } from './fake';
import { googleSheetsPort } from './port';

const fixture = () => {
  const workbook = new FakeWorkbook({
    Factures: {
      A1: 'N° facture',
      B1: 'Date',
      C1: 'PU HT',
      A2: 'F-1',
      B2: { value: 46_319, text: '24/10/2026', format: 'dd/mm/yyyy' },
      C2: { value: 30, text: '30,00 €', format: '#,##0.00 "€"' },
      D2: { value: 60, text: '60', formula: '=C2*2' },
    },
    Commandes: { A1: 'N° commande', A2: 'C-1' },
  });
  const google = fakeGoogleSheets(workbook);
  const port = googleSheetsPort(async (request) => google.host.dispatch(request));
  return { ...google, port };
};
afterEach(() => vi.useRealTimers());

describe('Google Sheets as a spreadsheet host', () => {
  it('quotes sheet names with spaces, apostrophes and punctuation before reading their cells', async () => {
    const name = "Factures d'octobre !";
    const native = fakeGoogleSheets(new FakeWorkbook({ [name]: { A1: 'N° facture', A2: 'F-1' } }));
    const port = googleSheetsPort(async (request) => native.host.dispatch(request));
    expect(readUsedRange(name, await port.usedRange(name)).snapshot.rows[1]?.cells[0]?.value).toBe(
      'F-1',
    );
    port.close();
  });

  it('reads visible sheets, native dates in the sheet timezone, formats and formulas', async () => {
    const f = fixture();
    f.hidden.add('Commandes');
    f.dates.set('Factures!B2', new Date('2026-10-23T22:00:00Z'));
    expect(await f.port.sheetNames()).toEqual(['Factures']);
    const range = await f.port.usedRange('Factures');
    const reading = readUsedRange('Factures', range);
    expect(reading.snapshot.rows[1]?.cells).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ col: 'B', value: '2026-10-24', text: '24/10/2026' }),
        expect.objectContaining({ col: 'C', value: 30, format: '#,##0.00 "€"' }),
        expect.objectContaining({ col: 'D', value: 60, formula: true }),
      ]),
    );
    f.setTimeZone('America/Los_Angeles');
    expect((await f.port.usedRange('Factures'))?.values[1]?.[1]).toBe('2026-10-23');
    f.port.close();
  });

  it('keeps settings with the spreadsheet, derives identity from its id and refuses secrets', async () => {
    const f = fixture();
    expect(await f.port.getSetting('fi.workbookId')).toBe('gs-spreadsheet-fi-test');
    await f.port.setSetting('fi.testMode', 'on');
    expect(await f.port.getSetting('fi.testMode')).toBe('on');
    await f.port.setSetting('fi.testMode', null);
    expect(await f.port.getSetting('fi.testMode')).toBeNull();
    expect(f.host.dispatch({ method: 'setSetting', key: 'apiKey', value: 'private' })).toEqual({
      ok: false,
      code: 'InvalidArgument',
    });
    const copy = fakeGoogleSheets(f.workbook, 'another-spreadsheet');
    expect(copy.host.dispatch({ method: 'getSetting', key: 'fi.workbookId' })).toEqual({
      ok: true,
      value: 'gs-another-spreadsheet',
    });
    f.port.close();
  });

  it('corrects one plain cell, preserves its format and refuses a change or a formula', async () => {
    const f = fixture();
    await f.port.readCell('Factures', 'C2');
    await f.port.writeCell('Factures', 'C2', 40);
    expect(f.workbook.cell('Factures', 'C2')).toMatchObject({ value: 40, format: '#,##0.00 "€"' });
    await f.port.readCell('Factures', 'C2');
    f.workbook.type('Factures', 'C2', 45);
    await expect(f.port.writeCell('Factures', 'C2', 50)).rejects.toMatchObject({
      code: 'CellChanged',
      message: t('sheets.error.changed'),
    });
    expect(f.workbook.cell('Factures', 'C2')?.value).toBe(45);
    await f.port.readCell('Factures', 'D2');
    await expect(f.port.writeCell('Factures', 'D2', 99)).rejects.toMatchObject({
      code: 'CellChanged',
    });
    expect(f.workbook.cell('Factures', 'D2')?.formula).toBe('=C2*2');
    expect(f.locked).toBe(false);
    f.port.close();
  });

  it('writes only its status columns and refuses occupied target columns before writing', async () => {
    const f = fixture();
    const original = structuredClone([...(f.workbook.sheets.get('Factures') ?? [])]);
    const plan: StatusPlan = {
      sheet: 'Factures',
      headerRow: 1,
      statusCol: 'E',
      detailCol: 'F',
      lastRow: 2,
      cells: [{ row: 2, status: 'Prête', detail: '=not a formula', tone: 'ok' }],
    };
    await f.port.writeStatus([plan]);
    expect(f.workbook.cell('Factures', 'E1')?.text).toBe('FI_Statut');
    expect(f.workbook.cell('Factures', 'F2')?.text).toBe("'=not a formula");
    for (const [address, value] of original)
      expect(f.workbook.cell('Factures', address)).toEqual(value);
    f.workbook.type('Factures', 'G2', 'Votre donnée');
    await expect(
      f.port.writeStatus([{ ...plan, statusCol: 'G', detailCol: 'H' }]),
    ).rejects.toMatchObject({ code: 'OwnedColumnsConflict' });
    expect(f.workbook.cell('Factures', 'G1')).toBeUndefined();
    expect(f.workbook.cell('Factures', 'G2')?.text).toBe('Votre donnée');
    f.port.close();
  });

  it('bounds reads and refuses invalid operations without touching a cell', async () => {
    const f = fixture();
    f.workbook.type('Factures', 'A5001', 'Too far');
    await expect(f.port.usedRange('Factures')).rejects.toMatchObject({ code: 'TooManyRows' });
    f.workbook.sheets.get('Factures')?.delete('A5001');
    f.workbook.type('Factures', 'AY5000', 'Too wide');
    await expect(f.port.usedRange('Factures')).rejects.toMatchObject({ code: 'TooManyCells' });
    expect(f.host.dispatch({ method: 'eval', script: 'arbitrary' })).toEqual({
      ok: false,
      code: 'InvalidArgument',
    });
    expect(
      f.host.dispatch({
        method: 'writeCell',
        sheet: 'Factures',
        cell: 'A2:B3',
        value: 1,
        expected: { value: '', text: '', formula: null },
      }),
    ).toEqual({ ok: false, code: 'InvalidArgument' });
    await expect(f.port.usedRange('Missing')).rejects.toMatchObject({ code: 'ItemNotFound' });
    f.port.close();
  });

  it('notices edits and API changes, then stops polling after the last listener leaves', async () => {
    vi.useFakeTimers();
    const f = fixture();
    const changed = vi.fn();
    const stop = await f.port.onChange('Commandes', changed);
    f.workbook.type('Commandes', 'A2', 'C-2');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(changed).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(changed).toHaveBeenCalledTimes(1);
    // A script/API change does not fire onEdit: periodic reconciliation still catches it.
    f.workbook.sheets.get('Commandes')?.set('A2', { value: 'C-3', text: 'C-3' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(changed).toHaveBeenCalledTimes(2);
    await stop();
    f.workbook.type('Commandes', 'A2', 'C-4');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(changed).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
    f.port.close();
  });
});
