// What we read from and send to B2Brouter's API (docs/B2BROUTER.md, OpenAPI 2026-06-26, checked
// 2026-10-18). Shared by the adapter and by the stand-in in apps/mock-pdp, so both speak the same
// protocol. Where the docs disagree with each other, the schemas accept both shapes (§11 T3–T6).
import { z } from 'zod';

/** Pinned: a newer version is a code change, never a surprise (docs/B2BROUTER.md §2). */
export const B2BROUTER_API_VERSION = '2026-06-26';

export const B2BROUTER_HEADERS = {
  apiKey: 'x-b2b-api-key',
  apiVersion: 'x-b2b-api-version',
  requestId: 'x-b2b-api-request-id',
  signature: 'x-b2brouter-signature',
  deliveryId: 'x-b2brouter-delivery-id',
  deliveryAttempt: 'x-b2brouter-delivery-attempt',
} as const;

/** Sandbox and production share a host; the key prefix picks the environment (§1). */
export const B2BROUTER_HOSTS = {
  production: 'https://api.b2brouter.net',
  staging: 'https://api-staging.b2brouter.net',
} as const;

export type B2BrouterEnvironment = 'sandbox' | 'staging' | 'production';

export function environmentOfKey(apiKey: string): B2BrouterEnvironment {
  if (apiKey.startsWith('test_')) return 'sandbox';
  if (apiKey.startsWith('stag_')) return 'staging';
  return 'production'; // `prod_`, or an older key without a prefix
}

/**
 * Why this key cannot be used with this base URL, or null. A B2Brouter host must match the key's
 * environment (a key from another environment answers 401); another host is a local stand-in.
 */
export function keyProblem(apiKey: string, baseUrl: string): string | null {
  const origin = new URL(baseUrl).origin;
  const environment = environmentOfKey(apiKey);
  const expected = environment === 'staging' ? B2BROUTER_HOSTS.staging : B2BROUTER_HOSTS.production;
  const known: string[] = Object.values(B2BROUTER_HOSTS);
  if (known.includes(origin) && origin !== expected) {
    return `a ${environment} key (${apiKey.slice(0, 5)}…) needs ${expected}, not ${origin}`;
  }
  return null;
}

/** B2Brouter ids are integers; we keep them as strings (pdpRef, account). */
const Id = z.union([z.number().int(), z.string().min(1)]).transform(String);
const text = z.string().nullish();

export const B2bInvoice = z.object({
  id: Id,
  type: z.string().optional(),
  number: text,
  state: z.string(),
  state_updated_at: text,
  created_at: text,
  updated_at: text,
  error_message: text,
  refuse_reason: text,
  refuse_reason_code: text,
});
export type B2bInvoice = z.infer<typeof B2bInvoice>;

export const B2bInvoiceEnvelope = z.object({ invoice: B2bInvoice });

const Meta = z.object({
  total_count: z.number().int(),
  offset: z.number().int().optional(),
  limit: z.number().int().optional(),
});

/** OpenAPI: `meta{…}`; the receive guide: the same fields at the top level (§11 T5). */
export const B2bInvoiceList = z.object({
  invoices: z.array(B2bInvoice),
  meta: Meta.optional(),
  total_count: z.number().int().optional(),
});

export const B2bEvent = z.object({
  name: z.string(),
  text,
  notes: text,
  created_at: z.string(),
  invoice: z.object({ id: Id, state: text, state_updated_at: text }).optional(),
});
export type B2bEvent = z.infer<typeof B2bEvent>;

export const B2bEventList = z.object({
  events: z.array(B2bEvent),
  meta: Meta.optional(),
  total_count: z.number().int().optional(),
});

/** Network and tax-authority answers about an invoice (CDAR, Peppol); not paginated. */
export const B2bResponses = z.object({
  responses: z.array(z.object({ event_name: z.string(), source: text, received_at: z.string() })),
});

/** `{error: {code, message, param}}`; also seen: `{error: "Not found"}` and `{errors: ["…"]}` (§2). */
export const B2bErrorBody = z.union([
  z.object({
    error: z.union([
      z.string(),
      z.object({
        code: z.string().optional(),
        message: z.string().optional(),
        param: z.string().optional(),
        request_log_url: z.string().optional(),
      }),
    ]),
  }),
  z.object({ errors: z.array(z.string()) }),
]);
export type B2bErrorBody = z.infer<typeof B2bErrorBody>;

export const B2bDirectoryPending = z.object({
  status: z.string(),
  message: z.string().optional(),
  polling_url: z.string().optional(),
});

export const B2bExternalCompany = z.object({
  name: text,
  cin_scheme: text,
  cin_value: text,
  information_flags: z.array(z.string()).optional(),
  invoice: z.object({ transport_type_code: text, document_type_code: text }).nullish(),
});
export type B2bExternalCompany = z.infer<typeof B2bExternalCompany>;

/** The DGFiP guide wraps the company in `external_company`, OpenAPI does not (§3.3, §11 T4). */
export const B2bDirectoryFound = z.union([
  z.object({ external_company: B2bExternalCompany }).transform((v) => v.external_company),
  B2bExternalCompany,
]);

export const B2bPaymentRequest = z.object({
  payment: z.object({
    invoice_id: z.number().int(),
    amount: z.number().positive().optional(),
    full: z.boolean().optional(),
    date: z.string().optional(),
  }),
});
export type B2bPaymentRequest = z.infer<typeof B2bPaymentRequest>;

const WebhookData = z.object({ account_id: Id, invoice_id: Id }).loose();

/** Webhook bodies: the `{code, data}` envelope (S2) or flat (changelog examples, §11 T3). */
export const B2bWebhook = z.union([
  z.object({
    code: z.string(),
    triggered_at: z.number().optional(),
    data: z.record(z.string(), z.unknown()),
  }),
  WebhookData.extend({ code: z.string().optional() }),
]);

/** Only issued-invoice changes concern the send/sync jobs; received invoices come by polling. */
export const ISSUED_INVOICE_EVENT = 'issued_invoice.state_change';

/**
 * The invoice a webhook is about; null for an event we do not act on (the webhook is still
 * acknowledged); 'unreadable' for a body that is not a B2Brouter webhook at all.
 * TODO(verify): docs/B2BROUTER.md §11 T3 — a flat body carries no event name we can rely on, so it
 * is read as an issued-invoice change; the sync job ignores ids it does not hold.
 */
export function webhookNotice(
  value: unknown,
): { account: string; pdpRef: string } | null | 'unreadable' {
  const parsed = B2bWebhook.safeParse(value);
  if (!parsed.success) return 'unreadable';
  const body = parsed.data;
  if (body.code !== undefined && body.code !== ISSUED_INVOICE_EVENT) return null;
  const data = WebhookData.safeParse('data' in body ? body.data : body);
  return data.success
    ? { account: data.data.account_id, pdpRef: data.data.invoice_id }
    : 'unreadable';
}
