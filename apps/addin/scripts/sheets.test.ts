import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { t } from '@fi/shared';
import { expect, it } from 'vitest';
import { FakeWorkbook } from '../src/excel/fake';
import { fakeGoogleSheets } from '../src/sheets/fake';

it('packages an executable bound script, its sidebar and current-document permissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fi-sheets-package-'));
  try {
    execFileSync(
      'pnpm',
      [
        'exec',
        'tsx',
        'scripts/sheets.ts',
        '--addin',
        'https://addin.example.test/google-sheets.html',
        '--out',
        dir,
      ],
      { stdio: 'pipe' },
    );
    const code = readFileSync(join(dir, 'Code.gs'), 'utf8');
    const google = fakeGoogleSheets(new FakeWorkbook({ Factures: { A1: 'N° facture' } }));
    const items: string[] = [];
    const context: Record<string, unknown> = {
      SpreadsheetApp: {
        getActiveSpreadsheet: () => google.services.book,
        flush() {},
        getUi: () => ({
          createMenu(label: string) {
            items.push(label);
            return {
              addItem(text: string) {
                items.push(text);
                return { addToUi() {} };
              },
            };
          },
        }),
      },
      PropertiesService: { getDocumentProperties: () => google.services.properties },
      LockService: { getDocumentLock: () => google.services.lock },
      Utilities: { formatDate: google.services.formatDate, getUuid: () => 'revision' },
    };
    runInNewContext(code, context, { timeout: 5_000 });
    const call = context.fiSheetsCall as (request: unknown) => unknown;
    expect(call({ method: 'getSetting', key: 'fi.workbookId' })).toEqual({
      ok: true,
      value: 'gs-spreadsheet-fi-test',
    });
    (context.onOpen as () => void)();
    expect(items).toEqual([t('app.title'), t('sheets.menu.open')]);
    const sidebar = readFileSync(join(dir, 'Sidebar.html'), 'utf8');
    expect(sidebar).toContain('FactureImpecSidebar.mount(<?!= config ?>)');
    expect(sidebar).not.toContain('office.js');
    const manifest = JSON.parse(readFileSync(join(dir, 'appsscript.json'), 'utf8'));
    expect(manifest.oauthScopes).toEqual([
      'https://www.googleapis.com/auth/spreadsheets.currentonly',
      'https://www.googleapis.com/auth/script.container.ui',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
