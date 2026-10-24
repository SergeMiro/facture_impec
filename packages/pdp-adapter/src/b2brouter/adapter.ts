// PdpAdapter on B2Brouter's API (docs/B2BROUTER.md §3.2). Same error rules as the mock adapter:
// network errors, timeouts, 5xx and 429 are PdpUnavailableError (retry later), anything else
// unexpected is PdpRequestError. The API key goes in a header only, never in a URL or a message.
//
// B2Brouter takes no idempotency key for invoices (§6), so a POST is never retried blindly: every
// send first looks the number up, and an invoice the platform already holds is reused when its
// original file is ours byte for byte (`/as/original` returns the import as-is and is not billed).
import { InvoiceXmlError, parseInvoiceXml } from '@fi/core';
import { readFacturXPdf } from '@fi/core/pdf';
import { t } from '@fi/shared';
import type { z } from 'zod';
import { verifyWebhookSignature } from '../signature';
import {
  type InboundInvoice,
  type PdpAdapter,
  type PdpRejection,
  PdpRequestError,
  type PdpStatusEvent,
  PdpUnavailableError,
  type SendResult,
} from '../types';
import {
  B2BROUTER_API_VERSION,
  B2BROUTER_HEADERS,
  B2BROUTER_HOSTS,
  B2bDirectoryFound,
  B2bErrorBody,
  type B2bEvent,
  B2bEventList,
  type B2bInvoice,
  B2bInvoiceEnvelope,
  B2bInvoiceList,
  type B2bPaymentRequest,
  B2bResponses,
  webhookNotice,
} from './protocol';
import { isRejectionResponse, pathOf, STATE_OF_STATUS } from './states';

export interface B2BrouterAdapterOptions {
  apiKey: string;
  /** Default the production host, which also serves the sandbox for `test_` keys (§1). */
  baseUrl?: string;
  /** The webhook's `signing_secret` (shown once, at creation); without it every webhook is refused. */
  webhookSecret?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** A directory lookup answers 202 until it resolves: wait between polls, give up after `polls`. */
  directory?: { pollMs: number; polls: number };
  sleep?: (ms: number) => Promise<void>;
}

/** Rule ids of the refusals the adapter reports (shown with the French message). */
export const B2BROUTER_RULES = {
  numberTaken: 'FI-PDP-NUMBER-TAKEN',
  platform: 'B2BROUTER',
} as const;

/** The largest page B2Brouter serves (§6). */
const PAGE = 500;
const DAY_MS = 86_400_000;

interface Answer {
  status: number;
  body: Uint8Array;
  text(): string;
}

interface CallOptions {
  query?: Record<string, string>;
  /** ArrayBuffer-backed: what the DOM's BodyInit accepts too (the add-in typechecks this file). */
  body?: string | Uint8Array<ArrayBuffer>;
  contentType?: string;
  accept: readonly number[];
}

const isPdf = (bytes: Uint8Array) =>
  bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46; // %PDF

