// TestAgent (plan §3, §6): the « répétition » before a real send. Deterministic on purpose: whether an
// invoice is ready is a fact the code checks, never a model's opinion. The API injects the checks
// (validation, XML, PDF, annuaire, a simulated rejection on a TEST- copy, legal mentions), so this
// file only orders them and turns their results into the checklist the add-in shows.
import { type MessageKey, t } from '@fi/shared';

export const REHEARSAL_ITEMS = [
  'valid',
  'xml',
  'pdf',
  'directory',
  'mentions',
  'rejection',
] as const;
export type RehearsalItem = (typeof REHEARSAL_ITEMS)[number];

export interface CheckResult {
  ok: boolean;
  /** Plain French, shown under the item. */
  detail?: string;
}

export type RehearsalChecks = Record<RehearsalItem, () => Promise<CheckResult>>;

export interface ChecklistEntry {
  item: RehearsalItem;
  label: string;
  ok: boolean;
  detail: string | null;
}

export interface Rehearsal {
  ready: boolean;
  /** « Prêt à envoyer » or what to do next. */
  summary: string;
  checklist: ChecklistEntry[];
}

/** Items that need a valid invoice: a simulated send of an invalid one proves nothing. */
const NEEDS_VALID: ReadonlySet<RehearsalItem> = new Set(['rejection']);

/** Runs the checks in order; a check that throws fails with a calm message, the others still run. */
export async function rehearse(checks: RehearsalChecks): Promise<Rehearsal> {
  const checklist: ChecklistEntry[] = [];
  let valid = true;
  for (const item of REHEARSAL_ITEMS) {
    const label = t(`rehearsal.item.${item}` as MessageKey);
    if (NEEDS_VALID.has(item) && !valid) {
      checklist.push({ item, label, ok: false, detail: t('rehearsal.detail.skipped') });
      continue;
    }
    let result: CheckResult;
    try {
      result = await checks[item]();
    } catch {
      result = { ok: false, detail: t('rehearsal.detail.technical') };
    }
    if (item === 'valid') valid = result.ok;
    checklist.push({ item, label, ok: result.ok, detail: result.detail ?? null });
  }
  const ready = checklist.every((c) => c.ok);
  return { ready, summary: t(ready ? 'rehearsal.ready' : 'rehearsal.notReady'), checklist };
}
