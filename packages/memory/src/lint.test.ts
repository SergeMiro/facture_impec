import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lintLinks } from './lint';
import { type Page, readPage } from './page';
import { pageFiles } from './rebuild';
import type { Link } from './types';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/vault-demo/vault', import.meta.url));

const demoPages = async () => {
  const pages: Page[] = [];
  for (const file of await pageFiles(FIXTURE)) {
    const read = readPage(file.replace(/\.md$/, ''), await readFile(join(FIXTURE, file), 'utf8'));
    if (!read.ok) throw new Error(`${file}: ${read.reason}`);
    pages.push(read.page);
  }
  return pages;
};

describe('the lint of the links', () => {
  it('finds nothing in the demo vault', async () => {
    expect(lintLinks(await demoPages())).toEqual([]);
  });

  it('finds each planted defect, and nothing else', async () => {
    const pages = await demoPages();
    const at = new Map(pages.map((p) => [p.path, p]));
    const page = (path: string) => at.get(path) as Page;
    const ofType = (type: Page['frontmatter']['type']) =>
      pages.filter((p) => p.frontmatter.type === type);
    const link = (p: Page, l: Link) => {
      p.frontmatter.links = [...(p.frontmatter.links ?? []), l];
    };
    const backlink = (p: Page, kind: Link['kind'], from: string) => {
      p.frontmatter.backlinks = [...(p.frontmatter.backlinks ?? []), { kind, from }];
    };
    const sales = ofType('facture_vente');
    const d = sales.find((p) => p.frontmatter.links?.some((l) => l.rule === 'chantier'));
    const [a, b, c, e] = sales.filter((p) => p !== d);
    const [chantier] = ofType('chantier');
    const [quiet] = ofType('attestation_vigilance');
    if (!a || !b || !c || !d || !e || !quiet || !chantier) throw new Error('demo vault');

    // A backlink taken away from a link's target.
    const [shown] = a.frontmatter.links ?? [];
    if (!shown) throw new Error('demo vault');
    const target = page(shown.to);
    target.frontmatter.backlinks = target.frontmatter.backlinks?.filter(
      (x) => !(x.kind === shown.kind && x.from === a.path),
    );
    // A backlink no link makes.
    backlink(quiet, 'mentioned_in', b.path);
    // A link to a page that is not there.
    link(c, {
      kind: 'belongs_to',
      to: 'chantiers/2026-nulle-part',
      confidence: 'exact',
      evidence: 'Chantier du document (champ « chantier »)',
      rule: 'chantier',
    });
    // A rule's link whose fact is gone: the invoice's chantier field taken away.
    const site = (d.frontmatter.links ?? []).find((l) => l.rule === 'chantier');
    if (!site || d.frontmatter.type !== 'facture_vente') throw new Error('demo vault');
    delete d.frontmatter.chantier;
    // A guess whose quote is not in its page, and a sure link nobody accounts for.
    link(e, {
      kind: 'mentioned_in',
      to: quiet.path,
      confidence: 'inferred',
      evidence: '« Une phrase que la page ne dit pas. »',
    });
    link(e, {
      kind: 'mentioned_in',
      to: chantier.path,
      confidence: 'strong',
      evidence: 'Vu au téléphone',
    });
    backlink(quiet, 'mentioned_in', e.path);
    backlink(chantier, 'mentioned_in', e.path);

    const found = lintLinks(pages).map((f) => `${f.code} ${f.page} ${f.side} ${f.kind} ${f.other}`);
    expect(found.toSorted()).toEqual(
      [
        `one_sided ${a.path} link ${shown.kind} ${shown.to}`,
        `one_sided ${quiet.path} backlink mentioned_in ${b.path}`,
        `dangling ${c.path} link belongs_to chantiers/2026-nulle-part`,
        `stale ${d.path} link belongs_to ${site.to}`,
        `unsourced ${e.path} link mentioned_in ${quiet.path}`,
        `unsourced ${e.path} link mentioned_in ${chantier.path}`,
      ].toSorted(),
    );
  });
});
