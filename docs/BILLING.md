# Billing (plan §11 M7)

Stripe sells the plans of `docs/research/PRICING.md` §3.2; our database only mirrors the status.
Code: `apps/api/src/billing.ts` (routes, gate, usage, webhook), `apps/api/src/stripe.ts` (plain `fetch`
client and signature check), stand-in `apps/mock-pdp/src/stripe.ts`, tests `apps/api/src/billing.test.ts`.

**Sources.** Every Stripe fact below was read on **2026-10-18** on docs.stripe.com (Markdown version of
each page). No Stripe account was created and no Stripe API was called: the code runs against the
stand-in only. Facts no page states explicitly are marked **NOT CONFIRMED** and carry a `TODO(verify)`
for the owner's first sandbox run (§11).

⚠️ **Prices are a proposal** (PRICING.md §3.2) until the owner confirms them against B2Brouter's quote.
They live only in the owner's Stripe account; the code knows price ids, never amounts.

---

## 1. API basics

| Fact | Source |
|---|---|
| Current version `2026-09-30.endive`; pin it per request with the `Stripe-Version` header instead of relying on the account default. We send it on every call (`STRIPE_VERSION`). | https://docs.stripe.com/api/versioning · https://docs.stripe.com/upgrades |
| Webhook events are rendered with the version set when the endpoint was created: create it pinned to endive. | https://docs.stripe.com/api/versioning |
| v1 bodies are `application/x-www-form-urlencoded`, nested keys in brackets (`line_items[0][price]`, `metadata[tenant_id]`); answers are JSON. | https://docs.stripe.com/api · https://docs.stripe.com/api/checkout/sessions/create |
| `Authorization: Bearer <key>` is accepted; HTTPS only. | https://docs.stripe.com/api/authentication |
| `Idempotency-Key` on v1 POSTs (≤ 255 chars, kept ≥ 24 h); no effect on GET/DELETE. | https://docs.stripe.com/api/idempotent_requests |
| Error body `{"error": {"type", "code", "message", …}}`. | https://docs.stripe.com/api/errors |
| Keys: `sk_test_`/`rk_test_` in a sandbox, `sk_live_`/`rk_live_` live; restricted keys recommended live. `packages/shared/src/env.ts` refuses a live key outside prod and a test key in prod. | https://docs.stripe.com/keys |
| Webhook secrets start with `whsec_`, one per endpoint, different in test and live. | https://docs.stripe.com/webhooks |
| Rate limit 25 req/s in a sandbox, 100 req/s live. | https://docs.stripe.com/rate-limits |

## 2. Checkout (`POST /v1/checkout/sessions`)

| Fact | Source |
|---|---|
| `mode=subscription` for recurring prices; `line_items[N][price]`; "Quantity should not be defined when `recurring.usage_type=metered`" → quantity 1 on the flat price only. | https://docs.stripe.com/api/checkout/sessions/create |
| `success_url` may contain the literal `{CHECKOUT_SESSION_ID}`, which Stripe fills in. `cancel_url` is optional. | https://docs.stripe.com/payments/checkout/custom-success-page |
| `client_reference_id` (≤ 200 chars) and `subscription_data[metadata]` (copied to the subscription) carry our tenant id. | https://docs.stripe.com/api/checkout/sessions/create |
| `customer` (existing) or `customer_email` (prefill when Checkout creates the customer). With an existing customer and tax id collection, pass `customer_update[name]=auto` (and `[address]=auto` with automatic tax). | https://docs.stripe.com/tax/checkout/tax-ids · https://docs.stripe.com/tax/checkout/page |
| `allow_promotion_codes`, `billing_address_collection=required`, `tax_id_collection[enabled]=true`, `automatic_tax[enabled]`, `locale=fr`. | https://docs.stripe.com/api/checkout/sessions/create |
| ⚠️ "You currently can't create mixed interval subscriptions on Checkout Sessions" → a yearly flat price cannot be sold with a monthly metered one (§10). | https://docs.stripe.com/billing/subscriptions/mixed-interval |
| Since endive, `payment_method_types` returns 400 (we never send it); `ui_mode` default `hosted_page`. | https://docs.stripe.com/changelog/endive/2026-09-30/remove-payment-method-types-checkout-sessions |
| The answer's `url` is present while the session is open; sessions expire after 24 h by default. | https://docs.stripe.com/api/checkout/sessions/object |
| Hosted Checkout inside an iframe: **NOT CONFIRMED**. Stripe advises against nesting Checkout in an iframe, so the task pane opens it in the browser (or an Office dialog whose first page is ours, `docs/APPSOURCE.md`). | https://docs.stripe.com/checkout/embedded/quickstart |

## 3. Customer portal (`POST /v1/billing_portal/sessions`)

