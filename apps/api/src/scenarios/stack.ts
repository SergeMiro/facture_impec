// Everything in one process for scenarios and tests: PGlite in memory (or a Postgres the caller
// names), the mock platform and the API on free ports, webhooks from one to the other. No .env. With `provider: 'b2brouter'`,
// invoices go through the real B2Brouter adapter to the stand-in the mock serves at /b2brouter.
import { randomBytes } from 'node:crypto';
import { openDatabase, type PdpProvider } from '@fi/db';
import { createMockPdp, listen, type MockPdpEngine } from '@fi/mock-pdp';
import { ServerEnvSchema } from '@fi/shared/env';
import { type RunningApi, startApi } from '../runtime';
import type { Scenario } from './scenario';

/** A sandbox-shaped key: the stand-in wants the `test_` prefix, and it is no secret. */
const STAND_IN_KEY = 'test_scenario_stand_in';

export interface StackOptions {
  /** Which adapter the scenario's companies use; default the mock platform's own. */
  provider?: PdpProvider;
  /** Business seconds per real second; default MOCK_PDP_SPEED's default (a day per second). */
  speed?: number;
  /** Mock → API webhooks (default on). Off, only the sweep brings news. */
  webhooks?: boolean;
  sweepEverySeconds?: number;
  /**
   * The API's clock runs at `speed` too once `startBusinessClock` is called (real time until then):
   * chasing days and the mails' dates are business time. Off, only the platform hurries.
   */
  businessClock?: boolean;
  /** Real seconds between chasing runs; default 0.05 on the business clock. */
  collectEverySeconds?: number;
  /** A Postgres to use instead of PGlite in memory (the k6 load test, scripts/load). */
  databaseUrl?: string;
  log?: (message: string) => void;
}

/** What a scenario needs from its stack: chasing runs the API on the platform's clock. */
export function stackFor(scenario: Scenario): StackOptions {
  if (!scenario.chase) return {};
  return {
    businessClock: true,
    ...(scenario.platform.speed && { speed: scenario.platform.speed }),
  };
}

export interface Stack {
  provider: PdpProvider;
  apiUrl: string;
  mockUrl: string;
  adminToken: string;
  api: RunningApi;
  mock: MockPdpEngine;
  /** From now on the API's clock runs at the platform's speed (with `businessClock`). */
  startBusinessClock(): void;
  close(): Promise<void>;
}

export async function startStack(options: StackOptions = {}): Promise<Stack> {
  const log = options.log ?? (() => {});
  const webhookSecret = randomBytes(16).toString('hex');
  const adminToken = randomBytes(24).toString('base64url');
  const provider = options.provider ?? 'mock';
  const b2brouter = provider === 'b2brouter';
  const env = ServerEnvSchema.parse({
    FI_ENV: 'local',
    ADMIN_TOKEN: adminToken,
    PDP_SYNC_INTERVAL_SECONDS: String(options.sweepEverySeconds ?? 2),
    MOCK_PDP_WEBHOOK_SECRET: webhookSecret,
    ...(options.speed && { MOCK_PDP_SPEED: String(options.speed) }),
    ...(b2brouter && { B2BROUTER_API_KEY: STAND_IN_KEY, B2BROUTER_WEBHOOK_SECRET: webhookSecret }),
  });

  const {
    app,
    engine,
    b2brouter: standIn,
  } = createMockPdp({
    speed: env.MOCK_PDP_SPEED,
    webhookSecret,
    log,
  });
  const mock = await listen(app.fetch, 0);
  const database = await openDatabase(options.databaseUrl ? { url: options.databaseUrl } : {});
  const speed = env.MOCK_PDP_SPEED;
  const businessClock = options.businessClock === true;
  let started: number | null = null;
  const now = () =>
    started === null ? new Date() : new Date(started + (Date.now() - started) * speed);
  const api = await startApi({
    env: {
      ...env,
      MOCK_PDP_URL: mock.url,
      ...(b2brouter && { B2BROUTER_BASE_URL: `${mock.url}/b2brouter` }),
    },
    port: 0,
    database,
    pollingIntervalSeconds: 0.5,
    ...(businessClock && {
      now,
      collectEverySeconds: options.collectEverySeconds ?? 0.05,
    }),
    log,
  });
  if (options.webhooks !== false) {
    engine.setWebhookUrl(`${api.url}/webhooks/pdp/mock`);
    standIn.setWebhookUrl(`${api.url}/webhooks/pdp/b2brouter`);
  }

  return {
    provider,
    apiUrl: api.url,
    mockUrl: mock.url,
    adminToken,
    api,
    mock: engine,
    startBusinessClock() {
      if (businessClock && started === null) started = Date.now();
    },
    async close() {
      engine.setWebhookUrl(undefined);
      standIn.setWebhookUrl(undefined);
      await api.close();
      await mock.close();
      await database.close();
    },
  };
}
