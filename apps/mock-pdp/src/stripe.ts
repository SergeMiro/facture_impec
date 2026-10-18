// A stand-in for the part of Stripe that billing uses (docs/BILLING.md), served at /stripe: Checkout
// and portal sessions with a page that « pays » or cancels, subscriptions, meter events, and signed
// snapshot webhooks. Local, the E2E run and the scenario stack bill against it; no card, no money.
import { createHmac, randomBytes } from 'node:crypto';
import { type Context, Hono } from 'hono';
import { html } from 'hono/html';

export interface StripeStandInOptions {
  /** Signs the webhooks (header Stripe-Signature), like an endpoint's `whsec_…`. */
  webhookSecret: string;
  /** Where the webhooks go; none when unset. */
  webhookUrl?: string;
  /** This stand-in's address as a browser sees it: the Checkout and portal pages live there. */
  publicUrl?: string;
  /** Default: global fetch (the scenario stack hands its own). */
  fetcher?: typeof fetch;
  now?: () => Date;
  log?: (message: string) => void;
}

interface Item {
  price: { id: string };
  current_period_end: number;
}

export interface StandInSubscription {
  id: string;
  object: 'subscription';
  status: string;
  customer: string;
  metadata: Record<string, string>;
  items: { object: 'list'; data: Item[] };
}

interface CheckoutSession {
  id: string;
  object: 'checkout.session';
  mode: string;
  status: 'open' | 'complete' | 'expired';
  url: string;
  success_url: string;
  cancel_url: string | null;
  client_reference_id: string | null;
  customer: string | null;
  customer_email: string | null;
  subscription: string | null;
  metadata: Record<string, string>;
  prices: string[];
  subscriptionMetadata: Record<string, string>;
}

export interface StandInMeterEvent {
  event_name: string;
  identifier: string;
  timestamp: number;
  payload: Record<string, string>;
}

type Form = { [key: string]: string | Form };

/** `a[b][0]=x` → { a: { b: { 0: 'x' } } }: Stripe's bracket notation, read back. */
function unflatten(params: URLSearchParams): Form {
  const root: Form = {};
  for (const [key, value] of params) {
    const path = key.replace(/\]/g, '').split('[');
    let node = root;
    path.forEach((part, i) => {
      if (i === path.length - 1) node[part] = value;
      else {
        const next = node[part];
        if (typeof next === 'object') node = next;
        else {
          const child: Form = {};
          node[part] = child;
          node = child;
        }
      }
    });
  }
  return root;
}

const text = (form: Form, key: string): string | null => {
  const v = form[key];
  return typeof v === 'string' && v ? v : null;
};
const map = (form: Form, key: string): Record<string, string> => {
  const v = form[key];
  if (typeof v !== 'object') return {};
  return Object.fromEntries(
    Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'),
  );
};

class StripeRequestError extends Error {
  constructor(
    readonly status: 400 | 401 | 404,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

const id = (prefix: string) => `${prefix}_test_${randomBytes(9).toString('hex')}`;
const DAY = 86_400;

export class StripeStandIn {
  readonly app = new Hono();
  readonly sessions = new Map<string, CheckoutSession>();
  readonly subscriptions = new Map<string, StandInSubscription>();
  readonly meterEvents: StandInMeterEvent[] = [];
  readonly portals = new Map<string, { customer: string; return_url: string }>();
  readonly delivered: { type: string; status: number | null }[] = [];
  #options: StripeStandInOptions;

  constructor(options: StripeStandInOptions) {
    this.#options = options;
    this.#routes();
  }

  setWebhookUrl(url: string | undefined) {
    if (url) this.#options.webhookUrl = url;
    else delete this.#options.webhookUrl;
  }

  #now = () => Math.floor(+(this.#options.now?.() ?? new Date()) / 1000);
  #page = (path: string) =>
    `${(this.#options.publicUrl ?? 'http://localhost:4010/stripe').replace(/\/$/, '')}${path}`;

  /** What « Payer » does: a customer, an active subscription, then the two webhooks. */
  async pay(sessionId: string): Promise<CheckoutSession> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new StripeRequestError(404, `No such checkout.session: ${sessionId}`);
    if (session.status !== 'open') return session;
    const customer = session.customer ?? id('cus');
    const now = this.#now();
    const subscription: StandInSubscription = {
      id: id('sub'),
      object: 'subscription',
      status: 'active',
      customer,
      metadata: session.subscriptionMetadata,
      items: {
        object: 'list',
        // The stand-in knows no intervals: a price whose id says « year » renews in a year.
        data: session.prices.map((price) => ({
          price: { id: price },
          current_period_end: now + (/year/i.test(price) ? 365 : 30) * DAY,
        })),
      },
    };
    this.subscriptions.set(subscription.id, subscription);
    Object.assign(session, { status: 'complete', customer, subscription: subscription.id });
    await this.#send('customer.subscription.created', subscription);
    await this.#send('checkout.session.completed', this.#sessionView(session));
    return session;
  }

  /** The portal's buttons, and what the scenario stack plays: a failed payment, a cancellation. */
  async setStatus(subscriptionId: string, status: 'active' | 'past_due' | 'canceled' | 'unpaid') {
    const sub = this.subscriptions.get(subscriptionId);
    if (!sub) throw new StripeRequestError(404, `No such subscription: '${subscriptionId}'`);
    sub.status = status;
    await this.#send(
      status === 'canceled' ? 'customer.subscription.deleted' : 'customer.subscription.updated',
      sub,
    );
    return sub;
  }

