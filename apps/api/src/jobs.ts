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
  /** An ERP's list written (src/erp.ts). `stately` per company and list: one running, one waiting. */
  erp: 'erp.sync',
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
  // 5 000 rows in ten batches take seconds; a retry goes on from the last batch written (D9).
  await boss.createQueue(QUEUES.erp, {
    policy: 'stately',
    retryLimit: 3,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 600,
  });
}

export const syncKey = (target: SyncTarget) =>
  `${target.provider}:${target.account}:${target.pdpRef}`;

/**
 * pg-boss waits its polling interval after every fetch, busy or not: two workers on a queue would
 * take at most one job a second (measured by `pnpm perf`, docs/plans/phase-7.md). A job sent from
 * this process wakes its queue's workers instead, and a worker that finishes a job wakes itself
 * (src/workers.ts): they fetch until a fetch comes back empty, then poll again. A job sent from
 * another process is still found by polling.
 */
export interface Wakeups {
  add(queue: string, workerId: string): void;
  wake(queue: string): void;
}

export function bossWakeups(boss: PgBoss): Wakeups {
  const workers = new Map<string, string[]>();
  return {
    add(queue, workerId) {
      workers.set(queue, [...(workers.get(queue) ?? []), workerId]);
    },
    wake(queue) {
      for (const id of workers.get(queue) ?? []) boss.notifyWorker(id);
    },
  };
}

export function bossJobs(boss: PgBoss, wakeups?: Wakeups): Jobs {
  const send = async (queue: string, data: object, singletonKey: string) => {
    await boss.send(queue, data, { singletonKey });
    wakeups?.wake(queue);
  };
  return {
    enqueueSend: (invoiceId) => send(QUEUES.send, { invoiceId }, invoiceId),
    enqueueSync: (target) => send(QUEUES.sync, target, syncKey(target)),
    enqueueMonitor: (invoiceId) => send(QUEUES.monitor, { invoiceId }, invoiceId),
    enqueueReportPayment: (invoiceId) => send(QUEUES.reportPayment, { invoiceId }, invoiceId),
    enqueueRegistry: (tenantId) => send(QUEUES.registry, { tenantId }, tenantId),
    enqueueConnector: (connectionId) => send(QUEUES.connector, { connectionId }, connectionId),
    enqueueIngest: (documentId) => send(QUEUES.ingest, { documentId }, documentId),
    enqueueValidate: (documentId) => send(QUEUES.validate, { documentId }, documentId),
    enqueueClassify: (documentId) => send(QUEUES.classify, { documentId }, documentId),
    enqueueAction: (actionId) => send(QUEUES.action, { actionId }, actionId),
    enqueueErp: (tenantId, connector) =>
      send(QUEUES.erp, { tenantId, connector }, `${tenantId}:${connector}`),
  };
}
