// Memory M5 « done when »: the lint finds nothing in the demo vault, and the 20 defects planted in a
// copy of it, each where it was planted; then what a person approves is mended.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays } from '@fi/core';
import { describe, expect, it } from 'vitest';
import type { PageFacts, PageWrite } from './compile';
import { addQuestions, countQuestions, readIndexLines, sectionIndex } from './indexes';
import { walk } from './journal';
import { type LintInput, lintMemory, type MemoryFinding } from './lint';
import { type Page, readPage, writePage } from './page';
import { pageFiles } from './rebuild';
import { pagePath } from './slug';
import { NOW, read, tempVault } from './test-helpers';
import { Frontmatter, SECTIONS, type Section } from './types';
import { MemoryVault } from './writer';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/vault-demo/vault', import.meta.url));
const TODAY = '2026-10-25';
const OWN = '999999990';

async function pagesOf(root: string): Promise<Page[]> {
  const pages: Page[] = [];
  for (const file of await pageFiles(root)) {
    const path = file.replace(/\.md$/, '');
    const got = readPage(path, await readFile(join(root, file), 'utf8'));
    if (!got.ok) throw new Error(`${file}: ${got.reason}`);
    pages.push(got.page);
  }
  return pages;
}

async function inputOf(root: string): Promise<LintInput> {
  const indexes = {} as Record<Section, string | null>;
  for (const s of SECTIONS) {
    indexes[s] = await readFile(join(root, sectionIndex(s)), 'utf8').catch(() => null);
  }
  const raw = new Set(await walk(root, join(root, 'raw')));
  return { pages: await pagesOf(root), indexes, raw, today: TODAY };
}

/** The deadlines a company following all of them has: what the lint asks for, on a clean vault. */
const deadlinesOf = (input: LintInput) =>
  new Set(
    lintMemory({ ...input, deadlines: { own: OWN, keys: new Set() } })
      .filter((f) => f.code === 'no_deadline')
      .map((f) => f.detail),
  );

const said = (f: MemoryFinding) => `${f.code} ${f.page} ${f.detail}`;

