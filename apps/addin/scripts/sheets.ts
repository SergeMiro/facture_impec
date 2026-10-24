// Reproducible bound Apps Script package: no account credentials or remote writes.
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'vite';

const { values } = parseArgs({
  options: {
    addin: { type: 'string' },
    out: { type: 'string' },
    'allow-local': { type: 'boolean', default: false },
  },
});
if (!values.addin)
  throw new Error('Usage: pnpm sheets:package --addin https://host/google-sheets.html');
const url = new URL(values.addin);
const local = ['localhost', '127.0.0.1'].includes(url.hostname);
if (
  (url.protocol !== 'https:' && !(values['allow-local'] && local && url.protocol === 'http:')) ||
  url.username ||
  url.password ||
  url.search ||
  url.hash ||
  !url.pathname.endsWith('/google-sheets.html')
) {
  throw new Error(
    '--addin must be an https Google Sheets page without credentials, query or fragment',
  );
}
if (local && !values['allow-local'])
  throw new Error('Local packages need --allow-local; Google cannot reach this VPS localhost');
const here = new URL('../', import.meta.url);
const out = values.out ?? fileURLToPath(new URL('dist/sheets/', here));
const bundled = await mkdtemp(join(tmpdir(), 'fi-sheets-bundle-'));
await mkdir(out, { recursive: true });
try {
  for (const entry of ['host', 'sidebar']) {
    await build({
      configFile: false,
      logLevel: 'warn',
      build: {
        outDir: bundled,
        emptyOutDir: false,
        minify: false,
        target: 'es2020',
        lib: {
          entry: fileURLToPath(new URL(`src/sheets/${entry}.ts`, here)),
          name: entry === 'host' ? 'FactureImpecSheets' : 'FactureImpecSidebar',
          formats: ['iife'],
          fileName: () => `${entry}.js`,
        },
      },
    });
  }
  const host = await readFile(`${bundled}/host.js`, 'utf8');
  const sidebar = (await readFile(`${bundled}/sidebar.js`, 'utf8')).replace(
    /<\/script/gi,
    '<\\/script',
  );
  const code =
    `var FI_SHEETS_URL = ${JSON.stringify(url.toString())};\n${host}\n` +
    [
      'function onOpen(e) { FactureImpecSheets.menu(); }',
      'function onInstall(e) { onOpen(e); }',
      'function fiOpen() { FactureImpecSheets.open(); }',
      'function onEdit(e) { FactureImpecSheets.recordEdit(e); }',
      'function fiSheetsCall(request) { return FactureImpecSheets.dispatch(request); }',
    ].join('\n');
  await writeFile(`${out}/Code.gs`, code);
  await writeFile(
    `${out}/Sidebar.html`,
    `<!doctype html><html lang="fr"><head><meta charset="UTF-8"><base target="_blank"></head><body><script>${sidebar}\nFactureImpecSidebar.mount(<?!= config ?>);</script></body></html>\n`,
  );
  await writeFile(
    `${out}/appsscript.json`,
    `${JSON.stringify(
      {
        timeZone: 'Europe/Paris',
        runtimeVersion: 'V8',
        exceptionLogging: 'STACKDRIVER',
        oauthScopes: [
          'https://www.googleapis.com/auth/spreadsheets.currentonly',
          'https://www.googleapis.com/auth/script.container.ui',
        ],
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Google Sheets package: ${out} (Code.gs, Sidebar.html, appsscript.json)`);
} finally {
  await rm(bundled, { recursive: true, force: true });
}
