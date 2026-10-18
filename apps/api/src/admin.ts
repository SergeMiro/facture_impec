// The operator's routes (Bearer ADMIN_TOKEN): list and create companies, set one's platform account and
// switch it live in prod, give it a firm's brand or the pilot status, and the local outbox. Every change is audited as `admin`.
import { Address, isValidSiren } from '@fi/core';
import {
  and,
  apiKeys,
  asc,
  audit,
  eq,
  isNull,
  sha256,
  TENANT_PROVIDERS,
  type TenantRow,
  tenants,
} from '@fi/db';
import { TRIAL_DAYS, WhiteLabel } from '@fi/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import { adminAuth, newApiKey } from './auth';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { body, Email, uuid } from './http';
import { OutboxMailer } from './mail';
import { homeProvider } from './platform';
import { insertTenant } from './tenants';
import { tenantView } from './views';

const NewTenant = z.object({
  name: z.string().min(1),
  siren: z.string().refine(isValidSiren, 'not a valid SIREN'),
  vatId: z.string().min(1).optional(),
  address: Address.optional(),
  /** Default: the deployment's own platform (mock in local, B2Brouter elsewhere). */
  pdpProvider: z.enum(TENANT_PROVIDERS).optional(),
  /** Defaults to the SIREN: B2Brouter keeps one account per SIREN (docs/B2BROUTER.md §3.2). */
  pdpAccount: z.string().min(1).optional(),
  vatOnDebits: z.boolean().default(false),
  /** The person who signs in to the add-in with a link (role owner). */
  ownerEmail: Email.optional(),
  /** The operator's companies are pilots (never billed) unless said otherwise. */
  billing: z.enum(['pilot', 'trial']).default('pilot'),
});

const LiveBody = z.object({ live: z.boolean(), confirmSiren: z.string() });
const BrandBody = z.object({ whiteLabel: WhiteLabel.nullable() });
const BillingBody = z.object({ status: z.enum(['pilot', 'trial']) });
const PlatformBody = z.object({ account: z.string().trim().min(1).max(100) });

export function adminRoutes(deps: ApiDeps) {
  const admin = new Hono();
  admin.use(adminAuth(deps));

  const company = async (id: string) => {
    const [row] = await deps.db
      .select()
      .from(tenants)
      .where(eq(tenants.id, uuid(id)));
    if (!row || row.deletedAt) throw new ApiError(404, 'tenant_not_found');
    return row;
  };

  const update = async (
    before: TenantRow,
    action: string,
    patch: Partial<typeof tenants.$inferInsert>,
  ) =>
    deps.db.transaction(async (tx) => {
      const [row] = await tx
        .update(tenants)
        .set(patch)
        .where(eq(tenants.id, before.id))
        .returning();
      if (!row) throw new ApiError(404, 'tenant_not_found');
      await audit(tx, {
        tenantId: row.id,
        actor: 'admin',
        action,
        objectType: 'tenant',
        objectId: row.id,
        before: tenantView(before),
        after: tenantView(row),
      });
      return row;
    });

  /** The companies, oldest first; `?siren=` finds one (the ids the routes below take). */
  admin.get('/tenants', async (c) => {
    const siren = c.req.query('siren')?.replace(/\s/g, '');
    const rows = await deps.db
      .select()
      .from(tenants)
      .where(and(isNull(tenants.deletedAt), siren ? eq(tenants.siren, siren) : undefined))
      .orderBy(asc(tenants.createdAt));
    return c.json({ tenants: rows.map(tenantView) });
  });

  admin.post('/tenants', async (c) => {
    const input = await body(c, NewTenant);
    const provider = input.pdpProvider ?? homeProvider(deps.pdp);
    if (!provider || !deps.pdp[provider]) throw new ApiError(409, 'pdp_not_configured');
    const apiKey = newApiKey();
    const tenant = await deps.db.transaction(async (tx) => {
      const { tenant: row } = await insertTenant(
        tx,
        {
          ...input,
          vatId: input.vatId ?? null,
          address: input.address ?? null,
          pdpProvider: provider,
        },
        'admin',
        deps.now(),
      );
      const [key] = await tx
        .insert(apiKeys)
        .values({ tenantId: row.id, hash: sha256(apiKey), label: 'initial' })
        .returning({ id: apiKeys.id });
      await audit(tx, {
        tenantId: row.id,
        actor: 'admin',
        action: 'api_key.create',
        objectType: 'api_key',
        objectId: key?.id ?? '',
      });
      return row;
    });
    // The key is shown here once and never again (only its hash is stored).
    return c.json({ tenant: tenantView(tenant), apiKey }, 201);
  });

  /**
   * « Switch one to prod » (plan §11 M7): real sends open once the company's account at its platform
   * answers. Only prod gates sends this way (src/platform.ts awaitsGoLive).
   */
  admin.put('/tenants/:id/live', async (c) => {
    const { live, confirmSiren } = await body(c, LiveBody);
    const before = await company(c.req.param('id'));
    if (confirmSiren.replace(/\s/g, '') !== before.siren)
      throw new ApiError(409, 'confirm_mismatch');
    if (!live) return c.json(tenantView(await update(before, 'tenant.offline', { liveAt: null })));
    if (before.liveAt) return c.json(tenantView(before));
    const adapter = deps.pdp[before.pdpProvider];
    if (!adapter) throw new ApiError(409, 'pdp_not_configured');
    try {
      // The cheapest call that needs the account to exist and our key to reach it.
      await adapter.listInbound({ account: before.pdpAccount, since: deps.now() });
    } catch (e) {
      const details = e instanceof Error ? e.message : String(e);
      throw new ApiError(409, 'platform_account_missing', undefined, details);
    }
    return c.json(tenantView(await update(before, 'tenant.live', { liveAt: deps.now() })));
  });

  /**
   * The company's account id at its platform, when it is not the SIREN a sign-up gives (docs/B2BROUTER.md
   * T22). Fixed once the company is live: its invoices are followed through that account.
   */
  admin.put('/tenants/:id/platform', async (c) => {
    const { account } = await body(c, PlatformBody);
    const before = await company(c.req.param('id'));
    if (before.liveAt) throw new ApiError(409, 'tenant_live');
    return c.json(tenantView(await update(before, 'tenant.platform', { pdpAccount: account })));
  });

  admin.put('/tenants/:id/white-label', async (c) => {
    const { whiteLabel } = await body(c, BrandBody);
    const before = await company(c.req.param('id'));
    return c.json(tenantView(await update(before, 'tenant.white_label', { whiteLabel })));
  });

  /** Pilot customers are never billed; back to « trial » gives a fresh trial month. */
  admin.put('/tenants/:id/billing', async (c) => {
    const { status } = await body(c, BillingBody);
    const before = await company(c.req.param('id'));
    if (before.stripeSubscriptionId && status === 'trial') {
      throw new ApiError(409, 'billing_has_subscription');
    }
    const trialEndsAt = status === 'trial' ? new Date(+deps.now() + TRIAL_DAYS * 86_400_000) : null;
    return c.json(
      tenantView(await update(before, 'tenant.billing', { billingStatus: status, trialEndsAt })),
    );
  });

  // Local only: the mails the outbox kept (src/mail.ts), for the E2E run, scenarios and the developer.
  admin.get('/outbox', (c) => {
    if (!(deps.mailer instanceof OutboxMailer)) throw new ApiError(404, 'route_not_found');
    return c.json({ mails: deps.mailer.sent });
  });

  return admin;
}