describe('the lint of the whole memory', () => {
  it('finds nothing in the demo vault, which follows the deadlines it should', async () => {
    const input = await inputOf(FIXTURE);
    const keys = deadlinesOf(input);
    expect(keys.size).toBeGreaterThan(10);
    expect(lintMemory({ ...input, deadlines: { own: OWN, keys }, recalls: [] })).toEqual([]);
  });

  it('finds the 20 defects planted in a copy of the demo vault, where they were planted', {
    timeout: 60_000,
  }, async () => {
    const root = await tempVault();
    await cp(FIXTURE, root, { recursive: true });
    const clean = await inputOf(root);
    const keys = deadlinesOf(clean);
    const pages = clean.pages;
    const ofType = <T extends Frontmatter['type']>(type: T) =>
      pages
        .filter((p) => p.frontmatter.type === type)
        .map((p) => p as Page & { frontmatter: Extract<Frontmatter, { type: T }> });
    const pick = <T>(list: readonly T[], test: (x: T) => boolean, what: string): T => {
      const found = list.find(test);
      if (!found) throw new Error(`the demo vault has no ${what}`);
      return found;
    };
    const used = new Set<string>();
    const fresh = <T extends Page>(list: readonly T[], test: (x: T) => boolean, what: string) => {
      const p = pick(list, (x) => !used.has(x.path) && test(x), what);
      used.add(p.path);
      return p;
    };
    const edit = async (path: string, change: (p: Page) => void) => {
      const file = join(root, `${path}.md`);
      const got = readPage(path, await readFile(file, 'utf8'));
      if (!got.ok) throw new Error(got.reason);
      change(got.page);
      await writeFile(file, writePage(got.page));
    };
    const expected: string[] = [];
    const plant = (code: string, page: string, detail: string) =>
      expected.push(`${code} ${page} ${detail}`);

    const sales = ofType('facture_vente');
    const purchases = ofType('facture_achat');
    const tiers = ofType('tiers');

    // 1. A link its target does not show back.
    const target = fresh(tiers, (p) => (p.frontmatter.backlinks?.length ?? 0) > 0, 'backlink');
    const gone = target.frontmatter.backlinks?.[0] as { kind: string; from: string };
    await edit(target.path, (p) => {
      p.frontmatter.backlinks = p.frontmatter.backlinks?.slice(1);
    });
    used.add(gone.from);
    plant('one_sided', gone.from, `link ${gone.kind} ${target.path}`);

    // 2. A backlink no link makes.
    const shown = fresh(tiers, () => true, 'tiers');
    const stranger = fresh(sales, () => true, 'sale');
    await edit(shown.path, (p) => {
      p.frontmatter.backlinks = [
        ...(p.frontmatter.backlinks ?? []),
        { kind: 'mentioned_in', from: stranger.path },
      ];
    });
    plant('one_sided', shown.path, `backlink mentioned_in ${stranger.path}`);

    // 3. A link to a page that is not there.
    const lost = fresh(purchases, () => true, 'purchase');
    await edit(lost.path, (p) => {
      p.frontmatter.links = [
        ...(p.frontmatter.links ?? []),
        {
          kind: 'mentioned_in',
          to: 'tiers/n-existe-pas',
          confidence: 'inferred',
          evidence: '« ailleurs »',
        },
      ];
    });
    plant('dangling', lost.path, 'link mentioned_in tiers/n-existe-pas');

    // 4. A rule's link whose fact is gone.
    const moved = fresh(
      purchases,
      (p) =>
        !!p.frontmatter.project_ref && !!p.frontmatter.links?.some((l) => l.rule === 'project_ref'),
      'purchase with a chantier reference',
    );
    const siteLink = moved.frontmatter.links?.find((l) => l.rule === 'project_ref');
    await edit(moved.path, (p) => {
      (p.frontmatter as { project_ref?: string }).project_ref = 'CH-9999-99';
    });
    plant('stale', moved.path, `link belongs_to ${siteLink?.to}`);

    // 5. A guessed link whose quote is not in its page (its target shows it back).
    const guessing = fresh(purchases, () => true, 'purchase');
    const guessed = fresh(tiers, () => true, 'tiers');
    await edit(guessing.path, (p) => {
      p.frontmatter.links = [
        ...(p.frontmatter.links ?? []),
        {
          kind: 'mentioned_in',
          to: guessed.path,
          confidence: 'inferred',
          evidence: '« une phrase que la page ne contient pas »',
        },
      ];
    });
    await edit(guessed.path, (p) => {
      p.frontmatter.backlinks = [
        ...(p.frontmatter.backlinks ?? []),
        { kind: 'mentioned_in', from: guessing.path },
      ];
    });
    plant('unsourced', guessing.path, `link mentioned_in ${guessed.path}`);

    // 6. HT + TVA ≠ TTC.
    const wrongSum = fresh(sales, () => true, 'sale');
    await edit(wrongSum.path, (p) => {
      (p.frontmatter as { ttc: number }).ttc += 100;
    });
    plant('contradiction', wrongSum.path, 'amounts');

    // 7. Lines that do not add up to HT.
    const wrongLines = fresh(purchases, (p) => (p.frontmatter.lines?.length ?? 0) > 0, 'lines');
    await edit(wrongLines.path, (p) => {
      const line = (p.frontmatter as { lines: { amount: number }[] }).lines[0];
      if (line) line.amount += 100;
    });
    plant('contradiction', wrongLines.path, 'lines');

    // 8. Due before issued.
    const early = fresh(purchases, (p) => !!p.frontmatter.due_date, 'due date');
    await edit(early.path, (p) => {
      const f = p.frontmatter as { issue_date: string; due_date?: string };
      f.due_date = addDays(f.issue_date, -1);
    });
    plant('contradiction', early.path, 'dates due_date');

    // 9. Paid before issued.
    const paid = fresh(sales, (p) => !!p.frontmatter.paid_at, 'paid sale');
    await edit(paid.path, (p) => {
      const f = p.frontmatter as { issue_date: string; paid_at?: string };
      f.paid_at = addDays(f.issue_date, -3);
    });
    plant('contradiction', paid.path, 'dates paid_at');

    // 10. Valid until before valid from.
    const standing = fresh(ofType('attestation_assurance_decennale'), () => true, 'insurance');
    await edit(standing.path, (p) => {
      const f = p.frontmatter as { valid_from: string; valid_to: string };
      f.valid_to = addDays(f.valid_from, -1);
    });
    plant('contradiction', standing.path, 'dates valid_to');

    // 11. A situation whose cumul goes down.
    const situations = ofType('situation');
    const third = fresh(
      situations,
      (s) =>
        s.frontmatter.number === 3 &&
        situations.some(
          (x) => x.frontmatter.chantier === s.frontmatter.chantier && x.frontmatter.number === 2,
        ),
      'third situation',
    );
    const second = pick(
      situations,
      (s) => s.frontmatter.chantier === third.frontmatter.chantier && s.frontmatter.number === 2,
      'second situation',
    );
    await edit(third.path, (p) => {
      (p.frontmatter as { cumul_ht: number }).cumul_ht = second.frontmatter.cumul_ht - 100;
    });
    plant('contradiction', third.path, `cumul ${second.path}`);

    // 12. Two pages of one document that disagree.
    const twin = fresh(
      purchases,
      (p) =>
        purchases.some(
          (o) =>
            o !== p &&
            !used.has(o.path) &&
            o.frontmatter.party === p.frontmatter.party &&
            o.frontmatter.ttc !== p.frontmatter.ttc,
        ),
      'two purchases from one supplier',
    );
    const original = fresh(
      purchases,
      (o) =>
        o.frontmatter.party === twin.frontmatter.party &&
        o.frontmatter.ttc !== twin.frontmatter.ttc,
      'its sibling',
    );
    await edit(twin.path, (p) => {
      (p.frontmatter as { number: string }).number = original.frontmatter.number;
    });
    plant('contradiction', twin.path, `duplicate ${original.path}`);
    plant('contradiction', original.path, `duplicate ${twin.path}`);

    // 13. An amount in the text that is none of the page's.
    const talker = fresh(purchases, () => true, 'purchase');
    await edit(talker.path, (p) => {
      p.text = `${p.text}\n\nMontant total : 1 234,56 € TTC.`;
    });
    plant('contradiction', talker.path, 'text 123456');

    // 14. A `raw/` source gone.
    const sourced = fresh(
      purchases,
      (p) => p.frontmatter.sources.some((s) => s.startsWith('raw/')),
      'raw source',
    );
    await edit(sourced.path, (p) => {
      p.frontmatter.sources = p.frontmatter.sources.map((s) =>
        s.startsWith('raw/') ? 'raw/2026/01/disparu.eml' : s,
      );
    });
    plant('missing_source', sourced.path, 'raw/2026/01/disparu.eml');

    // 15. A line missing from the finances index.
    const financeIndex = join(root, sectionIndex('finances'));
    const lines = readIndexLines(await readFile(financeIndex, 'utf8'));
    await writeFile(
      financeIndex,
      (await readFile(financeIndex, 'utf8')).replace(`${lines[0]}\n`, ''),
    );
    plant('stale_index', 'finances/index.md', 'finances');

    // 16. A catalogue index that shows an old price.
    const article = fresh(
      ofType('article'),
      (a) => a.frontmatter.last_price !== undefined,
      'price',
    );
    await edit(article.path, (p) => {
      (p.frontmatter as { last_price: number }).last_price += 100;
    });
    plant('stale_index', 'catalogue/index.md', 'catalogue');

    // 17. An attestation filed by hand for a company, its deadline not followed.
    const filer = fresh(
      tiers,
      (p) =>
        !!p.frontmatter.siren &&
        !keys.has(`attestation_vigilance_renouvellement:${p.frontmatter.siren}`),
      'company without an attestation',
    );
    const filed = `juridique/${filer.path.split('/')[1]}/attestation-vigilance_2026-10-01`;
    await mkdir(join(root, filed, '..'), { recursive: true });
    await writeFile(
      join(root, `${filed}.md`),
      writePage({
        path: filed,
        frontmatter: Frontmatter.parse({
          type: 'attestation_vigilance',
          title: `Attestation de vigilance ${filer.frontmatter.title}`,
          sources: ['user:marc'],
          updated: TODAY,
          party: filer.path,
          valid_from: '2026-10-01',
          valid_to: '2027-03-31',
        }),
        text: '',
      }),
    );
    plant('no_deadline', filed, `attestation_vigilance_renouvellement:${filer.frontmatter.siren}`);

    // 18. A sale whose deadline is followed under another number.
    const renamed = fresh(
      sales,
      (s) => !s.frontmatter.paid_at && !!s.frontmatter.due_date,
      'unpaid sale',
    );
    await edit(renamed.path, (p) => {
      (p.frontmatter as { number: string }).number = 'F-2026-999';
    });
    plant('no_deadline', renamed.path, `facture_echeance:${OWN}:F-2026-999`);

    // 19. A page recall found three times only in the whole text.
    const deep = fresh(ofType('chantier'), () => true, 'chantier');
    const shallow = fresh(tiers, () => true, 'tiers');
    const recalls = [
      { level: 4, found: [deep.path] },
      { level: 5, found: [deep.path, deep.path] },
      { level: 4, found: [deep.path, shallow.path] },
      { level: 3, found: [shallow.path] },
      { level: 3, found: [shallow.path] },
      { level: 4, found: ['tiers/n-existe-pas'] },
      { level: 4, found: ['tiers/n-existe-pas'] },
      { level: 4, found: ['tiers/n-existe-pas'] },
    ];
    plant('misplaced', deep.path, 'recall');

    // 20. A réception before the start.
    const site = fresh(ofType('chantier'), (c) => !!c.frontmatter.start, 'chantier with a start');
    await edit(site.path, (p) => {
      const f = p.frontmatter as { start: string; reception_date?: string };
      f.reception_date = addDays(f.start, -1);
    });
    plant('contradiction', site.path, 'dates reception_date');

    const found = lintMemory({
      ...(await inputOf(root)),
      deadlines: { own: OWN, keys },
      recalls,
    });
    const got = found.map(said);
    expect(new Set(expected).size).toBe(21); // 20 defects, the duplicate seen from both pages
    for (const e of expected) expect(got).toContain(e);
    // Nothing else, except the indexes of the sections whose shown facts changed.
    const extra = got.filter((g) => !expected.includes(g));
    expect(extra).toEqual(['stale_index juridique/index.md juridique']);
    for (const f of found) expect(f.text).not.toMatch(/\{\w+\}/);
    expect(found.find((f) => f.code === 'dangling')).toMatchObject({
      fix: 'drop_link',
      link: { kind: 'mentioned_in', to: 'tiers/n-existe-pas' },
    });
    expect(new Set(found.filter((f) => f.code === 'one_sided').map((f) => f.fix))).toEqual(
      new Set(['reindex']),
    );
  });
});

