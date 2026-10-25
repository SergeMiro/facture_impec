// The proactive catalogue (memory M5): the chasers built before it, the rules over the memory's
// pages, and one pass of those rules over a company's pages. What fired is recorded, cooled down and
// shown by the API (`apps/api/src/rules.ts`); nothing here writes or sends.
import { devisAcceptedNoInvoice, situationDue } from './billing';
import { CHASERS, type RuleEntry } from './catalogue';
import { subcontractorNoDocs } from './compliance';
import type { Found, MemoryRule, RuleContext } from './context';
import { cashForecast, marginBelowThreshold, tvaDeclarationDue } from './money';
import { priceIncrease, purchaseNotRebilled } from './purchases';

export * from './billing';
export * from './catalogue';
export * from './compliance';
export * from './context';
export * from './money';
export * from './notice';
export * from './purchases';

export const MEMORY_RULES: readonly MemoryRule[] = [
  devisAcceptedNoInvoice,
  situationDue,
  purchaseNotRebilled,
  priceIncrease,
  marginBelowThreshold,
  cashForecast,
  tvaDeclarationDue,
  subcontractorNoDocs,
];

/** Every rule that raises something by itself, wherever it runs. */
export const CATALOGUE: readonly RuleEntry[] = [...CHASERS, ...MEMORY_RULES.map((r) => r.entry)];

export interface RuleResult {
  rule: string;
  /** The pages of the types it looks at. */
  checked: number;
  found: Found[];
  /** A rule that threw: the others still run, the run records it. */
  error?: string;
}

/** Each memory rule once over the pages; a firing that cites no page is dropped (memory doc §8). */
export function evaluateRules(ctx: RuleContext, rules = MEMORY_RULES): RuleResult[] {
  return rules.map((rule) => {
    const checked = ctx.pages.filter((p) => rule.on.includes(p.frontmatter.type)).length;
    try {
      const found = rule.detect(ctx).filter((f) => f.cites.length > 0);
      return { rule: rule.entry.id, checked, found };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return { rule: rule.entry.id, checked, found: [], error };
    }
  });
}
