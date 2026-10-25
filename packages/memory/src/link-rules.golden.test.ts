import { describe, expect, it } from 'vitest';
import { demoVault, type TrueLink } from './demo';
import type { Link } from './types';

const demo = demoVault();
const linksAt = new Map(demo.pages.map((p) => [p.path, p.frontmatter.links ?? []]));
const find = (t: TrueLink): Link | undefined =>
  linksAt.get(t.from)?.find((l) => l.kind === t.kind && l.to === t.to);

describe('the link rules on the demo vault', () => {
  it('tie ≥ 90 % of the chains by exact or strong links, the rest by inferred ones, none missing', () => {
    const missing: string[] = [];
    const count = { quote_invoice: { sure: 0, all: 0 }, purchase_sale: { sure: 0, all: 0 } };
    for (const chain of demo.chains) {
      const found = chain.links.map(find);
      const lost = chain.links.filter((_, i) => !found[i]);
      for (const t of lost) missing.push(`${t.from} ${t.kind} ${t.to}`);
      count[chain.kind].all++;
      if (found.every((l) => l && l.confidence !== 'inferred')) count[chain.kind].sure++;
    }
    console.info(
      `chains: quote → invoice ${count.quote_invoice.sure}/${count.quote_invoice.all}, purchase → sale ${count.purchase_sale.sure}/${count.purchase_sale.all} exact or strong`,
    );
    expect(missing).toEqual([]);
    expect(count.quote_invoice.all).toBe(20);
    expect(count.purchase_sale.all).toBe(20);
    for (const c of Object.values(count)) expect(c.sure / c.all).toBeGreaterThanOrEqual(0.9);
  });

  it('never makes an exact or strong link to a wrong page', () => {
    const truth = new Set(demo.truth.map((t) => `${t.from} ${t.kind} ${t.to}`));
    const checked = new Set(['belongs_to', 'fulfils', 'uses', 'works_on']);
    const wrong: string[] = [];
    const guesses: string[] = [];
    for (const [from, links] of linksAt) {
      for (const l of links) {
        if (!checked.has(l.kind) || truth.has(`${from} ${l.kind} ${l.to}`)) continue;
        (l.confidence === 'inferred' ? guesses : wrong).push(
          `${from} ${l.kind} ${l.to} (${l.rule})`,
        );
      }
    }
    console.info(`wrong guesses (inferred, for a person to refuse): ${guesses.join('; ')}`);
    expect(wrong).toEqual([]);
  });
});
