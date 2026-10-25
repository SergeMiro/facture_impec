import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { readIndexLines } from './indexes';
import { commitFiles, recover, walk } from './journal';
import { readPage } from './page';
import { read, snapshot, tempVault } from './test-helpers';
import { sha, WRITTEN, type Written } from './vault';

const put = async (root: string, file: string, text: string) => {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
};

describe('several files written as one', () => {
  it('writes and removes files in one go', async () => {
    const root = await tempVault();
    await put(root, 'b.md', 'old');
    await commitFiles(
      root,
      new Map([
        ['a/a.md', 'new'],
        ['b.md', null],
      ]),
    );
    expect(await snapshot(root)).toEqual({ 'a/a.md': 'new' });
  });

  it('finishes a write cut after its journal, and sweeps the litter of one cut before', async () => {
    const root = await tempVault();
    await put(root, 'a.md', 'old a');
    await put(root, 'b.md', 'old b');
    await put(root, 'a.md.tmp-aaaaaaaaaaaa', 'new a');
    await put(
      root,
      '_system/compile.journal.json',
      JSON.stringify({ id: 'aaaaaaaaaaaa', files: ['a.md'], removed: ['b.md'] }),
    );
    await put(root, 'c.md.tmp-bbbbbbbbbbbb', 'never journaled');
    expect(await recover(root)).toBe('finished');
    expect(await read(root, 'a.md')).toBe('new a');
    expect(await walk(root)).toContain('c.md.tmp-bbbbbbbbbbbb');
    await recover(root, true);
    expect(await snapshot(root)).toEqual({ 'a.md': 'new a' });
  });
});

describe('a write cut by SIGKILL', () => {
  const child = join(dirname(fileURLToPath(import.meta.url)), '../test/crash-child.ts');

  /** Writes round 1, then round 2 until `killAt`, where the writer is killed. */
  const killAt = (root: string, at: string) =>
    new Promise<void>((resolve, reject) => {
      const proc = spawn(process.execPath, ['--import', 'tsx', child, root, at], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      proc.stdout.on('data', (d) => {
        output += d;
      });
      proc.stderr.on('data', (d) => {
        output += d;
      });
      proc.on('exit', (_code, signal) => {
        if (signal === 'SIGKILL') resolve();
        else reject(new Error(`${at}: the writer was not killed: ${output.slice(0, 500)}`));
      });
    });

  // Round 2 writes 23 files (20 pages, the section index, the log, the hashes): 23 temporary files
  // and the journal's are opened, then the journal and the 23 files are renamed.
  const cases: [string, number][] = [
    ['open:1', 1],
    ['open:12', 1],
    ['open:24', 1],
    ['rename:1', 1],
    ['rename:2', 2],
    ['rename:13', 2],
    ['rename:24', 2],
  ];

  it.each(cases)(
    'killed at %s: after recovery, round %i is there whole',
    async (at, round) => {
      const root = await tempVault();
      await killAt(root, at);
      const litter = (await walk(root)).filter((f) => /\.tmp-|journal/.test(f));
      // Cut before its first file, a write leaves nothing; any later, it leaves something to recover.
      expect(litter.length > 0).toBe(at !== 'open:1');
      await recover(root, true);
      expect((await walk(root)).filter((f) => /\.tmp-|journal/.test(f))).toEqual([]);
      const written = JSON.parse(await read(root, WRITTEN)) as Record<string, Written>;
      for (let i = 0; i < 20; i++) {
        const path = `tiers/p-${String(i).padStart(2, '0')}`;
        const file = await readFile(join(root, `${path}.md`), 'utf8');
        const page = readPage(path, file);
        if (!page.ok) throw new Error(`${path}: ${page.reason}`);
        expect(page.page.frontmatter.title).toBe(`round-${round}`);
        expect(written[`${path}.md`]?.sha).toBe(sha(file));
        if (i === 0) expect(page.page.frontmatter.backlinks).toHaveLength(19);
      }
      expect(readIndexLines(await read(root, 'tiers/index.md'))).toHaveLength(20);
      const log = (await read(root, 'log.md')).split('\n').filter((l) => l.startsWith('- '));
      expect(log).toHaveLength(round);
    },
    30_000,
  );
});
