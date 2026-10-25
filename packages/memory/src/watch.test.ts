import { spawnSync } from 'node:child_process';
import { rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile } from './compile';
import { readIndexLines } from './indexes';
import { acquireLock, LOCK, releaseLock, renewLock, VaultLocked } from './lock';
import { readPage } from './page';
import { addRaw } from './raw';
import {
  LATER,
  NOW,
  options,
  purchase,
  read,
  snapshot,
  tempVault,
  tiers,
  touch,
} from './test-helpers';
import { WRITTEN, type Written } from './vault';
import { applyUserEdits, watchVault } from './watch';
import { MemoryVault } from './writer';

const seed = async () => {
  const root = await tempVault();
  const invoice = purchase('f-1', 'a');
  await compile(
    root,
    { reason: 'ingest', actor: 'agent:test', pages: [tiers('a'), tiers('b'), invoice] },
    options(),
  );
  return { root, invoice };
};

describe("a person's edits", () => {
  it('reads, checks and indexes the page, relinks the others, and leaves their file as typed', async () => {
    const { root, invoice } = await seed();
    const file = `${invoice.path}.md`;
    const typed = (await read(root, file))
      .replace('title: Facture f-1', 'title: Facture f-1 (litige)')
      .replace('to: tiers/a', 'to: tiers/b');
    await writeFile(join(root, file), typed);
    await touch(root, file, LATER);

    const done = await applyUserEdits(root, [file, 'tiers/index.md', 'log.md'], { now: LATER });
    expect(done).toEqual({
      accepted: [invoice.path],
      invalid: [],
      removed: [],
      copies: [],
      relinked: 2,
    });
    expect(await read(root, file)).toBe(typed);
    expect(await read(root, 'finances/index.md')).toContain('|Facture f-1 (litige)]]');
    const b = readPage('tiers/b', await read(root, 'tiers/b.md'));
    expect(b.ok && b.page.frontmatter.backlinks).toEqual([
      { kind: 'issued_by', from: invoice.path },
    ]);
    expect(await read(root, 'log.md')).toContain(`modifié à la main · user · ${invoice.path}`);
    const written = JSON.parse(await read(root, WRITTEN)) as Record<string, Written>;
    expect(written[file]).toMatchObject({ person: true, edited: LATER.toISOString() });

    // Its own writes come back through the watcher: nothing to do.
    const before = await snapshot(root);
    expect(await applyUserEdits(root, [file, 'tiers/b.md'], { now: LATER })).toMatchObject({
      accepted: [],
    });
    expect(await snapshot(root)).toEqual(before);
    // An agent's patch on the page within the minute waits; its text is never replaced after.
    const later = { ...invoice, append: 'Payée le 30/10.' };
    expect(
      await compile(
        root,
        { reason: 'ingest', actor: 'agent:test', pages: [later] },
        options(LATER),
      ),
    ).toMatchObject({ code: 'conflict' });
  });

  it('takes an unreadable page out of the index, and a deleted one with its backlinks', async () => {
    const { root, invoice } = await seed();
    await writeFile(join(root, 'tiers/b.md'), '---\ntype: tiers\n---\n');
    await rm(join(root, `${invoice.path}.md`));

    const done = await applyUserEdits(root, ['tiers/b.md', `${invoice.path}.md`], { now: LATER });
    expect(done).toMatchObject({ invalid: ['tiers/b.md'], removed: [invoice.path], relinked: 1 });
    expect(readIndexLines(await read(root, 'tiers/index.md'))).toHaveLength(1);
    expect(readIndexLines(await read(root, 'finances/index.md'))).toEqual([]);
    const a = readPage('tiers/a', await read(root, 'tiers/a.md'));
    expect(a.ok && a.page.frontmatter.backlinks).toBeUndefined();
    const questions = await read(root, 'open-questions.md');
    expect(questions).toContain("[[tiers/b]] · La page n'a pas pu être lue");
    expect(questions).toContain(`[[${invoice.path}]] · La page a été supprimée à la main`);
    const written = JSON.parse(await read(root, WRITTEN)) as Record<string, Written>;
    expect(written['tiers/b.md']).toBeUndefined();
  });

  it('hears a file saved in the vault', async () => {
    const { root } = await seed();
    const heard = new Promise<string[]>((resolve) => {
      const stop = watchVault(
        root,
        (files) => {
          stop();
          resolve(files);
        },
        50,
      );
    });
    await writeFile(join(root, 'tiers/a.md'), `${await read(root, 'tiers/a.md')}\n`);
    expect(await heard).toContain('tiers/a.md');
  });
});