| Fact | Source |
|---|---|
| Params `customer`, `return_url`, `locale`; answer `url` (short-lived). Authenticate the user first: only the owner of the company may open it. | https://docs.stripe.com/api/customer_portal/sessions/create · https://docs.stripe.com/customer-management/integrate-customer-portal |
| The portal's settings must be saved in the Dashboard, separately for each sandbox and for live, before sessions can be created. Exact error without them: **NOT CONFIRMED** — `TODO(verify)` in §11. | https://docs.stripe.com/customer-management/integrate-customer-portal |

## 4. Webhooks (`POST /webhooks/stripe`)

| Fact | Source |
|---|---|
| `Stripe-Signature: t=<ts>,v1=<sig>[,v1=…]`; HMAC-SHA256 of `<t>.<raw body>` under the endpoint secret; compare with every `v1` in constant time; ignore other schemes (`v0`). | https://docs.stripe.com/webhooks |
| Signature encoding: **NOT CONFIRMED** explicitly; the documented examples are 64 lowercase hex characters, which is what we check. | https://docs.stripe.com/webhooks |
| Libraries accept 5 minutes between `t` and now (we use 300 s); reject a bad signature with 400. | https://docs.stripe.com/webhooks · https://docs.stripe.com/error-handling |
| Two `v1` values appear while a secret rolls (up to 24 h). | https://docs.stripe.com/events/manage-webhook-endpoints |
| Events are not delivered in order and may arrive twice → we store each `event.id` once (`stripe_events`) and always re-read the subscription from Stripe before applying it. | https://docs.stripe.com/webhooks |
| Retries for up to 3 days live, 3 times over a few hours in a sandbox. | https://docs.stripe.com/webhooks |
| Payload format: **snapshot** events (full object, versioned by the endpoint). Stripe now recommends thin events for new integrations; snapshot stays supported and keeps one endpoint. Revisit: `docs/DEFERRED.md`. | https://docs.stripe.com/events/how-events-work |

Events the endpoint needs: `checkout.session.completed`, `customer.subscription.created`,
`customer.subscription.updated`, `customer.subscription.deleted`. Any other signed event is
acknowledged and ignored.

## 5. Subscription statuses → our `billing_status`

| Stripe `status` | Ours | Why | Source |
|---|---|---|---|
| `trialing`, `active` | `active` | in good standing | https://docs.stripe.com/billing/subscriptions/webhooks |
| `past_due` | `past_due` — sends continue, the pane asks to update the card | Stripe is retrying | same |
| `incomplete` | unchanged | first payment pending (23 h) | https://docs.stripe.com/api/subscriptions/object |
| `incomplete_expired`, `canceled`, `unpaid`, `paused` | `ended`, or back to `trial` if the free month is not over | access revoked | same · https://docs.stripe.com/changelog/endive/2026-09-30/pause-subscription |

An `ended` event for a subscription that is not the company's current one is ignored (an old one ending
after a new purchase).

## 6. Subscription object

Since `2025-03-31.basil` the period lives on each item: `items.data[].current_period_end`; there is no
top-level `current_period_end`. We store the latest item end as `billing_period_end`. Price id:
`items.data[].price.id`. Sources: https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-subscription-current-period-start-and-end ·
https://docs.stripe.com/api/subscriptions/object

## 7. Meter events (`POST /v1/billing/meter_events`)

| Fact | Source |
|---|---|
| Fields `event_name`, `payload[stripe_customer_id]`, `payload[value]`, `identifier` (≤ 100 chars), `timestamp` (Unix s). | https://docs.stripe.com/api/billing/meter-event/create |
| A second event with the same `identifier` is dropped for at least 24 h → our identifier is the invoice id, plus `Idempotency-Key: meter-<invoice id>`. | same |
| `timestamp` must be within the past 35 days → we report within 34. | https://docs.stripe.com/billing/subscriptions/usage-based/recording-usage-api |
| Live: one concurrent call per customer per meter → the sweep reports sequentially. | same |
| Legacy usage records are gone since basil; a metered price needs `recurring[meter]`. | https://docs.stripe.com/changelog/basil/2025-03-31/deprecate-legacy-usage-based-billing |
| ⚠️ The Billing Meters guide is marked **"Not Recommended"** for new integrations (Stripe points to Metronome); Meters stay fully supported. Kept because it is one form POST, needs no extra contract, and our quota is computed by us. Revisit: `docs/DEFERRED.md`. | https://docs.stripe.com/billing/subscriptions/usage-based/implementation-guide |

## 8. Cancellation on account deletion

