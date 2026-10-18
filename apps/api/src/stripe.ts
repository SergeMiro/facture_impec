// Stripe through plain fetch (docs/BILLING.md §1): form-encoded requests, JSON answers, one pinned API
// version. Only what billing needs: Checkout, the customer portal, a subscription, meter events, and
// the webhook signature. The key is sent as a header and never logged.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/** Pinned on every request (docs.stripe.com/upgrades); the webhook endpoint takes the same one. */
export const STRIPE_VERSION = '2026-09-30.endive';
export const STRIPE_API = 'https://api.stripe.com';

export class StripeError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'StripeError';
  }
}

/** v1 bodies: nested objects and arrays in brackets, `line_items[0][price]=…` (docs.stripe.com/api). */
export function formEncode(params: Record<string, unknown>): string {
  const out = new URLSearchParams();
  const add = (key: string, value: unknown) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      for (const [i, v] of value.entries()) add(`${key}[${i}]`, v);
    } else if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) add(`${key}[${k}]`, v);
    } else out.append(key, String(value));
  };
  for (const [k, v] of Object.entries(params)) add(k, v);
  return out.toString();
}

/** Since basil the period sits on each item, not on the subscription (docs/BILLING.md §6). */
export const StripeSubscription = z.object({
  id: z.string(),
  status: z.string(),
  customer: z.string(),
  metadata: z.record(z.string(), z.string()).default({}),
  items: z.object({
    data: z.array(
      z.object({ price: z.object({ id: z.string() }), current_period_end: z.number().int() }),
    ),
  }),
});
export type StripeSubscription = z.infer<typeof StripeSubscription>;

const Session = z.object({ id: z.string(), url: z.string().nullable().optional() });
const ErrorBody = z.object({
  error: z.object({ code: z.string().nullish(), message: z.string().nullish() }),
});

export interface MeterEvent {
  eventName: string;
  customer: string;
  /** Stripe drops a second event with the same identifier for at least 24 h. */
  identifier: string;
  at: Date;
}

export class StripeApi {
  constructor(
    private readonly key: string,
    private readonly baseUrl: string = STRIPE_API,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async call(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params?: Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<unknown> {
    const body = params && method !== 'GET' ? formEncode(params) : undefined;
    const res = await this.fetcher(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.key}`,
        'stripe-version': STRIPE_VERSION,
        ...(body !== undefined && { 'content-type': 'application/x-www-form-urlencoded' }),
        ...(idempotencyKey && { 'idempotency-key': idempotencyKey }),
      },
      ...(body !== undefined && { body }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new StripeError(res.status, null, `Stripe answered ${res.status} without JSON`);
    }
    if (!res.ok) {
      const e = ErrorBody.safeParse(data);
      const code = e.success ? (e.data.error.code ?? null) : null;
      const message = e.success ? (e.data.error.message ?? '') : '';
      throw new StripeError(
        res.status,
        code,
        `Stripe ${res.status}${code ? ` ${code}` : ''}: ${message}`,
      );
    }
    return data;
  }

  async createCheckout(params: Record<string, unknown>, idempotencyKey: string) {
    const session = Session.parse(
      await this.call('POST', '/v1/checkout/sessions', params, idempotencyKey),
    );
    if (!session.url) throw new StripeError(200, null, 'Checkout session without a url');
    return { id: session.id, url: session.url };
  }

  async createPortal(customer: string, returnUrl: string) {
    const session = Session.parse(
      await this.call('POST', '/v1/billing_portal/sessions', {
        customer,
        return_url: returnUrl,
        locale: 'fr',
      }),
    );
    if (!session.url) throw new StripeError(200, null, 'portal session without a url');
    return { url: session.url };
  }

  async getSubscription(id: string): Promise<StripeSubscription> {
    return StripeSubscription.parse(
      await this.call('GET', `/v1/subscriptions/${encodeURIComponent(id)}`),
    );
  }

  /** Now, invoicing the metered usage not billed yet (docs/BILLING.md §8). */
  async cancelSubscription(id: string): Promise<StripeSubscription> {
    return StripeSubscription.parse(
      await this.call('DELETE', `/v1/subscriptions/${encodeURIComponent(id)}`, {
        invoice_now: true,
        prorate: false,
      }),
    );
  }

  async meterEvent(event: MeterEvent): Promise<void> {
    await this.call(
      'POST',
      '/v1/billing/meter_events',
      {
        event_name: event.eventName,
        identifier: event.identifier,
        timestamp: Math.floor(+event.at / 1000),
        payload: { stripe_customer_id: event.customer, value: 1 },
      },
      `meter-${event.identifier}`,
    );
  }
}

/** Stripe's own libraries accept 5 minutes between the signature's timestamp and now. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;

/**
 * `Stripe-Signature: t=…,v1=…[,v1=…]`: HMAC-SHA256 of `t.body` under the endpoint's secret, hex. Any
 * v1 may match (two while a secret rolls); other schemes are ignored (docs/BILLING.md §4).
 */
export function verifyStripeSignature(
  header: string | undefined,
  body: string,
  secret: string,
  now: Date,
): boolean {
  if (!header) return false;
  let timestamp = Number.NaN;
  const signatures: Buffer[] = [];
  for (const part of header.split(',')) {
    const at = part.indexOf('=');
    const key = part.slice(0, at).trim();
    const value = part.slice(at + 1).trim();
    if (key === 't') timestamp = Number(value);
    else if (key === 'v1' && /^[0-9a-f]{64}$/i.test(value))
      signatures.push(Buffer.from(value, 'hex'));
  }
  if (!Number.isInteger(timestamp) || !signatures.length) return false;
  if (Math.abs(+now / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest();
  return signatures.some((s) => timingSafeEqual(s, expected));
}
