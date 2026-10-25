import { describe, expect, it } from 'vitest';
import { readPage, writePage } from './page';
import { pagePath, slugify } from './slug';
import type { Frontmatter } from './types';

const invoice: Frontmatter = {
  type: 'facture_vente',
  title: 'Facture F-2026-114',
  sources: ['invoice:abc'],
  updated: '2026-10-25',
  number: 'F-2026-114',
  party: 'tiers/hugo-batiment',
  issue_date: '2026-10-21',
  ht: 1_240_000,
  tva: 248_000,
  ttc: 1_488_000,
  links: [{ kind: 'issued_to', to: 'tiers/hugo-batiment', confidence: 'exact', evidence: 'SIREN' }],
  backlinks: [{ kind: 'covers', from: 'finances/situations/2026-hugo_sit-3' }],
};
const path = 'finances/2026/2026-10-21_facture_hugo-batiment_f-2026-114';

describe('a page as a file', () => {
  it('writes amounts as euros, reads them back as cents, and gives the same bytes twice', () => {
    const file = writePage({ path, frontmatter: invoice, text: 'Situation de septembre.' });
    expect(file).toContain('ttc: "14880.00"');
    expect(file).toContain('## Liens');
    expect(file).toContain('[[tiers/hugo-batiment]]');
    const read = readPage(path, file);
    if (!read.ok) throw new Error(read.reason);
    expect(read.page.frontmatter).toEqual(invoice);
    expect(read.page.text).toBe('Situation de septembre.');
    expect(writePage(read.page)).toBe(file);
  });

  it('reads an amount a person typed as a number, and drops what they wrote under « Liens »', () => {
    const file = writePage({ path, frontmatter: invoice, text: 'Texte.' })
      .replace('ttc: "14880.00"', 'ttc: 14880')
      .concat('- une ligne ajoutée à la main\n');
    const read = readPage(path, file);
    if (!read.ok) throw new Error(read.reason);
    expect(read.page.frontmatter.type === 'facture_vente' && read.page.frontmatter.ttc).toBe(
      1_488_000,
    );
    expect(writePage(read.page)).not.toContain('à la main');
  });

  it('says why a page cannot be read', () => {
    expect(readPage(path, 'pas de frontmatter')).toEqual({ ok: false, reason: 'no frontmatter' });
    const bad = writePage({ path, frontmatter: invoice, text: '' }).replace(
      'ttc: "14880.00"',
      'ttc: douze',
    );
    const read = readPage(path, bad);
    expect(read.ok).toBe(false);
    expect(!read.ok && read.reason).toMatch(/^ttc: /);
    expect(readPage(path, '---\ntitle: [\n---\n').ok).toBe(false);
  });
});

describe('page paths', () => {
  it('makes a name every system reads, and the same one twice', () => {
    expect(slugify('Électricité Marc & Fils')).toBe('electricite-marc-fils');
    expect(slugify('Cœur de Ville — Lot 2')).toBe('coeur-de-ville-lot-2');
    expect(slugify('!!!')).toBe('sans-nom');
    expect(slugify('a'.repeat(100))).toHaveLength(60);
  });

  it('puts each page where its type lives, and a second one beside it', () => {
    const { updated: _u, backlinks: _b, ...facts } = invoice;
    expect(pagePath(facts)).toBe(path);
    expect(pagePath(facts, (p) => p === path)).toBe(`${path}-2`);
    expect(
      pagePath({
        type: 'situation',
        title: 'Situation 3',
        sources: ['sheet:1'],
        chantier: 'chantiers/2026-hugo',
        number: 3,
        cumul_ht: 3_000_000,
      }),
    ).toBe('finances/situations/2026-hugo_sit-3');
    expect(
      pagePath({
        type: 'attestation_vigilance',
        title: 'Attestation URSSAF',
        sources: ['document:1'],
        party: 'tiers/marc-elec',
        valid_from: '2026-10-01',
        valid_to: '2027-03-31',
      }),
    ).toBe('juridique/marc-elec/attestation-vigilance_2026-10-01');
  });
});
