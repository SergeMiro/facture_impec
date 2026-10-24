// pg-boss queues (plan §1). The queue lives in the same Postgres as the data: PGlite in tests and
// local dev, node-postgres elsewhere.
import type { Database } from '@fi/db';
import { fromPglite, PgBoss } from 'pg-boss';
import type { Jobs, SyncTarget } from './deps';

export const QUEUES = {
  /** One invoice to the platform. `exclusive`: one job per invoice, queued or running. */
  send: 'invoice.send',
  /** Fetch an invoice's platform history and apply what is new. `stately`: one running + one queued. */
  sync: 'invoice.sync',
  /** Safety net: refresh invoices in flight, queue sends that never finished. */
  sweep: 'pdp.sweep',
  /** MonitorAgent advice after a rejection or a refusal. One per invoice at a time. */
  monitor: 'invoice.monitor',
  /** « Encaissée » reported to the platform. */
  reportPayment: 'invoice.report_payment',
  /** A company's registry brought up to date. `stately` per company: one running + one queued. */
  registry: 'registry.refresh',
  /** A connected account's picked files checked (src/connectors.ts). `stately` per connection. */
  connector: 'connector.check',
  /** A document read (src/ingest.ts): its data, its text, or OCR. `exclusive` per document. */
  ingest: 'document.ingest',
  /** An invoice document checked by the rules (src/ingest.ts). `exclusive` per document. */
  validate: 'document.validate',
  /** A text document classified, linked and its deadlines derived (src/document-pipeline.ts). */
  classify: 'document.classify',
  /** What a person approved, sent (src/actions.ts). `exclusive` per action. */
  action: 'action.send',
} as const;

export function createBoss(database: Database): PgBoss {
  return database.kind === 'pglite'
    ? new PgBoss({ db: fromPglite(database.pglite), backend: 'pglite' })
    : new PgBoss({ connectionString: database.url });
}

export async function ensureQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUES.send, {
    policy: 'exclusive',
    retryLimit: 8,
    retryDelay: 1,
    retryBackoff: true,
    retryDelayMax: 300,
    expireInSeconds: 120,
  });
  await boss.createQueue(QUEUES.sync, {
    policy: 'stately',
    retryLimit: 8,
    retryDelay: 1,
    retryBackoff: true,
    retryDelayMax: 60,
    expireInSeconds: 60,
  });
  await boss.createQueue(QUEUES.sweep, { policy: 'short', retryLimit: 0, expireInSeconds: 300 });
  // An agent call takes up to the orchestrator's timeout, retries included.
  await boss.createQueue(QUEUES.monitor, {
    policy: 'stately',
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 600,
  });
  await boss.createQueue(QUEUES.reportPayment, {
    policy: 'exclusive',
    retryLimit: 8,
    retryDelay: 5,
    retryBackoff: true,
    retryDelayMax: 600,
    expireInSeconds: 120,
  });
  // 50 000 lines take seconds (docs/PROGRESS.md R0); a retry starts again from what is left.
  await boss.createQueue(QUEUES.registry, {
    policy: 'stately',
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 600,
  });
  // Twenty files of 10 MB at worst; Microsoft asking to wait is handled inside, not retried here.
  await boss.createQueue(QUEUES.connector, {
    policy: 'stately',
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 600,
  });
  // OCR of ten pages takes about twenty seconds; a missing tool is retried, then the sweep tries again.
  await boss.createQueue(QUEUES.ingest, {
    policy: 'exclusive',
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 300,
  });
  await boss.createQueue(QUEUES.validate, {
    policy: 'exclusive',
    retryLimit: 3,
    retryDelay: 5,
    retryBackoff: true,
    expireInSeconds: 60,
  });
  // A model's call takes up to the orchestrator's timeout, its own retries included.
  await boss.createQueue(QUEUES.classify, {
    policy: 'exclusive',
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    expireInSeconds: 600,
  });
  // A failed mail is counted on the action itself (three tries, then « failed »): the queue's
  // retries carry those tries.
  await boss.createQueue(QUEUES.action, {
    policy: 'exclusive',
    retryLimit: 3,
    retryDelay: 30,
    retryBackoff: true,
    expireInSeconds: 300,
  });
}

export const syncKey = (target: SyncTarget) =>
  `${target.provider}:${target.account}:${target.pdpRef}`;

export function bossJobs(boss: PgBoss): Jobs {
  return {
    async enqueueSend(invoiceId) {
      await boss.send(QUEUES.send, { invoiceId }, { singletonKey: invoiceId });
    },
    async enqueueSync(target) {
      await boss.send(QUEUES.sync, target, { singletonKey: syncKey(target) });
    },
    async enqueueMonitor(invoiceId) {
      await boss.send(QUEUES.monitor, { invoiceId }, { singletonKey: invoiceId });
    },
    async enqueueReportPayment(invoiceId) {
      await boss.send(QUEUES.reportPayment, { invoiceId }, { singletonKey: invoiceId });
    },
    async enqueueRegistry(tenantId) {
      await boss.send(QUEUES.registry, { tenantId }, { singletonKey: tenantId });
    },
    async enqueueConnector(connectionId) {
      await boss.send(QUEUES.connector, { connectionId }, { singletonKey: connectionId });
    },
    async enqueueIngest(documentId) {
      await boss.send(QUEUES.ingest, { documentId }, { singletonKey: documentId });
    },
    async enqueueValidate(documentId) {
      await boss.send(QUEUES.validate, { documentId }, { singletonKey: documentId });
    },
    async enqueueClassify(documentId) {
      await boss.send(QUEUES.classify, { documentId }, { singletonKey: documentId });
    },
    async enqueueAction(actionId) {
      await boss.send(QUEUES.action, { actionId }, { singletonKey: actionId });
    },
  };
}
