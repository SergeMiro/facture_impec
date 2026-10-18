// Renders every golden invoice as Factur-X and runs the two outside checks of plan §9 on the files:
// veraPDF (PDF/A-3B, Docker image verapdf/cli) and Akretion's Factur-X extractor (`pip install
// factur-x`, which also checks the extracted XML against the Factur-X XSD).
// Not part of pnpm verify: both tools live outside node_modules. Results go to docs/PROGRESS.md.
// Run: pnpm --filter @fi/core pdf:check [output dir]
//   FACTURX_EXTRACT=/path/to/facturx-pdfextractxml when the extractor is not on PATH.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { toFacturXPdf } from '../src/pdf';
import { computeGolden, goldens, PDF_DATE } from '../test/fixtures';

const VERAPDF = 'verapdf/cli:v1.30.2';
const font = (file: string) => readFileSync(new URL(`../fonts/${file}`, import.meta.url));
const fonts = { regular: font('DejaVuSans.ttf'), bold: font('DejaVuSans-Bold.ttf') };

const dir = process.argv[2] ?? mkdtempSync(join(tmpdir(), 'facturx-'));
mkdirSync(dir, { recursive: true });
for (const g of goldens) {
  writeFileSync(
    join(dir, `${g.name}.pdf`),
    await toFacturXPdf(computeGolden(g), { fonts, now: PDF_DATE }),
  );
}
console.log(`${goldens.length} PDF in ${dir}`);

let failed = 0;
const report = execFileSync(
  'docker',
  [
    'run',
    '--rm',
    '--network',
    'none',
    '-v',
    `${dir}:/data:ro`,
    VERAPDF,
    '--flavour',
    '3b',
    '--format',
    'text',
    '/data',
  ],
  { encoding: 'utf8' },
);
for (const line of report.trim().split('\n')) {
  if (!line.startsWith('PASS')) failed++;
  console.log(`veraPDF ${line}`);
}

const extract = process.env.FACTURX_EXTRACT ?? 'facturx-pdfextractxml';
for (const g of goldens) {
  const pdf = join(dir, `${g.name}.pdf`);
  try {
    // -ds: its schematron step needs a Saxon server; the oracle runs that schematron (pnpm verify).
    execFileSync(extract, ['-l', 'warn', '-ds', pdf, join(dir, `${g.name}.xml`)], {
      stdio: 'pipe',
    });
    console.log(`factur-x PASS ${g.name}`);
  } catch (e) {
    failed++;
    const err = e as { stderr?: Buffer; message: string };
    console.log(`factur-x FAIL ${g.name}: ${err.stderr?.toString().trim() || err.message}`);
  }
}
if (failed) {
  console.error(`${failed} failure(s)`);
  process.exit(1);
}
