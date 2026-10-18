// Billing (plan §11 M7, docs/BILLING.md): a 30-day trial, then a plan bought through Stripe Checkout;
// the month's quota, and each invoice sent beyond it reported to Stripe as one meter event. Stripe
// holds the prices, the card and the invoices; our row holds the status, which its webhooks keep
// current. A deployment without STRIPE_SECRET_KEY bills nobody and blocks nobody.
import { randomUUID } from 'node:crypto';
import { parisToday } from '@fi/core';
import {
  and,
  audit,
  billingUsage,
  count,
  type DbOrTx,
  eq,
  gte,
  inArray,
  invoices,
  isNull,
  stripeEvents,
  type TenantRow,
  type Tx,
  tenants,
} from '@fi/db';
import {
  BILLING_INTERVALS,
  BillingInterval,
  type BillingStatus,
  MONTHLY_SENDS,
  PLANS,
  Plan,
  TRIAL_REAL_SENDS,
  t,
} from '@fi/shared';
import type { ServerEnv } from '@fi/shared/env';
import { Hono } from 'hono';
import { z } from 'zod';
import { isOwner, type TenantEnv } from './auth';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { body } from './http';
import { page } from './page';
import {
  STRIPE_API,
  StripeApi,
  StripeError,
  type StripeSubscription,
  verifyStripeSignature,
} from './stripe';
import { tenantView } from './views';

export type PriceKey = `${Plan}:${BillingInterval}`;

export interface Billing {
  stripe: StripeApi;
  webhookSecret: string;
  /** The Checkout prices of each plan and interval sold: the flat one first, then any metered one. */
  prices: Partial<Record<PriceKey, string[]>>;
  /** The meter's event name; null: invoices beyond the quota are counted, not charged. */
  meterEvent: string | null;
  automaticTax: boolean;
}

/** Null without a Stripe key. Only local may point at a stand-in instead of Stripe. */
export function billingFromEnv(env: ServerEnv, fetcher?: typeof fetch): Billing | null {
  if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) return null;
  const baseUrl = env.STRIPE_BASE_URL ?? STRIPE_API;
  if (env.FI_ENV !== 'local' && new URL(baseUrl).origin !== STRIPE_API) {
    throw new Error(`STRIPE_BASE_URL: only local may use a stand-in (${new URL(baseUrl).origin})`);
  }
  const prices: Billing['prices'] = {};
  const set = (key: PriceKey, list: string[] | undefined) => {
    if (list) prices[key] = list;
  };
  set('essentiel:month', env.STRIPE_PRICES_ESSENTIEL_MONTH);
  set('essentiel:year', env.STRIPE_PRICES_ESSENTIEL_YEAR);
  set('croissance:month', env.STRIPE_PRICES_CROISSANCE_MONTH);
  set('croissance:year', env.STRIPE_PRICES_CROISSANCE_YEAR);
  return {
    stripe: new StripeApi(env.STRIPE_SECRET_KEY, baseUrl, fetcher),
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    prices,
    meterEvent: env.STRIPE_METER_EVENT ?? null,
    automaticTax: env.STRIPE_AUTOMATIC_TAX,
  };
}

/** A trial past its end date is over, whether or not a job has noticed. */
export function billingState(
  tenant: Pick<TenantRow, 'billingStatus' | 'trialEndsAt'>,
  now: Date,
): BillingStatus {
  if (tenant.billingStatus === 'trial' && tenant.trialEndsAt && tenant.trialEndsAt <= now) {
    return 'ended';
  }
  return tenant.billingStatus;
}

/** `2026-10`: quotas follow the calendar month in Europe/Paris. */
export const billingMonth = (at: Date) => parisToday(at).slice(0, 7);

async function monthSends(db: DbOrTx, tenantId: string, month: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(billingUsage)
    .where(and(eq(billingUsage.tenantId, tenantId), eq(billingUsage.month, month)));
  return row?.n ?? 0;
}

