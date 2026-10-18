// Background work (plan §6 phases 6–7): send to the platform, apply its events, sweep what was
// missed. Each job is safe to run twice: sends reuse the idempotency key, platform events are
// applied once per event id.
import { toCii } from '@fi/core';
import {
  and,
  applyTransition,
  audit,
  type Db,
  eq,
  inArray,
  inboundQueue,
  invoiceEvents,
  invoices,
  isNotNull,
  isNull,
  lockInvoice,
  max,
  PDP_PROVIDERS,
  type PdpProvider,
  pdpSubmissions,
  sql,
  tenants,
} from '@fi/db';
import { eventFor, type PdpAdapter, PdpUnavailableError, type SendResult } from '@fi/pdp-adapter';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import type { Jobs, PdpRegistry, SyncTarget, TestPlatform } from './deps';
import { idempotencyKey } from './invoices';
import { QUEUES } from './jobs';
import { routeFor } from './platform';

export interface WorkerDeps {
  db: Db;
  pdp: PdpRegistry;
  test: TestPlatform | null;
  jobs: Jobs;
  now: () => Date;
}

const SendJob = z.object({ invoiceId: z.uuid() });
const SyncJob = z.object({
  provider: z.enum(PDP_PROVIDERS),
  account: z.string().min(1),
  pdpRef: z.string().min(1),
});

/** Statuses in which the platform still has something to tell us. */
const AWAITING_PLATFORM = ['deposited', 'delivered', 'accepted', 'overdue', 'chasing'] as const;

/** The platform said nothing usable yet (no reference stored, adapter missing): retry later. */
export class NotReadyError extends Error {}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runSend(deps: WorkerDeps, invoiceId: string): Promise<void> {
  // 1. Claim: ready_to_send → sending, and the submission row keyed by tenant + number + fingerprint.
  const claim = await deps.db.transaction(async (tx) => {
    const row = await lockInvoice(tx, invoiceId);
    if (!row) return null;
    let xml = row.xmlCii;
    if (row.status === 'ready_to_send') {
      xml = toCii(row.document);
      const moved = await applyTransition(tx, {
        invoiceId,
        event: 'send',
        actor: 'system',
        patch: { xmlCii: xml },
      });
      if (!moved.ok) return null;
    } else if (row.status !== 'sending') {
      return null; // sent, cancelled or rejected meanwhile: nothing to do
    }
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, row.tenantId));
    const route = tenant && routeFor(deps, tenant, row.isTest);
    if (!tenant || !xml || !route) return null;
    const key = idempotencyKey(row);
    await tx
      .insert(pdpSubmissions)
      .values({
        tenantId: tenant.id,
        invoiceId,
        idempotencyKey: key,
        provider: route.provider,
        attempts: 1,
      })
      .onConflictDoUpdate({
        target: pdpSubmissions.idempotencyKey,
        set: { attempts: sql`${pdpSubmissions.attempts} + 1`, updatedAt: deps.now() },
      });
    return { route, key, xml };
  });
  if (!claim) return;

  // 2. Call the platform outside any transaction.
  let result: SendResult;
  try {
    const { adapter, provider, account } = claim.route;
    if (!adapter) throw new NotReadyError(`no ${provider} adapter configured`);
    result = await adapter.sendInvoice({
      account,
      xml: claim.xml,
      format: 'CII',
      idempotencyKey: claim.key,
    });
  } catch (e) {
    // Outage or lost answer: back to ready_to_send, pg-boss retries with the same key.
    await deps.db.transaction(async (tx) => {
      await tx
        .update(pdpSubmissions)
        .set({ lastError: message(e), updatedAt: deps.now() })
        .where(eq(pdpSubmissions.idempotencyKey, claim.key));
      await applyTransition(tx, {
        invoiceId,
        event: 'send_interrupted',
        actor: 'system',
        payload: { error: message(e), retryable: e instanceof PdpUnavailableError },
      });
    });
    throw e;
  }

  // 3. Record the answer.
  await deps.db.transaction(async (tx) => {
    if (result.outcome === 'deposited') {
      await tx
        .update(pdpSubmissions)
        .set({ status: 'deposited', pdpRef: result.pdpRef, lastError: null, updatedAt: deps.now() })
        .where(eq(pdpSubmissions.idempotencyKey, claim.key));
      await applyTransition(tx, {
        invoiceId,
        event: 'deposited',
        actor: 'pdp',
        patch: { pdpRef: result.pdpRef },
        payload: { pdpRef: result.pdpRef },
      });
    } else {
      await tx
        .update(pdpSubmissions)
        .set({
          status: 'rejected',
          lastError: JSON.stringify(result.errors),
          updatedAt: deps.now(),
        })
        .where(eq(pdpSubmissions.idempotencyKey, claim.key));
      await applyTransition(tx, {
        invoiceId,
        event: 'rejected_by_pdp',
        actor: 'pdp',
        payload: { errors: result.errors },
      });
    }
  });
}

