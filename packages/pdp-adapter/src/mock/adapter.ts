// PdpAdapter over HTTP to apps/mock-pdp. Same error rules as the B2Brouter adapter will have:
// network errors, timeouts, 5xx and 429 are PdpUnavailableError (retry later with the same key);
// anything else unexpected is PdpRequestError.
import type { z } from 'zod';
import { verifyWebhookSignature } from '../signature';
import {
  type InboundInvoice,
  type PdpAdapter,
  PdpRequestError,
  PdpUnavailableError,
  type SendResult,
  type WebhookNotice,
} from '../types';
import {
  MOCK_HEADERS,
  MockDirectoryEntry,
  MockInbound,
  MockInvoice,
  MockSendResponse,
  MockWebhook,
} from './protocol';

export interface MockAdapterOptions {
  baseUrl: string;
  webhookSecret: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createMockPdpAdapter(options: MockAdapterOptions): PdpAdapter {
  const fetchFn = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;

  async function call(
    path: string,
    init: RequestInit & { account: string },
    accept: readonly number[],
  ): Promise<{ status: number; json: unknown }> {
    let res: Response;
    try {
      res = await fetchFn(new URL(path, options.baseUrl), {
        ...init,
        headers: {
          ...(init.headers as Record<string, string>),
          [MOCK_HEADERS.account]: init.account,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new PdpUnavailableError(`mock PDP unreachable: ${String(e)}`, { cause: e });
    }
    if (res.status >= 500 || res.status === 429) {
      throw new PdpUnavailableError(`mock PDP answered ${res.status}`);
    }
    if (!accept.includes(res.status)) {
      throw new PdpRequestError(`mock PDP answered ${res.status} to ${path}`, res.status);
    }
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  }

  function parse<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
    const result = schema.safeParse(value);
    if (!result.success) throw new PdpRequestError(`unexpected ${what} from the mock PDP`);
    return result.data;
  }

  return {
    provider: 'mock',

    async sendInvoice(input): Promise<SendResult> {
      const { json } = await call(
        '/invoices',
        {
          method: 'POST',
          account: input.account,
          headers: {
            'content-type': 'application/xml',
            [MOCK_HEADERS.idempotencyKey]: input.idempotencyKey,
          },
          body: input.xml,
        },
        [200, 201, 422],
      );
      const res = parse(MockSendResponse, json, 'send answer');
      return res.status === 'deposited'
        ? { outcome: 'deposited', pdpRef: res.id }
        : { outcome: 'rejected', errors: res.errors };
    },

    async getStatus({ account, pdpRef }) {
      const path = `/invoices/${encodeURIComponent(pdpRef)}/status`;
      const { json } = await call(path, { account }, [200]);
      return parse(MockInvoice, json, 'status').events.map((e) => ({
        id: e.id,
        status: e.status,
        raw: e.status,
        at: e.at,
        ...(e.reason && { reason: e.reason }),
      }));
    },

    async listInbound({ account, since }): Promise<InboundInvoice[]> {
      const path = `/inbound?since=${encodeURIComponent(since.toISOString())}`;
      const { json } = await call(path, { account }, [200]);
      return parse(MockInbound.array(), json, 'inbound list').map((i) => ({
        pdpRef: i.id,
        receivedAt: i.receivedAt,
        xml: i.xml,
      }));
    },

    async lookupRecipient({ account, siren }) {
      const { status, json } = await call(
        `/directory/${encodeURIComponent(siren)}`,
        { account },
        [200, 404],
      );
      return status === 404 ? null : parse(MockDirectoryEntry, json, 'directory entry');
    },

    async reportPayment({ account, pdpRef, amount }) {
      await call(
        `/invoices/${encodeURIComponent(pdpRef)}/payments`,
        {
          method: 'POST',
          account,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ amount }),
        },
        [200, 201],
      );
    },

    verifyWebhook({ headers, body }) {
      return verifyWebhookSignature(
        options.webhookSecret,
        headers.get(MOCK_HEADERS.signature),
        body,
      );
    },

    parseWebhook(body): WebhookNotice[] {
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        throw new PdpRequestError('webhook body is not JSON');
      }
      const { data } = parse(MockWebhook, json, 'webhook');
      return [{ account: data.account_id, pdpRef: data.invoice_id }];
    },
  };
}
