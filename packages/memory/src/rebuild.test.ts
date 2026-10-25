import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile, type PageWrite } from './compile';
import { readIndexLines, renderSchema } from './indexes';
import { readPage } from './page';
import { copyOf, rebuild, VaultTooNew } from './rebuild';
import { LATER, NOW, options, purchase, read, snapshot, tempVault, tiers } from './test-helpers';

const put = async (root: string, file: string, text: string) => {
  await mkdir(dirname(join(root, file)), { recursive: true });
  await writeFile(join(root, file), text);
};

describe('rebuild', () => {
  it('reads 1 000 pages again in well under a minute, and gives the same vault', async () => {
    const root = await tempVault();
    const companies = Array.from({ length: 50 }, (_, i) => tiers(`t-${i}`));
    const invoices: PageWrite[] = Array.from({ length: 950 }, (_, i) =>
      purchase(`f-${i}`, `t-${i % 50}`),
    );
    expect(
      await compile(
        root,
        { reason: 'ingest', actor: 'agent:test', pages: [...companies, ...invoices] },
        options(),
      ),
    ).toMatchObject({ ok: true });
    const before = await snapshot(root);
    await rm(join(root, 'tiers/index.md'));
    await rm(join(root, 'finances/index.md'));
    await rm(join(root, 'index.md'));

    const started = performance.now();
    const done = await rebuild(root, { now: LATER });
    const seconds = (performance.now() - started) / 1000;
    expect(seconds).toBeLessThan(60);
    expect(done).toEqual({ pages: 1000, invalid: [], copies: [], relinked: 0 });
    const after = await snapshot(root);
    for (const file of ['tiers/index.md', 'finances/index.md', 'index.md']) {
      expect(after[file]).toBe(before[file]);
    }
    expect(readIndexLines(after['finances/index.md'] ?? '')).toHaveLength(950);
    expect(after['_schema.md']).toBe(renderSchema());
    console.info(`rebuild of 1 000 pages: ${seconds.toFixed(2)} s`);
  }, 120_000);

  it('leaves out of the index a page that cannot be read, a misnamed one, one in the wrong folder', async () => {
    const root = await tempVault();
    await compile(
      root,
      { reason: 'ingest', actor: 'agent:test', pages: [tiers('a'), tiers('b')] },
      options(),
    );
    const b = await read(root, 'tiers/b.md');
    await put(root, 'tiers/b.md', b.replace('roles:', 'siren: douze\nroles:'));
    await put(root, 'tiers/Mon Fichier.md', b);
    await put(root, 'catalogue/c.md', b.replace('tiers/b', 'catalogue/c'));

    const done = await rebuild(root, { now: LATER });
    expect(done.pages).toBe(1);
    expect(done.invalid.sort()).toEqual(['catalogue/c.md', 'tiers/Mon Fichier.md', 'tiers/b.md']);
    expect(readIndexLines(await read(root, 'tiers/index.md'))).toHaveLength(1);
    const questions = await read(root, 'open-questions.md');
    expect(questions).toContain("[[tiers/b]] · La page n'a pas pu être lue (siren:");
    expect(questions).toContain("n'a pas un nom de page (tiers/Mon Fichier.md)");
    expect(questions).toContain('[[catalogue/c]] · Cette page est une page « Entreprise »');
    // Asked once: a second rebuild finds the same questions open.
    await rebuild(root, { now: LATER });
    expect(await read(root, 'open-questions.md')).toBe(questions);
  });

  it('sets a synchronisation conflict copy aside', async () => {
    expect(copyOf('tiers/marc-elec (1)')).toBe('tiers/marc-elec');
    expect(copyOf('tiers/marc-elec (conflicted copy 2026-10-25)')).toBe('tiers/marc-elec');
    expect(copyOf('tiers/marc-elec')).toBeNull();
    const root = await tempVault();
    await compile(
      root,
      { reason: 'ingest', actor: 'agent:test', pages: [tiers('marc-elec')] },
      options(),
    );
    const page = await read(root, 'tiers/marc-elec.md');
    await put(root, 'tiers/marc-elec (1).md', page.replace('Entreprise marc-elec', 'Autre'));

    expect(await rebuild(root, { now: LATER })).toMatchObject({
      pages: 1,
      copies: ['tiers/marc-elec (1).md'],
    });
    const files = await snapshot(root);
    expect(files['tiers/marc-elec (1).md']).toBeUndefined();
    expect(files['_conflicts/2026-10-25/tiers/marc-elec (1).md']).toContain('title: Autre');
    expect(files['open-questions.md']).toContain('[[tiers/marc-elec]] · Une copie en conflit');
  });

  it('writes the backlinks again from the links a person changed, and reads their edit', async () => {
    const root = await tempVault();
    const invoice = purchase('f-1', 'a');
    await compile(
      root,
      { reason: 'ingest', actor: 'agent:test', pages: [tiers('a'), tiers('b'), invoice] },
      options(),
    );
    const file = `${invoice.path}.md`;
    await put(root, file, (await read(root, file)).replace('to: tiers/a', 'to: tiers/b'));

    expect(await rebuild(root, { now: LATER })).toMatchObject({ relinked: 2 });
    const a = readPage('tiers/a', await read(root, 'tiers/a.md'));
    const b = readPage('tiers/b', await read(root, 'tiers/b.md'));
    expect(a.ok && a.page.frontmatter.backlinks).toBeUndefined();
    expect(b.ok && b.page.frontmatter.backlinks).toEqual([
      { kind: 'issued_by', from: invoice.path },
    ]);
    const written = JSON.parse(await read(root, '_system/written.json'));
    expect(written[file]).toMatchObject({ person: true });
    expect(await read(root, 'log.md')).toContain(
      'index refait · system · — · 3 page(s) lue(s), 0 hors',
    );
  });

  it('asks about a link to a page that does not exist', async () => {
    const root = await tempVault();
    const invoice = purchase('f-1', 'a');
    await compile(
      root,
      { reason: 'ingest', actor: 'agent:test', pages: [tiers('a'), invoice] },
      options(),
    );
    await rm(join(root, 'tiers/a.md'));
    await rebuild(root, { now: LATER });
    expect(await read(root, 'open-questions.md')).toContain('renvoie vers [[tiers/a]], qui n');
    expect(readIndexLines(await read(root, 'tiers/index.md'))).toEqual([]);
  });

  it('refuses a vault written by a newer schema', async () => {
    const root = await tempVault();
    await put(root, '_schema.md', '<!-- memory-schema-version: 99 -->\n');
    await expect(rebuild(root, { now: NOW })).rejects.toBeInstanceOf(VaultTooNew);
  });
});
