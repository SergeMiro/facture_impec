// The functions that write invoices.status and inbound_queue.status (plan §4). Each locks the row,
// asks the core state machine, writes the status and the audit event (and an invoice's timeline event)
// in the caller's transaction. Triggers (migrations 0001, 0005) refuse a status write from elsewhere.
import {
  type Actor,
  type InboundEvent,
  type InboundState,
  type InvoiceEvent,
  inboundTransition,
  type TransitionResult,
  transition,
} from '@fi/core';
import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from './client';
import { hashOf } from './hash';
import {
  auditEvents,
  type InboundRow,
  type InvoiceRow,
  inboundQueue,
  invoiceEvents,
  invoices,
} from './schema';

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
  /** When it happened in business time (the chasing run's clock); the database clock otherwise. */
  at?: Date;
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
    ...(input.at && { at: input.at }),
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

/** Columns that may change together with a supplier invoice's status. */
export type InboundPatch = Partial<
  Pick<InboundRow, 'decidedAt' | 'decidedBy' | 'disputeReason' | 'exportId'>
>;

export type InboundResult =
  | { ok: true; row: InboundRow; from: InboundState }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'not_allowed'; from: InboundState };

/** Moves one supplier invoice of `tenantId`; `audit` carries what the decision rested on. */
export async function applyInboundTransition(
  tx: Tx,
  input: {
    id: string;
    tenantId: string;
    event: InboundEvent;
    actor: Actor;
    patch?: InboundPatch;
    audit?: Record<string, unknown>;
  },
): Promise<InboundResult> {
  const [row] = await tx
    .select()
    .from(inboundQueue)
    .where(and(eq(inboundQueue.id, input.id), eq(inboundQueue.tenantId, input.tenantId)))
    .for('update');
  if (!row) return { ok: false, reason: 'not_found' };
  const to = inboundTransition(row.status, input.event);
  if (!to) return { ok: false, reason: 'not_allowed', from: row.status };

  await tx.execute(sql`select set_config('fi.status_write', 'on', true)`);
  const [moved] = await tx
    .update(inboundQueue)
    .set({ ...input.patch, status: to, updatedAt: new Date() })
    .where(eq(inboundQueue.id, row.id))
    .returning();
  await tx.execute(sql`select set_config('fi.status_write', 'off', true)`);
  if (!moved) return { ok: false, reason: 'not_found' };

  await audit(tx, {
    tenantId: row.tenantId,
    actor: input.actor,
    action: `inbound.${input.event}`,
    objectType: 'inbound',
    objectId: row.id,
    before: { status: row.status },
    after: { status: to, ...input.audit },
  });
  return { ok: true, row: moved, from: row.status };
}
