import { describe, expect, it } from 'vitest';
import type { PageFacts, PageWrite } from './compile';
import { readPage } from './page';
import { pagePath } from './slug';
import { NOW, purchase, read, tempVault, tiers } from './test-helpers';
import type { Link } from './types';
import { MemoryVault } from './writer';

const write = (frontmatter: PageFacts, text?: string): PageWrite => ({
  path: pagePath(frontmatter),
  frontmatter,
  ...(text !== undefined && { text }),
});

const client = write({
  type: 'tiers',
  title: 'Client Dupont',
  sources: ['erp:tiers-2'],
  roles: ['client'],
});
const party = client.path;

const quote = (number: string, ht: number, date: string) =>
  write({
    type: 'devis',
    title: `Devis ${number}`,
    sources: [`document:devis-${number}`],
    number,
    party,
    date,
    status: 'accepte',
    ht,
  });

const sale = (number: string, ht: number, text?: string) =>
  write(
    {
      type: 'facture_vente',
      title: `Facture ${number}`,
      sources: [`invoice:${number}`],
      number,
      party,
      issue_date: '2026-10-20',
      ht,
      tva: ht / 5,
      ttc: (ht * 6) / 5,
    },
    text,
  );

const open = async (pages: PageWrite[]) => {
  const vault = await MemoryVault.open(await tempVault(), {
    host: 'test',
    clock: () => NOW,
    sourceExists: () => true,
  });
  const made = await vault.compile({ reason: 'ingest', actor: 'agent:test', pages });
  if (!made.ok) throw new Error(made.detail);
  return vault;
};

const linksAt = async (vault: MemoryVault, path: string) => {
  const read_ = readPage(path, await read(vault.root, `${path}.md`));
  if (!read_.ok) throw new Error(read_.reason);
  return read_.page.frontmatter;
};

const fulfils = async (vault: MemoryVault, path: string): Promise<Link[]> =>
  ((await linksAt(vault, path)).links ?? []).filter((l) => l.kind === 'fulfils');

describe('links found by the rules', () => {
  it('ties an invoice to its order once the order is filed, and shows it back on the order', async () => {
    const invoice = purchase('f-1', 'a');
    const facts = invoice.frontmatter;
    if (facts.type !== 'facture_achat') throw new Error('a purchase');
    const vault = await open([
      tiers('a'),
      { ...invoice, frontmatter: { ...facts, order_ref: 'BC-7' } },
    ]);
    expect(await fulfils(vault, invoice.path)).toEqual([]);

    const order = write({
      type: 'commande',
      title: 'Commande BC-7',
      sources: ['document:commande-7'],
      number: 'BC-7',
      party: 'tiers/a',
      date: '2026-10-01',
    });
    const done = await vault.compile({ reason: 'ingest', actor: 'agent:test', pages: [order] });
    expect(done.ok).toBe(true);
    expect(await fulfils(vault, invoice.path)).toEqual([
      {
        kind: 'fulfils',
        to: order.path,
        confidence: 'exact',
        evidence: 'Numéro de commande « BC-7 » (BT-13)',
        rule: 'order_ref',
      },
    ]);
    expect((await linksAt(vault, order.path)).backlinks).toContainEqual({
      kind: 'fulfils',
      from: invoice.path,
    });
    expect(await read(vault.root, 'log.md')).toContain('liens recalculés');
    await vault.close();
  });

  it('makes no sure link when two quotes fit the amount: the closest is a guess, a tie nothing', async () => {
    const one = quote('D-1', 1_000_000, '2026-10-01');
    const two = quote('D-2', 1_010_000, '2026-10-02');
    const closer = sale('F-1', 1_002_000);
    const between = sale('F-2', 1_005_000);
    const vault = await open([client, one, two, closer, between]);
    expect(await fulfils(vault, closer.path)).toEqual([
      expect.objectContaining({ to: one.path, confidence: 'inferred', rule: 'quote_near' }),
    ]);
    expect(await fulfils(vault, between.path)).toEqual([]);
    await vault.close();
  });

  it("keeps a person's word: a confirmed guess stays sure, a refused link never comes back", async () => {
    const one = quote('D-1', 1_000_000, '2026-10-01');
    const two = quote('D-2', 1_010_000, '2026-10-02');
    const invoice = sale('F-1', 1_002_000);
    const vault = await open([client, one, two, invoice]);
    const link = { kind: 'fulfils', to: one.path } as const;
    expect(() => vault.reviewLink(invoice.path, link, 'confirm', 'agent:test')).toThrow();

    expect((await vault.reviewLink(invoice.path, link, 'confirm', 'user:marie')).ok).toBe(true);
    const sure = expect.objectContaining({
      to: one.path,
      confidence: 'strong',
      rule: 'quote_near',
      confirmed_by: 'user:marie le 25/10/2026',
    });
    expect(await fulfils(vault, invoice.path)).toEqual([sure]);
    // Written again by an agent that knows nothing of it, and a third quote filed: still there.
    await vault.compile({ reason: 'ingest', actor: 'agent:test', pages: [invoice] });
    await vault.compile({
      reason: 'ingest',
      actor: 'agent:test',
      pages: [quote('D-3', 1_001_000, '2026-10-03')],
    });
    expect(await fulfils(vault, invoice.path)).toContainEqual(sure);

    expect((await vault.reviewLink(invoice.path, link, 'refuse', 'user:marie')).ok).toBe(true);
    await vault.compile({ reason: 'ingest', actor: 'agent:test', pages: [invoice] });
    const after = await linksAt(vault, invoice.path);
    expect(after.links?.some((l) => l.to === one.path)).toBe(false);
    expect(after.refused_links).toEqual([link]);
    expect((await linksAt(vault, one.path)).backlinks ?? []).not.toContainEqual({
      kind: 'fulfils',
      from: invoice.path,
    });
    await vault.close();
  });

  it("keeps a model's guess the rules cannot make, and lints the links clean", async () => {
    const site = write({
      type: 'chantier',
      title: 'Maison Martin',
      sources: ['erp:chantier-1'],
      status: 'en_cours',
    });
    const invoice = sale('F-9', 500_000, 'Travaux chez les Martin, au fond de la cour.');
    const guess: Link = {
      kind: 'belongs_to',
      to: site.path,
      confidence: 'inferred',
      evidence: '« Travaux chez les Martin, au fond de la cour. »',
    };
    const vault = await open([
      client,
      site,
      { ...invoice, frontmatter: { ...invoice.frontmatter, links: [guess] } },
    ]);
    expect((await linksAt(vault, invoice.path)).links).toContainEqual(guess);
    await vault.compile({ reason: 'ingest', actor: 'agent:test', pages: [client] });
    expect((await linksAt(vault, invoice.path)).links).toContainEqual(guess);
    expect(await vault.lint()).toEqual([]);
    await vault.close();
  });
});
