// pnpm appsource:package --addin <url> --support <url> [--help <url>] --version a.b.c.d [--validate]
// Builds what Partner Center asks for (docs/APPSOURCE.md) into dist/appsource/: the store manifest,
// the icons and the store logo, the listing to paste, the notes for the reviewers with their sample.
// Exits 1 while something would be refused (a blank the owner has to fill, a limit), unless --draft.
// --validate also sends the manifest to Microsoft's validation service (office-addin-manifest -p).
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { demoTable } from '../src/harness/demo';
import { iconPng } from './icon';
import {
  listingProblems,
  parseListing,
  productionManifest,
  reviewerSample,
  TO_FILL,
} from './release';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const { values } = parseArgs({
  options: {
    addin: { type: 'string' },
    support: { type: 'string' },
    help: { type: 'string' },
    version: { type: 'string' },
    out: { type: 'string', default: join(repo, 'dist/appsource') },
    validate: { type: 'boolean', default: false },
    draft: { type: 'boolean', default: false },
  },
});
if (!values.addin || !values.support || !values.version) {
  console.error(
    'usage: pnpm appsource:package --addin https://… --support https://… --version 1.0.0.0 [--help https://…] [--validate] [--draft]',
  );
  process.exit(2);
}
const urls = {
  addin: values.addin,
  support: values.support,
  learnMore: values.help ?? values.support,
};
const out = values.out;
mkdirSync(out, { recursive: true });
const write = (name: string, data: string | Buffer) => writeFileSync(join(out, name), data);
const read = (path: string) => readFileSync(join(repo, path), 'utf8');

write('manifest.xml', productionManifest(read('apps/addin/manifest.xml'), urls, values.version));
// The manifest's two icons (also served from the add-in's assets/) and the store logo, same drawing.
write('icon-32.png', iconPng(32));
write('icon-64.png', iconPng(64));
write('store-logo-300.png', iconPng(300));

const listing = parseListing(read('docs/appsource/listing-fr.md'));
write(
  'listing-fr.txt',
  [
    `NOM\n${listing.name}`,
    `RÉSUMÉ\n${listing.summary}`,
    `DESCRIPTION\n${listing.description}`,
    `MOTS-CLÉS\n${listing.keywords.join('\n')}`,
  ].join('\n\n'),
);
const sample = reviewerSample(demoTable());
const notes = read('docs/appsource/certification-notes.md')
  .replace(/^[\s\S]*?\n---\n\n/, '')
  .replaceAll('{ADDIN_URL}', urls.addin)
  .replaceAll('{SUPPORT_URL}', urls.support)
  .replaceAll('{SAMPLE}', sample);
write('certification-notes.txt', notes);
write('sample-invoices.tsv', `${sample}\n`);

const problems = [
  ...listingProblems(listing),
  ...[...new Set(notes.match(TO_FILL) ?? [])].map((blank) => `notes, to fill in: ${blank}`),
];

if (values.validate) {
  // Sends manifest.xml (public URLs only, no secret) to validationgateway.omex.office.net.
  const run = spawnSync(
    'npx',
    ['--yes', 'office-addin-manifest@3.0.1', 'validate', '-p', 'manifest.xml'],
    { cwd: out, encoding: 'utf8' },
  );
  write('validation.txt', `${run.stdout}\n${run.stderr}`);
  console.log(run.stdout);
  if (run.status !== 0) problems.push('manifest: production validation failed (validation.txt)');
}

console.log(`AppSource package → ${out}`);
for (const p of problems) console.log(`  ✗ ${p}`);
if (problems.length && !values.draft) process.exit(1);