/** Real invoices sent, plus those on their way, so that parallel clicks cannot pass the limit. */
async function trialSends(db: DbOrTx, tenantId: string): Promise<number> {
  const [sent] = await db
    .select({ n: count() })
    .from(billingUsage)
    .where(eq(billingUsage.tenantId, tenantId));
  const [queued] = await db
    .select({ n: count() })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        eq(invoices.isTest, false),
        inArray(invoices.status, ['ready_to_send', 'sending']),
      ),
    );
  return (sent?.n ?? 0) + (queued?.n ?? 0);
}

/**
 * Before a real send (src/invoices.ts requestSend): the trial's limits, or a subscription. Mode test
 * never asks, and a subscription Stripe is retrying (past_due) still sends: the pane warns instead.
 */
export async function assertMaySend(
  deps: Pick<ApiDeps, 'billing' | 'now'>,
  tx: Tx,
  tenant: TenantRow,
): Promise<void> {
  if (!deps.billing) return;
  const state = billingState(tenant, deps.now());
  if (state === 'ended') throw new ApiError(409, 'billing_required');
  if (state === 'trial' && (await trialSends(tx, tenant.id)) >= TRIAL_REAL_SENDS) {
    throw new ApiError(409, 'trial_sends_used', { count: TRIAL_REAL_SENDS });
  }
}

/** Whether invoices beyond the quota cost something: a meter, and a metered price after the flat one. */
const charged = (billing: Billing | null | undefined, key: PriceKey) =>
  Boolean(billing?.meterEvent) && (billing?.prices[key]?.length ?? 0) > 1;

/**
 * In the transaction that records a real deposit (src/workers.ts runSend): the invoice counts in its
 * month, and is billable beyond the plan's quota. The company row is locked so that two sends
 * finishing together are counted one after the other.
 */
export async function recordUsage(
  tx: Tx,
  deps: { billing?: Billing | null },
  invoice: { id: string; tenantId: string },
  at: Date,
): Promise<void> {
  const [tenant] = await tx
    .select({
      status: tenants.billingStatus,
      plan: tenants.plan,
      interval: tenants.billingInterval,
    })
    .from(tenants)
    .where(eq(tenants.id, invoice.tenantId))
    .for('update');
  if (!tenant) return;
  const month = billingMonth(at);
  const subscribed = tenant.status === 'active' || tenant.status === 'past_due';
  const billable =
    subscribed &&
    tenant.plan !== null &&
    tenant.interval !== null &&
    charged(deps.billing, `${tenant.plan}:${tenant.interval}`) &&
    (await monthSends(tx, invoice.tenantId, month)) >= MONTHLY_SENDS[tenant.plan];
  await tx
    .insert(billingUsage)
    .values({ invoiceId: invoice.id, tenantId: invoice.tenantId, month, sentAt: at, billable })
    .onConflictDoNothing();
}

/** Stripe refuses meter events older than 35 days; one day of margin. */
const REPORT_WINDOW_MS = 34 * 86_400_000;

/** Each billable invoice once, as one meter event named by the invoice (sweep, src/workers.ts). */
export async function runUsageReport(
  deps: { db: DbOrTx; billing?: Billing | null; now: () => Date },
  log: (message: string) => void = () => {},
): Promise<{ reported: number; failed: number }> {
  const billing = deps.billing;
  if (!billing?.meterEvent) return { reported: 0, failed: 0 };
  const now = deps.now();
  const due = await deps.db
    .select({
      invoiceId: billingUsage.invoiceId,
      sentAt: billingUsage.sentAt,
      customer: tenants.stripeCustomerId,
    })
    .from(billingUsage)
    .innerJoin(tenants, eq(tenants.id, billingUsage.tenantId))
    .where(
      and(
        eq(billingUsage.billable, true),
        isNull(billingUsage.reportedAt),
        gte(billingUsage.sentAt, new Date(+now - REPORT_WINDOW_MS)),
      ),
    )
    .limit(200);
  let reported = 0;
  let failed = 0;
  for (const row of due) {
    try {
      if (!row.customer) throw new Error('no Stripe customer');
      await billing.stripe.meterEvent({
        eventName: billing.meterEvent,
        customer: row.customer,
        identifier: row.invoiceId,
        at: row.sentAt,
      });
      await deps.db
        .update(billingUsage)
        .set({ reportedAt: deps.now(), reportError: null })
        .where(eq(billingUsage.invoiceId, row.invoiceId));
      reported++;
    } catch (e) {
      failed++;
      const message = e instanceof Error ? e.message : String(e);
      log(`meter event ${row.invoiceId}: ${message}`);
      await deps.db
        .update(billingUsage)
        .set({ reportError: message.slice(0, 500) })
        .where(eq(billingUsage.invoiceId, row.invoiceId));
    }
  }
  return { reported, failed };
}

