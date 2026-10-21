// Corrections from the pane (R8): « Corriger pour moi » on a finding's card, and the chat's proposeFix
// and undoEdit. The code builds the correction from the finding (one price cell, before → after); the
// pane checks the cell still holds « before », writes it, reads the sheet again and says so here. This
// file keeps the journal (edits), the document lock and the audit trail, and checks the invoice again
// the moment a correction ends: « corrigé » only when its finding closed.
//
// The lock: while a card waits for its click (5 minutes at most), the checks leave the invoice's
// findings as they are, the autopilot does not send it and « Envoyer » asks to finish first. The other
// invoices go on being checked: one invoice is corrected and checked in turn, different ones at once.
import { frDate, frMoney } from '@fi/core';
import {
  and,
  audit,
  desc,
  type EditRow,
  type EditStatus,
  edits,
  eq,
  type FindingRow,
  findings,
  type InvoiceRow,
  invoices,
  lockInvoice,
  type TenantRow,
  type Tx,
} from '@fi/db';
import { z } from 'zod';
import { fixTarget, invoiceFindings, placesOf, runChecks } from './checks';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { EDITABLE } from './invoices';
import { refreshRegistry } from './registry';

/** How long a card holds the invoice: the person reads it and clicks. */
export const EDIT_LOCK_MS = 5 * 60_000;

export const FixBody = z.object({
  /** The chat's agent asked for it, or the person from the finding's card. */
  by: z.enum(['agent', 'person']).default('person'),
  toolCallId: z.string().min(1).max(200).optional(),
});
export type FixBody = z.infer<typeof FixBody>;

export const EditDecision = z.object({
  /**
   * applied · declined · conflict (the cell held something else: nothing written) · reverted (the
   * undo card was applied) · kept (the undo card was declined: the correction stays).
   */
  status: z.enum(['applied', 'declined', 'conflict', 'reverted', 'kept']),
  /** At a conflict: what the cell held, and its formula when it had one. */
  found: z.string().max(500).optional(),
  formula: z.string().max(2000).optional(),
  reason: z.enum(['changed', 'formula', 'missing']).optional(),
});
export type EditDecision = z.infer<typeof EditDecision>;

export function editView(row: EditRow) {
  return {
    id: row.id,
    findingId: row.findingId,
    invoiceId: row.invoiceId,
    by: row.by,
    status: row.status,
    workbookId: row.workbookId,
    sheet: row.sheet,
    cell: row.cell,
    field: row.field,
    /** Decimal text, as the pane writes it: « 30 » → « 40 ». */
    before: row.beforeValue,
    after: row.afterValue,
    found: row.foundValue,
    reason: row.reason,
    /** An undo is offered once the correction was written (applied, or a conflict at its undo). */
    undoable: row.status === 'applied' || (row.status === 'conflict' && row.appliedAt !== null),
    appliedAt: row.appliedAt?.toISOString() ?? null,
    revertedAt: row.revertedAt?.toISOString() ?? null,
  };
}
export type EditView = ReturnType<typeof editView>;

/** A sent invoice is not changed: it is corrected by a credit note or a corrective invoice. */
function sentInvoice(invoice: InvoiceRow, amount: number | null) {
  const params = {
    number: invoice.number ?? '',
    date: invoice.issueDate ? frDate(invoice.issueDate) : '',
  };
  return amount
    ? new ApiError(409, 'invoice_sent', { ...params, amount: frMoney(amount) })
    : new ApiError(409, 'invoice_sent_plain', params);
}

async function ownFinding(tx: Tx, tenant: TenantRow, id: string): Promise<FindingRow> {
  const [row] = await tx
    .select()
    .from(findings)
    .where(and(eq(findings.id, id), eq(findings.tenantId, tenant.id)));
  if (!row) throw new ApiError(404, 'finding_not_found');
  return row;
}

async function lockFor(tx: Tx, invoice: InvoiceRow, now: Date) {
  await tx
    .update(invoices)
    .set({ editLockUntil: new Date(now.getTime() + EDIT_LOCK_MS) })
    .where(eq(invoices.id, invoice.id));
}

