// The export connector (D5, D9): the lists an ERP exports to Excel or CSV, read through the same
// `Connector` as an API connector will be. Its cursor is the file's SHA-256 and the last row
// written: the same file again starts where it stopped, another file starts at the top.
import { FatalError } from '@fi/domain';
import type { ChantierRow, TiersRow } from '../schemas';
import { BATCH_ROWS, type Connector, type Cursor, type ErpEntity } from '../types';
import type { ExportList } from './columns';
import { type ExportFile, readExport } from './read';
import { chantierRow, dataRows, type Parsed, tiersRow } from './rows';

export interface ExportConfig {
  file: ExportFile;
  /** SHA-256 of `file.bytes`, hex. */
  sha256: string;
  /** What the person said the file lists; else its labels say. */
  list?: ExportList;
}

export type ExportRow = Parsed<TiersRow> | Parsed<ChantierRow>;

export const entityOf = (list: ExportList): ErpEntity =>
  list === 'chantiers' ? 'chantier' : 'tiers';

const keyOf = (row: ExportRow) =>
  row.ok ? ('siren' in row.value ? row.value.siren : row.value.code) : undefined;

/** Where a pull of this file starts: past the row its cursor reached, if the cursor is this file's. */
export function startRow(cfg: ExportConfig, cursor: Cursor | null): number {
  return cursor?.sha256 === cfg.sha256 && typeof cursor.row === 'number' ? cursor.row : 0;
}

export const exportConnector: Connector<ExportConfig, ExportRow> = {
  id: 'export',

  async probe(cfg) {
    try {
      const sheet = await readExport(cfg.file, cfg.list);
      return { ok: true, detail: `${sheet.list}: ${dataRows(sheet.rows).length}` };
    } catch (error) {
      if (error instanceof FatalError) return { ok: false, detail: error.code };
      throw error;
    }
  },

  async *pull(cfg, cursor) {
    const sheet = await readExport(cfg.file, cfg.list);
    const read = sheet.list === 'chantiers' ? chantierRow : tiersRow;
    const start = startRow(cfg, cursor);
    // The whole file is parsed, so a key seen twice is a duplicate wherever the pull resumes.
    const seen = new Set<string>();
    const rows = dataRows(sheet.rows).map((raw) => {
      const parsed: ExportRow = read(sheet, raw);
      const key = keyOf(parsed);
      if (key === undefined) return { raw, parsed };
      if (seen.has(key)) {
        const name = parsed.ok ? parsed.value.name : null;
        return {
          raw,
          parsed: { ok: false, skipped: { row: raw.row, name, reason: 'duplicate' } } as ExportRow,
        };
      }
      seen.add(key);
      return { raw, parsed };
    });
    const left = rows.filter((r) => r.raw.row > start);
    for (let at = 0; at < left.length; at += BATCH_ROWS) {
      const batch = left.slice(at, at + BATCH_ROWS);
      const last = batch.at(-1)?.raw.row ?? start;
      yield {
        entity: entityOf(sheet.list),
        rows: batch.map((r) => r.parsed),
        nextCursor: { sha256: cfg.sha256, row: last, list: sheet.list },
      };
    }
  },
};
