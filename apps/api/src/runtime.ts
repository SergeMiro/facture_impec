// Assembles the API process: database (migrated), pg-boss, PDP adapters, HTTP server, workers.
// server.ts runs it from .env; the scenario stack runs it in-process on a free port.
import { includedAi } from '@fi/agents';
import { bundledFonts } from '@fi/core/fonts';
import { type Database, openDatabase } from '@fi/db';
import {
  B2BROUTER_HOSTS,
  createB2BrouterAdapter,
  createMockPdpAdapter,
  createMockScenarioPort,
  environmentOfKey,
  isB2BrouterHost,
  keyProblem,
} from '@fi/pdp-adapter';
import type { ServerEnv } from '@fi/shared/env';
import type { PgBoss } from 'pg-boss';
import { createAiDeps } from './ai';
import { createApp } from './app';
import type { AiDeps, ApiDeps, Mailer, PdpRegistry, TestPlatform } from './deps';
import { bossJobs, createBoss, ensureQueues } from './jobs';
import { type Listening, listen } from './listen';
import { OutboxMailer } from './mail';
import { startWorkers } from './workers';

export interface ApiOptions {
  env: ServerEnv;
  /** Default env.API_PORT; 0 picks a free port. */
  port?: number;
  /** An open database; default: DATABASE_URL, else PGlite in PGLITE_DIR. Not closed on stop. */
  database?: Database;
  pdp?: PdpRegistry;
  /** Default: testPlatformFromEnv (B2Brouter's sandbox, else the mock platform). */
  test?: TestPlatform | null;
  /** Default: AI_* from env (createAiDeps). */
  ai?: AiDeps;
  /** Default: the outbox in local, none elsewhere (docs/DEFERRED.md). */
  mailer?: Mailer | null;
  pollingIntervalSeconds?: number;
  /** Chasing timer (real seconds); default COLLECT_EVERY_SECONDS. */
  collectEverySeconds?: number;
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

/**
 * The adapters this environment offers: the mock platform, and B2Brouter when a key is set. A key
 * that does not fit its host, or a stand-in host outside local, stops the API at startup.
 */
export function pdpFromEnv(env: ServerEnv): PdpRegistry {
  const pdp: PdpRegistry = {
    mock: createMockPdpAdapter({
      baseUrl: env.MOCK_PDP_URL,
      webhookSecret: env.MOCK_PDP_WEBHOOK_SECRET,
    }),
  };
  const apiKey = env.B2BROUTER_API_KEY;
  if (apiKey) {
    const baseUrl = env.B2BROUTER_BASE_URL ?? B2BROUTER_HOSTS.production;
    const problem = keyProblem(apiKey, baseUrl);
    if (problem) throw new Error(`B2BROUTER_API_KEY: ${problem}`);
    if (env.FI_ENV !== 'local' && !isB2BrouterHost(baseUrl)) {
      throw new Error(
        `B2BROUTER_BASE_URL: only local may use a stand-in (${new URL(baseUrl).origin})`,
      );
    }
    pdp.b2brouter = createB2BrouterAdapter({
      apiKey,
      baseUrl,
      ...(env.B2BROUTER_WEBHOOK_SECRET && { webhookSecret: env.B2BROUTER_WEBHOOK_SECRET }),
    });
  }
  return pdp;
}

/**
 * Where « Mode test » sends: B2Brouter when this deployment holds a sandbox key (it cannot reach a
 * real platform; B2Brouter plays no scenarios, so the ScenarioInjector fakes them), else the mock.
 */
export function testPlatformFromEnv(env: ServerEnv, pdp: PdpRegistry): TestPlatform | null {
  const key = env.B2BROUTER_API_KEY;
  if (pdp.b2brouter && key && environmentOfKey(key) === 'sandbox') {
    return { provider: 'b2brouter', scenarios: null };
  }
  if (!pdp.mock) return null;
  return { provider: 'mock', scenarios: createMockScenarioPort({ baseUrl: env.MOCK_PDP_URL }) };
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

  const now = options.now ?? (() => new Date());
  const pdp = options.pdp ?? pdpFromEnv(env);
  const deps: ApiDeps = {
    env,
    db: database.db,
    jobs: bossJobs(boss),
    pdp,
    test: options.test === undefined ? testPlatformFromEnv(env, pdp) : options.test,
    ai:
      options.ai ??
      createAiDeps({
        db: database.db,
        now,
        included: includedAi(env),
        sealingKey: env.AI_KEY_SEALING_KEY,
        budget: { runTokens: env.AI_RUN_TOKENS, tenantDailyTokens: env.AI_DAILY_TOKENS },
      }),
    mailer:
      options.mailer === undefined
        ? env.FI_ENV === 'local'
          ? new OutboxMailer(log, now)
          : null
        : options.mailer,
    fonts: bundledFonts(),
    now,
  };
  const stopSweep = env.API_WORKERS
    ? await startWorkers(boss, deps, {
        sweepEverySeconds: env.PDP_SYNC_INTERVAL_SECONDS,
        ...(options.pollingIntervalSeconds && {
          pollingIntervalSeconds: options.pollingIntervalSeconds,
        }),
        ...(options.collectEverySeconds && { collectEverySeconds: options.collectEverySeconds }),
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
