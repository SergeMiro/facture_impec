import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compile, type MemoryPatch } from './compile';
import { readPage } from './page';
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

const patch = (pages: MemoryPatch['pages'], extra: Partial<MemoryPatch> = {}): MemoryPatch => ({
  reason: 'ingest',
  actor: 'agent:ingest',
  pages,
  ...extra,
});

const invoice = purchase('f-114', 'marc-elec');

describe('compile', () => {
  it('writes the pages, their links both ways, the indexes, the log and what it wrote', async () => {
    const root = await tempVault();
    const done = await compile(root, patch([tiers('marc-elec'), invoice]), options());
    expect(done).toEqual({ ok: true, written: ['tiers/marc-elec', invoice.path] });

    const company = readPage('tiers/marc-elec', await read(root, 'tiers/marc-elec.md'));
    expect(company.ok && company.page.frontmatter.backlinks).toEqual([
      { kind: 'issued_by', from: invoice.path },
    ]);
    expect(await read(root, 'tiers/marc-elec.md')).toContain(`[[${invoice.path}]]`);
    expect(await read(root, 'tiers/index.md')).toContain(
      '[[tiers/marc-elec|Entreprise marc-elec]]',
    );
    expect(await read(root, 'finances/index.md')).toMatch(
      /12\s000,00\s€ TTC, échéance le 20\/11\/2026/,
    );
    expect(await read(root, 'index.md')).toMatch(/\[\[finances\/index\|.*\(1 page\(s\)\)/);
    expect(await read(root, 'log.md')).toMatch(
      /2026-10-25 11:00 · document lu · agent:ingest · tiers\/marc-elec, finances/,
    );
    const written = JSON.parse(await read(root, WRITTEN)) as Record<string, Written>;
    expect(Object.keys(written)).toEqual([`${invoice.path}.md`, 'tiers/marc-elec.md']);
  });

  it('writes nothing for a patch that changes nothing', async () => {
    const root = await tempVault();
    await compile(root, patch([tiers('marc-elec'), invoice]), options());
    const before = await snapshot(root);
    expect(await compile(root, patch([tiers('marc-elec'), invoice]), options(LATER))).toEqual({
      ok: true,
      written: [],
    });
    expect(await snapshot(root)).toEqual(before);
  });

  it('refuses the whole patch for one bad page, and writes nothing', async () => {
    const root = await tempVault();
    const bad = tiers('dupont', {});
    bad.frontmatter = { ...bad.frontmatter, type: 'tiers', roles: ['client'], siren: '12345' };
    const done = await compile(root, patch([tiers('marc-elec'), bad]), options());
    expect(done).toMatchObject({ ok: false, code: 'invalid' });
    expect(await snapshot(root)).toEqual({});
  });

  it('refuses a page in the wrong folder, rh/ while it is off, a missing source, a link to nothing', async () => {
    const root = await tempVault();
    const misplaced = { ...invoice, path: 'tiers/f-114' };
    expect(await compile(root, patch([misplaced]), options())).toMatchObject({ code: 'section' });
    const person = {
      path: 'rh/jean',
      frontmatter: {
        type: 'salarie' as const,
        title: 'Jean',
        sources: ['user:1'],
        contract: 'cdi' as const,
        start: '2024-01-01',
      },
    };
    expect(await compile(root, patch([person]), options())).toMatchObject({ code: 'section' });
    expect(await compile(root, patch([person]), { ...options(), rh: true })).toMatchObject({
      ok: true,
    });
    const noSource = await compile(root, patch([tiers('a', {})]), { now: NOW });
    expect(noSource).toMatchObject({ code: 'source' });
    const raw = {
      ...tiers('b'),
      frontmatter: { ...tiers('b').frontmatter, sources: ['raw/2026/10/x.pdf'] },
    };
    expect(await compile(root, patch([raw]), options())).toMatchObject({ code: 'source' });
    expect(await compile(root, patch([invoice]), options())).toMatchObject({ code: 'link' });
  });

  it('takes a link away from its target when the page drops it', async () => {
    const root = await tempVault();
    await compile(root, patch([tiers('marc-elec'), invoice]), options());
    const unlinked = { ...invoice, frontmatter: { ...invoice.frontmatter, links: [] } };
    await compile(root, patch([unlinked]), options(LATER));
    const company = readPage('tiers/marc-elec', await read(root, 'tiers/marc-elec.md'));
    expect(company.ok && company.page.frontmatter.backlinks).toBeUndefined();
  });
});

describe("a person's edit wins", () => {
  it('leaves a page a person edited a minute ago as it is, and asks instead', async () => {
    const root = await tempVault();
    await compile(root, patch([tiers('marc-elec')]), options());
    const edited = (await read(root, 'tiers/marc-elec.md')).replace(
      'roles:',
      'erp_ref: M-1\nroles:',
    );
    await writeFile(join(root, 'tiers/marc-elec.md'), edited);
    await touch(root, 'tiers/marc-elec.md', new Date(LATER.getTime() - 20_000));

    const done = await compile(
      root,
      patch([tiers('marc-elec', { append: 'Nouveau RIB.' })]),
      options(LATER),
    );
    expect(done).toMatchObject({ ok: false, code: 'conflict' });
    expect(await read(root, 'tiers/marc-elec.md')).toBe(edited);
    expect(await read(root, 'open-questions.md')).toMatch(
      /- \[ \] 25\/10\/2026 · \[\[tiers\/marc-elec\]\] · Une mise à jour/,
    );
    expect(await read(root, 'log.md')).toContain('edited by a person');
  });

  it('never replaces the text a person wrote; adds to it once they are done', async () => {
    const root = await tempVault();
    await compile(root, patch([tiers('marc-elec', { text: 'Fiche créée.' })]), options());
    const edited = (await read(root, 'tiers/marc-elec.md')).replace(
      'Fiche créée.',
      'Payer par virement.',
    );
    await writeFile(join(root, 'tiers/marc-elec.md'), edited);
    await touch(root, 'tiers/marc-elec.md', NOW);

    const replace = tiers('marc-elec', { text: 'Fiche refaite.' });
    expect(await compile(root, patch([replace]), options(LATER))).toMatchObject({
      code: 'conflict',
    });
    const add = tiers('marc-elec', { append: 'RIB changé le 25/10 (facture F-114).' });
    expect(await compile(root, patch([add]), options(LATER))).toMatchObject({ ok: true });
    const page = readPage('tiers/marc-elec', await read(root, 'tiers/marc-elec.md'));
    expect(page.ok && page.page.text).toBe(
      'Payer par virement.\n\nRIB changé le 25/10 (facture F-114).',
    );
    const written = JSON.parse(await read(root, WRITTEN)) as Record<string, Written>;
    expect(written['tiers/marc-elec.md']).toMatchObject({
      person: true,
      edited: NOW.toISOString(),
    });
    expect(await compile(root, patch([replace]), options(LATER))).toMatchObject({
      code: 'conflict',
    });
  });
});
