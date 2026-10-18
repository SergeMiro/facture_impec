// Writes src/codelists/generated.ts from the vendored CEN code-list schematrons.
// Run: pnpm --filter @fi/core codelists
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderGenerated } from '../src/codelists/extract';

const VERSION = '1.3.17';
const root = (path: string) => fileURLToPath(new URL(`../${path}`, import.meta.url));

const source = (name: string) => {
  const bytes = readFileSync(root(`vendor/cen-${VERSION}/codelist/${name}`));
  return {
    name,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    text: bytes.toString('latin1'),
  };
};

const output = renderGenerated(
  VERSION,
  source('EN16931-CII-codes.sch'),
  source('EN16931-UBL-codes.sch'),
);
writeFileSync(root('src/codelists/generated.ts'), output);
console.info('src/codelists/generated.ts written');
