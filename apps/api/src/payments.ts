// « Encaissée » (plan §6, status 212): the user records what the customer paid. The payment that
// settles the balance makes the invoice paid at once and ends its chasing; a smaller one (an
// instalment) is added to what was received, and the chasing goes on for the rest. Then a job reports
// each payment to the platform that holds the invoice. A payment_reports row is written with each
// payment, before the platform is called, so a payment is reported once whatever happens to the job
// (docs/B2BROUTER.md T21 for a lost answer, T25 for several payments on one invoice).
import { frMoney, isIsoDate, parisToday } from '@fi/core';
import {
  and,
  applyTransition,
  asc,
  audit,
  eq,
  invoiceEvents,
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
import { endPlan } from './collect';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { label } from './invoices';
import { adapterFor } from './platform';
import type { WorkerDeps } from './workers';

export const PaymentBody = z.object({
  /** Europe/Paris; default today. */
  paidOn: z.string().refine(isIsoDate, 'YYYY-MM-DD').optional(),
  /** Cents received; default what is left to pay. */
  amount: z.number().int().positive().optional(),
  /**
   * Cents the pane showed as already received. Another figure means a payment was recorded meanwhile
   * (a second click, another pane): this one is refused rather than counted twice.
   */
  paidBefore: z.number().int().nonnegative().optional(),
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
    const money = (cents: number) => frMoney(cents, row.currency ?? 'EUR');
    if (input.paidBefore !== undefined && input.paidBefore !== row.amountPaid) {
      throw new ApiError(409, 'payment_changed', { paid: money(row.amountPaid) });
    }
    const balance = Math.max(0, (row.payable ?? 0) - row.amountPaid);
    const amount = input.amount ?? balance;
    if (amount > balance) throw new ApiError(400, 'payment_too_much', { balance: money(balance) });
    const paid = row.amountPaid + amount;
    const left = balance - amount;
    await tx.update(invoices).set({ amountPaid: paid }).where(eq(invoices.id, id));
    if (left === 0) {
      await applyTransition(tx, {
        invoiceId: id,
        event: 'paid',
        actor: 'user',
        payload: { paidOn, amount, paid, source: 'user' },
        at: now,
      });
      await endPlan(tx, id, now);
    } else {
      await tx.insert(invoiceEvents).values({
        invoiceId: id,
        type: 'note',
        actor: 'user',
        event: 'payment_partial',
        at: now,
        payload: { paidOn, amount, paid, left },
      });
    }
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: left === 0 ? 'payment.record' : 'payment.partial',
      objectType: 'invoice',
      objectId: id,
      after: { paidOn, amount, paid, left },
    });
    // The platform that holds the invoice (test invoices sit on the test platform).
    const [held] = row.pdpRef
      ? await tx
          .select({ provider: pdpSubmissions.provider })
          .from(pdpSubmissions)
          .where(and(eq(pdpSubmissions.invoiceId, id), eq(pdpSubmissions.pdpRef, row.pdpRef)))
      : [];
    if (!held || amount === 0) return false;
    await tx
      .insert(paymentReports)
      .values({ tenantId: tenant.id, invoiceId: id, provider: held.provider, amount, paidOn });
    return true;
  });
  // After the commit; the sweep queues a report whose job was lost (runSweep).
  if (report) await deps.jobs.enqueueReportPayment(id);
}

/** The invoice's payments not reported yet, oldest first. */
const pendingReports = (deps: WorkerDeps, invoiceId: string) =>
  deps.db
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
    .where(and(eq(paymentReports.invoiceId, invoiceId), eq(paymentReports.status, 'pending')))
    .orderBy(asc(paymentReports.createdAt), asc(paymentReports.id));

type ReportJob = Awaited<ReturnType<typeof pendingReports>>[number];

/** Reports the invoice's recorded payments to the platform. Throws to be retried while it is down. */
export async function runReportPayment(deps: WorkerDeps, invoiceId: string): Promise<void> {
  // An outage throws out of the loop: the later payments wait with it for the retry.
  for (const job of await pendingReports(deps, invoiceId)) await reportOne(deps, invoiceId, job);
}

async function reportOne(deps: WorkerDeps, invoiceId: string, job: ReportJob): Promise<void> {
  if (!job.pdpRef) return;
  const pdpRef = job.pdpRef;
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
    await adapter.reportPayment({ account: job.account, pdpRef, amount: job.report.amount });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // An outage is retried by the queue; a refusal will not get better by retrying.
    await mark(e instanceof PdpUnavailableError ? 'pending' : 'failed', message);
    if (e instanceof PdpUnavailableError) throw e;
    return;
  }
  await mark('reported', null);
}
