// What a verdict depends on besides the invoice and its context: the code of packages/core (rules, code
// lists, money and date helpers) and the French texts of the issues. Any change to them gives every
// invoice a new check key (src/invoices.ts checkOf), so the first sync after a deploy checks each
// invoice once more, and an invoice validated under old rules never leaves under them.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

/** [name, path]: names relative to their package, so two installs in other folders agree. */
function sources(): [string, string][] {
  const core = dirname(require.resolve('@fi/core'));
  const shared = dirname(require.resolve('@fi/shared'));
  const code = readdirSync(core, { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(ts|json)$/.test(f) && !f.endsWith('.test.ts'))
    .map((f): [string, string] => [`core/${f}`, join(core, f)]);
  return [...code, ['shared/fr.json', join(shared, '..', 'i18n', 'fr.json')]];
}

function digest(): string {
  const hash = createHash('sha256');
  const files = sources().sort(([a], [b]) => (a < b ? -1 : 1));
  for (const [name, path] of files) hash.update(`${name}\u0000`).update(readFileSync(path));
  return hash.digest('hex');
}

export const RULESET = digest();
