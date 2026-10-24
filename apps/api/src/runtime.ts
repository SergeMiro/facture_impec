// Assembles the API process: database (migrated), pg-boss, PDP adapters, HTTP server, workers.
// server.ts runs it from .env; the scenario stack runs it in-process on a free port.
import { resolveMx } from 'node:dns/promises';
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
import { type Billing, billingFromEnv } from './billing';
import type { GoogleConnector, MicrosoftConnector } from './connectors';
import type { AiDeps, ApiDeps, Mailer, OwnPlatform, PdpRegistry, TestPlatform } from './deps';
import { createGoogleClient, GOOGLE_HOSTS } from './google';
import { bossJobs, bossWakeups, createBoss, ensureQueues } from './jobs';
import { type Listening, listen } from './listen';
import { log as jsonLog } from './log';
import { OutboxMailer, SmtpMailer } from './mail';
import { createMicrosoftClient, MICROSOFT_HOSTS } from './microsoft';
import { type Directory, RechercheEntreprises } from './sirene';
import { type Vies, ViesClient } from './vies';
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
  /** Default: mailerFromEnv. */
  mailer?: Mailer | null;
  /** Default: billingFromEnv (STRIPE_*). */
  billing?: Billing | null;
  /** Default: the Annuaire des entreprises at SIRENE_URL. */
  directory?: Directory | null;
  /** Default: ownPdpFromEnv (PDP_KEY_SEALING_KEY). */
  ownPdp?: OwnPlatform | null;
  /** Default: microsoftFromEnv (MICROSOFT_*). */
  microsoft?: MicrosoftConnector | null;
  /** Default: googleFromEnv (GOOGLE_*). */
  google?: GoogleConnector | null;
  /** Default: VIES at VIES_URL. */
  vies?: Vies | null;
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

/** A B2Brouter adapter for one key; a key that does not fit its host stops the API at startup. */
function b2brouterAdapter(
  env: ServerEnv,
  apiKey: string,
  webhookSecret: string | undefined,
  name = 'B2BROUTER_API_KEY',
) {
  const baseUrl = env.B2BROUTER_BASE_URL ?? B2BROUTER_HOSTS.production;
  const problem = keyProblem(apiKey, baseUrl);
  if (problem) throw new Error(`${name}: ${problem}`);
  if (env.FI_ENV !== 'local' && !isB2BrouterHost(baseUrl)) {
    throw new Error(
      `B2BROUTER_BASE_URL: only local may use a stand-in (${new URL(baseUrl).origin})`,
    );
  }
  return createB2BrouterAdapter({ apiKey, baseUrl, ...(webhookSecret && { webhookSecret }) });
}

/**
 * The adapters this environment offers: the mock platform in local only (a company on it elsewhere
 * would send nowhere), B2Brouter when a key is set, and in prod B2Brouter's sandbox under its own
 * name when the sandbox key is set too, for « Mode test ».
 */
export function pdpFromEnv(env: ServerEnv): PdpRegistry {
  const pdp: PdpRegistry = {};
  if (env.FI_ENV === 'local') {
    pdp.mock = createMockPdpAdapter({
      baseUrl: env.MOCK_PDP_URL,
      webhookSecret: env.MOCK_PDP_WEBHOOK_SECRET,
    });
  }
  if (env.B2BROUTER_API_KEY) {
    pdp.b2brouter = b2brouterAdapter(env, env.B2BROUTER_API_KEY, env.B2BROUTER_WEBHOOK_SECRET);
  }
  if (env.B2BROUTER_SANDBOX_API_KEY) {
    pdp.b2brouter_test = b2brouterAdapter(
      env,
      env.B2BROUTER_SANDBOX_API_KEY,
      env.B2BROUTER_SANDBOX_WEBHOOK_SECRET,
    );
  }
  return pdp;
}

/**
 * Company keys (docs/B2BROUTER.md §12): only with PDP_KEY_SEALING_KEY. A B2Brouter key must be one
 * of this environment (test_… in sandbox, never in prod) and fit B2BROUTER_BASE_URL; the mock takes
 * no key, so in local a company key on it changes nothing but proves the path.
 */
export function ownPdpFromEnv(env: ServerEnv, pdp: PdpRegistry): OwnPlatform | null {
  const sealingKey = env.PDP_KEY_SEALING_KEY;
  if (!sealingKey) return null;
  return {
    sealingKey,
    adapter(provider, apiKey) {
      if (provider === 'mock') return pdp.mock ?? null;
      if (provider !== 'b2brouter') return null;
      if (env.FI_ENV !== 'local' && apiKey.startsWith('test_') !== (env.FI_ENV === 'sandbox')) {
        throw new Error(
          env.FI_ENV === 'sandbox' ? 'a sandbox key (test_…)' : 'a production key, not test_…',
        );
      }
      // Company webhooks are signed with the company's own secret, which we do not hold: their news
      // comes from the sweep (docs/DEFERRED.md).
      return b2brouterAdapter(env, apiKey, undefined, 'company key');
    },
  };
}

