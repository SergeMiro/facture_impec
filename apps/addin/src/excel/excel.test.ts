import { describe, expect, it } from 'vitest';
import { FakeWorkbook } from './fake';
import type { StatusPlan, UsedRange } from './port';
import {
  detectionSample,
  headersOf,
  MAX_ROWS,
  readUsedRange,
  statusColumns,
  TooManyRows,
  topLeft,
} from './reader';
import { EXCEL_RETRY, ExcelTimeout, isPermanent, withRetry } from './retry';
import { asText, planValues, StatusWriter, TONE_FILL, type WriterClock } from './writer';

const range = (address: string, rows: (string | number)[][]): UsedRange => ({
  address,
  values: rows,
  text: rows.map((r) => r.map(String)),
  numberFormat: rows.map((r) => r.map(() => 'General')),
});

describe('SheetReader', () => {
  it('returns rows with addresses from where the used range starts', () => {
    expect(topLeft("'Factures 2026'!B3:F9")).toEqual({ col: 2, row: 3 });
    const reading = readUsedRange(
      'Factures',
      range('Factures!B3:D4', [
        ['N°', 'Client', ''],
        ['F-1', 'Martin', 12],
      ]),
    );
    expect(reading.snapshot.rows).toEqual([
      {
        row: 3,
        cells: [
          { col: 'B', value: 'N°', text: 'N°' },
          { col: 'C', value: 'Client', text: 'Client' },
        ],
      },
      {
        row: 4,
        cells: [
          { col: 'B', value: 'F-1', text: 'F-1' },
          { col: 'C', value: 'Martin', text: 'Martin' },
          { col: 'D', value: 12, text: '12' },
        ],
      },
    ]);
    expect(reading.lastCol).toBe('D');
    expect(reading.lastRow).toBe(4);
  });

  it('keeps number formats other than General, for dates and percentages', () => {
    const r = range('S!A1:A1', [[46310]]);
    r.text = [['15/10/2026']];
    r.numberFormat = [['dd/mm/yyyy']];
    expect(readUsedRange('S', r).snapshot.rows[0]?.cells[0]).toEqual({
      col: 'A',
      value: 46310,
      text: '15/10/2026',
      format: 'dd/mm/yyyy',
    });
  });

  it('says which cells a formula computes, once it read the formulas', () => {
    const r = range('S!A1:C1', [[400, 410, '=x']]);
    r.formulas = [['=A2*B2', 410, '=x']];
    const { snapshot } = readUsedRange('S', r);
    expect(snapshot.formulas).toBe(true);
    expect(snapshot.rows[0]?.cells.map((c) => c.formula)).toEqual([true, undefined, undefined]);
    expect(readUsedRange('S', range('S!A1:A1', [[1]])).snapshot.formulas).toBeUndefined();
  });

  it('never reads back its own FI columns, and reuses them for the statuses', () => {
    const reading = readUsedRange(
      'S',
      range('S!A1:D2', [
        ['N°', 'FI_Statut', 'Montant', 'FI_Détail'],
        ['F-1', 'Vérifiée', 100, ''],
      ]),
    );
    expect(reading.owned).toEqual({ status: 'B', detail: 'D' });
    expect(reading.snapshot.rows.flatMap((r) => r.cells.map((c) => c.col))).toEqual([
      'A',
      'C',
      'A',
      'C',
    ]);
    expect(statusColumns(reading)).toEqual({ statusCol: 'B', detailCol: 'D' });
  });

  it('puts new status columns right after the data, or in A–B on a blank sheet', () => {
    const reading = readUsedRange('S', range('S!A1:L2', [Array(12).fill('x'), Array(12).fill(1)]));
    expect(statusColumns(reading)).toEqual({ statusCol: 'M', detailCol: 'N' });
    const blank = readUsedRange('S', null);
    expect(blank.snapshot.rows).toEqual([]);
    expect(statusColumns(blank)).toEqual({ statusCol: 'A', detailCol: 'B' });
  });

  it('refuses more rows than the API reads', () => {
    const rows = Array.from({ length: MAX_ROWS + 1 }, (_, i) => [`F-${i}`]);
    expect(() => readUsedRange('S', range(`S!A1:A${rows.length}`, rows))).toThrow(TooManyRows);
  });

  it('sends the agent the first 50 rows and lists headers for the pickers', () => {
    const rows = Array.from({ length: 80 }, (_, i) => [
      i === 0 ? 'N°' : `F-${i}`,
      i === 0 ? '' : 1,
    ]);
    const { snapshot } = readUsedRange('S', range('S!A1:B80', rows));
    expect(detectionSample(snapshot).rows).toHaveLength(50);
    expect(headersOf(snapshot, 1)).toEqual([
      { col: 'A', text: 'N°' },
      { col: 'B', text: '' },
    ]);
  });
});

