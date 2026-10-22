// Patterns and learning (R7): what a person teaches the checks from « Contrôles ». « C'est normal » on a
// finding about a price keeps its rule quiet on that article — for that customer or any — for 3 months,
// 12 months or with no end; « Retirer » brings the finding back. « Oui » / « Non » on « Est-ce le même
// article ? » ties two articles or never asks again. Each answer is audited, then the documents are
// checked again (src/checks.ts reads the answers).
import { ACCEPTABLE_RULES, type AcceptableRule, addDays, parisToday } from '@fi/core';
import { and, audit, eq, findings, itemSynonyms, ruleExceptions, type TenantRow } from '@fi/db';
import { z } from 'zod';
import { checksView, placesOf, runChecks } from './checks';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';

type Deps = Pick<ApiDeps, 'db' | 'now' | 'ai'>;

export const NormalBody = z.object({
  /** True: whatever the customer; false: the finding's customer only. */
  everyCustomer: z.boolean().default(false),
  /** How long; null: no end. */
  months: z.union([z.literal(3), z.literal(12)]).nullable(),
});
export type NormalBody = z.infer<typeof NormalBody>;

export const SynonymBody = z.object({ status: z.enum(['confirmed', 'rejected']) });

/** The last day of an exception that starts today and lasts `months`. */
export function lastDay(today: string, months: number): string {
  const [y = 0, m = 1, d = 1] = today.split('-').map(Number);
  const end = new Date(Date.UTC(y, m - 1 + months, d)).toISOString().slice(0, 10);
  return addDays(end, -1);
}

const acceptable = (rule: string): rule is AcceptableRule =>
  (ACCEPTABLE_RULES as readonly string[]).includes(rule);

/** « C'est normal » on an open finding: the exception is kept, and the documents checked again. */
export async function acceptFinding(
  deps: Deps,
  tenant: TenantRow,
  actor: string,
  id: string,
  input: NormalBody,
) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(findings)
      .where(and(eq(findings.id, id), eq(findings.tenantId, tenant.id)));
    if (!row) throw new ApiError(404, 'finding_not_found');
    if (row.status !== 'open' || !row.scope || !acceptable(row.rule)) {
      throw new ApiError(409, 'finding_not_acceptable');
    }
    const place = (await placesOf(tx, [row.docId])).get(row.docId);
    const party = input.everyCustomer ? null : row.scope.party;
    const until = input.months === null ? null : lastDay(parisToday(now), input.months);
    const [kept] = await tx
      .insert(ruleExceptions)
      .values({
        tenantId: tenant.id,
        rule: row.rule,
        party,
        partyName: party ? (place?.partyName ?? null) : null,
        itemId: row.scope.itemId,
        itemName: row.params.item ?? '',
        until,
        findingKey: row.key,
        createdBy: actor,
        createdAt: now,
      })
      .returning({ id: ruleExceptions.id });
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'finding.normal',
      objectType: 'finding',
      objectId: row.id,
      after: { exception: kept?.id, rule: row.rule, key: row.key, party, until, by: actor },
    });
  });
  await runChecks(deps.db, tenant.id, now);
  return checksView(deps, tenant);
}

/** « Retirer » on an exception: the rule speaks again, and the documents are checked again. */
export async function removeException(deps: Deps, tenant: TenantRow, actor: string, id: string) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .delete(ruleExceptions)
      .where(and(eq(ruleExceptions.id, id), eq(ruleExceptions.tenantId, tenant.id)))
      .returning();
    if (!row) throw new ApiError(404, 'exception_not_found');
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'exception.remove',
      objectType: 'rule_exception',
      objectId: id,
      before: { rule: row.rule, party: row.party, item: row.itemId, until: row.until },
      after: { by: actor },
    });
  });
  await runChecks(deps.db, tenant.id, now);
  return checksView(deps, tenant);
}

/** « Oui » / « Non » on two articles: kept as answered, and the documents checked again. */
export async function decideSynonym(
  deps: Deps,
  tenant: TenantRow,
  actor: string,
  id: string,
  status: 'confirmed' | 'rejected',
) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(itemSynonyms)
      .where(and(eq(itemSynonyms.id, id), eq(itemSynonyms.tenantId, tenant.id)))
      .for('update');
    if (!row) throw new ApiError(404, 'synonym_not_found');
    await tx
      .update(itemSynonyms)
      .set({ status, decidedBy: actor, decidedAt: now, updatedAt: now })
      .where(eq(itemSynonyms.id, id));
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: status === 'confirmed' ? 'synonym.confirm' : 'synonym.reject',
      objectType: 'item_synonym',
      objectId: id,
      before: { status: row.status },
      after: { status, item: row.itemId, alias: row.aliasId },
    });
  });
  await runChecks(deps.db, tenant.id, now);
  return checksView(deps, tenant);
}
