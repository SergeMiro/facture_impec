// Where the E2E stack runs: its own ports and a throwaway database, so `pnpm dev` can keep running.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const E2E = {
  api: 4100,
  mock: 4110,
  addin: 3100,
  adminToken: 'e2e-admin-token-not-a-secret-0001',
};

/** Playwright loads the config in every worker: the first load picks the folder, workers inherit it. */
process.env.FI_E2E_DB ??= mkdtempSync(join(tmpdir(), 'fi-e2e-'));
export const E2E_DB = process.env.FI_E2E_DB;
