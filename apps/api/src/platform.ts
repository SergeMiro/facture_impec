// Which platform an invoice goes to (plan §3): a test invoice to the test platform, whatever the
// tenant's real PDP is, so « Mode test » never reaches a real platform.
import type { PdpProvider, TenantRow } from '@fi/db';
import type { PdpAdapter } from '@fi/pdp-adapter';
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
  return { provider, account: tenant.pdpAccount, adapter: deps.pdp[provider] };
}
