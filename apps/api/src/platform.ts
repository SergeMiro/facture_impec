// Which platform an invoice goes to (plan §3): a test invoice to the test platform, whatever the
// tenant's real PDP is, so « Mode test » never reaches a real platform.
import type { PdpProvider, TenantProvider, TenantRow } from '@fi/db';
import type { PdpAdapter } from '@fi/pdp-adapter';
import type { FiEnv } from '@fi/shared/env';
import type { PdpRegistry, TestPlatform } from './deps';

export interface Route {
  provider: PdpProvider;
  account: string;
  /** Undefined when this deployment has no adapter for the provider yet. */
  adapter: PdpAdapter | undefined;
}

export function routeFor(
  deps: { pdp: PdpRegistry; test: TestPlatform | null },
  tenant: Pick<TenantRow, 'pdpProvider' | 'pdpAccount'>,
  isTest: boolean,
): Route | null {
  if (isTest && !deps.test) return null;
  const provider = isTest && deps.test ? deps.test.provider : tenant.pdpProvider;
  // TODO(verify) docs/B2BROUTER.md T22: in prod a test invoice goes to the sandbox under the same
  // account id as real ones; if B2Brouter gives a company another id there, store both.
  return { provider, account: tenant.pdpAccount, adapter: deps.pdp[provider] };
}

/**
 * The platform a new company sends through: the mock in local (the only place it exists, even next to
 * a B2Brouter sandbox key for live runs), else B2Brouter.
 */
export function homeProvider(pdp: PdpRegistry): TenantProvider | null {
  if (pdp.mock) return 'mock';
  if (pdp.b2brouter) return 'b2brouter';
  return null;
}

/**
 * In prod, a company's real sends and its real inbox wait until the operator switches it live, once
 * its account at the platform exists (POST /admin/tenants/:id/live). Elsewhere nothing is real.
 */
export function awaitsGoLive(
  deps: { env?: { FI_ENV: FiEnv } },
  tenant: Pick<TenantRow, 'liveAt'>,
): boolean {
  return deps.env?.FI_ENV === 'prod' && !tenant.liveAt;
}
