// B2Brouter's API in front of the mock platform (docs/B2BROUTER.md): the same engine (validation,
// lifecycle, clock, timeline faults, inbound, directory) spoken in B2Brouter's protocol, so the real
// B2Brouter adapter runs end to end, in tests and in `pnpm dev`, without the sandbox. Mounted at
// /b2brouter. It follows the documented shapes; `alternate` serves the other shape wherever the docs
// disagree (§11 T3–T5), so the adapter is proven against both. What the docs do not say at all
// (§11), it answers in the simplest plausible way, and the adapter must not depend on that.
import {
  B2BROUTER_HEADERS,
  B2bPaymentRequest,
  type MockEvent,
  type MockInvoice,
  signWebhook,
  type WebhookRequest,
} from '@fi/pdp-adapter';
import { type Context, Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  type Delivery,
  MockConflict,
  MockNotFound,
  type MockPdpEngine,
  MockUnavailable,
} from './engine';

export interface B2BrouterStandInOptions {
  /** Signs the stand-in's webhooks (header X-B2Brouter-Signature). */
  webhookSecret: string;
  /** Where `issued_invoice.state_change` webhooks go; none when unset (the API's sweep polls). */
  webhookUrl?: string;
  /** The other shape where the docs disagree: flat webhooks, top-level list counts, directory. */
  alternate?: boolean;
}

type MockStatus = MockInvoice['status'];

/** The mock's lifecycle in B2Brouter's words (docs/B2BROUTER.md §7, read backwards). */
const STATE: Record<MockStatus, string> = {
  deposited: 'sent',
  received_by_platform: 'registered',
  delivered: 'read',
  accepted: 'accepted',
  refused: 'refused',
  payment_received: 'paid',
  rejected: 'error',
};

interface Draft {
  id: number;
  account: string;
  number: string;
  xml: string;
  createdAt: string;
  /** Set once sent: the invoice inside the mock engine. */
  engineId?: string;
  deleted?: boolean;
}

const MAX_LIMIT = 500;
/** As in B2Brouter's examples: ids are integers in the millions. */
const FIRST_ID = 4_053_100;

class Answer extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly body: unknown,
  ) {
    super(JSON.stringify(body));
  }
}

const error = (status: ContentfulStatusCode, code: string, message: string, param?: string) =>
  new Answer(status, { error: { code, message, type: 'invalid_request_error', param } });

export class B2BrouterStandIn {
  readonly app = new Hono();
  readonly #engine: MockPdpEngine;
  readonly #options: B2BrouterStandInOptions;
  #drafts = new Map<number, Draft>();
  #inbound = new Map<number, { account: string; inboundId: string }>();
  #looked = new Set<string>();
  #seq = { id: FIRST_ID, request: 0 };
  #webhookUrl: string | undefined;

  constructor(engine: MockPdpEngine, options: B2BrouterStandInOptions) {
    this.#engine = engine;
    this.#options = options;
    this.#webhookUrl = options.webhookUrl;
    engine.onReset(() => {
      this.#drafts.clear();
      this.#inbound.clear();
      this.#looked.clear();
    });
    this.#routes();
  }