/**
 * « Corriger pour moi » / proposeFix: the card for the finding's correction. Asked again (the lock ran
 * out, the pane checks before writing), it gives the same card back and holds the invoice again.
 */
export async function proposeFix(
  deps: Pick<ApiDeps, 'db' | 'now'>,
  tenant: TenantRow,
  findingId: string,
  input: FixBody,
): Promise<EditView> {
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    const finding = await ownFinding(tx, tenant, findingId);
    if (finding.status !== 'open') throw new ApiError(409, 'finding_resolved');
    if (!finding.fix || !finding.invoiceId) throw new ApiError(422, 'no_fix');
    const invoice = await lockInvoice(tx, finding.invoiceId);
    if (!invoice) throw new ApiError(422, 'no_fix');
    if (!EDITABLE.includes(invoice.status)) throw sentInvoice(invoice, finding.amount);
    const target = fixTarget(finding.fix, (await placesOf(tx, [finding.docId])).get(finding.docId));
    if (!target) throw new ApiError(422, 'no_fix');
    await lockFor(tx, invoice, now);

    const [waiting] = await tx
      .select()
      .from(edits)
      .where(and(eq(edits.findingId, finding.id), eq(edits.status, 'proposed')))
      .orderBy(desc(edits.createdAt));
    if (
      waiting &&
      waiting.sheet === target.sheet &&
      waiting.cell === target.cell &&
      waiting.beforeValue === target.before &&
      waiting.afterValue === target.after
    ) {
      return editView(waiting);
    }
    // The finding changed since that card: it would write a value nobody saw.
    if (waiting) {
      await tx
        .update(edits)
        .set({ status: 'declined', updatedAt: now })
        .where(eq(edits.id, waiting.id));
    }
    const [row] = await tx
      .insert(edits)
      .values({
        tenantId: tenant.id,
        invoiceId: invoice.id,
        findingId: finding.id,
        by: input.by,
        toolCallId: input.toolCallId ?? null,
        workbookId: target.workbookId,
        sheet: target.sheet,
        cell: target.cell,
        field: target.field,
        beforeValue: target.before,
        afterValue: target.after,
      })
      .returning();
    if (!row) throw new Error('edit not inserted');
    await audit(tx, {
      tenantId: tenant.id,
      actor: input.by === 'agent' ? 'agent:chat' : 'user',
      action: 'edit.propose',
      objectType: 'invoice',
      objectId: invoice.id,
      after: {
        edit: row.id,
        finding: finding.id,
        sheet: row.sheet,
        cell: row.cell,
        before: row.beforeValue,
        after: row.afterValue,
      },
    });
    return editView(row);
  });
}

async function ownEdit(tx: Tx, tenant: TenantRow, id: string): Promise<EditRow> {
  const [row] = await tx
    .select()
    .from(edits)
    .where(and(eq(edits.id, id), eq(edits.tenantId, tenant.id)))
    .for('update');
  if (!row) throw new ApiError(404, 'edit_not_found');
  return row;
}

export async function getEdit(deps: Pick<ApiDeps, 'db'>, tenant: TenantRow, id: string) {
  const [row] = await deps.db
    .select()
    .from(edits)
    .where(and(eq(edits.id, id), eq(edits.tenantId, tenant.id)));
  if (!row) throw new ApiError(404, 'edit_not_found');
  return editView(row);
}

/** The latest correction of a finding that an undo can take back: undoEdit without its id. */
export async function lastUndoable(
  deps: Pick<ApiDeps, 'db'>,
  tenant: TenantRow,
  findingId: string,
) {
  const found = await deps.db
    .select()
    .from(edits)
    .where(and(eq(edits.findingId, findingId), eq(edits.tenantId, tenant.id)))
    .orderBy(desc(edits.createdAt));
  const row = found.find((e) => editView(e).undoable);
  if (!row) throw new ApiError(404, 'edit_not_found');
  return editView(row);
}

/**
 * undoEdit: the card that puts « before » back. Only a correction that was written; never on an
 * invoice sent since. The pane checks the cell still holds « after »: if the person changed it, it
 * asks, and only a second click (« Remettre quand même ») writes over it.
 */