export function createB2BrouterAdapter(options: B2BrouterAdapterOptions): PdpAdapter {
  const fetchFn = options.fetch ?? ((input, init) => fetch(input, init));
  const base = (options.baseUrl ?? B2BROUTER_HOSTS.production).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? 20_000;
  const directory = options.directory ?? { pollMs: 1_000, polls: 10 };
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

  async function call(method: string, path: string, init: CallOptions): Promise<Answer> {
    const url = new URL(`${base}${path}`);
    for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);
    const what = `${method} ${path}`;
    let res: Response;
    try {
      res = await fetchFn(url, {
        method,
        headers: {
          [B2BROUTER_HEADERS.apiKey]: options.apiKey,
          [B2BROUTER_HEADERS.apiVersion]: B2BROUTER_API_VERSION,
          accept: 'application/json',
          ...(init.contentType && { 'content-type': init.contentType }),
        },
        ...(init.body !== undefined && { body: init.body }),
        // A received invoice answers 302 to GET /invoices/{id}: we want to see that, not follow it.
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new PdpUnavailableError(`B2Brouter unreachable (${what}): ${String(e)}`, { cause: e });
    }
    const body = new Uint8Array(await res.arrayBuffer());
    const answer = { status: res.status, body, text: () => new TextDecoder().decode(body) };
    const trace = res.headers.get(B2BROUTER_HEADERS.requestId);
    const where = `${what}${trace ? `, request ${trace}` : ''}`;
    if (res.status >= 500 || res.status === 429) {
      throw new PdpUnavailableError(`B2Brouter answered ${res.status} (${where})`);
    }
    if (!init.accept.includes(res.status)) {
      const detail = errorText(answer.text());
      throw new PdpRequestError(
        `B2Brouter answered ${res.status} (${where})${detail ? `: ${detail}` : ''}`,
        res.status,
      );
    }
    return answer;
  }

  function read<T>(schema: z.ZodType<T>, answer: Answer, what: string): T {
    let json: unknown;
    try {
      json = JSON.parse(answer.text());
    } catch {
      throw new PdpRequestError(`B2Brouter sent ${what} that is not JSON`);
    }
    const result = schema.safeParse(json);
    if (!result.success) throw new PdpRequestError(`unexpected ${what} from B2Brouter`);
    return result.data;
  }

  const account = (id: string) => `/accounts/${encodeURIComponent(id)}`;
  const invoicePath = (id: string) => `/invoices/${encodeURIComponent(id)}`;

  async function getInvoice(id: string): Promise<B2bInvoice> {
    if (!/^\d+$/.test(id)) throw new PdpRequestError(`not a B2Brouter invoice id: ${id}`, 404);
    return read(
      B2bInvoiceEnvelope,
      await call('GET', invoicePath(id), { accept: [200] }),
      'invoice',
    ).invoice;
  }

  /** Every page of a list (offset/limit, at most 500 a page). */
  async function pages<T>(
    path: string,
    query: Record<string, string>,
    schema: z.ZodType<{ items: T[]; total: number }>,
  ): Promise<T[]> {
    const all: T[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const answer = await call('GET', path, {
        query: { ...query, offset: String(offset), limit: String(PAGE) },
        accept: [200],
      });
      const page = read(schema, answer, 'list');
      all.push(...page.items);
      if (page.items.length < PAGE || all.length >= page.total) return all;
    }
  }

  const invoiceList = B2bInvoiceList.transform((l) => ({
    items: l.invoices,
    total: l.meta?.total_count ?? l.total_count ?? l.invoices.length,
  }));
  const eventList = B2bEventList.transform((l) => ({
    items: l.events,
    total: l.meta?.total_count ?? l.total_count ?? l.events.length,
  }));

  /** The issued invoice the platform holds under this exact number (the filter is a prefix match). */
  async function findIssued(accountId: string, number: string): Promise<B2bInvoice | undefined> {
    const found = await pages(
      `${account(accountId)}/invoices`,
      { type: 'IssuedInvoice', number },
      invoiceList,
    );
    return found.find((i) => i.number === number);
  }

  async function original(id: string): Promise<Uint8Array | null> {
    const answer = await call('GET', `${invoicePath(id)}/as/original`, {
      accept: [200, 404, 422],
    });
    return answer.status === 200 ? answer.body : null;
  }

  const sameBytes = (a: Uint8Array | null, b: Uint8Array) =>
    a !== null && a.length === b.length && a.every((byte, i) => byte === b[i]);

  /**
   * What the platform already holds under our number: our own invoice (reuse it), nothing, or
   * another document. A draft that was never sent is ours from an earlier attempt of an invoice the
   * user has corrected since: it is deleted and replaced. A sent one means the number is taken.
   */
  async function existing(
    accountId: string,
    number: string,
    xml: Uint8Array,
  ): Promise<B2bInvoice | 'taken' | null> {
    const found = await findIssued(accountId, number);
    if (!found) return null;
    if (sameBytes(await original(found.id), xml)) return found;
    if (found.state !== 'new') return 'taken';
    const deleted = await call('DELETE', invoicePath(found.id), { accept: [200, 204, 404, 422] });
    return deleted.status === 422 ? 'taken' : null;
  }

  const taken = (number: string): SendResult => ({
    outcome: 'rejected',
    errors: [
      { rule: B2BROUTER_RULES.numberTaken, message: t('pdp.refused.numberTaken', { number }) },
    ],
  });

  async function importXml(
    accountId: string,
    number: string,
    xml: Uint8Array<ArrayBuffer>,
  ): Promise<B2bInvoice | SendResult> {
    const answer = await call('POST', `${account(accountId)}/invoices/import`, {
      query: { send_after_import: 'false', issued: 'true' },
      body: xml,
      // TODO(verify): docs/B2BROUTER.md §11 T1 — the France guide says application/xml, OpenAPI
      // says application/octet-stream.
      contentType: 'application/xml',
      accept: [200, 201, 422],
    });
    if (answer.status !== 422) return read(B2bInvoiceEnvelope, answer, 'imported invoice').invoice;
    if (errorCode(answer.text()) !== 'parameter_taken') {
      return { outcome: 'rejected', errors: rejections(answer.text()) };
    }
    // The number appeared since we looked: an import whose answer was lost, or a concurrent one.
    const now = await existing(accountId, number, xml);
    if (now === 'taken') return taken(number);
    if (now === null) throw new PdpUnavailableError(`B2Brouter freed number ${number}: try again`);
    return now;
  }

  /** null once sent; the refusal when the platform will not send it. */
  async function send(id: string): Promise<SendResult | null> {
    const answer = await call('POST', `/invoices/send_invoice/${encodeURIComponent(id)}`, {
      accept: [200, 202, 204, 422],
    });
    if (answer.status !== 422) return null;
    // TODO(verify): docs/B2BROUTER.md §11 T10 — the answer to sending an invoice twice is not
    // documented. If it left `new`, an earlier attempt sent it: that is not a refusal.
    if ((await getInvoice(id)).state !== 'new') return null;
    return { outcome: 'rejected', errors: rejections(answer.text()) };
  }

  return {
    provider: 'b2brouter',

    async sendInvoice({ account: accountId, xml, pdf }): Promise<SendResult> {
      const number = numberOf(xml);
      const bytes = new TextEncoder().encode(xml);
      let invoice = await existing(accountId, number, bytes);
      if (invoice === 'taken') return taken(number);
      if (!invoice) {
        const imported = await importXml(accountId, number, bytes);
        if ('outcome' in imported) return imported;
        invoice = imported;
        if (pdf) {
          // TODO(verify): docs/B2BROUTER.md §11 T16 — an attachment cannot be replaced cleanly.
          await call('POST', `${invoicePath(invoice.id)}/add_attachment`, {
            query: { filename: `${number}.pdf`, use_as_pdf_view: 'true' },
            body: new Uint8Array(pdf),
            contentType: 'application/octet-stream',
            accept: [200, 201, 204],
          });
        }
      }
      if (invoice.state === 'new') {
        const refused = await send(invoice.id);
        if (refused) return refused;
      }
      return { outcome: 'deposited', pdpRef: invoice.id };
    },

    async getStatus({ account: accountId, pdpRef }) {
      const invoice = await getInvoice(pdpRef);
      const [events, responses] = await Promise.all([
        pages(`${account(accountId)}/events`, { invoice_id: invoice.id }, eventList),
        call('GET', `${invoicePath(invoice.id)}/responses`, { accept: [200] }).then(
          (a) => read(B2bResponses, a, 'responses').responses,
        ),
      ]);
      return history(invoice, events, responses);
    },

    async listInbound({ account: accountId, since }): Promise<InboundInvoice[]> {
      // The filter takes a date and means "later than": start a day early, the caller drops repeats.
      const from = new Date(since.getTime() - DAY_MS).toISOString().slice(0, 10);
      const received = await pages(
        `${account(accountId)}/invoices`,
        { type: 'ReceivedInvoice', ack: 'false', updated_at_from: from },
        invoiceList,
      );
      const inbound: InboundInvoice[] = [];
      for (const r of received) {
        const file = await original(r.id);
        const xml = file && (await xmlOf(file));
        // TODO(M6): a received file that is neither XML nor Factur-X waits for the Réception screen.
        if (!xml) continue;
        inbound.push({
          pdpRef: r.id,
          receivedAt: r.created_at ?? r.updated_at ?? new Date().toISOString(),
          xml,
        });
      }
      return inbound;
    },

    async lookupRecipient({ siren }) {
      // TODO(verify): docs/B2BROUTER.md §11 T4 — 202 first or 200 at once, body wrapped or not,
      // `parameter_invalid` or `invalid_identifier`: all are handled.
      const path = `/directory/fr/0002/${encodeURIComponent(siren)}`;
      for (let poll = 0; poll <= directory.polls; poll++) {
        if (poll > 0) await sleep(directory.pollMs);
        // "Retry the same request until it resolves": the polling_url is that same path.
        const answer = await call('GET', path, { accept: [200, 202, 404, 422, 424] });
        if (answer.status === 202) continue;
        if (answer.status === 200) {
          const company = read(B2bDirectoryFound, answer, 'directory entry');
          const transport = company.invoice?.transport_type_code;
          return {
            siren,
            ...(company.name && { name: company.name }),
            ...(transport && { platform: transport }),
          };
        }
        if (answer.status === 424 && errorCode(answer.text()) === 'upstream_unavailable') {
          throw new PdpUnavailableError('the directory behind B2Brouter is unavailable');
        }
        return null; // 404 not found, 422 not a SIREN, 424 the company cannot receive
      }
      throw new PdpUnavailableError(`B2Brouter is still looking up ${siren}`);
    },

    async reportPayment({ account: accountId, pdpRef, amount }) {
      // POST /payments, not mark_as: its `amount` is the CDV 206 partial approval (OpenAPI 2026-06-26).
      // TODO(verify): docs/B2BROUTER.md §11 T21 — no idempotency key: a retry after a lost answer may
      // record the payment twice.
      // TODO(verify): docs/B2BROUTER.md §11 T25 — an instalment is sent with its own amount; whether
      // B2Brouter adds them up and reaches 212 only at the total is not documented.
      const body: B2bPaymentRequest = {
        payment: { invoice_id: Number(pdpRef), amount: amount / 100 },
      };
      await call('POST', `${account(accountId)}/payments`, {
        body: JSON.stringify(body),
        contentType: 'application/json',
        accept: [200, 201],
      });
    },

    verifyWebhook({ headers, body }) {
      if (!options.webhookSecret) return false;
      return verifyWebhookSignature(
        options.webhookSecret,
        headers.get(B2BROUTER_HEADERS.signature),
        body,
      );
    },

    parseWebhook(body) {
      let json: unknown;
      try {
        json = JSON.parse(body);
      } catch {
        throw new PdpRequestError('webhook body is not JSON');
      }
      const notice = webhookNotice(json);
      if (notice === 'unreadable') throw new PdpRequestError('not a B2Brouter webhook');
      return notice ? [notice] : [];
    },
  };
}

function numberOf(xml: string): string {
  try {
    const number = parseInvoiceXml(xml).invoice.number;
    if (number) return number;
  } catch (e) {
    if (!(e instanceof InvoiceXmlError)) throw e;
  }
  throw new PdpRequestError('the invoice XML has no readable number (BT-1)');
}

async function xmlOf(file: Uint8Array): Promise<string | null> {
  if (!isPdf(file)) {
    const text = new TextDecoder().decode(file).trimStart();
    return text.startsWith('<') ? text : null;
  }
  try {
    return (await readFacturXPdf(file)).xml;
  } catch {
    return null;
  }
}

function parsedError(text: string): B2bErrorBody | null {
  try {
    const result = B2bErrorBody.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function errorCode(text: string): string | undefined {
  const body = parsedError(text);
  return body && 'error' in body && typeof body.error === 'object' ? body.error.code : undefined;
}

/** A short description of an error body for logs: code and message, nothing else. */
function errorText(text: string): string {
  const body = parsedError(text);
  if (!body) return '';
  if ('errors' in body) return body.errors.join('; ').slice(0, 300);
  if (typeof body.error === 'string') return body.error.slice(0, 300);
  return [body.error.code, body.error.message].filter(Boolean).join(': ').slice(0, 300);
}

/** The platform's refusal, one item per problem, with a calm French sentence around its words. */
function rejections(text: string): PdpRejection[] {
  const body = parsedError(text);
  const item = (rule: string, detail: string) => ({
    rule,
    message: t('pdp.refused.platform', { detail }),
  });
  if (!body) return [item(B2BROUTER_RULES.platform, text.slice(0, 300))];
  if ('errors' in body) return body.errors.map((e) => item(B2BROUTER_RULES.platform, e));
  if (typeof body.error === 'string') return [item(B2BROUTER_RULES.platform, body.error)];
  const { code, message, param } = body.error;
  return [
    item(
      code ?? B2BROUTER_RULES.platform,
      [message ?? code, param && `(${param})`].filter(Boolean).join(' '),
    ),
  ];
}

/**
 * The history B2Brouter's current state proves, oldest first (states.ts). Timestamps come from the
 * events list when an event carries that state, else from the step before; the current state uses
 * `state_updated_at`. TODO(verify): docs/B2BROUTER.md §11 T11 — whether an event's `invoice.state`
 * is the state at that event or now; the order of our events does not depend on it.
 */
export function history(
  invoice: B2bInvoice,
  events: readonly B2bEvent[],
  responses: readonly { event_name: string; received_at: string }[],
): PdpStatusEvent[] {
  const ref = invoice.id;
  const latest = invoice.state_updated_at ?? invoice.updated_at ?? invoice.created_at;
  const now = latest ?? new Date().toISOString();
  const path = pathOf(invoice.state);
  if (path === null) {
    return [{ id: `${ref}:${invoice.state}`, status: 'unknown', raw: invoice.state, at: now }];
  }
  const entered = new Map<string, string>();
  for (const e of [...events].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
    const state = e.invoice?.state;
    if (state && !entered.has(state)) entered.set(state, e.created_at);
  }
  let previous = invoice.created_at ?? now;
  const later = (at: string | null | undefined) => {
    if (at && Date.parse(at) > Date.parse(previous)) previous = at;
    return previous;
  };
  const steps: PdpStatusEvent[] = path.map((status, i) => {
    const raw = STATE_OF_STATUS[status];
    const final = i === path.length - 1;
    const step: PdpStatusEvent = {
      id: `${ref}:${raw}`,
      status,
      raw,
      at: later(final ? latest : entered.get(raw)),
    };
    if (final && status === 'refused' && (invoice.refuse_reason || invoice.refuse_reason_code)) {
      step.reason = {
        ...(invoice.refuse_reason_code && { code: invoice.refuse_reason_code }),
        ...(invoice.refuse_reason && { text: invoice.refuse_reason }),
      };
    }
    if (final && status === 'rejected' && invoice.error_message) {
      step.reason = { code: invoice.error_message, text: invoice.error_message };
    }
    return step;
  });
  if (!path.includes('rejected')) {
    const rejection = responses.find((r) => isRejectionResponse(r.event_name));
    if (rejection) {
      steps.push({
        id: `${ref}:response:${rejection.event_name}:${rejection.received_at}`,
        status: 'rejected',
        raw: rejection.event_name,
        at: later(rejection.received_at),
        reason: { code: rejection.event_name },
      });
    }
  }
  return steps;
}