/**
 * Where « Mode test » sends: B2Brouter's sandbox (in prod through the second key; elsewhere when the
 * deployment's key is a sandbox key), which cannot reach a real platform and plays no scenarios, so
 * the ScenarioInjector fakes them; else the mock in local. Prod without a sandbox key has none.
 */
export function testPlatformFromEnv(env: ServerEnv, pdp: PdpRegistry): TestPlatform | null {
  if (pdp.b2brouter_test) return { provider: 'b2brouter_test', scenarios: null };
  const key = env.B2BROUTER_API_KEY;
  if (pdp.b2brouter && key && environmentOfKey(key) === 'sandbox') {
    return { provider: 'b2brouter', scenarios: null };
  }
  if (!pdp.mock) return null;
  return { provider: 'mock', scenarios: createMockScenarioPort({ baseUrl: env.MOCK_PDP_URL }) };
}

/**
 * The OneDrive connector (docs/MICROSOFT365.md): only with the owner's app registration. Outside local
 * it talks to Microsoft's hosts only, and change notifications need an https address Graph can reach;
 * without one, files are polled.
 */
export function microsoftFromEnv(
  env: ServerEnv,
  fetcher?: typeof fetch,
): MicrosoftConnector | null {
  const clientId = env.MICROSOFT_CLIENT_ID;
  const clientSecret = env.MICROSOFT_CLIENT_SECRET;
  const sealingKey = env.CONNECTOR_SEALING_KEY;
  if (!clientId || !clientSecret || !sealingKey) return null;
  const loginUrl = env.MICROSOFT_LOGIN_URL ?? MICROSOFT_HOSTS.login;
  const graphUrl = env.MICROSOFT_GRAPH_URL ?? MICROSOFT_HOSTS.graph;
  if (env.FI_ENV !== 'local') {
    for (const [name, url, host] of [
      ['MICROSOFT_LOGIN_URL', loginUrl, MICROSOFT_HOSTS.login],
      ['MICROSOFT_GRAPH_URL', graphUrl, MICROSOFT_HOSTS.graph],
    ] as const) {
      if (new URL(url).origin !== new URL(host).origin) {
        throw new Error(`${name}: only local may use a stand-in (${new URL(url).origin})`);
      }
    }
  }
  const reachable = env.FI_ENV === 'local' || env.API_PUBLIC_URL.startsWith('https://');
  return {
    client: createMicrosoftClient({
      clientId,
      clientSecret,
      loginUrl,
      graphUrl,
      ...(fetcher && { fetcher }),
    }),
    clientId,
    sealingKey,
    notificationUrl: reachable
      ? new URL('/webhooks/microsoft', env.API_PUBLIC_URL).toString()
      : null,
    mailExchanges: mailExchangesFromDns(),
  };
}

/**
 * The Google Drive connector (docs/GOOGLE.md): only with the owner's OAuth client. Outside local it
 * talks to Google's hosts only, Google comes back to an https address (§7), and a channel needs one
 * Google can reach; without it, files are polled.
 */
export function googleFromEnv(env: ServerEnv, fetcher?: typeof fetch): GoogleConnector | null {
  const clientId = env.GOOGLE_CLIENT_ID;
  const clientSecret = env.GOOGLE_CLIENT_SECRET;
  const sealingKey = env.CONNECTOR_SEALING_KEY;
  if (!clientId || !clientSecret || !sealingKey) return null;
  const accountsUrl = env.GOOGLE_ACCOUNTS_URL ?? GOOGLE_HOSTS.accounts;
  const oauthUrl = env.GOOGLE_OAUTH_URL ?? GOOGLE_HOSTS.oauth;
  const apiUrl = env.GOOGLE_API_URL ?? GOOGLE_HOSTS.api;
  const local = env.FI_ENV === 'local';
  if (!local) {
    for (const [name, url, host] of [
      ['GOOGLE_ACCOUNTS_URL', accountsUrl, GOOGLE_HOSTS.accounts],
      ['GOOGLE_OAUTH_URL', oauthUrl, GOOGLE_HOSTS.oauth],
      ['GOOGLE_API_URL', apiUrl, GOOGLE_HOSTS.api],
    ] as const) {
      if (new URL(url).origin !== new URL(host).origin) {
        throw new Error(`${name}: only local may use a stand-in (${new URL(url).origin})`);
      }
    }
    if (!env.API_PUBLIC_URL.startsWith('https://')) {
      throw new Error('GOOGLE_CLIENT_ID: Google comes back to API_PUBLIC_URL, which must be https');
    }
  }
  return {
    client: createGoogleClient({
      clientId,
      clientSecret,
      accountsUrl,
      oauthUrl,
      apiUrl,
      ...(fetcher && { fetcher }),
    }),
    sealingKey,
    redirectUrl: new URL('/connectors/google/callback', env.API_PUBLIC_URL).toString(),
    notificationUrl:
      local || env.API_PUBLIC_URL.startsWith('https://')
        ? new URL('/webhooks/google', env.API_PUBLIC_URL).toString()
        : null,
  };
}