`DELETE /v1/subscriptions/{id}` cancels now; `invoice_now=true` invoices the usage not billed yet,
`prorate=false` gives no credit for unused time (https://docs.stripe.com/api/subscriptions/cancel).
`DELETE /tenant` calls it before erasing the company (`apps/api/src/rgpd.ts`); a 404 (already gone) is
fine, any other failure stops the deletion with a message and nothing is erased.

## 9. VAT

Stripe Tax collects only where the account has a registration; without one it returns zero tax. France:
VAT, threshold "1 transaction", no calculation for DOM-TOM; FR → FR is taxed at French rates, EU B2B with
a VAT number is reverse charge. Sources: https://docs.stripe.com/tax/set-up ·
https://docs.stripe.com/tax/supported-countries/european-union/france. `STRIPE_AUTOMATIC_TAX=true` only
after the owner has added the French registration (§11); otherwise prices must be set tax-inclusive or
exclusive by the owner and Stripe adds nothing.

---

## 10. Our model

- **Trial:** 30 days from account creation, every feature, Mode test unlimited, **10 invoices sent for
  real** (counted when queued, so parallel clicks cannot pass the limit). Afterwards a real send answers
  409 `billing_required`: nothing is lost, the invoice stays « prête » and Mode test keeps working.
- **Plans:** Essentiel 30 invoices sent per month, Croissance 100 (`MONTHLY_SENDS`), monthly or yearly.
  The month is the calendar month in Europe/Paris. A send counts when the platform accepted it
  (`billing_usage`, one row per invoice, written in the same transaction as the deposit).
- **Beyond the quota:** each further invoice is one meter event (§7), reported by the sweep. Only when
  the plan's price list holds a metered price after the flat one; otherwise sends are counted and not
  charged (the view says `overage: false`).
- **Yearly plans:** because Checkout cannot mix intervals (§2), a yearly plan is sold as
  `flat yearly price[, metered yearly price]`. With the metered price, overage accrues every month and is
  invoiced at the yearly renewal (or at cancellation, §8). The owner chooses by listing it or not in
  `STRIPE_PRICES_*_YEAR`. Graduated tiers are not needed: we send only the invoices beyond the quota.
- **past_due** keeps sending; **pilot** (set by the operator) is never billed or gated and cannot buy;
  a deployment without `STRIPE_SECRET_KEY` bills nobody and gates nobody.
- **Who:** only the owner (role owner or the company's API key) may open Checkout or the portal.
- **Cabinet** (per-dossier pricing for accounting firms) is sold on quote outside Stripe for now
  (`docs/DEFERRED.md`).

## 11. Owner setup (Stripe Dashboard, sandbox first)

1. Create the account; Settings → Business: legal name, SIREN, address. Branding: logo, colour.
2. **Meter:** Billing → Meters → event name `facture_envoyee`, aggregation *Sum* of `value`, customer key
   `stripe_customer_id`.
3. **Products and prices** (EUR, HT): Essentiel monthly 18 €, yearly 180 €; Croissance monthly 47 €,
   yearly 468 €; metered per-unit prices on the meter: 0.30 € (Essentiel) and 0.20 € (Croissance), one
   monthly and one yearly of each if yearly overage is wanted (§10). Set each price's tax behaviour.
4. **Env:** `STRIPE_PRICES_ESSENTIEL_MONTH=price_flat,price_metered` (flat first), same for the three
   others; `STRIPE_METER_EVENT=facture_envoyee`.
5. **Webhook endpoint:** `https://<api host>/webhooks/stripe`, **API version 2026-09-30.endive**,
   snapshot payload, the four events of §4 → `STRIPE_WEBHOOK_SECRET=whsec_…`.
6. **Customer portal:** Settings → Billing → Customer portal: allow cancelling, updating the card and
   invoice history; switching plans optional; save it **in the sandbox and in live** (§3).
   `TODO(verify)`: open the portal once from the pane in the sandbox.
7. **Tax:** Stripe Tax → head office, add the French VAT registration, default product tax code; then
   `STRIPE_AUTOMATIC_TAX=true`.
8. **Key:** a restricted key (`rk_…`) with write access to Checkout Sessions, Customer portal,
   Subscriptions, Billing meter events, read on Customers → `STRIPE_SECRET_KEY`. Live keys only in prod.
9. `TODO(verify)` on the first sandbox run: one Checkout paid with test card 4242…, the webhook applied
   (pane shows the plan), 31 real sends on Essentiel → one meter event in Billing → Meters, the portal
   opens, deleting a test company cancels its subscription.

## 12. Local and tests

`pnpm dev` starts the stand-in at `http://localhost:4010/stripe` (`MOCK_STRIPE_WEBHOOK_URL` tells it where
to post; secret `MOCK_STRIPE_WEBHOOK_SECRET`). To bill locally set `STRIPE_SECRET_KEY=sk_test_local`,
`STRIPE_WEBHOOK_SECRET` = the stand-in's secret, `STRIPE_BASE_URL=http://localhost:4010/stripe` and price
ids of your choice (`price_…`; a price id containing `year` gets a yearly period). Its Checkout page has a
« Payer » button and its portal page simulates a refused payment or a cancellation. Only `FI_ENV=local`
accepts a `STRIPE_BASE_URL` other than Stripe's.