/**
 * Applies the platform events of one invoice that are not on its timeline yet, oldest first. An
 * event the state machine does not allow from the current status (« Reçue » then « Mise à
 * disposition », both `delivered` for us) is kept on the timeline as a platform event.
 */
export async function runSync(deps: WorkerDeps, target: SyncTarget): Promise<void> {
  const adapter: PdpAdapter | undefined = deps.pdp[target.provider];
  if (!adapter) throw new NotReadyError(`no ${target.provider} adapter configured`);
  // The submission says which platform holds the invoice: test invoices sit on the test platform.
  const [found] = await deps.db
    .select({ id: invoices.id })
    .from(invoices)
    .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
    .innerJoin(
      pdpSubmissions,
      and(eq(pdpSubmissions.invoiceId, invoices.id), eq(pdpSubmissions.pdpRef, invoices.pdpRef)),
    )
    .where(
      and(
        eq(invoices.pdpRef, target.pdpRef),
        eq(pdpSubmissions.provider, target.provider),
        eq(tenants.pdpAccount, target.account),
      ),
    );
  // A webhook can beat the send job's answer: the reference is not stored yet. Retry shortly.
  if (!found)
    throw new NotReadyError(`no invoice with ${target.provider} reference ${target.pdpRef}`);

  const history = await adapter.getStatus({ account: target.account, pdpRef: target.pdpRef });
  await deps.db.transaction(async (tx) => {
    const row = await lockInvoice(tx, found.id);
    if (!row) return;
    const applied = await tx
      .select({ id: invoiceEvents.pdpEventId })
      .from(invoiceEvents)
      .where(and(eq(invoiceEvents.invoiceId, row.id), isNotNull(invoiceEvents.pdpEventId)));
    const seen = new Set(applied.map((a) => a.id));
    for (const e of history) {
      if (seen.has(e.id)) continue;
      const event = eventFor(e.status);
      const payload = { pdpStatus: e.raw, at: e.at, ...(e.reason && { reason: e.reason }) };
      const result = event
        ? await applyTransition(tx, {
            invoiceId: row.id,
            event,
            actor: 'pdp',
            pdpEventId: e.id,
            payload,
          })
        : null;
      if (!result?.ok) {
        await tx.insert(invoiceEvents).values({
          invoiceId: row.id,
          type: 'pdp_event',
          actor: 'pdp',
          event,
          pdpEventId: e.id,
          payload: { ...payload, ...(result && { ignored: result.reason }) },
        });
      }
    }
    const last = history.at(-1);
    if (last && last.raw !== row.pdpStatusRaw) {
      await tx.update(invoices).set({ pdpStatusRaw: last.raw }).where(eq(invoices.id, row.id));
    }
  });
}

/** Refreshes every invoice the platform still has news about and re-queues unfinished sends. */
export async function runSweep(deps: WorkerDeps): Promise<{ synced: number; sends: number }> {
  const inFlight = await deps.db
    .select({
      pdpRef: invoices.pdpRef,
      provider: pdpSubmissions.provider,
      account: tenants.pdpAccount,
    })
    .from(invoices)
    .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
    .innerJoin(
      pdpSubmissions,
      and(eq(pdpSubmissions.invoiceId, invoices.id), eq(pdpSubmissions.pdpRef, invoices.pdpRef)),
    )
    .where(and(inArray(invoices.status, AWAITING_PLATFORM), isNotNull(invoices.pdpRef)));
  for (const i of inFlight) {
    if (i.pdpRef) await deps.jobs.enqueueSync({ ...i, pdpRef: i.pdpRef });
  }
  const unfinished = await deps.db
    .select({ id: invoices.id })
    .from(invoices)
    .where(inArray(invoices.status, ['ready_to_send', 'sending']));
  for (const i of unfinished) await deps.jobs.enqueueSend(i.id);
  return { synced: inFlight.length, sends: unfinished.length };
}

