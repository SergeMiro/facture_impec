// Background work (plan §6 phases 6–9): send to the platform, apply its events, advise on rejections
// and refusals, report payments, chase, sweep what was missed. Each job is safe to run twice: sends
// reuse the idempotency key, platform events are applied once per event id, advice is written once
// per event, a payment is reported once, and each chasing step is claimed before it is mailed.
import { toCii } from '@fi/core';
import type { FacturXOptions } from '@fi/core/pdf';
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
  notLike,
  PDP_PROVIDERS,
  type PdpProvider,
  paymentReports,
  pdpSubmissions,
  sql,
  tenants,
} from '@fi/db';
import { eventFor, type PdpAdapter, PdpUnavailableError, type SendResult } from '@fi/pdp-adapter';
import type { FiEnv } from '@fi/shared/env';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';
import { runActionSend } from './actions';
import { archiveReceived, archiveSent, runArchive } from './archive';
import { runAutopilot } from './autopilot';
import { type Billing, recordUsage, runUsageReport } from './billing';
import { checkNow, checksBehind } from './checks';
import { runCollect } from './collect';
import {
  checkConnection,
  connectorsBehind,
  type GoogleConnector,
  type MicrosoftConnector,
} from './connectors';
import { creditOriginal } from './credits';
import type {
  AiDeps,
  Jobs,
  Mailer,
  OwnPlatform,
  PdpRegistry,
  SyncTarget,
  TestPlatform,
} from './deps';
import { runDocumentClassify } from './document-pipeline';
import { runErpSync } from './erp';
import { INJECTED_PREFIX, triagePending } from './inbound';
import {
  documentsBehind,
  inboundDocuments,
  runDocumentIngest,
  runDocumentValidate,
} from './ingest';
import { idempotencyKey } from './invoices';
import { QUEUES } from './jobs';
import { ADVISED, awaitingAdvice, runMonitor } from './monitor';
import { runReportPayment } from './payments';
import { adapterFor, awaitsGoLive, routeFor } from './platform';
import { registryBehind } from './registry';
import { runWeeklyReports } from './report';
import { purgeExpired } from './rgpd';
import { runVatChecks } from './vat-checks';
import type { Vies } from './vies';
import { runWatchers } from './watchers';

export interface WorkerDeps {
  /**
   * FI_ENV for the go-live gate (src/platform.ts), API_PUBLIC_URL for the weekly e-mail's links
   * (src/action-links.ts); absent in unit tests: not prod, no links.
   */
  env?: { FI_ENV: FiEnv; API_PUBLIC_URL?: string };
  db: Db;
  pdp: PdpRegistry;
  test: TestPlatform | null;
  /** Company platform keys (src/platform.ts adapterFor); absent: every company uses ours. */
  ownPdp?: OwnPlatform | null;
  jobs: Jobs;
  ai: AiDeps;
  mailer: Mailer | null;
  /** Counts real sends and reports those beyond the quota (src/billing.ts). */
  billing?: Billing | null;
  /** For the archived PDF (src/archive.ts); absent: the bundled fonts. */
  fonts?: FacturXOptions['fonts'];
  /** OneDrive files (src/connectors.ts); absent: no connection is checked. */
  microsoft?: MicrosoftConnector | null;
  /** Google Drive files (R5); absent: no Google connection is checked. */
  google?: GoogleConnector | null;
  /** EU customers' VAT numbers (src/vat-checks.ts); absent: never asked. */
  vies?: Vies | null;
  now: () => Date;
}

const SendJob = z.object({ invoiceId: z.uuid() });
const InvoiceJob = SendJob;
const RegistryJob = z.object({ tenantId: z.uuid() });
const ConnectorJob = z.object({ connectionId: z.uuid() });
const DocumentJob = z.object({ documentId: z.uuid() });
const ActionJob = z.object({ actionId: z.uuid() });
const ErpJob = z.object({ tenantId: z.uuid(), connector: z.string().min(1) });
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
    return { route, key, xml, tenantId: tenant.id, isTest: row.isTest };
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
      // A credit note now held by the platform cancels the invoice it names.
      await creditOriginal(tx, invoiceId, deps.now());
      if (!claim.isTest) {
        await recordUsage(tx, deps, { id: invoiceId, tenantId: claim.tenantId }, deps.now());
      }
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
  if (result.outcome === 'rejected') await deps.jobs.enqueueMonitor(invoiceId);
  // Into the ten-year archive right away; if this fails, the sweep archives it (runArchive).
  if (result.outcome === 'deposited' && !claim.isTest) {
    await archiveSent(deps, invoiceId).catch(() => false);
  }
}

/**
 * Applies the platform events of one invoice that are not on its timeline yet, oldest first. An
 * event the state machine does not allow from the current status (« Reçue » then « Mise à
 * disposition », both `delivered` for us) is kept on the timeline as a platform event.
 */
