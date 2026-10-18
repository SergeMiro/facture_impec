// The MonitorAgent job (plan §6 phase 7): after a platform rejection or a customer refusal lands on
// an invoice, a note on its timeline says what to do next (@fi/agents adviseNext). Queued by the send
// and sync jobs after their commit, and by the sweep for any it missed. Advice only: no status changes.
import { adviseNext, type MonitorEvent } from '@fi/agents';
import {
  and,
  audit,
  desc,
  eq,
  type InvoiceEventRow,
  inArray,
  invoiceEvents,
  invoices,
  lockInvoice,
  sql,
  tenants,
} from '@fi/db';
import { z } from 'zod';
import { tenantAi } from './ai';
import { recipientOf } from './collect';
import type { WorkerDeps } from './workers';

/** Statuses a platform event brings that the user must act on. */
export const ADVISED = ['rejected_by_pdp', 'refused_by_customer'] as const;

const Rejection = z.object({
  errors: z.array(z.object({ rule: z.string(), message: z.string() })).default([]),
});
const Refusal = z.object({
  reason: z.object({ code: z.string().optional(), text: z.string().optional() }).optional(),
});

function eventOf(row: InvoiceEventRow): MonitorEvent {
  if (row.toStatus === 'rejected_by_pdp') {
    const parsed = Rejection.safeParse(row.payload);
    return { kind: 'rejection', errors: parsed.success ? parsed.data.errors : [] };
  }
  const parsed = Refusal.safeParse(row.payload);
  return { kind: 'refusal', reason: (parsed.success && parsed.data.reason) || null };
}

const advised = sql`exists (select 1 from ${invoiceEvents} n where n.invoice_id = ${invoiceEvents.invoiceId} and n.type = 'note' and n.event = 'monitor' and (n.payload_json->>'for')::bigint = ${invoiceEvents.id})`;

/** Invoices whose latest rejection or refusal has no advice yet (the sweep's safety net). */
export async function awaitingAdvice(deps: Pick<WorkerDeps, 'db'>, limit = 50) {
  const rows = await deps.db
    .selectDistinct({ invoiceId: invoiceEvents.invoiceId })
    .from(invoiceEvents)
    .innerJoin(invoices, eq(invoices.id, invoiceEvents.invoiceId))
    .where(
      and(
        eq(invoiceEvents.type, 'transition'),
        inArray(invoiceEvents.toStatus, [...ADVISED]),
        inArray(invoices.status, [...ADVISED]),
        sql`not ${advised}`,
      ),
    )
    .limit(limit);
  return rows.map((r) => r.invoiceId);
}

export async function runMonitor(deps: WorkerDeps, invoiceId: string): Promise<void> {
  const [found] = await deps.db
    .select({ invoice: invoices, tenant: tenants })
    .from(invoices)
    .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
    .where(eq(invoices.id, invoiceId));
  if (!found) return;
  const { invoice, tenant } = found;
  const [last] = await deps.db
    .select()
    .from(invoiceEvents)
    .where(
      and(
        eq(invoiceEvents.invoiceId, invoiceId),
        eq(invoiceEvents.type, 'transition'),
        inArray(invoiceEvents.toStatus, [...ADVISED]),
      ),
    )
    .orderBy(desc(invoiceEvents.id))
    .limit(1);
  if (!last) return;
  const [done] = await deps.db
    .select({ id: invoiceEvents.id })
    .from(invoiceEvents)
    .where(and(eq(invoiceEvents.id, last.id), advised));
  if (done) return;

  const { advice, rejected } = await adviseNext(
    {
      number: invoice.number ?? '',
      issueDate: invoice.issueDate ?? '',
      dueDate: invoice.dueDate,
      payable: invoice.payable ?? 0,
      currency: invoice.currency ?? 'EUR',
      seller: tenant.name,
      customer: invoice.buyerName ?? '',
      to: recipientOf(invoice),
    },
    eventOf(last),
    {
      tenantId: tenant.id,
      invoiceId,
      ai: tenantAi(deps.ai, tenant),
      orchestrator: deps.ai.orchestrator,
    },
  );
  await deps.db.transaction(async (tx) => {
    await lockInvoice(tx, invoiceId);
    const [again] = await tx
      .select({ id: invoiceEvents.id })
      .from(invoiceEvents)
      .where(and(eq(invoiceEvents.id, last.id), advised));
    if (again) return;
    await tx.insert(invoiceEvents).values({
      invoiceId,
      type: 'note',
      actor: 'agent:monitor',
      event: 'monitor',
      payload: { for: last.id, ...advice },
    });
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'agent:monitor',
      action: 'monitor.advice',
      objectType: 'invoice',
      objectId: invoiceId,
      after: { for: last.id, proposal: advice.proposal, source: advice.source, rejected },
    });
  });
}
