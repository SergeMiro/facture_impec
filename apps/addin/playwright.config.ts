// E2E (plan §11, M3–M4): the task pane against the real API, mock platform and Vite dev server, in
// the server's local Chrome (browser: local). `pnpm test:e2e` starts the three on ports of their own.
// e2e/harness.spec.ts drives the harness page (a sheet in the browser, no Excel);
// e2e/b2brouter.spec.ts sends through the B2Brouter adapter: to the stand-in in apps/mock-pdp, or to
// B2Brouter's sandbox with the owner's key (FI_LIVE_B2BROUTER_*, docs/RUNBOOK.md § E2E);
// e2e/excel-web.spec.ts drives Excel on the web and runs only with an account (docs/RUNBOOK.md).
import { defineConfig } from '@playwright/test';
import { E2E, E2E_DB, LIVE } from './e2e/env';

const api = `http://localhost:${E2E.api}`;

export default defineConfig({
  testDir: 'e2e',
  globalTeardown: './e2e/teardown.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    channel: 'chrome',
    baseURL: `https://localhost:${E2E.addin}`,
    // The dev certificate's CA is not installed on this server (docs/RUNBOOK.md § Add-in).
    ignoreHTTPSErrors: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter @fi/mock-pdp start',
      url: `http://localhost:${E2E.mock}/health`,
      env: {
        MOCK_PDP_PORT: String(E2E.mock),
        MOCK_PDP_WEBHOOK_URL: `${api}/webhooks/pdp/mock`,
        // One business second per second: a sent test invoice stays « Déposée » for the scenarios.
        MOCK_PDP_SPEED: '1',
        MOCK_PDP_B2BROUTER_WEBHOOK_URL: `${api}/webhooks/pdp/b2brouter`,
        B2BROUTER_WEBHOOK_SECRET: E2E.b2brouterWebhookSecret,
      },
      reuseExistingServer: false,
    },
    {
      command: 'pnpm --filter @fi/api start',
      url: `${api}/health`,
      env: {
        FI_ENV: 'local',
        API_PORT: String(E2E.api),
        PGLITE_DIR: E2E_DB,
        ADMIN_TOKEN: E2E.adminToken,
        API_PUBLIC_URL: api,
        ADDIN_ORIGINS: `https://localhost:${E2E.addin}`,
        MOCK_PDP_URL: `http://localhost:${E2E.mock}`,
        // A test_ key makes B2Brouter the test platform. Live: B2Brouter's own host, and no
        // webhooks (they cannot reach this server), so the sweep brings the news.
        B2BROUTER_API_KEY: LIVE?.key ?? E2E.standInKey,
        B2BROUTER_BASE_URL: LIVE ? '' : `http://localhost:${E2E.mock}/b2brouter`,
        B2BROUTER_WEBHOOK_SECRET: LIVE ? '' : E2E.b2brouterWebhookSecret,
        PDP_SYNC_INTERVAL_SECONDS: '10',
        // No AI: the agents' deterministic answers, the same on every run.
        AI_PROVIDER: '',
      },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: 'pnpm exec vite',
      url: `https://localhost:${E2E.addin}/harness.html`,
      ignoreHTTPSErrors: true,
      env: { ADDIN_PORT: String(E2E.addin), API_PORT: String(E2E.api) },
      reuseExistingServer: false,
    },
  ],
});