export async function runSync(deps: WorkerDeps, target: SyncTarget): Promise<void> {
  // The submission says which platform holds the invoice: test invoices sit on the test platform.
  const [found] = await deps.db
    .select({
      id: invoices.id,
      isTest: invoices.isTest,
      pdpProvider: tenants.pdpProvider,
      pdpKeySealed: tenants.pdpKeySealed,
    })
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
  // A real invoice is followed with the key it was sent with: the company's own, when it has one.
  const adapter: PdpAdapter | undefined = found.isTest
    ? deps.pdp[target.provider]
    : adapterFor(deps, found, target.provider);
  if (!adapter) throw new NotReadyError(`no ${target.provider} adapter configured`);

  const history = await adapter.getStatus({ account: target.account, pdpRef: target.pdpRef });
  let advise = false;
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
      if (result?.ok && (ADVISED as readonly string[]).includes(result.to)) advise = true;
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
  if (advise) await deps.jobs.enqueueMonitor(found.id);
}

/**
 * Refreshes every invoice the platform still has news about, re-queues unfinished sends, and queues
 * the advice, payment reports and registry refreshes (with their checks) whose job was lost, and the
 * checks of connected files that are due.
 */
export async function runSweep(deps: WorkerDeps): Promise<{
  synced: number;
  sends: number;
  advice: number;
  payments: number;
  registry: number;
  connectors: number;
  documents: number;
}> {
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
  const advice = await awaitingAdvice(deps);
  for (const id of advice) await deps.jobs.enqueueMonitor(id);
  const payments = await deps.db
    .selectDistinct({ id: paymentReports.invoiceId })
    .from(paymentReports)
    .where(eq(paymentReports.status, 'pending'));
  for (const p of payments) await deps.jobs.enqueueReportPayment(p.id);
  // The registry job also checks the documents again (src/checks.ts): behind on either, it runs.
  const behind = [
    ...new Set([...(await registryBehind(deps.db)), ...(await checksBehind(deps.db, deps.now()))]),
  ];
  for (const tenantId of behind) await deps.jobs.enqueueRegistry(tenantId);
  const due =
    deps.microsoft || deps.google ? await connectorsBehind(deps.db, deps.now(), deps) : [];
  for (const id of due) await deps.jobs.enqueueConnector(id);
  // A document a worker left half-way (a crash, a deploy, a tool missing) is read again.
  const stuck = await documentsBehind(deps.db, deps.now());
  for (const id of stuck.read) await deps.jobs.enqueueIngest(id);
  for (const id of stuck.classify) await deps.jobs.enqueueClassify(id);
  for (const id of stuck.validate) await deps.jobs.enqueueValidate(id);
  return {
    synced: inFlight.length,
    sends: unfinished.length,
    advice: advice.length,
    payments: payments.length,
    registry: behind.length,
    connectors: due.length,
    documents: stuck.read.length + stuck.classify.length + stuck.validate.length,
  };
}

/**
 * Asks each company's platform for the supplier invoices it received since the last one stored,
 * stores each one once (plan §11 M4 « inbound polling »), then lets the InboundAgent triage them
 * (M6). A company is polled on its own platform and, in « Mode test », on the test platform too:
 * what only the test platform delivered is a test invoice. One platform failing does not stop the
 * others: the next sweep asks again from the same point.
 */
export async function runInboundPoll(
  deps: WorkerDeps,
  log: (message: string) => void = () => {},
): Promise<{ stored: number; failed: number; triaged: number }> {
  const companies = await deps.db
    .select({
      id: tenants.id,
      provider: tenants.pdpProvider,
      account: tenants.pdpAccount,
      pdpKeySealed: tenants.pdpKeySealed,
      sandboxEnabled: tenants.sandboxEnabled,
      liveAt: tenants.liveAt,
      createdAt: tenants.createdAt,
    })
    .from(tenants)
    .where(isNull(tenants.deletedAt));
  let stored = 0;
  let failed = 0;
  for (const company of companies) {
    // A company not live yet in prod has no account at the real platform to ask.
    const providers = new Set<PdpProvider>(awaitsGoLive(deps, company) ? [] : [company.provider]);
    if (company.sandboxEnabled && deps.test) providers.add(deps.test.provider);
    for (const provider of providers) {
      const isTest = provider !== company.provider;
      const keyed = { pdpProvider: company.provider, pdpKeySealed: company.pdpKeySealed };
      const adapter = isTest ? deps.pdp[provider] : adapterFor(deps, keyed, provider);
      if (!adapter) continue;
      try {
        stored += await pollOne(deps, adapter, { ...company, provider, isTest });
      } catch (e) {
        failed++;
        log(`inbound ${provider} ${company.account}: ${message(e)}`);
      }
    }
  }
  const triaged = await triagePending(deps, undefined, log);
  await inboundDocuments(deps, log);
  return { stored, failed, triaged };
}

