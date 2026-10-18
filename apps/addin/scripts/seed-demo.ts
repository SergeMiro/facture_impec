// pnpm seed:demo [email] — the demo company on the API of `pnpm dev`, for the harness page or Excel.
// Needs ADMIN_TOKEN in .env. Prints the access key; the sign-in link goes to the API's log (local).
import { loadServerEnv } from '@fi/shared/env';
import { seedDemo } from '../src/harness/seed';

const env = loadServerEnv();
if (!env.ADMIN_TOKEN) {
  console.error(
    'ADMIN_TOKEN is empty in .env: set one (24 characters or more) and restart the API.',
  );
  process.exit(1);
}
const company = await seedDemo({
  api: `http://localhost:${env.API_PORT}`,
  adminToken: env.ADMIN_TOKEN,
  ...(process.argv[2] && { email: process.argv[2] }),
});
console.log(`Demo company ${company.tenantId}
  sign in with the link sent to ${company.email} (printed in the API log), or the key:
  ${company.apiKey}
  demo sheet: https://localhost:${process.env.ADDIN_PORT ?? 3000}/harness.html`);
