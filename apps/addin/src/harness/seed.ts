// Creates the demo company on a running API (admin route), owner e-mail included, with the invoice
// defaults the demo sheet needs. Used by `pnpm seed:demo` and by the E2E run.
import { DEMO_DEFAULTS, DEMO_OWNER, DEMO_SELLER } from './demo';

export interface SeedOptions {
  /** The API itself, e.g. http://localhost:4000 (not the add-in's /api proxy). */
  api: string;
  adminToken: string;
  email?: string;
  /** The account on the mock platform; one per company. */
  account?: string;
}

export interface SeededCompany {
  tenantId: string;
  apiKey: string;
  email: string;
}

async function call(url: string, token: string, method: string, body: unknown): Promise<unknown> {
  const res = await fetch(url, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${await res.text()}`);
  return res.json();
}

export async function seedDemo(options: SeedOptions): Promise<SeededCompany> {
  const email = options.email ?? DEMO_OWNER;
  const created = (await call(`${options.api}/admin/tenants`, options.adminToken, 'POST', {
    ...DEMO_SELLER,
    pdpProvider: 'mock',
    pdpAccount: options.account ?? `demo-${Date.now()}`,
    ownerEmail: email,
  })) as { tenant: { id: string }; apiKey: string };
  await call(`${options.api}/settings`, created.apiKey, 'PATCH', {
    invoiceDefaults: DEMO_DEFAULTS,
  });
  return { tenantId: created.tenant.id, apiKey: created.apiKey, email };
}