async function pollOne(
  deps: WorkerDeps,
  adapter: PdpAdapter,
  company: { id: string; provider: PdpProvider; account: string; createdAt: Date; isTest: boolean },
): Promise<number> {
  // The API's own test invoices (inbound.ts) were never at the platform: they say nothing of it.
  const [last] = await deps.db
    .select({ at: max(inboundQueue.receivedAt) })
    .from(inboundQueue)
    .where(
      and(
        eq(inboundQueue.tenantId, company.id),
        eq(inboundQueue.provider, company.provider),
        notLike(inboundQueue.pdpRef, `${INJECTED_PREFIX}%`),
      ),
    );
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
          isTest: company.isTest,
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
      if (!company.isTest) {
        await archiveReceived(
          tx,
          { tenantId: company.id, inboundId: row.id, xml: r.xml },
          deps.now(),
        );
      }
    });
  }
  return stored;
}

export interface WorkerOptions {
  pollingIntervalSeconds?: number;
  sweepEverySeconds: number;
  /** How often chasing and the weekly report run (real seconds); default 5 minutes. */
  collectEverySeconds?: number;
  log?: (message: string) => void;
}

export const COLLECT_EVERY_SECONDS = 300;

/** Registers the workers, the periodic sweep and chasing; returns a function that stops the timers. */
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
    await runAutopilot(deps, options.log);
    await runSweep(deps);
    await runArchive(deps, options.log);
    await runInboundPoll(deps, options.log);
    await runUsageReport(deps, options.log);
    await runVatChecks(deps, options.log);
  });
  await boss.work(QUEUES.monitor, { ...polling, localConcurrency: 2 }, async ([job]) => {
    if (job) await runMonitor(deps, InvoiceJob.parse(job.data).invoiceId);
  });
  await boss.work(QUEUES.reportPayment, polling, async ([job]) => {
    if (job) await runReportPayment(deps, InvoiceJob.parse(job.data).invoiceId);
  });
  await boss.work(QUEUES.registry, polling, async ([job]) => {
    if (job) await checkNow(deps.db, RegistryJob.parse(job.data).tenantId, deps.now());
  });
  // OCR takes the CPU: two documents at a time per process.
  await boss.work(QUEUES.ingest, { ...polling, localConcurrency: 2 }, async ([job]) => {
    if (job) await runDocumentIngest(deps, DocumentJob.parse(job.data).documentId);
  });
  await boss.work(QUEUES.validate, { ...polling, localConcurrency: 2 }, async ([job]) => {
    if (job) await runDocumentValidate(deps, DocumentJob.parse(job.data).documentId);
  });
  // Mostly waiting on a model: three at a time, under the orchestrator's own semaphores.
  await boss.work(QUEUES.classify, { ...polling, localConcurrency: 3 }, async ([job]) => {
    if (job) await runDocumentClassify(deps, DocumentJob.parse(job.data).documentId);
  });
  // A request a person approved (src/actions.ts): a failed mail throws, and the queue tries again.
  await boss.work(QUEUES.action, { ...polling, localConcurrency: 2 }, async ([job]) => {
    if (job) await runActionSend(deps, ActionJob.parse(job.data).actionId);
  });
  // An ERP's list (src/erp.ts): a fatal error is kept on its sync row, anything else is retried.
  await boss.work(QUEUES.erp, polling, async ([job]) => {
    if (job) {
      const { tenantId, connector } = ErpJob.parse(job.data);
      await runErpSync(deps, tenantId, connector);
    }
  });
  await boss.work(QUEUES.connector, polling, async ([job]) => {
    if (job) {
      await checkConnection(deps, ConnectorJob.parse(job.data).connectionId, options.log);
    }
  });
  const tick = () =>
    boss
      .send(QUEUES.sweep, {}, { singletonSeconds: options.sweepEverySeconds })
      .catch((e: unknown) => options.log?.(`sweep not queued: ${message(e)}`));
  void tick();
  const timer = setInterval(tick, options.sweepEverySeconds * 1000);
  timer.unref();

  // Chasing runs on its own timer rather than through the queue: it must see each business day,
  // and the scenario stack's accelerated clock turns a day into a fraction of a second. Plans are
  // locked row by row, so instances running it at once do not act twice. Expired sign-in rows go
  // on the same timer (src/rgpd.ts purgeExpired), and so do the deadline watchers (src/watchers.ts),
  // which must see each business day too.
  let collecting = false;
  const collect = async () => {
    if (collecting) return;
    collecting = true;
    try {
      await runCollect(deps, options.log);
      await runWatchers(deps, options.log);
      await runWeeklyReports(deps, options.log);
      await purgeExpired(deps);
    } catch (e) {
      options.log?.(`chasing run failed: ${message(e)}`);
    } finally {
      collecting = false;
    }
  };
  void collect();
  const collectTimer = setInterval(
    collect,
    (options.collectEverySeconds ?? COLLECT_EVERY_SECONDS) * 1000,
  );
  collectTimer.unref();
  return () => {
    clearInterval(timer);
    clearInterval(collectTimer);
  };
}
