// Where the E2E stack runs: its own ports and a throwaway database, so `pnpm dev` can keep running.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const E2E = {
  api: 4100,
  mock: 4110,
  addin: 3100,
  adminToken: 'e2e-admin-token-not-a-secret-0001',
  /** B2Brouter's stand-in in apps/mock-pdp takes any sandbox-shaped key. */
  standInKey: 'test_e2e_stand_in',
  b2brouterWebhookSecret: 'e2e-b2brouter-webhook-secret-0001',
  /** Microsoft's stand-in in apps/mock-pdp knows this app (apps/mock-pdp/src/app.ts). */
  microsoft: {
    clientId: '00000000-0000-4000-8000-00000000f1f1',
    clientSecret: 'local-microsoft-client-secret',
  },
  /** Seals the E2E company's Microsoft tokens; 32 bytes, nothing secret. */
  sealingKey: Buffer.alloc(32, 5).toString('base64'),
};

/** Playwright loads the config in every worker: the first load picks the folder, workers inherit it. */
process.env.FI_E2E_DB ??= mkdtempSync(join(tmpdir(), 'fi-e2e-'));
export const E2E_DB = process.env.FI_E2E_DB;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required with FI_LIVE_B2BROUTER_KEY (docs/RUNBOOK.md)`);
  return value;
}

/**
 * The live run against B2Brouter's sandbox (docs/RUNBOOK.md § E2E): the owner's sandbox key, the
 * account it serves and a SIREN its directory knows. Unset: the stand-in in apps/mock-pdp.
 */
export const LIVE = process.env.FI_LIVE_B2BROUTER_KEY
  ? {
      key: sandboxKey(process.env.FI_LIVE_B2BROUTER_KEY),
      account: required('FI_LIVE_B2BROUTER_ACCOUNT'),
      buyerSiren: required('FI_LIVE_B2BROUTER_SIREN'),
    }
  : null;

/** The E2E run sends invoices: never with a key that reaches real customers. */
function sandboxKey(key: string): string {
  if (!key.startsWith('test_'))
    throw new Error('FI_LIVE_B2BROUTER_KEY: sandbox keys only (test_…)');
  return key;
}
