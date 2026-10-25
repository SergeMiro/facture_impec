// `pnpm vault:demo`: writes the demo vault and its 100 golden questions (docs/plans/memory.md M1)
// to fixtures/vault-demo/, from the seeded generator in @fi/memory/demo. The recall tests make it
// again and compare, so run this after changing the generator or the page format, then commit both.
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeDemoVault } from '@fi/memory/demo';

const out = fileURLToPath(new URL('../fixtures/vault-demo', import.meta.url));
const fresh = await mkdtemp(join(tmpdir(), 'fi-vault-demo-'));
const demo = await writeDemoVault(fresh);
await rm(join(out, 'vault'), { recursive: true, force: true });
await rename(fresh, join(out, 'vault')).catch(async () => {
  const { cp } = await import('node:fs/promises');
  await cp(fresh, join(out, 'vault'), { recursive: true });
  await rm(fresh, { recursive: true });
});
await writeFile(join(out, 'golden.json'), `${JSON.stringify(demo.golden, null, 2)}\n`);
console.info(
  `${demo.pages.length} pages, ${demo.originals.length} originals, ${demo.golden.length} questions → ${out}`,
);
