// The proactive catalogue (memory doc §8, docs/DECISIONS.md D12): every rule that raises something
// by itself is an entry here, with a detect by code and a test « fires / does not fire ». A rule
// without an entry does not exist. The chasers built before the catalogue are entries too; they keep
// running where they were built (`runs`), the others run over the memory's pages (`detect`).
import { z } from 'zod';

export const RULE_CATEGORIES = [
  'conformite',
  'tresorerie',
  'facturation',
  'achats',
  'chantier',
  'rh',
  'fiscal',
] as const;

/**
 * notify: says a fact, prepares nothing; propose: drafts, waits for « oui »; prepare: makes the whole
 * document and queues it for signing; execute: acts with no approval, only inside the company.
 */
export const AUTONOMY = ['notify', 'propose', 'prepare', 'execute'] as const;
export type Autonomy = (typeof AUTONOMY)[number];

/** Where a rule's detect runs: over the memory's pages, or in a chaser built before the catalogue. */
export const RULE_RUNNERS = ['memory', 'collect', 'watchers', 'checks'] as const;
export type RuleRunner = (typeof RULE_RUNNERS)[number];

export const RuleEntry = z
  .object({
    id: z.string().regex(/^[a-z]+(-[a-z]+)*$/),
    category: z.enum(RULE_CATEGORIES),
    /** When the memory doc has it fire; the runner evaluates every memory rule once a day. */
    trigger: z.enum(['cron', 'on_document', 'on_edge']),
    runs: z.enum(RULE_RUNNERS),
    /** What a firing prepares: nothing, a message, a whole document. */
    draft: z.enum(['none', 'message', 'document']),
    autonomy: z.enum(AUTONOMY),
    /** Its draft leaves the company (a mail, an invoice): `execute` is refused, whatever is asked. */
    outward: z.boolean(),
    /** The least sure link a firing may rest on (memory doc §7). */
    minConfidence: z.enum(['exact', 'strong', 'inferred']),
    /** The same rule does not fire again on the same entity before this many days. */
    cooldownDays: z.int().min(0),
    /** The law it serves, when it serves one. */
    legal: z.string().min(1).optional(),
  })
  .refine((r) => !(r.outward && r.autonomy === 'execute'), {
    message: 'execute is for actions inside the company only',
  });
export type RuleEntry = z.infer<typeof RuleEntry>;

/**
 * The autonomy a rule runs with: the company's preference, except `execute` for a rule whose draft
 * leaves the company, which stays at the rule's own level. A client cannot turn it on.
 */
export function autonomyOf(entry: RuleEntry, preferred?: Autonomy): Autonomy {
  if (!preferred) return entry.autonomy;
  if (preferred === 'execute' && entry.outward) return entry.autonomy;
  return preferred;
}

/** The chasers that were there before the catalogue: listed, run where they were built. */
export const CHASERS: readonly RuleEntry[] = [
  {
    id: 'invoice-overdue',
    category: 'tresorerie',
    trigger: 'cron',
    runs: 'collect',
    draft: 'message',
    autonomy: 'propose',
    outward: true,
    minConfidence: 'exact',
    cooldownDays: 7,
    legal: 'C. com. art. L441-10 (pénalités de retard, indemnité de 40 €)',
  },
  {
    id: 'attestation-expiring',
    category: 'conformite',
    trigger: 'cron',
    runs: 'watchers',
    draft: 'message',
    autonomy: 'propose',
    outward: true,
    minConfidence: 'exact',
    cooldownDays: 30,
    legal: 'C. trav. art. L8222-1, R8222-1, D8222-5',
  },
  {
    id: 'retenue-releasable',
    category: 'tresorerie',
    trigger: 'cron',
    runs: 'watchers',
    draft: 'message',
    autonomy: 'propose',
    outward: true,
    minConfidence: 'exact',
    cooldownDays: 30,
    legal: 'Loi n° 71-584 du 16 juillet 1971, art. 2',
  },
  {
    id: 'autoliquidation-error',
    category: 'fiscal',
    trigger: 'on_document',
    runs: 'checks',
    draft: 'message',
    autonomy: 'propose',
    outward: true,
    minConfidence: 'exact',
    cooldownDays: 0,
    legal: 'CGI art. 283, 2 nonies',
  },
];
