// Creating a company: by the operator (POST /admin/tenants, a pilot or internal company, never billed)
// or by the person who signs up (src/onboarding.ts, on a 30-day trial). Both write the same rows and
// the same audit events.
import type { Address } from '@fi/core';
import { audit, type TenantProvider, type TenantRow, type Tx, tenants, users } from '@fi/db';
import { type BillingStatus, TERMS_VERSION, TRIAL_DAYS } from '@fi/shared';
import { tenantView } from './views';

export interface NewCompany {
  name: string;
  siren: string;
  vatId: string | null;
  address: Address | null;
  pdpProvider: TenantProvider;
  /** Defaults to the SIREN: B2Brouter keeps one account per SIREN (docs/B2BROUTER.md §3.2). */
  pdpAccount?: string | undefined;
  vatOnDebits?: boolean | undefined;
  /** The person who signs in to the add-in with a link (role owner). */
  ownerEmail?: string | undefined;
  billing: Extract<BillingStatus, 'trial' | 'pilot'>;
  /** When the person accepted the terms (sign-up); the operator's companies have none. */
  termsAcceptedAt?: Date | undefined;
}

/** Inserts the company and its owner, with their audit events, inside the caller's transaction. */
export async function insertTenant(
  tx: Tx,
  input: NewCompany,
  actor: string,
  now: Date,
): Promise<{ tenant: TenantRow; ownerId: string | null }> {
  const [tenant] = await tx
    .insert(tenants)
    .values({
      name: input.name,
      siren: input.siren,
      vatId: input.vatId,
      address: input.address,
      pdpProvider: input.pdpProvider,
      pdpAccount: input.pdpAccount ?? input.siren,
      vatOnDebits: input.vatOnDebits ?? false,
      billingStatus: input.billing,
      trialEndsAt: input.billing === 'trial' ? new Date(+now + TRIAL_DAYS * 86_400_000) : null,
      ...(input.termsAcceptedAt && {
        termsVersion: TERMS_VERSION,
        termsAcceptedAt: input.termsAcceptedAt,
      }),
      createdAt: now,
    })
    .returning();
  if (!tenant) throw new Error('insert returned nothing');
  await audit(tx, {
    tenantId: tenant.id,
    actor,
    action: 'tenant.create',
    objectType: 'tenant',
    objectId: tenant.id,
    after: tenantView(tenant),
  });
  let ownerId: string | null = null;
  if (input.ownerEmail) {
    const [owner] = await tx
      .insert(users)
      .values({ tenantId: tenant.id, email: input.ownerEmail, role: 'owner', createdAt: now })
      .returning({ id: users.id });
    ownerId = owner?.id ?? null;
    await audit(tx, {
      tenantId: tenant.id,
      actor,
      action: 'user.create',
      objectType: 'user',
      objectId: ownerId ?? '',
    });
  }
  return { tenant, ownerId };
}