/**
 * MX hosts of a mail domain for the Scout (connectors.ts servedByMicrosoft): asked at most once a day
 * per domain, given up after 2 s. A failed lookup is an empty answer, kept like any other.
 */
export function mailExchangesFromDns(
  resolve: (domain: string) => Promise<{ exchange: string }[]> = resolveMx,
  now: () => number = Date.now,
): (domain: string) => Promise<string[]> {
  const DAY_MS = 24 * 3_600_000;
  const cache = new Map<string, { at: number; hosts: Promise<string[]> }>();
  return (domain) => {
    const hit = cache.get(domain);
    if (hit && now() - hit.at < DAY_MS) return hit.hosts;
    if (cache.size >= 1_000) cache.clear();
    let timer: NodeJS.Timeout | undefined;
    const hosts = Promise.race([
      resolve(domain).then((records) => records.map((r) => r.exchange)),
      new Promise<string[]>((done) => {
        timer = setTimeout(() => done([]), 2_000);
      }),
    ])
      .catch(() => [])
      .finally(() => clearTimeout(timer));
    cache.set(domain, { at: now(), hosts });
    return hosts;
  };
}

/** The outbox in local; elsewhere the SMTP provider, or no mail at all without one. */
export function mailerFromEnv(
  env: ServerEnv,
  log: (message: string) => void,
  now: () => Date,
): Mailer | null {
  if (env.FI_ENV === 'local') return new OutboxMailer(log, now);
  if (env.MAIL_SMTP_URL && env.MAIL_FROM) return new SmtpMailer(env.MAIL_SMTP_URL, env.MAIL_FROM);
  return null;
}

export async function startApi(options: ApiOptions): Promise<RunningApi> {
  const { env } = options;
  const log = options.log ?? jsonLog;
  const ownDatabase = !options.database;
  const database =
    options.database ??
    (await openDatabase(env.DATABASE_URL ? { url: env.DATABASE_URL } : { dir: env.PGLITE_DIR }));
  await database.migrate();

  const boss = createBoss(database);
  boss.on('error', (e) => log(`pg-boss: ${e.message}`));
  await boss.start();
  await ensureQueues(boss);
  const wakeups = bossWakeups(boss);

  const now = options.now ?? (() => new Date());
  const pdp = options.pdp ?? pdpFromEnv(env);
  const deps: ApiDeps = {
    env,
    db: database.db,
    jobs: bossJobs(boss, wakeups),
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
    mailer: options.mailer === undefined ? mailerFromEnv(env, log, now) : options.mailer,
    billing: options.billing === undefined ? billingFromEnv(env) : options.billing,
    directory:
      options.directory === undefined
        ? new RechercheEntreprises(env.SIRENE_URL)
        : options.directory,
    ownPdp: options.ownPdp === undefined ? ownPdpFromEnv(env, pdp) : options.ownPdp,
    microsoft: options.microsoft === undefined ? microsoftFromEnv(env) : options.microsoft,
    google: options.google === undefined ? googleFromEnv(env) : options.google,
    vies: options.vies === undefined ? new ViesClient(env.VIES_URL) : options.vies,
    fonts: bundledFonts(),
    now,
  };
  const stopSweep = env.API_WORKERS
    ? await startWorkers(boss, deps, {
        sweepEverySeconds: env.PDP_SYNC_INTERVAL_SECONDS,
        wakeups,
        ...(options.pollingIntervalSeconds && {
          pollingIntervalSeconds: options.pollingIntervalSeconds,
        }),
        ...(options.collectEverySeconds && { collectEverySeconds: options.collectEverySeconds }),
        log,
      })
    : () => {};

  let server: Listening;
  try {
    server = await listen(createApp(deps).fetch, options.port ?? env.API_PORT, env.API_HOST);
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
