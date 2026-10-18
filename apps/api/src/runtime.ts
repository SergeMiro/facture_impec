// Assembles the API process: database (migrated), pg-boss, PDP adapters, HTTP server, workers.
// server.ts runs it from .env; the scenario stack runs it in-process on a free port.
import { type Database, openDatabase } from '@fi/db';
import { createMockPdpAdapter } from '@fi/pdp-adapter';
import type { ServerEnv } from '@fi/shared/env';
import type { PgBoss } from 'pg-boss';
import { createApp } from './app';
import type { ApiDeps, PdpRegistry } from './deps';
import { bossJobs, createBoss, ensureQueues } from './jobs';
import { type Listening, listen } from './listen';
import { startWorkers } from './workers';

export interface ApiOptions {
  env: ServerEnv;
  /** Default env.API_PORT; 0 picks a free port. */
  port?: number;
  /** An open database; default: DATABASE_URL, else PGlite in PGLITE_DIR. Not closed on stop. */
  database?: Database;
  pdp?: PdpRegistry;
  pollingIntervalSeconds?: number;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface RunningApi {
  url: string;
  database: Database;
  boss: PgBoss;
  deps: ApiDeps;
  close(): Promise<void>;
}

/** The adapters this environment offers. B2Brouter arrives in M4 (docs/DEFERRED.md). */
export function pdpFromEnv(env: ServerEnv): PdpRegistry {
  return {
    mock: createMockPdpAdapter({
      baseUrl: env.MOCK_PDP_URL,
      webhookSecret: env.MOCK_PDP_WEBHOOK_SECRET,
    }),
  };
}

export async function startApi(options: ApiOptions): Promise<RunningApi> {
  const { env } = options;
  const log = options.log ?? ((message: string) => console.warn(message));
  const ownDatabase = !options.database;
  const database =
    options.database ??
    (await openDatabase(env.DATABASE_URL ? { url: env.DATABASE_URL } : { dir: env.PGLITE_DIR }));
  await database.migrate();

  const boss = createBoss(database);
  boss.on('error', (e) => log(`pg-boss: ${e.message}`));
  await boss.start();
  await ensureQueues(boss);

  const deps: ApiDeps = {
    env,
    db: database.db,
    jobs: bossJobs(boss),
    pdp: options.pdp ?? pdpFromEnv(env),
    now: options.now ?? (() => new Date()),
  };
  const stopSweep = env.API_WORKERS
    ? await startWorkers(boss, deps, {
        sweepEverySeconds: env.PDP_SYNC_INTERVAL_SECONDS,
        ...(options.pollingIntervalSeconds && {
          pollingIntervalSeconds: options.pollingIntervalSeconds,
        }),
        log,
      })
    : () => {};

  let server: Listening;
  try {
    server = await listen(createApp(deps).fetch, options.port ?? env.API_PORT);
  } catch (e) {
    stopSweep();
    await boss.stop({ graceful: false });
    if (ownDatabase) await database.close();
    throw e;
  }
  return {
    url: server.url,
    database,
    boss,
    deps,
    async close() {
      stopSweep();
      await server.close();
      await boss.stop({ graceful: true, timeout: 5_000 });
      if (ownDatabase) await database.close();
    },
  };
}