describe('mending what a person approved', () => {
  const write = (frontmatter: PageFacts): PageWrite => ({
    path: pagePath(frontmatter),
    frontmatter,
  });
  const client = write({
    type: 'tiers',
    title: 'Client Dupont',
    sources: ['erp:t-1'],
    roles: ['client'],
  });
  const sale = write({
    type: 'facture_vente',
    title: 'Facture F-1',
    sources: ['invoice:F-1'],
    number: 'F-1',
    party: client.path,
    issue_date: '2026-10-20',
    ht: 100_000,
    tva: 20_000,
    ttc: 120_000,
    links: [
      {
        kind: 'mentioned_in',
        to: client.path,
        confidence: 'strong',
        evidence: 'dit par une personne',
      },
    ],
  });
  const finding = (fields: Partial<MemoryFinding>): MemoryFinding => ({
    code: 'dangling',
    page: sale.path,
    detail: `link mentioned_in ${client.path}`,
    fix: 'drop_link',
    link: { kind: 'mentioned_in', to: client.path },
    text: 'Le lien mène à une page qui n’existe pas.',
    ...fields,
  });

  it('counts the open questions and the blocking ones', () => {
    const file = addQuestions(null, [
      { date: TODAY, entity: 'tiers/a', text: 'Qui ?' },
      { date: TODAY, text: 'Quoi ?', blocking: true },
    ]);
    expect(countQuestions(file)).toEqual({ open: 2, blocking: 1 });
    expect(countQuestions(file.replace('- [ ] ', '- [x] '))).toEqual({ open: 1, blocking: 1 });
    expect(countQuestions(null)).toEqual({ open: 0, blocking: 0 });
  });

  it('drops a link, relinks, rebuilds and asks; only for a person', async () => {
    const root = await tempVault();
    const vault = await MemoryVault.open(root, {
      host: 'test',
      clock: () => NOW,
      sourceExists: () => true,
    });
    const made = await vault.compile({
      reason: 'ingest',
      actor: 'agent:test',
      pages: [client, sale],
    });
    expect(made.ok).toBe(true);

    await expect(vault.fix(finding({}), 'agent:lint')).rejects.toThrow('only a person');
    expect(await vault.fix(finding({}), 'user:marc')).toBe(true);
    expect(await read(root, `${sale.path}.md`)).not.toContain('mentioned_in');
    expect(await vault.fix(finding({}), 'user:marc')).toBe(false);
    expect(await vault.fix(finding({ page: 'finances/absent' }), 'user:marc')).toBe(false);

    expect(await vault.fix(finding({ fix: 'relink' }), 'user:marc')).toBe(true);
    expect(await vault.fix(finding({ fix: 'relink', page: 'finances/absent' }), 'user:marc')).toBe(
      false,
    );
    expect(await vault.fix(finding({ fix: 'reindex' }), 'user:marc')).toBe(true);

    const question = finding({ fix: 'question', text: 'Les montants ne concordent pas.' });
    expect(await vault.fix(question, 'user:marc')).toBe(true);
    await vault.ask([
      finding({ fix: 'reindex', page: 'finances/index.md', text: 'Index à refaire.' }),
    ]);
    const questions = await read(root, 'open-questions.md');
    expect(questions).toContain(`[[${sale.path}]] · Les montants ne concordent pas.`);
    expect(questions).toContain('mémoire · Index à refaire.');
    expect(await vault.questions()).toEqual({ open: 2, blocking: 0 });

    expect(await vault.lint()).toEqual([]);
    const due = await vault.lint({ deadlines: { own: OWN, keys: new Set() } });
    expect(due).toEqual([]); // no due date: nothing to follow
    await vault.close();
  });
});
