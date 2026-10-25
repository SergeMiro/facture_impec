// Billing rules (memory doc §8): a quote accepted and never invoiced, a chantier whose monthly
// situation is late. Both `prepare` (M6 makes the document); here they only find the situation.
import { daysBetween } from '@fi/core';
import type { Found, MemoryRule } from './context';

/** A quote accepted this many days ago with no invoice is raised. */
export const QUOTE_WAIT_DAYS = 14;
/** A chantier billed by situations whose last one is older than this is due another. */
export const SITUATION_DAYS = 30;

export const devisAcceptedNoInvoice: MemoryRule = {
  entry: {
    id: 'devis-accepted-no-invoice',
    category: 'facturation',
    trigger: 'on_edge',
    runs: 'memory',
    draft: 'document',
    autonomy: 'prepare',
    outward: true,
    minConfidence: 'strong',
    cooldownDays: 7,
  },
  on: ['devis'],
  detect(ctx) {
    return ctx.ofType('devis').flatMap((devis): Found[] => {
      const f = devis.frontmatter;
      if (f.status !== 'accepte') return [];
      // The page has no day of acceptance: counted from the quote's own date (docs/DEFERRED.md).
      const days = daysBetween(f.date, ctx.today);
      if (days <= QUOTE_WAIT_DAYS) return [];
      // Any invoice tied to it, even by a guess, keeps it quiet: a guess is a person's question
      // (« est-ce bien la facture de ce devis ? »), never a reason to invoice twice.
      if (ctx.linking(devis, 'fulfils', 'inferred').length > 0) return [];
      return [
        {
          entity: devis.path,
          facts: {
            number: f.number,
            party: ctx.title(f.party),
            ht: f.ht ?? null,
            date: f.date,
            days,
          },
          cites: [devis.path, f.party, ...(f.chantier ? [f.chantier] : [])],
        },
      ];
    });
  },
};

export const situationDue: MemoryRule = {
  entry: {
    id: 'situation-due',
    category: 'chantier',
    trigger: 'cron',
    runs: 'memory',
    draft: 'document',
    autonomy: 'prepare',
    outward: true,
    minConfidence: 'exact',
    cooldownDays: 30,
  },
  on: ['chantier'],
  detect(ctx) {
    const situations = ctx.ofType('situation');
    return ctx.ofType('chantier').flatMap((site): Found[] => {
      if (site.frontmatter.status !== 'en_cours') return [];
      // A chantier billed by plain invoices has no situation to follow.
      const last = situations
        .filter((s) => s.frontmatter.chantier === site.path)
        .sort((a, b) => b.frontmatter.number - a.frontmatter.number)[0];
      const issued = last?.frontmatter.issue_date;
      if (!last || !issued) return [];
      const days = daysBetween(issued, ctx.today);
      if (days <= SITUATION_DAYS) return [];
      return [
        {
          entity: site.path,
          facts: {
            chantier: site.frontmatter.title,
            last: last.frontmatter.number,
            lastDate: issued,
            cumulHt: last.frontmatter.cumul_ht,
            days,
          },
          cites: [site.path, last.path],
        },
      ];
    });
  },
};