  #sessionView(s: CheckoutSession) {
    const { prices: _p, subscriptionMetadata: _m, ...view } = s;
    return view;
  }

  async #send(type: string, object: object) {
    const url = this.#options.webhookUrl;
    if (!url) return;
    const body = JSON.stringify({
      id: id('evt'),
      object: 'event',
      type,
      created: this.#now(),
      livemode: false,
      api_version: '2026-09-30.endive',
      data: { object },
    });
    const t = this.#now();
    const v1 = createHmac('sha256', this.#options.webhookSecret)
      .update(`${t}.${body}`)
      .digest('hex');
    try {
      const res = await (this.#options.fetcher ?? fetch)(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${v1}` },
        body,
      });
      this.delivered.push({ type, status: res.status });
      if (!res.ok) this.#options.log?.(`stripe stand-in: ${type} → ${res.status}`);
    } catch (e) {
      this.delivered.push({ type, status: null });
      this.#options.log?.(`stripe stand-in: ${type} not delivered (${String(e)})`);
    }
  }

  async #form(c: Context): Promise<Form> {
    return unflatten(new URLSearchParams(await c.req.text()));
  }

  #auth(c: Context) {
    const key = c.req.header('authorization')?.replace(/^Bearer /, '') ?? '';
    if (!/^(sk|rk)_test_/.test(key)) {
      throw new StripeRequestError(401, 'Invalid API Key provided', 'api_key_invalid');
    }
  }

  #routes() {
    const app = this.app;
    app.onError((err, c) => {
      if (err instanceof StripeRequestError) {
        return c.json(
          {
            error: { type: 'invalid_request_error', message: err.message, code: err.code ?? null },
          },
          err.status,
        );
      }
      throw err;
    });

    app.post('/v1/checkout/sessions', async (c) => {
      this.#auth(c);
      const form = await this.#form(c);
      if (text(form, 'mode') !== 'subscription') {
        throw new StripeRequestError(
          400,
          'The stand-in sells subscriptions only',
          'parameter_invalid',
        );
      }
      const items = form.line_items;
      const prices =
        typeof items === 'object'
          ? Object.values(items).flatMap((i) =>
              typeof i === 'object' && text(i, 'price') ? [text(i, 'price') as string] : [],
            )
          : [];
      const success = text(form, 'success_url');
      if (!prices.length || !success) {
        throw new StripeRequestError(
          400,
          'line_items and success_url are required',
          'parameter_missing',
        );
      }
      const sessionId = id('cs');
      const session: CheckoutSession = {
        id: sessionId,
        object: 'checkout.session',
        mode: 'subscription',
        status: 'open',
        url: this.#page(`/checkout/${sessionId}`),
        success_url: success,
        cancel_url: text(form, 'cancel_url'),
        client_reference_id: text(form, 'client_reference_id'),
        customer: text(form, 'customer'),
        customer_email: text(form, 'customer_email'),
        subscription: null,
        metadata: map(form, 'metadata'),
        prices,
        subscriptionMetadata:
          typeof form.subscription_data === 'object' ? map(form.subscription_data, 'metadata') : {},
      };
      this.sessions.set(sessionId, session);
      return c.json(this.#sessionView(session));
    });

    app.post('/v1/billing_portal/sessions', async (c) => {
      this.#auth(c);
      const form = await this.#form(c);
      const customer = text(form, 'customer');
      if (!customer)
        throw new StripeRequestError(400, 'Missing required param: customer.', 'parameter_missing');
      const portalId = id('bps');
      this.portals.set(portalId, { customer, return_url: text(form, 'return_url') ?? '' });
      return c.json({
        id: portalId,
        object: 'billing_portal.session',
        url: this.#page(`/portal/${portalId}`),
      });
    });

    app.get('/v1/subscriptions/:id', (c) => {
      this.#auth(c);
      const sub = this.subscriptions.get(c.req.param('id'));
      if (!sub)
        throw new StripeRequestError(
          404,
          `No such subscription: '${c.req.param('id')}'`,
          'resource_missing',
        );
      return c.json(sub);
    });

    app.delete('/v1/subscriptions/:id', async (c) => {
      this.#auth(c);
      const sub = this.subscriptions.get(c.req.param('id'));
      if (!sub || sub.status === 'canceled') {
        throw new StripeRequestError(
          404,
          `No such subscription: '${c.req.param('id')}'`,
          'resource_missing',
        );
      }
      return c.json(await this.setStatus(sub.id, 'canceled'));
    });

    app.post('/v1/billing/meter_events', async (c) => {
      this.#auth(c);
      const form = await this.#form(c);
      const name = text(form, 'event_name');
      const payload = map(form, 'payload');
      if (!name || !payload.stripe_customer_id || !payload.value) {
        throw new StripeRequestError(
          400,
          'event_name and payload are required',
          'parameter_missing',
        );
      }
      const identifier = text(form, 'identifier') ?? id('mev');
      const event: StandInMeterEvent = {
        event_name: name,
        identifier,
        timestamp: Number(text(form, 'timestamp') ?? this.#now()),
        payload,
      };
      // Stripe drops a second event with the same identifier (docs/BILLING.md §7).
      if (!this.meterEvents.some((e) => e.identifier === identifier)) this.meterEvents.push(event);
      return c.json({ object: 'billing.meter_event', livemode: false, ...event });
    });

    // For tests and the developer: what was reported.
    app.get('/_meter_events', (c) => c.json({ data: this.meterEvents }));

    // ── The pages a browser opens ───────────────────────────────────────────────────────────────
    const shell = (title: string, body: ReturnType<typeof html>) => html`<!doctype html>
<html lang="fr"><head><meta charset="utf-8" /><title>${title}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem}
button{font:inherit;padding:.5rem 1rem;margin-right:.5rem}</style></head>
<body><p><strong>Stripe (simulation locale)</strong> — aucun paiement réel.</p>${body}</body></html>`;

    app.get('/checkout/:id', (c) => {
      const s = this.sessions.get(c.req.param('id'));
      if (!s) return c.text('unknown session', 404);
      return c.html(
        shell(
          'Paiement',
          html`<h1>Abonnement</h1><p>${s.prices.join(', ')}</p>
<form method="post" action="${this.#page(`/checkout/${s.id}/pay`)}"><button type="submit">Payer</button></form>
${s.cancel_url ? html`<p><a href="${s.cancel_url}">Annuler</a></p>` : ''}`,
        ),
      );
    });

    app.post('/checkout/:id/pay', async (c) => {
      const s = await this.pay(c.req.param('id'));
      return c.redirect(s.success_url.replace('{CHECKOUT_SESSION_ID}', s.id), 303);
    });

    app.get('/portal/:id', (c) => {
      const p = this.portals.get(c.req.param('id'));
      if (!p) return c.text('unknown portal session', 404);
      const subs = [...this.subscriptions.values()].filter((s) => s.customer === p.customer);
      return c.html(
        shell(
          'Abonnement',
          html`<h1>Votre abonnement</h1>
${subs.map(
  (s) => html`<p>${s.id} — ${s.status}</p>
<form method="post" action="${this.#page(`/portal/${c.req.param('id')}/${s.id}/past_due`)}"><button>Simuler un paiement refusé</button></form>
<form method="post" action="${this.#page(`/portal/${c.req.param('id')}/${s.id}/canceled`)}"><button>Résilier</button></form>`,
)}
<p><a href="${p.return_url}">Revenir</a></p>`,
        ),
      );
    });

    app.post('/portal/:id/:sub/:status', async (c) => {
      const p = this.portals.get(c.req.param('id'));
      const status = c.req.param('status');
      if (!p || (status !== 'past_due' && status !== 'canceled')) return c.text('not found', 404);
      await this.setStatus(c.req.param('sub'), status);
      return c.redirect(p.return_url, 303);
    });
  }
}