describe('one writer', () => {
  const holder = { host: 'pc-bureau', pid: process.pid, now: NOW };

  it('refuses a second runner, takes over a lock past its time or left by a dead process', async () => {
    const root = await tempVault();
    const lock = await acquireLock(root, holder);
    await expect(acquireLock(root, { ...holder, host: 'portable' })).rejects.toBeInstanceOf(
      VaultLocked,
    );
    const expired = await acquireLock(root, {
      ...holder,
      host: 'portable',
      now: new Date(NOW.getTime() + 6 * 60_000),
    });
    expect(expired.host).toBe('portable');
    await expect(renewLock(root, lock, holder)).rejects.toBeInstanceOf(VaultLocked);

    const here = { host: hostname(), now: NOW };
    const other = await tempVault();
    const parent = await acquireLock(other, { ...here, pid: process.ppid });
    await expect(acquireLock(other, { ...here, pid: process.pid })).rejects.toBeInstanceOf(
      VaultLocked,
    );
    await releaseLock(other, parent);
    const dead = spawnSync(process.execPath, ['-e', '0']).pid ?? 0;
    await acquireLock(other, { ...here, pid: dead });
    const taken = await acquireLock(other, { ...here, pid: process.pid });
    expect(taken.pid).toBe(process.pid);
    await releaseLock(other, taken);
    expect(await snapshot(other)).toEqual({});
  });

  it('opens the vault, writes one thing after another, and lets it go', async () => {
    const root = await tempVault();
    const vault = await MemoryVault.open(root, {
      host: 'pc-bureau',
      clock: () => NOW,
      sourceExists: () => true,
    });
    await expect(
      MemoryVault.open(root, { host: 'portable', clock: () => NOW }),
    ).rejects.toBeInstanceOf(VaultLocked);
    const [one, two] = await Promise.all([
      vault.compile({ reason: 'ingest', actor: 'agent:test', pages: [tiers('a')] }),
      vault.compile({ reason: 'ingest', actor: 'agent:test', pages: [purchase('f-1', 'a')] }),
    ]);
    expect(one.ok && two.ok).toBe(true);
    await vault.close();
    expect(Object.keys(await snapshot(root))).not.toContain(LOCK);
    expect(await read(root, 'index.md')).toContain('[[tiers/index|');
  });
});

describe('raw/', () => {
  it('keeps each original once, never replaces one, and its text beside it', async () => {
    const root = await tempVault();
    const pdf = new Uint8Array([37, 80, 68, 70]);
    const ref = await addRaw(
      root,
      { name: 'Facture F-114.PDF', bytes: pdf, text: 'Facture F-114' },
      NOW,
    );
    expect(ref).toBe('raw/2026/10/facture-f-114.pdf');
    expect(await addRaw(root, { name: 'Facture F-114.PDF', bytes: pdf }, NOW)).toBe(ref);
    const other = await addRaw(
      root,
      { name: 'facture f-114.pdf', bytes: new Uint8Array([1]) },
      NOW,
    );
    expect(other).toBe('raw/2026/10/facture-f-114-2.pdf');
    expect(await read(root, `${ref}.txt`)).toBe('Facture F-114');
    const page = { ...tiers('a'), frontmatter: { ...tiers('a').frontmatter, sources: [ref] } };
    expect(
      await compile(root, { reason: 'ingest', actor: 'agent:test', pages: [page] }, { now: NOW }),
    ).toMatchObject({ ok: true });
  });
});
