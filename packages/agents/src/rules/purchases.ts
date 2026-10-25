// Purchase rules (memory doc §8): what was bought for a chantier and never billed on, an article
// bought dearer than last time.
import { addDays, daysBetween } from '@fi/core';
import type { Found, MemoryRule, PageOf, RuleContext } from './context';

/** A purchase for a chantier this many days old, its articles on no sale of that chantier since. */
export const REBILL_DAYS = 45;
/** Older purchases are history, not news: not raised. */
export const REBILL_HORIZON_DAYS = 120;
/** A price this much above the last one (in basis points: 5 %) is raised. */
export const PRICE_RISE_BPS = 500;
/** Only a purchase of the last 30 days counts as a rise: an old one is not news. */
export const PRICE_NEWS_DAYS = 30;

export const purchaseNotRebilled: MemoryRule = {
  entry: {
    id: 'purchase-not-rebilled',
    category: 'achats',
    trigger: 'on_document',
    runs: 'memory',
    draft: 'message',
    autonomy: 'propose',
    outward: true,
    minConfidence: 'strong',
    cooldownDays: 30,
  },
  on: ['facture_achat'],
  detect(ctx) {
    const min = purchaseNotRebilled.entry.minConfidence;
    const sales = ctx.ofType('facture_vente');
    return ctx.ofType('facture_achat').flatMap((purchase): Found[] => {
      const f = purchase.frontmatter;
      const site = ctx.siteOf(purchase, min);
      const days = daysBetween(f.issue_date, ctx.today);
      if (!site || days < REBILL_DAYS || days > REBILL_HORIZON_DAYS) return [];
      const bought = ctx.linked(purchase, 'uses', min);
      if (bought.length === 0) return [];
      const sold = new Set(
        sales
          .filter((s) => ctx.siteOf(s, min) === site && s.frontmatter.issue_date >= f.issue_date)
          .flatMap((s) => ctx.linked(s, 'uses', min)),
      );
      const missing = bought.filter((a) => !sold.has(a));
      if (missing.length === 0) return [];
      return [
        {
          entity: purchase.path,
          facts: {
            number: f.number,
            supplier: ctx.title(f.party),
            chantier: ctx.title(site),
            date: f.issue_date,
            days,
            articles: missing.map((a) => ctx.title(a)),
          },
          cites: [purchase.path, site, ...missing],
        },
      ];
    });
  },
};

interface Bought {
  invoice: string;
  date: string;
  price: number;
  supplier: string;
}

/** Each purchase of `article` with its unit price, oldest first. */
function purchasesOf(ctx: RuleContext, article: PageOf<'article'>): Bought[] {
  const codes = new Set(article.frontmatter.codes ?? []);
  return ctx
    .ofType('facture_achat')
    .flatMap((inv) =>
      (inv.frontmatter.lines ?? [])
        .filter((l) => l.article === article.path || (l.code !== undefined && codes.has(l.code)))
        .flatMap((l) =>
          l.unit_price === undefined
            ? []
            : [
                {
                  invoice: inv.path,
                  date: inv.frontmatter.issue_date,
                  price: l.unit_price,
                  supplier: inv.frontmatter.party,
                },
              ],
        ),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.invoice.localeCompare(b.invoice));
}

export const priceIncrease: MemoryRule = {
  entry: {
    id: 'price-increase',
    category: 'achats',
    trigger: 'on_document',
    runs: 'memory',
    draft: 'none',
    autonomy: 'notify',
    outward: false,
    minConfidence: 'strong',
    cooldownDays: 30,
  },
  on: ['article'],
  detect(ctx) {
    const quotes = ctx
      .ofType('devis')
      .filter((d) => d.frontmatter.status === 'brouillon' || d.frontmatter.status === 'envoye');
    return ctx.ofType('article').flatMap((article): Found[] => {
      const bought = purchasesOf(ctx, article);
      const latest = bought.at(-1);
      if (!latest || latest.date < addDays(ctx.today, -PRICE_NEWS_DAYS)) return [];
      const before = bought.filter((b) => b.invoice !== latest.invoice).at(-1);
      if (!before || latest.price * 10_000 <= before.price * (10_000 + PRICE_RISE_BPS)) return [];
      const open = quotes.filter(
        (q) =>
          q.frontmatter.lines?.some((l) => l.article === article.path) ||
          ctx.linked(q, 'uses', priceIncrease.entry.minConfidence).includes(article.path),
      );
      return [
        {
          entity: `${article.path}@${latest.invoice}`,
          facts: {
            article: article.frontmatter.title,
            before: before.price,
            after: latest.price,
            pct: Math.round(((latest.price - before.price) * 1000) / before.price) / 10,
            supplier: ctx.title(latest.supplier),
            date: latest.date,
            quotes: open.map((q) => q.frontmatter.number),
          },
          cites: [article.path, latest.invoice, before.invoice, ...open.map((q) => q.path)],
        },
      ];
    });
  },
};