/**
 * Asks each company's platform for the supplier invoices it received since the last one stored, and
 * stores each one once (plan §11 M4 « inbound polling »; reading them is M6). A company is polled on
 * its own platform and, in « Mode test », on the test platform too. One platform failing does not
 * stop the others: the next sweep asks again from the same point.
 */
export async function runInboundPoll(
  deps: WorkerDeps,
  log: (message: string) => void = () => {},
): Promise<{ stored: number; failed: number }> {
  const companies = await deps.db
    .select({
      id: tenants.id,
      provider: tenants.pdpProvider,
      account: tenants.pdpAccount,
      sandboxEnabled: tenants.sandboxEnabled,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .where(isNull(tenants.deletedAt));
  let stored = 0;
  let failed = 0;
  for (const company of companies) {
    const providers = new Set<PdpProvider>([company.provider]);
    if (company.sandboxEnabled && deps.test) providers.add(deps.test.provider);
    for (const provider of providers) {
      const adapter = deps.pdp[provider];
      if (!adapter) continue;
      try {
        stored += await pollOne(deps, adapter, { ...company, provider });
      } catch (e) {
        failed++;
        log(`inbound ${provider} ${company.account}: ${message(e)}`);
      }
    }
  }
  return { stored, failed };
}

async function pollOne(
  deps: WorkerDeps,
  adapter: PdpAdapter,
  company: { id: string; provider: PdpProvider; account: string; createdAt: Date },
): Promise<number> {
  const [last] = await deps.db
    .select({ at: max(inboundQueue.receivedAt) })
    .from(inboundQueue)
    .where(and(eq(inboundQueue.tenantId, company.id), eq(inboundQueue.provider, company.provider)));
  const since = last?.at ?? company.createdAt;
  const received = await adapter.listInbound({ account: company.account, since });
  let stored = 0;
  for (const r of received) {
    const receivedAt = new Date(r.receivedAt);
    if (Number.isNaN(receivedAt.getTime())) throw new Error(`bad receivedAt for ${r.pdpRef}`);
    await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(inboundQueue)
        .values({
          tenantId: company.id,
          provider: company.provider,
          pdpRef: r.pdpRef,
          receivedAt,
          xml: r.xml,
        })
        .onConflictDoNothing()
        .returning({ id: inboundQueue.id });
      if (!row) return;
      stored++;
      await audit(tx, {
        tenantId: company.id,
        actor: 'pdp',
        action: 'inbound_received',
        objectType: 'inbound',
        objectId: row.id,
        after: r.xml,
      });
    });
  }
  return stored;
}

export interface WorkerOptions {
  pollingIntervalSeconds?: number;
  sweepEverySeconds: number;
  log?: (message: string) => void;
}

/** Registers the workers and the periodic sweep; returns a function that stops the sweep timer. */
export async function startWorkers(
  boss: PgBoss,
  deps: WorkerDeps,
  options: WorkerOptions,
): Promise<() => void> {
  const polling = { pollingIntervalSeconds: options.pollingIntervalSeconds ?? 2 };
  await boss.work(QUEUES.send, { ...polling, localConcurrency: 4 }, async ([job]) => {
    if (job) await runSend(deps, SendJob.parse(job.data).invoiceId);
  });
  await boss.work(QUEUES.sync, { ...polling, localConcurrency: 4 }, async ([job]) => {
    if (job) await runSync(deps, SyncJob.parse(job.data));
  });
  await boss.work(QUEUES.sweep, polling, async () => {
    await runSweep(deps);
    await runInboundPoll(deps, options.log);
  });
  const tick = () =>
    boss
      .send(QUEUES.sweep, {}, { singletonSeconds: options.sweepEverySeconds })
      .catch((e: unknown) => options.log?.(`sweep not queued: ${message(e)}`));
  void tick();
  const timer = setInterval(tick, options.sweepEverySeconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
