// A small spreadsheet for the harness: click a cell to select it, type in the formula bar, Enter to
// write. Selection and fills come from the FakeWorkbook, so « Corriger dans la feuille » shows here.
import { columnIndex, columnLetters } from '@fi/core';
import { type KeyboardEvent, useEffect, useState, useSyncExternalStore } from 'react';
import type { FakeWorkbook } from '../excel/fake';

const MIN_COLS = 14;
const MIN_ROWS = 8;

export function Grid({ workbook }: { workbook: FakeWorkbook }) {
  const version = useSyncExternalStore(
    (l) => workbook.subscribe(l),
    () => workbook.version,
  );
  const { sheet, cell: active } = workbook.active;
  const cells = workbook.sheets.get(sheet) ?? new Map();
  const [draft, setDraft] = useState('');

  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` re-reads the cell on change.
  useEffect(() => setDraft(workbook.cell(sheet, active)?.text ?? ''), [sheet, active, version]);

  let cols = MIN_COLS;
  let rows = MIN_ROWS;
  for (const address of cells.keys()) {
    const m = /^([A-Z]+)(\d+)$/.exec(address);
    if (!m?.[1] || !m[2]) continue;
    cols = Math.max(cols, columnIndex(m[1]) + 1);
    rows = Math.max(rows, Number(m[2]) + 2);
  }

  const letters = Array.from({ length: cols }, (_, c) => columnLetters(c + 1));
  const rowNumbers = Array.from({ length: rows }, (_, r) => r + 1);
  const commit = () => workbook.type(sheet, active, draft);
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setDraft(workbook.cell(sheet, active)?.text ?? '');
  };

  return (
    <div className="grid-wrap">
      <div className="formula">
        <output data-testid="name-box">{active}</output>
        <input
          aria-label="Contenu de la cellule"
          data-testid="formula-bar"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => draft !== (workbook.cell(sheet, active)?.text ?? '') && commit()}
        />
      </div>
      <div className="grid-scroll">
        <table className="grid" data-testid="grid">
          <thead>
            <tr>
              <th />
              {letters.map((col) => (
                <th key={col}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowNumbers.map((row) => (
              <tr key={row}>
                <th>{row}</th>
                {letters.map((col) => {
                  const address = `${col}${row}`;
                  const cell = cells.get(address);
                  return (
                    <td
                      key={address}
                      className={address === active ? 'active' : undefined}
                      style={{
                        ...(cell?.fill && { backgroundColor: cell.fill }),
                        ...(cell?.bold && { fontWeight: 600 }),
                      }}
                    >
                      <button
                        type="button"
                        className="cell"
                        data-testid={`cell-${address}`}
                        aria-label={address}
                        aria-pressed={address === active}
                        onClick={() => void workbook.select(sheet, address)}
                      >
                        {cell?.text}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tabs">
        {[...workbook.sheets.keys()].map((name) => (
          <button
            key={name}
            type="button"
            className={name === sheet ? 'tab current' : 'tab'}
            onClick={() => void workbook.select(name, 'A1')}
          >
            {name}
          </button>
        ))}
      </div>
    </div>
  );
}
