// The one function that writes invoices.status (plan §4). It locks the row, asks the core state
// machine, writes the status, the timeline event and the audit event in the caller's transaction.
// A trigger (migration 0001) refuses a status write that does not come through here.
import { type Actor, type InvoiceEvent, type TransitionResult, transition } from '@fi/core';
import { eq, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { hashOf } from './hash';
import { auditEvents, type InvoiceRow, invoiceEvents, invoices } from './schema';

export interface AuditInput {
  tenantId: string | null;
  actor: string;
  action: string;
  objectType: string;
  objectId: string;
  before?: unknown;
  after?: unknown;
}

export async function audit(tx: Tx, input: AuditInput): Promise<void> {
  await tx.insert(auditEvents).values({
    tenantId: input.tenantId,
    actor: input.actor,
    action: input.action,
    objectType: input.objectType,
    objectId: input.objectId,
    beforeHash: input.before === undefined ? null : hashOf(input.before),
    afterHash: input.after === undefined ? null : hashOf(input.after),
  });
}

/** Locks the invoice row until the end of the transaction (per-invoice lock, plan §6). */
export async function lockInvoice(tx: Tx, id: string): Promise<InvoiceRow | undefined> {
  const [row] = await tx.select().from(invoices).where(eq(invoices.id, id)).for('update');
  return row;
}

/** Columns that may change together with the status. */
export type TransitionPatch = Partial<
  Pick<InvoiceRow, 'pdpRef' | 'pdpStatusRaw' | 'xmlCii' | 'document' | 'draft'>
>;

export interface ApplyInput {
  invoiceId: string;
  event: InvoiceEvent;
  actor: Actor;
  payload?: Record<string, unknown>;
  /** The platform event this transition comes from; a second application of it is refused. */
  pdpEventId?: string;
  patch?: TransitionPatch;
}

export type ApplyResult = TransitionResult | { ok: false; reason: 'not_found' };

export async function applyTransition(tx: Tx, input: ApplyInput): Promise<ApplyResult> {
  const row = await lockInvoice(tx, input.invoiceId);
  if (!row) return { ok: false, reason: 'not_found' };
  const result = transition(row.status, input.event, input.actor);
  if (!result.ok) return result;

  await tx.execute(sql`select set_config('fi.status_write', 'on', true)`);
  await tx
    .update(invoices)
    .set({ ...input.patch, status: result.to, updatedAt: new Date() })
    .where(eq(invoices.id, row.id));
  await tx.execute(sql`select set_config('fi.status_write', 'off', true)`);

  await tx.insert(invoiceEvents).values({
    invoiceId: row.id,
    type: 'transition',
    actor: input.actor,
    event: input.event,
    fromStatus: result.from,
    toStatus: result.to,
    pdpEventId: input.pdpEventId ?? null,
    payload: input.payload ?? {},
  });
  await audit(tx, {
    tenantId: row.tenantId,
    actor: input.actor,
    action: `invoice.${input.event}`,
    objectType: 'invoice',
    objectId: row.id,
    before: { status: result.from, fingerprint: row.fingerprint },
    after: { status: result.to, fingerprint: row.fingerprint },
  });
  return result;
}
