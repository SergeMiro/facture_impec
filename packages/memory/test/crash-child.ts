// Writes the same 20 pages twice, and kills itself with SIGKILL at a chosen file operation of the
// second write (`journal.test.ts` « a write cut by SIGKILL »): `open:K` before the K-th file it
// opens to write, `rename:K` before the K-th rename. Node's own `fs/promises` is wrapped, so the
// write runs exactly as in production up to that point.
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { compile, type PageWrite } from '../src/compile';

const [root, killAt] = process.argv.slice(2);
const [operation, nth] = (killAt ?? '').split(':');
if (!root || (operation !== 'open' && operation !== 'rename')) {
  throw new Error('usage: crash-child <vault> open:K|rename:K');
}

let armed = false;
let count = 0;
const original = fsp[operation] as (...args: unknown[]) => Promise<unknown>;
(fsp as unknown as Record<string, unknown>)[operation] = (...args: unknown[]) => {
  if (armed && ++count === Number(nth)) process.kill(process.pid, 'SIGKILL');
  return original(...args);
};
syncBuiltinESMExports();

const pages = (round: number): PageWrite[] =>
  Array.from({ length: 20 }, (_, i) => ({
    path: `tiers/p-${String(i).padStart(2, '0')}`,
    frontmatter: {
      type: 'tiers',
      title: `round-${round}`,
      sources: ['erp:1'],
      roles: ['client'],
      ...(i > 0 && {
        links: [{ kind: 'supplied_by', to: 'tiers/p-00', confidence: 'exact', evidence: 'test' }],
      }),
    },
    text: `Round ${round}.`,
  }));

for (const round of [1, 2]) {
  armed = round === 2;
  const done = await compile(
    root,
    { reason: 'ingest', actor: 'agent:test', pages: pages(round) },
    { now: new Date(), sourceExists: () => true },
  );
  if (!done.ok) throw new Error(done.detail);
}
process.stdout.write('not killed\n');
