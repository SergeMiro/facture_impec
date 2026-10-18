// Plan §11 M6 « export opens in a standard accounting tool without errors »: the accountant export
// imported into Paheko, free accounting software used in France, through its own FEC import
// (scripts/accounting/paheko-import.php) in a pinned Docker image; then the books must hold exactly
// what the file says. With no argument, the FEC is built from every golden invoice read as a received
// one (the code path of POST /inbound/export); with a path, that file is checked (an export
// downloaded from the pane). docs/ACCOUNTING_EXPORT.md § Paheko.
//   pnpm accounting:check                     pnpm accounting:check ~/Téléchargements/…FEC….txt
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFec, fecReady, parseInvoiceXml, purchaseItem } from '@fi/core';

const PAHEKO = 'paheko/paheko:1.3.23-8.5.10-apache-trixie';
/** The golden invoices are addressed to this buyer: it names the file. */
const BUYER_SIREN = '200000008';

const here = dirname(fileURLToPath(import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'fi-accounting-'));

/** The FEC to check and what it should put in the books. */
function fecToCheck() {
  const given = process.argv[2];
  const file = given
    ? join(work, basename(given))
    : join(work, `${BUYER_SIREN}FEC${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.txt`);
  if (given) {
    copyFileSync(resolve(given), file);
  } else {
    const golden = join(here, '../../fixtures/golden');
    const items = readdirSync(golden)
      .filter((f) => f.endsWith('.cii.xml'))
      .sort()
      .map((f) =>
        purchaseItem(parseInvoiceXml(readFileSync(join(golden, f), 'utf8')).invoice, {
          pdpRef: f,
          receivedAt: new Date().toISOString(),
        }),
      );
    const ready = items.filter(fecReady);
    const fec = buildFec(ready, {
      siren: BUYER_SIREN,
      firstEntry: 1,
      validDate: new Date().toISOString().slice(0, 10),
    });
    writeFileSync(file, fec.text);
    console.log(
      `FEC built from ${items.length} golden invoices: ${ready.length} entries, ` +
        `${items.length - ready.length} left to the CSV (${items
          .filter((i) => !fecReady(i))
          .map((i) => i.number)
          .join(', ')})`,
    );
  }
  // What the file itself says, read without Paheko: the books must hold exactly this.
  const rows = readFileSync(file, 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l !== '')
    .map((l) => l.split('\t'));
  const cents = (v = '') => Math.round(Number(v.replace(',', '.')) * 100);
  const byAccount: Record<string, number> = {};
  let debit = 0;
  for (const r of rows) {
    const net = cents(r[11]) - cents(r[12]);
    const account = r[4] ?? '';
    byAccount[account] = (byAccount[account] ?? 0) + net;
    debit += Math.max(net, 0);
  }
  const dates = rows.map((r) => r[3] ?? '').sort();
  return {
    file,
    entries: new Set(rows.map((r) => `${r[0]}|${r[2]}`)).size,
    debit,
    byAccount,
    years: [(dates[0] ?? '').slice(0, 4), (dates.at(-1) ?? '').slice(0, 4)],
  };
}

const expected = fecToCheck();
const [firstYear, lastYear] = expected.years;
copyFileSync(join(here, 'paheko-import.php'), join(work, 'paheko-import.php'));
writeFileSync(join(work, 'password'), 'controle-local-non-secret');

let out: string;
try {
  out = execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '--network',
      'none',
      '-v',
      `${work}:/work:ro`,
      '--entrypoint',
      'sh',
      PAHEKO,
      '-c',
      [
        'cd /var/www/paheko',
        'bin/paheko init --country=FR --orgname=Controle --name=Controle --email=controle@example.invalid --password-file=/work/password >/dev/null',
        `php /work/paheko-import.php /work/${basename(expected.file)} 01/01/${firstYear} 31/12/${lastYear}`,
      ].join(' && '),
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );
} catch (err) {
  rmSync(work, { recursive: true, force: true });
  const e = err as { stdout?: string; stderr?: string };
  const refusal = /^\{"error":.*$/m.exec(e.stdout ?? '')?.[0];
  if (!refusal) console.error(e.stdout ?? '', e.stderr ?? '');
  console.error(`✗ Paheko refused the FEC: ${refusal ? JSON.parse(refusal).error : 'see above'}`);
  process.exit(1);
}
rmSync(work, { recursive: true, force: true });

const line = out.trim().split('\n').at(-1) ?? '';
const books = JSON.parse(line) as {
  mapped: string[];
  preview: { created: number; modified: number; accounts: string[] };
  transactions: number;
  lines: number;
  debit: number;
  credit: number;
  unbalanced: number;
  byAccount: Record<string, number>;
};
console.log(PAHEKO);
console.log(JSON.stringify(books, null, 2));
const problems = [
  books.preview.created !== expected.entries &&
    `the preview creates ${books.preview.created} entries, the file has ${expected.entries}`,
  books.preview.modified !== 0 && `the preview modifies ${books.preview.modified} entries`,
  books.transactions !== expected.entries &&
    `${books.transactions} entries in the books, the file has ${expected.entries}`,
  books.debit !== expected.debit && `debits ${books.debit} ≠ ${expected.debit} in the file`,
  books.credit !== expected.debit && `credits ${books.credit} ≠ ${expected.debit} in the file`,
  books.unbalanced !== 0 && `${books.unbalanced} unbalanced entries`,
  ...Object.entries(expected.byAccount)
    .filter(([account, net]) => books.byAccount[account] !== net)
    .map(
      ([account, net]) => `account ${account}: ${books.byAccount[account]} ≠ ${net} in the file`,
    ),
].filter(Boolean);
if (problems.length > 0) {
  for (const p of problems) console.error(`✗ ${p}`);
  process.exit(1);
}
console.log(
  `✓ Paheko imported ${books.transactions} entries (${books.lines} lines, ` +
    `${(books.debit / 100).toFixed(2)} € on each side) without an error`,
);
