// The validation engine: runs every rule and turns findings into French messages (fr.json).
import { isMessageKey, type MessageParams, t } from '@fi/shared';
import { z } from 'zod';
import { parisToday } from '../dates';
import type { Invoice } from '../model';
import { BTP_RULES } from './btp';
import { CODELIST_RULES } from './codelists';
import { EN16931_RULES } from './en16931';
import { FR_RULES } from './fr';
import type { Finding, Issue, Rule, RuleContext } from './types';
import { VAT_RULES } from './vat';

export { type HistoryEntry, type HistorySubject, NumberingHistory } from './history';
export type * from './types';

export const RULES: readonly Rule[] = [
  ...EN16931_RULES,
  ...VAT_RULES,
  ...CODELIST_RULES,
  ...FR_RULES,
  ...BTP_RULES,
];

const BY_ID = new Map(RULES.map((r) => [r.id, r]));

export function getRule(id: string): Rule {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown rule ${id}`);
  return found;
}

/** fr.json keys of a rule's message and fix hint. */
export function messageKeys(rule: Rule, variant?: string) {
  const base = `rule.${rule.messageKey ?? rule.id}${variant ? `.${variant}` : ''}`;
  return { message: `${base}.message`, fix: `${base}.fix` };
}

/** Parameters that name something are shown with their French label: `field: 'dueDate'` → « date d'échéance ». */
const LABELS: Readonly<Record<string, string>> = {
  field: 'field',
  category: 'vatCategory',
  mention: 'noteCode',
};

function render(key: string, params?: Finding['params']): string {
  if (!isMessageKey(key)) throw new Error(`Missing French message ${key} in fr.json`);
  if (!params) return t(key);
  const resolved: MessageParams = Object.fromEntries(
    Object.entries(params).map(([name, value]) => {
      const label = `${LABELS[name]}.${value}`;
      return [name, LABELS[name] && isMessageKey(label) ? t(label) : value];
    }),
  );
  return t(key, resolved);
}

export function toIssue(rule: Rule, finding: Finding): Issue {
  const keys = messageKeys(rule, finding.variant);
  return {
    ruleId: rule.id,
    severity: rule.severity,
    scope: rule.scope,
    path: finding.path,
    bt: rule.bt,
    ...(finding.params && { params: finding.params }),
    autoFixable: rule.autoFixable,
    messageFr: render(keys.message, finding.params),
    fixHintFr: render(keys.fix, finding.params),
  };
}

/** What the caller knows about the tenant and the customer (RuleContext); missing settings are false. */
export const ContextInput = z.object({
  today: z.string().optional(),
  history: z
    .array(
      z.object({ number: z.string(), issueDate: z.string(), sellerSiren: z.string().optional() }),
    )
    .optional(),
  seller: z.object({ vatOnDebits: z.boolean() }).partial().optional(),
  buyer: z
    .object({
      requiresPurchaseOrder: z.boolean(),
      deliversElsewhere: z.boolean(),
      publicEntity: z.boolean(),
      vat: z.object({ vatId: z.string(), valid: z.boolean() }),
    })
    .partial()
    .optional(),
  btp: z
    .object({
      subcontracting: z.boolean(),
      retenue: z.object({ rateBps: z.int().min(0), amount: z.int().min(0) }).partial(),
      chantier: z.object({ retenueBps: z.int().min(0).nullable() }),
      situation: z.object({
        number: z.int().min(1),
        cumulative: z.int().optional(),
        previous: z.object({ number: z.int().min(0), cumulative: z.int().optional() }).optional(),
      }),
    })
    .partial()
    .optional(),
});
export type ContextInput = z.infer<typeof ContextInput>;

export function ruleContext(input: ContextInput = {}): RuleContext {
  return {
    today: input.today ?? parisToday(),
    ...(input.history && { history: input.history }),
    seller: { vatOnDebits: false, ...input.seller },
    buyer: {
      requiresPurchaseOrder: false,
      deliversElsewhere: false,
      publicEntity: false,
      ...input.buyer,
    },
    ...(input.btp && { btp: input.btp }),
  };
}

/**
 * Runs every model rule. An auto-fixable issue hides the other issues on the same path: once the
 * formatting is fixed, validation runs again and shows what is left.
 */
export function validate(invoice: Invoice, context: ContextInput = {}): Issue[] {
  const ctx = ruleContext(context);
  const issues = RULES.filter((r) => r.stage !== 'import').flatMap((r) =>
    r.check(invoice, ctx).map((f) => toIssue(r, f)),
  );
  const fixable = new Set(issues.filter((i) => i.autoFixable).map((i) => i.path));
  return issues.filter((i) => i.autoFixable || !fixable.has(i.path));
}

export const hasErrors = (issues: readonly Issue[]) => issues.some((i) => i.severity === 'error');