/** Stripe's subscription statuses (docs/BILLING.md §5); null: the first payment is still pending. */
function statusOf(sub: StripeSubscription): 'active' | 'past_due' | 'ended' | null {
  switch (sub.status) {
    case 'trialing':
    case 'active':
      return 'active';
    case 'past_due':
      return 'past_due';
    case 'incomplete':
      return null;
    default:
      // canceled, unpaid, incomplete_expired, paused: no sends until a new subscription.
      return 'ended';
  }
}

/** The plan and interval whose flat price the subscription holds. */
function boughtPlan(billing: Billing, sub: StripeSubscription) {
  const held = new Set(sub.items.data.map((i) => i.price.id));
  for (const plan of PLANS) {
    for (const interval of BILLING_INTERVALS) {
      const flat = billing.prices[`${plan}:${interval}`]?.[0];
      if (flat && held.has(flat)) return { plan, interval };
    }
  }
  return null;
}

/** The ids a Stripe event points at; the subscription itself is read back from Stripe. */
function subscriptionOf(event: StripeEvent): { subscriptionId: string; tenantId?: string } | null {
  const object = event.data.object;
  const text = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  if (event.type === 'checkout.session.completed') {
    const subscriptionId = text(object.subscription);
    const tenantId = text(object.client_reference_id);
    return subscriptionId ? { subscriptionId, ...(tenantId && { tenantId }) } : null;
  }
  if (event.type.startsWith('customer.subscription.')) {
    const subscriptionId = text(object.id);
    const metadata = z.record(z.string(), z.string()).safeParse(object.metadata);
    const tenantId = metadata.success ? metadata.data.tenant_id : undefined;
    return subscriptionId ? { subscriptionId, ...(tenantId && { tenantId }) } : null;
  }
  return null;
}

const StripeEvent = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.object({ object: z.record(z.string(), z.unknown()) }),
});
type StripeEvent = z.infer<typeof StripeEvent>;

async function applySubscription(
  tx: Tx,
  deps: Pick<ApiDeps, 'now'>,
  billing: Billing,
  sub: StripeSubscription,
  hint: string | undefined,
) {
  const tenantId = sub.metadata.tenant_id ?? hint;
  const byId = tenantId && z.uuid().safeParse(tenantId).success ? tenantId : null;
  const [before] = await tx
    .select()
    .from(tenants)
    .where(byId ? eq(tenants.id, byId) : eq(tenants.stripeSubscriptionId, sub.id))
    .for('update');
  if (!before || before.deletedAt) return;
  const status = statusOf(sub);
  // An older subscription ending says nothing about the current one.
  if (before.stripeSubscriptionId && before.stripeSubscriptionId !== sub.id && status === 'ended') {
    return;
  }
  const now = deps.now();
  // Bought during the trial, then cancelled: what is left of the trial comes back.
  const ended = before.trialEndsAt && before.trialEndsAt > now ? 'trial' : 'ended';
  const bought = boughtPlan(billing, sub);
  const ends = sub.items.data.map((i) => i.current_period_end);
  const [row] = await tx
    .update(tenants)
    .set({
      stripeCustomerId: sub.customer,
      stripeSubscriptionId: sub.id,
      billingStatus: status === 'ended' ? ended : (status ?? before.billingStatus),
      plan: bought?.plan ?? before.plan,
      billingInterval: bought?.interval ?? before.billingInterval,
      billingPeriodEnd: ends.length ? new Date(Math.max(...ends) * 1000) : null,
    })
    .where(eq(tenants.id, before.id))
    .returning();
  if (!row) return;
  await audit(tx, {
    tenantId: row.id,
    actor: 'stripe',
    action: 'tenant.billing',
    objectType: 'tenant',
    objectId: row.id,
    before: tenantView(before),
    after: tenantView(row),
  });
}

