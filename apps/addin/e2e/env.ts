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
};

/** Playwright loads the config in every worker: the first load picks the folder, workers inherit it. */
process.env.FI_E2E_DB ??= mkdtempSync(join(tmpdir(), 'fi-e2e-'));
export const E2E_DB = process.env.FI_E2E_DB;

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required with FI_E2E_B2BROUTER_KEY (docs/RUNBOOK.md)`);
  return value;
}

/**
 * The live run against B2Brouter's sandbox (docs/RUNBOOK.md § E2E): the owner's sandbox key, the
 * account it serves and a SIREN its directory knows. Unset: the stand-in in apps/mock-pdp.
 */
export const LIVE = process.env.FI_E2E_B2BROUTER_KEY
  ? {
      key: process.env.FI_E2E_B2BROUTER_KEY,
      account: required('FI_E2E_B2BROUTER_ACCOUNT'),
      buyerSiren: required('FI_E2E_B2BROUTER_BUYER_SIREN'),
    }
  : null;
