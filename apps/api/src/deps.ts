import type { Db, PdpProvider } from '@fi/db';
import type { PdpAdapter } from '@fi/pdp-adapter';
import type { ServerEnv } from '@fi/shared/env';

/** The adapters this deployment can use; a tenant on a missing provider cannot send yet. */
export type PdpRegistry = Partial<Record<PdpProvider, PdpAdapter>>;

/** An invoice at a platform: what a webhook or the sweep asks the sync job to refresh. */
export interface SyncTarget {
  provider: PdpProvider;
  account: string;
  pdpRef: string;
}

/** Background work the routes start (pg-boss in src/jobs.ts). */
export interface Jobs {
  enqueueSend(invoiceId: string): Promise<void>;
  enqueueSync(target: SyncTarget): Promise<void>;
}

export interface ApiDeps {
  env: Pick<ServerEnv, 'FI_ENV' | 'ADMIN_TOKEN'>;
  db: Db;
  jobs: Jobs;
  pdp: PdpRegistry;
  now: () => Date;
}