/** A clock the test moves by hand. */
function manualClock() {
  let now = 0;
  const due: Array<{ at: number; fn: () => void }> = [];
  const clock: WriterClock = {
    now: () => now,
    setTimeout: (fn, ms) => due.push({ at: now + ms, fn }),
  };
  const advance = async (ms: number) => {
    now += ms;
    for (;;) {
      due.sort((a, b) => a.at - b.at);
      const next = due[0];
      if (!next || next.at > now) break;
      due.shift();
      next.fn();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  return { clock, advance };
}

const plan = (sheet: string, status: string): StatusPlan => ({
  sheet,
  headerRow: 1,
  statusCol: 'C',
  detailCol: 'D',
  lastRow: 3,
  cells: [{ row: 2, status, detail: '', tone: 'ok' }],
});

describe('StatusWriter', () => {
  it('writes at most once per 500 ms, the newest plan of each sheet, all sheets together', async () => {
    const book = new FakeWorkbook({ S: { A1: 'N°', A2: 'F-1' }, T: { A1: 'N°', A2: 'F-2' } });
    const { clock, advance } = manualClock();
    const writer = new StatusWriter(book, clock);
    const first = writer.write(plan('S', 'un'));
    await advance(0);
    await first;
    expect(book.writes).toBe(1);

    const settled: string[] = [];
    for (const [sheet, status] of [
      ['S', 'deux'],
      ['S', 'trois'],
      ['T', 'quatre'],
    ] as const) {
      void writer.write(plan(sheet, status)).then(() => settled.push(status));
    }
    await advance(499);
    expect(book.writes).toBe(1);
    await advance(1);
    expect(book.writes).toBe(2);
    expect(book.cell('S', 'C2')?.text).toBe('trois');
    expect(book.cell('T', 'C2')?.text).toBe('quatre');
    expect(settled.sort()).toEqual(['deux', 'quatre', 'trois']);
  });

  it('rejects the waiters when Excel fails, and keeps writing later plans', async () => {
    const book = new FakeWorkbook({ S: { A1: 'N°' } });
    const { clock, advance } = manualClock();
    const writer = new StatusWriter(book, clock);
    const failing = Object.assign(book, {});
    const original = failing.writeStatus.bind(failing);
    failing.writeStatus = async () => {
      throw new Error('Excel est occupé');
    };
    const rejected = writer.write(plan('S', 'un')).catch((e: Error) => e.message);
    await advance(0);
    expect(await rejected).toBe('Excel est occupé');
    failing.writeStatus = original;
    const ok = writer.write(plan('S', 'deux'));
    await advance(500);
    await ok;
    expect(book.cell('S', 'C2')?.text).toBe('deux');
  });

  it('plans text that cannot turn into a formula, and fills in runs', () => {
    expect(asText('=SOMME(A1)')).toBe("'=SOMME(A1)");
    expect(asText('-5 €')).toBe("'-5 €");
    const values = planValues({
      sheet: 'S',
      headerRow: 1,
      statusCol: 'M',
      detailCol: 'N',
      lastRow: 6,
      cells: [
        { row: 2, status: 'À corriger', detail: 'SIREN', tone: 'error' },
        { row: 3, status: 'À corriger', detail: 'Date', tone: 'error' },
        { row: 4, status: 'Vérifiée', detail: '', tone: 'ok' },
        { row: 6, status: 'Brouillon', detail: '', tone: 'neutral' },
      ],
    });
    expect(values.first).toBe(2);
    expect(values.status.map((r) => r[0])).toEqual([
      'À corriger',
      'À corriger',
      'Vérifiée',
      '',
      'Brouillon',
    ]);
    expect(values.fills).toEqual([
      { from: 2, to: 3, color: TONE_FILL.error },
      { from: 4, to: 4, color: TONE_FILL.ok },
    ]);
  });
});

describe('withRetry', () => {
  const fast = { ...EXCEL_RETRY, timeoutMs: 50, sleep: async () => {} };

  it('tries again after a temporary error', async () => {
    let calls = 0;
    const value = await withRetry(async () => {
      calls++;
      if (calls < 3) throw Object.assign(new Error('busy'), { code: 'GeneralException' });
      return 'ok';
    }, fast);
    expect(value).toBe('ok');
    expect(calls).toBe(3);
  });

  it('stops at once on an error a second try will not fix', async () => {
    let calls = 0;
    const error = Object.assign(new Error('no sheet'), { code: 'ItemNotFound' });
    expect(isPermanent(error)).toBe(true);
    await expect(
      withRetry(async () => {
        calls++;
        throw error;
      }, fast),
    ).rejects.toBe(error);
    expect(calls).toBe(1);
  });

  it('gives up on a call that hangs', async () => {
    await expect(
      withRetry(() => new Promise(() => {}), { ...fast, attempts: 2 }),
    ).rejects.toBeInstanceOf(ExcelTimeout);
  });
});

describe('FakeWorkbook', () => {
  it('fires change events for user edits and for its own writes, like Excel', async () => {
    const book = new FakeWorkbook({ S: { A1: 'N°', A2: 'F-1' } });
    const seen: string[] = [];
    const stop = await book.onChange('S', (a) => seen.push(a));
    book.type('S', 'B2', 'Martin');
    await book.writeStatus([plan('S', 'Vérifiée')]);
    await stop();
    book.type('S', 'B3', 'ignoré');
    expect(seen).toEqual(['B2', 'C1:D3']);
    expect(book.cell('S', 'C1')).toMatchObject({ text: 'FI_Statut', bold: true });
  });
});