export async function proposeUndo(
  deps: Pick<ApiDeps, 'db' | 'now'>,
  tenant: TenantRow,
  id: string,
): Promise<EditView> {
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    const row = await ownEdit(tx, tenant, id);
    if (!editView(row).undoable) throw new ApiError(409, 'edit_state');
    const invoice = await lockInvoice(tx, row.invoiceId);
    if (!invoice) throw new ApiError(404, 'edit_not_found');
    if (!EDITABLE.includes(invoice.status)) {
      const [finding] = row.findingId
        ? await tx.select().from(findings).where(eq(findings.id, row.findingId))
        : [];
      throw sentInvoice(invoice, finding?.amount ?? null);
    }
    await lockFor(tx, invoice, now);
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'edit.undo_propose',
      objectType: 'invoice',
      objectId: invoice.id,
      after: { edit: row.id, cell: row.cell, before: row.afterValue, after: row.beforeValue },
    });
    return editView(row);
  });
}

/** What a decision may follow: the correction's card, then its undo card. */
const FROM: Record<EditDecision['status'], (row: EditRow) => boolean> = {
  applied: (r) => r.status === 'proposed',
  declined: (r) => r.status === 'proposed',
  // An undo can meet a changed cell again after « Laisser »: the correction is still undoable.
  conflict: (r) => r.status === 'proposed' || editView(r).undoable,
  reverted: (r) => editView(r).undoable,
  kept: (r) => editView(r).undoable,
};

const ACTION: Record<EditDecision['status'], string> = {
  applied: 'edit.apply',
  declined: 'edit.decline',
  conflict: 'edit.conflict',
  reverted: 'edit.revert',
  kept: 'edit.undo_decline',
};

/**
 * The person's click on a card, as the pane reports it after writing (or not). Ends the lock and
 * checks the invoice again at once: the answer says whether the finding closed and what remains.
 */
export async function decideEdit(
  deps: Pick<ApiDeps, 'db' | 'now'>,
  tenant: TenantRow,
  id: string,
  decision: EditDecision,
) {
  const now = deps.now();
  const row = await deps.db.transaction(async (tx) => {
    const before = await ownEdit(tx, tenant, id);
    if (!FROM[decision.status](before)) throw new ApiError(409, 'edit_state');
    const status: EditStatus = decision.status === 'kept' ? before.status : decision.status;
    const [after] = await tx
      .update(edits)
      .set({
        status,
        updatedAt: now,
        ...(decision.status === 'applied' && { appliedAt: now }),
        ...(decision.status === 'reverted' && { revertedAt: now }),
        ...(decision.status === 'conflict' && {
          foundValue: decision.found ?? null,
          beforeFormula: decision.formula ?? null,
          reason: decision.reason ?? 'changed',
        }),
      })
      .where(eq(edits.id, id))
      .returning();
    await tx.update(invoices).set({ editLockUntil: null }).where(eq(invoices.id, before.invoiceId));
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: ACTION[decision.status],
      objectType: 'invoice',
      objectId: before.invoiceId,
      before: { edit: id, status: before.status },
      after: {
        edit: id,
        status,
        cell: before.cell,
        ...(decision.status === 'conflict' && { reason: decision.reason ?? 'changed' }),
      },
    });
    return after ?? before;
  });
  // The lock held the invoice's findings as they were: whatever the click, they are read again now.
  await refreshRegistry(deps.db, tenant.id, now);
  await runChecks(deps.db, tenant.id, now);
  const [finding] = row.findingId
    ? await deps.db
        .select({ id: findings.id, status: findings.status })
        .from(findings)
        .where(eq(findings.id, row.findingId))
    : [];
  const remaining = await invoiceFindings(deps.db, row.invoiceId);
  return {
    edit: editView(row),
    /** Closed by the checks: the agent says « corrigé » only then. */
    resolved: finding ? finding.status === 'resolved' : null,
    /** What the checks still find on the invoice. */
    remaining: remaining.map((f) => ({ id: f.id, message: f.message })),
  };
}