  get #now(): string {
    return this.#engine.now().toISOString();
  }

  #routes(): void {
    const app = this.app;
    app.onError((err, c) => {
      if (err instanceof Answer) return c.json(err.body as object, err.status);
      if (err instanceof MockUnavailable) return c.json({ error: { code: 'unavailable' } }, 503);
      if (err instanceof MockNotFound) return c.json({ error: 'Not found' }, 404);
      if (err instanceof MockConflict) {
        return c.json({ error: { code: 'invalid_state', message: err.message } }, 422);
      }
      throw err;
    });

    app.use('*', async (c, next) => {
      c.header(B2BROUTER_HEADERS.requestId, `req_${++this.#seq.request}`);
      // A sandbox key: the prefix alone selects the sandbox (docs/B2BROUTER.md §1).
      if (!c.req.header(B2BROUTER_HEADERS.apiKey)?.startsWith('test_')) {
        throw error(401, 'invalid_api_key', 'Invalid API key');
      }
      const version = c.req.header(B2BROUTER_HEADERS.apiVersion);
      if (version !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(version)) {
        throw error(400, 'invalid_api_version', `Unknown API version ${version}`);
      }
      await next();
    });

    app.post('/accounts/:account/invoices/import', async (c) => {
      const account = c.req.param('account');
      const xml = await c.req.text();
      if (!xml.trim()) throw error(400, 'parameter_empty', 'The file is empty');
      const checked = this.#engine.check(account, xml);
      if (!checked.ok) {
        if (checked.errors.some((e) => e.rule === 'XML')) throw new Answer(406, {});
        throw new Answer(422, { errors: checked.errors.map((e) => `${e.rule}: ${e.message}`) });
      }
      const number = checked.invoice.number ?? '';
      if (this.#issued(account).some((d) => d.number === number)) {
        throw error(422, 'parameter_taken', 'Number has already been taken', 'number');
      }
      const draft: Draft = { id: ++this.#seq.id, account, number, xml, createdAt: this.#now };
      this.#drafts.set(draft.id, draft);
      if (c.req.query('send_after_import') === 'true') this.#send(draft);
      return c.json({ invoice: this.#json(draft) }, 201);
    });

    app.get('/accounts/:account/invoices', (c) => {
      const account = c.req.param('account');
      if (c.req.query('type') === 'ReceivedInvoice') {
        const from = c.req.query('updated_at_from');
        const since = from ? new Date(`${from}T00:00:00Z`) : new Date(0);
        const received = this.#engine.listInbound(account, since).map((i) => {
          const id = this.#inboundId(account, i.id);
          return { id, type: 'ReceivedInvoice', state: 'received', created_at: i.receivedAt };
        });
        return this.#list(c, 'invoices', received);
      }
      const prefix = c.req.query('number') ?? '';
      const issued = this.#issued(account).filter((d) => d.number.startsWith(prefix));
      return this.#list(
        c,
        'invoices',
        issued.map((d) => this.#json(d)),
      );
    });

    app.get('/invoices/:id', (c) => {
      const id = Number(c.req.param('id'));
      if (this.#inbound.has(id)) return c.redirect(`/b2brouter/received_invoices/${id}`, 302);
      return c.json({ invoice: this.#json(this.#draft(id)) });
    });

    app.delete('/invoices/:id', (c) => {
      const draft = this.#draft(Number(c.req.param('id')));
      if (draft.engineId) throw error(422, 'invalid_state', 'A sent invoice cannot be deleted');
      draft.deleted = true;
      return c.json({ invoice: this.#json(draft) });
    });

    app.post('/invoices/send_invoice/:id', (c) => {
      // TODO(verify): docs/B2BROUTER.md §11 T10 — the real answer to a second send is unknown.
      const draft = this.#draft(Number(c.req.param('id')));
      if (draft.engineId) throw error(422, 'invalid_state', 'The invoice was already sent');
      this.#send(draft);
      return c.body(null, 204);
    });

    app.post('/invoices/:id/add_attachment', (c) => {
      this.#draft(Number(c.req.param('id')));
      return c.json({}, 201);
    });

    app.get('/invoices/:id/as/:code', (c) => {
      const id = Number(c.req.param('id'));
      if (c.req.param('code') !== 'original') {
        throw error(422, 'parameter_invalid', 'The stand-in only serves the original file');
      }
      const received = this.#inbound.get(id);
      const xml = received
        ? this.#engine
            .listInbound(received.account, new Date(0))
            .find((i) => i.id === received.inboundId)?.xml
        : this.#draft(id).xml;
      if (xml === undefined) throw new MockNotFound(`no invoice ${id}`);
      return c.body(xml, 200, { 'content-type': 'application/xml' });
    });

    app.get('/invoices/:id/responses', (c) => {
      this.#draft(Number(c.req.param('id')));
      return c.json({ responses: [] });
    });

    app.get('/accounts/:account/events', (c) => {
      const account = c.req.param('account');
      const only = c.req.query('invoice_id');
      const drafts = only ? [this.#draft(Number(only), account)] : this.#issued(account);
      const events = drafts.flatMap((d) =>
        this.#engineEvents(d).map((e) => ({
          name: `invoice_${STATE[e.status]}`,
          text: `Invoice ${STATE[e.status]}`,
          notes: e.reason?.text ?? null,
          created_at: e.at,
          updated_at: e.at,
          // The state reached at this event (one reading of §11 T11).
          invoice: { id: d.id, number: d.number, state: STATE[e.status], state_updated_at: e.at },
        })),
      );
      return this.#list(c, 'events', events);
    });

    app.post('/accounts/:account/payments', async (c) => {
      const parsed = B2bPaymentRequest.safeParse(await c.req.json().catch(() => undefined));
      if (!parsed.success)
        throw error(400, 'parameter_invalid', 'Expected {payment: {invoice_id}}');
      const { invoice_id: id, amount, full } = parsed.data.payment;
      if ((amount === undefined) === (full === undefined)) {
        throw error(422, 'parameter_conflict', 'Send either amount or full');
      }
      const draft = this.#draft(id, c.req.param('account'));
      // `amount` in euros (§3.1); `full` pays what is left.
      const cents = amount === undefined ? undefined : Math.round(amount * 100);
      if (draft.engineId) this.#engine.reportPayment(draft.account, draft.engineId, cents);
      return c.json({ payment: { id: ++this.#seq.request, invoice_id: id, amount } }, 201);
    });

    app.get('/directory/:country/:scheme/:id', (c) => {
      const siren = c.req.param('id');
      if (c.req.param('scheme') !== '0002' || !/^\d{9}$/.test(siren)) {
        const code = this.#options.alternate ? 'invalid_identifier' : 'parameter_invalid';
        throw error(422, code, 'Identifier is not valid for the requested scheme');
      }
      const found = this.#engine.lookup(siren);
      // Documented: always 202 first; the changelog: a known entry answers 200 at once (§3.3).
      const first = !this.#looked.has(siren);
      this.#looked.add(siren);
      if (first && !(this.#options.alternate && found)) {
        return c.json(
          {
            status: 'processing',
            message: 'Querying directory. Please retry this request.',
            polling_url: c.req.url,
          },
          202,
        );
      }
      if (!found) return c.json({ error: 'Not found' }, 404);
      const company = {
        name: found.name ?? `Entreprise ${siren}`,
        country: 'fr',
        cin_scheme: '0002',
        cin_value: siren,
        information_flags: ['FR_ASSUJETTI_ACTIVE'],
        invoice: { transport_type_code: 'peppol', document_type_code: 'xml.ubl.invoice.frcius.v1' },
      };
      return c.json(this.#options.alternate ? { external_company: company } : company);
    });
  }

  #issued(account: string): Draft[] {
    return [...this.#drafts.values()].filter((d) => d.account === account && !d.deleted);
  }

  #draft(id: number, account?: string): Draft {
    const draft = this.#drafts.get(id);
    if (!draft || draft.deleted || (account !== undefined && draft.account !== account)) {
      throw new Answer(404, { error: { code: 'not_found', message: 'Invoice not found' } });
    }
    return draft;
  }

  #inboundId(account: string, inboundId: string): number {
    for (const [id, i] of this.#inbound) if (i.inboundId === inboundId) return id;
    const id = ++this.#seq.id;
    this.#inbound.set(id, { account, inboundId });
    return id;
  }

  #send(draft: Draft): void {
    // The engine's idempotency key: a send whose answer was lost finds the same invoice again.
    const { response } = this.#engine.deposit(draft.account, draft.xml, `b2brouter:${draft.id}`, {
      notify: (event) => this.#delivery(draft, event),
    });
    if (response.status === 'rejected') {
      throw new Answer(422, { errors: response.errors.map((e) => `${e.rule}: ${e.message}`) });
    }
    draft.engineId = response.id;
  }

  #engineEvents(draft: Draft): MockEvent[] {
    return draft.engineId ? this.#engine.status(draft.account, draft.engineId).events : [];
  }

  #json(draft: Draft) {
    const last = this.#engineEvents(draft).at(-1);
    const at = last?.at ?? draft.createdAt;
    return {
      id: draft.id,
      type: 'IssuedInvoice',
      number: draft.number,
      state: last ? STATE[last.status] : 'new',
      state_updated_at: at,
      created_at: draft.createdAt,
      updated_at: at,
      error_message: last?.status === 'rejected' ? (last.reason?.text ?? 'Rejected') : null,
      refuse_reason: last?.status === 'refused' ? (last.reason?.text ?? null) : null,
      refuse_reason_code: last?.status === 'refused' ? (last.reason?.code ?? null) : null,
      account: { id: draft.account },
    };
  }

  #list<T>(c: Context, key: string, items: T[]) {
    const offset = Math.max(0, Number(c.req.query('offset') ?? 0) || 0);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(c.req.query('limit') ?? 25) || 25));
    const meta = { total_count: items.length, offset, limit };
    const page = items.slice(offset, offset + limit);
    return c.json(this.#options.alternate ? { [key]: page, ...meta } : { [key]: page, meta });
  }

  #webhookBody(draft: Draft, event: MockEvent): string {
    const data = {
      account_id: draft.account,
      invoice_id: draft.id,
      event_id: event.id,
      state: STATE[event.status],
      notes: event.reason?.text ?? null,
    };
    return JSON.stringify(
      this.#options.alternate
        ? data
        : {
            code: 'issued_invoice.state_change',
            triggered_at: Math.floor(this.#engine.now().getTime() / 1000),
            data,
          },
    );
  }

  /** The webhook B2Brouter would send for the invoice's latest change, signed now. */
  webhookFor(pdpRef: string): WebhookRequest {
    const draft = this.#draft(Number(pdpRef));
    const event = this.#engineEvents(draft).at(-1);
    if (!event) throw new MockNotFound(`invoice ${pdpRef} was never sent`);
    const body = this.#webhookBody(draft, event);
    return {
      headers: new Headers({
        [B2BROUTER_HEADERS.signature]: signWebhook(this.#options.webhookSecret, body),
      }),
      body,
    };
  }

  /** Where webhooks go; the in-process stack sets it once the API has a port. */
  setWebhookUrl(url: string | undefined): void {
    this.#webhookUrl = url;
  }

  #delivery(draft: Draft, event: MockEvent): Delivery | undefined {
    if (!this.#webhookUrl) return undefined;
    const body = this.#webhookBody(draft, event);
    // Retried by the engine like the mock's own webhooks; B2Brouter retries for a week.
    return {
      url: () => this.#webhookUrl,
      body,
      headers: (attempt) => ({
        'content-type': 'application/json',
        [B2BROUTER_HEADERS.signature]: signWebhook(this.#options.webhookSecret, body),
        [B2BROUTER_HEADERS.deliveryId]: event.id,
        [B2BROUTER_HEADERS.deliveryAttempt]: String(attempt),
      }),
    };
  }
}
