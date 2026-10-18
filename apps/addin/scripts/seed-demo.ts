// pnpm seed:demo [email] — the demo company on the API of `pnpm dev`, for the harness page or Excel.
// Needs ADMIN_TOKEN in .env. Prints the access key; the sign-in link goes to the API's log (local).
// The store reviewers' company on a deployed API (docs/APPSOURCE.md §5):
//   ADMIN_TOKEN=… pnpm seed:demo --api https://api.… --provider b2brouter <reviewer e-mail>
import { parseArgs } from 'node:util';
import { loadServerEnv } from '@fi/shared/env';
import { seedDemo } from '../src/harness/seed';

const { values, positionals } = parseArgs({
  options: { api: { type: 'string' }, provider: { type: 'string' } },
  allowPositionals: true,
});
if (values.provider && values.provider !== 'mock' && values.provider !== 'b2brouter') {
  console.error(`--provider: mock or b2brouter, not ${values.provider}`);
  process.exit(1);
}

const env = loadServerEnv();
if (!env.ADMIN_TOKEN) {
  console.error(
    'ADMIN_TOKEN is empty in .env: set one (24 characters or more) and restart the API.',
  );
  process.exit(1);
}
const company = await seedDemo({
  api: values.api?.replace(/\/$/, '') ?? `http://localhost:${env.API_PORT}`,
  adminToken: env.ADMIN_TOKEN,
  ...(positionals[0] && { email: positionals[0] }),
  ...(values.provider && { provider: values.provider as 'mock' | 'b2brouter' }),
});
console.log(`Demo company ${company.tenantId}
  sign in with the link sent to ${company.email} (printed in the API log), or the key:
  ${company.apiKey}
  demo sheet: https://localhost:${process.env.ADDIN_PORT ?? 3000}/harness.html`);
