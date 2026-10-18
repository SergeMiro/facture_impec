// « Encaissée » (plan §6, status 212): the user records that the customer paid; the invoice is paid at
// once and its chasing plan ends, then a job reports the payment to the platform that holds the
// invoice. The payment_reports row is written with the payment, before the platform is called, so the
// payment is reported once whatever happens to the job (docs/B2BROUTER.md T21 for a lost answer).
import { endSteps, isIsoDate, parisToday } from '@fi/core';
import {
  and,
  applyTransition,
  audit,
  chasePlans,
  eq,
  invoices,
  lockInvoice,
  paymentReports,
  pdpSubmissions,
  sql,
  type TenantRow,
  tenants,
} from '@fi/db';
import { PdpUnavailableError } from '@fi/pdp-adapter';
import { z } from 'zod';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { label } from './invoices';
import { adapterFor } from './platform';
import type { WorkerDeps } from './workers';

export const PaymentBody = z.object({
  /** Europe/Paris; default today. */
  paidOn: z.string().refine(isIsoDate, 'YYYY-MM-DD').optional(),
});

/** Statuses from which the user may say « Encaissée » (core transition `paid`). */
const PAYABLE = ['deposited', 'delivered', 'accepted', 'overdue', 'chasing'] as const;

export async function recordPayment(
  deps: ApiDeps,
  tenant: TenantRow,
  id: string,
  input: z.infer<typeof PaymentBody>,
) {
  const now = deps.now();
  const paidOn = input.paidOn ?? parisToday(now);
  if (paidOn > parisToday(now)) throw new ApiError(400, 'payment_in_future');
  const report = await deps.db.transaction(async (tx) => {
    const row = await lockInvoice(tx, id);
    if (!row || row.tenantId !== tenant.id) throw new ApiError(404, 'not_found');
    if (row.status === 'paid') return false;
    if (!(PAYABLE as readonly string[]).includes(row.status)) {
      throw new ApiError(409, 'not_payable', { status: label(row.status) });
    }
    const amount = row.payable ?? 0;
    await applyTransition(tx, {
      invoiceId: id,
      event: 'paid',
      actor: 'user',
      payload: { paidOn, amount, source: 'user' },
      at: now,
    });
    const [plan] = await tx
      .select()
      .from(chasePlans)
      .where(eq(chasePlans.invoiceId, id))
      .for('update');
    if (plan) {
      await tx
        .update(chasePlans)
        .set({ steps: endSteps(plan.steps, now), nextStepOn: null, updatedAt: new Date() })
        .where(eq(chasePlans.id, plan.id));
    }
    // The platform that holds the invoice (test invoices sit on the test platform).
    const [held] = row.pdpRef
      ? await tx
          .select({ provider: pdpSubmissions.provider })
          .from(pdpSubmissions)
          .where(and(eq(pdpSubmissions.invoiceId, id), eq(pdpSubmissions.pdpRef, row.pdpRef)))
      : [];
    if (!held) return false;
    await tx
      .insert(paymentReports)
      .values({ tenantId: tenant.id, invoiceId: id, provider: held.provider, amount, paidOn })
      .onConflictDoNothing();
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'payment.record',
      objectType: 'invoice',
      objectId: id,
      after: { paidOn, amount },
    });
    return true;
  });
  // After the commit; the sweep queues a report whose job was lost (runSweep).
  if (report) await deps.jobs.enqueueReportPayment(id);
}

/** Reports one recorded payment to the platform. Throws to be retried while the platform is down. */
export async function runReportPayment(deps: WorkerDeps, invoiceId: string): Promise<void> {
  const [job] = await deps.db
    .select({
      report: paymentReports,
      pdpRef: invoices.pdpRef,
      isTest: invoices.isTest,
      account: tenants.pdpAccount,
      pdpProvider: tenants.pdpProvider,
      pdpKeySealed: tenants.pdpKeySealed,
    })
    .from(paymentReports)
    .innerJoin(invoices, eq(invoices.id, paymentReports.invoiceId))
    .innerJoin(tenants, eq(tenants.id, paymentReports.tenantId))
    .where(eq(paymentReports.invoiceId, invoiceId));
  if (job?.report.status !== 'pending' || !job.pdpRef) return;
  const adapter = job.isTest
    ? deps.pdp[job.report.provider]
    : adapterFor(deps, job, job.report.provider);
  const mark = (status: 'pending' | 'reported' | 'failed', error: string | null) =>
    deps.db.transaction(async (tx) => {
      await tx
        .update(paymentReports)
        .set({
          status,
          attempts: sql`${paymentReports.attempts} + 1`,
          lastError: error,
          updatedAt: deps.now(),
        })
        .where(eq(paymentReports.id, job.report.id));
      if (status !== 'pending') {
        await audit(tx, {
          tenantId: job.report.tenantId,
          actor: 'system',
          action: `payment.${status}`,
          objectType: 'invoice',
          objectId: invoiceId,
          ...(error && { after: { error } }),
        });
      }
    });
  try {
    if (!adapter) throw new PdpUnavailableError(`no ${job.report.provider} adapter configured`);
    await adapter.reportPayment({
      account: job.account,
      pdpRef: job.pdpRef,
      amount: job.report.amount,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // An outage is retried by the queue; a refusal will not get better by retrying.
    await mark(e instanceof PdpUnavailableError ? 'pending' : 'failed', message);
    if (e instanceof PdpUnavailableError) throw e;
    return;
  }
  await mark('reported', null);
}
