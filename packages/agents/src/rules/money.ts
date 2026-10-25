// Money rules (memory doc §8): a chantier earning less than the company's threshold, the cash coming
// in and going out in 30/60/90 days, the VAT return due. They only say a fact (`notify`): nothing
// leaves the company, and the numbers come from the pages, never from a model.
import { addDays } from '@fi/core';
import type { Found, MemoryRule, PageOf, RuleContext } from './context';

export const FORECAST_DAYS = [30, 60, 90] as const;
/** The VAT return of a month is raised from this day of the next one. */
export const TVA_REMIND_DAY = 10;

/** An avoir's sign: the client's lowers sales, the supplier's lowers costs. */
function avoirSide(ctx: RuleContext, avoir: PageOf<'avoir'>): 'sale' | 'cost' {
  const party = ctx.get(avoir.frontmatter.party);
  const roles = party?.frontmatter.type === 'tiers' ? party.frontmatter.roles : [];
  return roles.includes('client') ? 'sale' : 'cost';
}

export const marginBelowThreshold: MemoryRule = {
  entry: {
    id: 'margin-below-threshold',
    category: 'chantier',
    trigger: 'cron',
    runs: 'memory',
    draft: 'none',
    autonomy: 'notify',
    outward: false,
    minConfidence: 'strong',
    cooldownDays: 7,
  },
  on: ['chantier'],
  detect(ctx) {
    const min = marginBelowThreshold.entry.minConfidence;
    const situations = ctx.ofType('situation');
    const docs = [
      ...ctx.ofType('facture_vente'),
      ...ctx.ofType('facture_achat'),
      ...ctx.ofType('avoir'),
    ];
    return ctx.ofType('chantier').flatMap((site): Found[] => {
      const mine = docs.filter((d) => ctx.siteOf(d, min) === site.path);
      let sales = 0;
      let costs = 0;
      for (const d of mine) {
        const ht = d.frontmatter.ht;
        if (d.frontmatter.type === 'facture_vente') sales += ht;
        else if (d.frontmatter.type === 'facture_achat') costs += ht;
        else if (avoirSide(ctx, d as PageOf<'avoir'>) === 'sale') sales -= ht;
        else costs -= ht;
      }
      // A situation states the work done so far: the last one's cumul is what was billed.
      const sits = situations.filter((s) => s.frontmatter.chantier === site.path);
      const cumul = Math.max(0, ...sits.map((s) => s.frontmatter.cumul_ht));
      sales += cumul;
      if (sales <= 0) return [];
      const margin = sales - costs;
      // Compared in hundredths of a percent, no float on money.
      if (margin * 100 >= sales * ctx.options.marginPct) return [];
      return [
        {
          entity: site.path,
          facts: {
            chantier: site.frontmatter.title,
            sales,
            costs,
            margin,
            pct: Math.round((margin * 1000) / sales) / 10,
            threshold: ctx.options.marginPct,
          },
          cites: [site.path, ...mine.map((d) => d.path), ...sits.map((s) => s.path)],
        },
      ];
    });
  },
};

export const cashForecast: MemoryRule = {
  entry: {
    id: 'cash-forecast',
    category: 'tresorerie',
    trigger: 'cron',
    runs: 'memory',
    draft: 'none',
    autonomy: 'notify',
    outward: false,
    minConfidence: 'exact',
    cooldownDays: 7,
  },
  on: ['facture_vente', 'facture_achat'],
  detect(ctx) {
    // Situations have no « paid » on their page yet: left out rather than counted forever.
    const open = [...ctx.ofType('facture_vente'), ...ctx.ofType('facture_achat')].filter(
      (d) => !d.frontmatter.paid_at && d.frontmatter.due_date,
    );
    if (open.length === 0) return [];
    const facts: Found['facts'] = {};
    for (const days of FORECAST_DAYS) {
      const until = addDays(ctx.today, days);
      const due = open.filter((d) => (d.frontmatter.due_date ?? '') <= until);
      facts[`in${days}`] = sum(due, 'facture_vente');
      facts[`out${days}`] = sum(due, 'facture_achat');
    }
    const late = open.filter(
      (d) => d.frontmatter.type === 'facture_vente' && (d.frontmatter.due_date ?? '') < ctx.today,
    );
    facts.lateIn = sum(late, 'facture_vente');
    facts.lateCount = late.length;
    return [{ entity: 'company', facts, cites: open.map((d) => d.path) }];
  },
};

function sum(
  docs: readonly PageOf<'facture_vente' | 'facture_achat'>[],
  type: 'facture_vente' | 'facture_achat',
): number {
  return docs.filter((d) => d.frontmatter.type === type).reduce((s, d) => s + d.frontmatter.ttc, 0);
}

export const tvaDeclarationDue: MemoryRule = {
  entry: {
    id: 'tva-declaration-due',
    category: 'fiscal',
    trigger: 'cron',
    runs: 'memory',
    draft: 'none',
    autonomy: 'notify',
    outward: false,
    minConfidence: 'exact',
    cooldownDays: 31,
    // TODO(verify): the deadline (from the 15th to the 24th) depends on the company's regime and
    // SIREN; checked with an accountant before the reminder names a day (docs/TODO.md).
    legal: 'CGI art. 269, 2, c ; art. 287',
  },
  on: ['facture_vente', 'facture_achat', 'avoir'],
  detect(ctx) {
    const [y, m, d] = ctx.today.split('-').map(Number) as [number, number, number];
    if (d < TVA_REMIND_DAY) return [];
    const prev = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const inMonth = (date: string | undefined) => date?.startsWith(prev) ?? false;
    // Services (BTP works) pay VAT when paid, unless the company opted for its invoices.
    const sales = ctx
      .ofType('facture_vente')
      .filter((s) =>
        inMonth(ctx.options.vatOnDebits ? s.frontmatter.issue_date : s.frontmatter.paid_at),
      );
    const purchases = ctx.ofType('facture_achat').filter((p) => inMonth(p.frontmatter.issue_date));
    const avoirs = ctx.ofType('avoir').filter((a) => inMonth(a.frontmatter.issue_date));
    const back = (side: 'sale' | 'cost') =>
      avoirs.filter((a) => avoirSide(ctx, a) === side).reduce((s, a) => s + a.frontmatter.tva, 0);
    const collected = sales.reduce((s, x) => s + x.frontmatter.tva, 0) - back('sale');
    const deductible = purchases.reduce((s, x) => s + x.frontmatter.tva, 0) - back('cost');
    if (collected === 0 && deductible === 0) return [];
    return [
      {
        entity: `tva:${prev}`,
        facts: {
          month: prev,
          collected,
          deductible,
          net: collected - deductible,
          basis: ctx.options.vatOnDebits ? 'debits' : 'encaissements',
        },
        cites: [...sales, ...purchases, ...avoirs].map((p) => p.path),
      },
    ];
  },
};