/**
 * POST /webhooks/stripe. Each event is applied once (stripe_events); its subscription is read back
 * from Stripe, so events arriving out of order still leave the latest state (docs/BILLING.md §4).
 */
export async function handleStripeWebhook(deps: ApiDeps, headers: Headers, raw: string) {
  const billing = deps.billing;
  if (!billing) throw new ApiError(404, 'route_not_found');
  const signature = headers.get('stripe-signature') ?? undefined;
  if (!verifyStripeSignature(signature, raw, billing.webhookSecret, deps.now())) {
    throw new ApiError(400, 'webhook_signature');
  }
  let event: StripeEvent;
  try {
    event = StripeEvent.parse(JSON.parse(raw));
  } catch {
    throw new ApiError(400, 'invalid_request');
  }
  const [seen] = await deps.db
    .select({ id: stripeEvents.id })
    .from(stripeEvents)
    .where(eq(stripeEvents.id, event.id));
  if (seen) return { applied: false };
  const target = subscriptionOf(event);
  // A Stripe outage answers 500 here, and Stripe sends the event again later.
  const sub = target ? await billing.stripe.getSubscription(target.subscriptionId) : null;
  return deps.db.transaction(async (tx) => {
    const [fresh] = await tx
      .insert(stripeEvents)
      .values({ id: event.id, type: event.type, receivedAt: deps.now() })
      .onConflictDoNothing()
      .returning({ id: stripeEvents.id });
    if (!fresh) return { applied: false };
    if (sub) await applySubscription(tx, deps, billing, sub, target?.tenantId);
    return { applied: true };
  });
}

/** Ends the subscription now (account deletion, src/rgpd.ts): nothing may be charged afterwards. */
export async function cancelSubscription(deps: Pick<ApiDeps, 'billing'>, tenant: TenantRow) {
  const subscribed = tenant.billingStatus === 'active' || tenant.billingStatus === 'past_due';
  if (!deps.billing || !tenant.stripeSubscriptionId || !subscribed) return;
  try {
    await deps.billing.stripe.cancelSubscription(tenant.stripeSubscriptionId);
  } catch (e) {
    // Already gone at Stripe (cancelled in the portal meanwhile): nothing left to stop.
    if (e instanceof StripeError && e.status === 404) return;
    throw new ApiError(502, 'billing_cancel_failed', undefined, String(e));
  }
}

export async function billingView(deps: ApiDeps, tenant: TenantRow) {
  const now = deps.now();
  const state = billingState(tenant, now);
  const month = billingMonth(now);
  const subscribed = state === 'active' || state === 'past_due';
  const billing = deps.billing;
  return {
    enabled: Boolean(billing),
    status: state,
    plan: tenant.plan,
    interval: tenant.billingInterval,
    trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null,
    periodEnd: tenant.billingPeriodEnd?.toISOString() ?? null,
    trial:
      state === 'trial'
        ? {
            sends: TRIAL_REAL_SENDS,
            left: Math.max(0, TRIAL_REAL_SENDS - (await trialSends(deps.db, tenant.id))),
          }
        : null,
    month: {
      month,
      sent: await monthSends(deps.db, tenant.id, month),
      included: subscribed && tenant.plan ? MONTHLY_SENDS[tenant.plan] : null,
      overage:
        subscribed && tenant.plan && tenant.billingInterval
          ? charged(billing, `${tenant.plan}:${tenant.billingInterval}`)
          : false,
    },
    offers: billing
      ? PLANS.flatMap((plan) =>
          BILLING_INTERVALS.filter((i) => billing.prices[`${plan}:${i}`]).map((interval) => ({
            plan,
            interval,
            included: MONTHLY_SENDS[plan],
            overage: charged(billing, `${plan}:${interval}`),
          })),
        )
      : [],
    portal: Boolean(billing && tenant.stripeCustomerId),
  };
}
export type BillingView = Awaited<ReturnType<typeof billingView>>;

const CheckoutBody = z.object({ plan: Plan, interval: BillingInterval });

/** The task pane's routes, behind tenantAuth (src/app.ts); buying and managing are the owner's. */
export function billingRoutes(deps: ApiDeps) {
  const app = new Hono<TenantEnv>();

  const configured = () => {
    if (!deps.billing) throw new ApiError(409, 'billing_disabled');
    return deps.billing;
  };
  const owner = (principal: TenantEnv['Variables']['principal']) => {
    if (!isOwner(principal)) throw new ApiError(403, 'owner_only');
  };
  const pageUrl = (path: string) => new URL(path, deps.env.API_PUBLIC_URL).toString();

  app.get('/', async (c) => c.json(await billingView(deps, c.get('tenant'))));

  app.post('/checkout', async (c) => {
    const billing = configured();
    const tenant = c.get('tenant');
    const principal = c.get('principal');
    owner(principal);
    const { plan, interval } = await body(c, CheckoutBody);
    const prices = billing.prices[`${plan}:${interval}`];
    if (!prices) throw new ApiError(409, 'plan_unavailable');
    const state = billingState(tenant, deps.now());
    if (state === 'pilot') throw new ApiError(409, 'billing_pilot');
    if (state === 'active' || state === 'past_due') {
      throw new ApiError(409, 'billing_has_subscription');
    }
    const customer = tenant.stripeCustomerId;
    const session = await billing.stripe
      .createCheckout(
        {
          mode: 'subscription',
          // Quantity only on the flat price: a metered one takes none (docs/BILLING.md §2).
          line_items: prices.map((price, i) => (i === 0 ? { price, quantity: 1 } : { price })),
          success_url: `${pageUrl('/billing/done')}?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: pageUrl('/billing/cancelled'),
          client_reference_id: tenant.id,
          ...(customer
            ? { customer, customer_update: { name: 'auto', address: 'auto' } }
            : principal.kind === 'session' && { customer_email: principal.email }),
          metadata: { tenant_id: tenant.id },
          subscription_data: { metadata: { tenant_id: tenant.id } },
          locale: 'fr',
          allow_promotion_codes: true,
          billing_address_collection: 'required',
          tax_id_collection: { enabled: true },
          ...(billing.automaticTax && { automatic_tax: { enabled: true } }),
        },
        randomUUID(),
      )
      .catch((e: unknown) => {
        throw new ApiError(502, 'billing_unavailable', undefined, String(e));
      });
    await deps.db.transaction((tx) =>
      audit(tx, {
        tenantId: tenant.id,
        actor: principal.kind === 'session' ? `user:${principal.userId}` : 'user',
        action: 'billing.checkout',
        objectType: 'tenant',
        objectId: tenant.id,
        after: { plan, interval },
      }),
    );
    return c.json({ url: session.url });
  });

  app.post('/portal', async (c) => {
    const billing = configured();
    const tenant = c.get('tenant');
    owner(c.get('principal'));
    if (!tenant.stripeCustomerId) throw new ApiError(409, 'billing_no_customer');
    const session = await billing.stripe
      .createPortal(tenant.stripeCustomerId, pageUrl('/billing/return'))
      .catch((e: unknown) => {
        throw new ApiError(502, 'billing_unavailable', undefined, String(e));
      });
    return c.json({ url: session.url });
  });

  return app;
}

/** Where Stripe sends the browser back: nothing to do there but return to Excel. */
export function billingPages() {
  const app = new Hono();
  const title = t('billing.page.title');
  app.get('/done', (c) => c.html(page(title, t('billing.page.done'))));
  app.get('/cancelled', (c) => c.html(page(title, t('billing.page.cancelled'))));
  app.get('/return', (c) => c.html(page(title, t('billing.page.return'))));
  return app;
}
