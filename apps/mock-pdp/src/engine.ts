// The mock platform (plan §3): validates with @fi/core, plays the scripted lifecycle, pushes signed
// webhooks, holds inbound invoices. State lives in memory: a restart forgets everything, as a test
// platform should. Business time runs `speed` times faster than the clock.
import { type Invoice, InvoiceXmlError, parisToday, parseInvoiceXml, validate } from '@fi/core';
import {
  DEFAULT_TIMELINE,
  MOCK_HEADERS,
  type MockControl,
  type MockEvent,
  type MockInbound,
  type MockInvoice,
  type MockScenario,
  type MockSendResponse,
  type MockWebhook,
  type PdpRejection,
  parseDuration,
  type RoutingInfo,
  signWebhook,
  type TimelineStep,
  type WebhookRequest,
} from '@fi/pdp-adapter';
import { type Clock, systemClock } from './clock';

type Status = MockInvoice['status'];

/** The platform is down or the answer was lost: HTTP 503. */
export class MockUnavailable extends Error {}
export class MockNotFound extends Error {}
/** The request makes no sense in the invoice's current state: HTTP 409. */
export class MockConflict extends Error {}
/** The body is not something the platform can read: HTTP 422. */
export class MockUnreadable extends Error {}

/** Lifecycle order: a timeline step never moves an invoice backwards. */
const RANK: Record<Status, number> = {
  deposited: 0,
  received_by_platform: 1,
  delivered: 2,
  accepted: 3,
  refused: 3,
  payment_received: 4,
  rejected: 4,
};
const FINAL: ReadonlySet<Status> = new Set(['refused', 'payment_received', 'rejected']);

/** Real milliseconds between webhook attempts; the API's status sweep covers what is left. */
export const WEBHOOK_RETRY_MS = [500, 1_000, 2_000, 4_000, 8_000];

interface Stored extends MockInvoice {
  idempotencyKey: string | undefined;
  issueDate: string;
  sellerSiren: string | undefined;
  timers: (() => void)[];
}

export interface EngineOptions {
  clock?: Clock;
  /** Business seconds per clock second (MOCK_PDP_SPEED). */
  speed?: number;
  webhookUrl?: string;
  webhookSecret: string;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

interface Control {
  speed: number;
  timeline: TimelineStep[];
  failNext: NonNullable<MockControl['failNext']>;
  webhookFailures: number;
  unknownSirens: string[];
}

const id = (prefix: string, n: number) => `${prefix}_${String(n).padStart(6, '0')}`;

export class MockPdpEngine {
  readonly #clock: Clock;
  readonly #options: EngineOptions;
  readonly #fetch: typeof fetch;
  #webhookUrl: string | undefined;
  #control: Control;
  #invoices = new Map<string, Stored>();
  #byKey = new Map<string, Stored>();
  #inbound: (MockInbound & { account: string })[] = [];
  #timers = new Set<() => void>();
  #deliveries = new Set<Promise<void>>();
  #seq = { invoice: 0, event: 0, inbound: 0 };

  constructor(options: EngineOptions) {
    this.#options = options;
    this.#clock = options.clock ?? systemClock;
    this.#fetch = options.fetch ?? fetch;
    this.#webhookUrl = options.webhookUrl;
    this.#control = this.#defaults();
  }

  /** Where webhooks go; the in-process stack sets it once the API has a port. */
  setWebhookUrl(url: string | undefined): void {
    this.#webhookUrl = url;
  }

  #defaults(): Control {
    return {
      speed: this.#options.speed ?? 86_400,
      timeline: DEFAULT_TIMELINE,
      failNext: { count: 0, mode: 'error' },
      webhookFailures: 0,
      unknownSirens: [],
    };
  }

  get control(): MockControl {
    return structuredClone(this.#control);
  }

  setControl(patch: MockControl): MockControl {
    this.#control = { ...this.#control, ...patch };
    return this.control;
  }

  reset(): void {
    for (const cancel of this.#timers) cancel();
    this.#timers.clear();
    this.#invoices.clear();
    this.#byKey.clear();
    this.#inbound = [];
    this.#control = this.#defaults();
  }

  deposit(
    account: string,
    xml: string,
    idempotencyKey?: string,
  ): { response: MockSendResponse; created: boolean } {
    const failure = this.#control.failNext;
    const failing = failure.count > 0;
    if (failing) failure.count--;
    if (failing && failure.mode === 'error') throw new MockUnavailable('failNext: error');

    const known = idempotencyKey && this.#byKey.get(`${account}\u0000${idempotencyKey}`);
    if (known) {
      if (failing) throw new MockUnavailable('failNext: drop-response');
      return { response: { status: 'deposited', id: known.id }, created: false };
    }

    const checked = this.#check(account, xml);
    if (!checked.ok) {
      if (failing) throw new MockUnavailable('failNext: drop-response');
      return { response: { status: 'rejected', errors: checked.errors }, created: false };
    }
    const parsed = checked.invoice;
    const invoice: Stored = {
      id: id('inv', ++this.#seq.invoice),
      account,
      number: parsed.number ?? null,
      status: 'deposited',
      events: [],
      idempotencyKey,
      issueDate: parsed.issueDate ?? '',
      sellerSiren: parsed.seller.legalId?.id,
      timers: [],
    };
    this.#invoices.set(invoice.id, invoice);
    if (idempotencyKey) this.#byKey.set(`${account}\u0000${idempotencyKey}`, invoice);
    this.#record(invoice, 'deposited');
    this.#schedule(invoice);
    // drop-response: the platform has the invoice, the caller never hears about it.
    if (failing) throw new MockUnavailable('failNext: drop-response');
    return { response: { status: 'deposited', id: invoice.id }, created: true };
  }

  /** The same validator as the API (plan §3), plus the platform's own history of numbers. */
  #check(
    account: string,
    xml: string,
  ): { ok: true; invoice: Invoice } | { ok: false; errors: PdpRejection[] } {
    let parsed: ReturnType<typeof parseInvoiceXml>;
    try {
      parsed = parseInvoiceXml(xml);
    } catch (e) {
      if (!(e instanceof InvoiceXmlError)) throw e;
      const message = `Le fichier n'est pas une facture CII ou UBL lisible (${e.message}).`;
      return { ok: false, errors: [{ rule: 'XML', message }] };
    }
    const history = [...this.#invoices.values()]
      .filter((i) => i.account === account && i.status !== 'rejected' && i.number)
      .map((i) => ({
        number: i.number ?? '',
        issueDate: i.issueDate,
        ...(i.sellerSiren && { sellerSiren: i.sellerSiren }),
      }));
    const issues = [
      ...parsed.issues,
      ...validate(parsed.invoice, { today: parisToday(this.#clock.now()), history }),
    ];
    const errors = issues
      .filter((i) => i.severity === 'error')
      .map((i) => ({ rule: i.ruleId, message: i.messageFr }));
    return errors.length > 0 ? { ok: false, errors } : { ok: true, invoice: parsed.invoice };
  }

  #schedule(invoice: Stored): void {
    let offset = 0;
    for (const step of this.#control.timeline) {
      offset += parseDuration(step.after);
      const cancel = this.#clock.setTimeout(
        () => {
          this.#timers.delete(cancel);
          if (FINAL.has(invoice.status) || RANK[step.status] <= RANK[invoice.status]) return;
          this.#record(invoice, step.status, step.reason);
        },
        (offset * 1000) / this.#control.speed,
      );
      invoice.timers.push(cancel);
      this.#timers.add(cancel);
    }
  }

  #record(invoice: Stored, status: Status, reason?: MockEvent['reason']): MockEvent {
    const event: MockEvent = {
      id: id('evt', ++this.#seq.event),
      status,
      at: this.#clock.now().toISOString(),
      ...(reason && { reason }),
    };
    invoice.status = status;
    invoice.events.push(event);
    if (FINAL.has(status)) {
      for (const cancel of invoice.timers) {
        cancel();
        this.#timers.delete(cancel);
      }
      invoice.timers = [];
    }
    this.#notify(invoice, event);
    return event;
  }

  #get(invoiceId: string, account?: string): Stored {
    const invoice = this.#invoices.get(invoiceId);
    if (!invoice || (account !== undefined && invoice.account !== account)) {
      throw new MockNotFound(`no invoice ${invoiceId}`);
    }
    return invoice;
  }

  /** The account's invoices, oldest first; `number` narrows to one invoice number. */
  list(account: string, number?: string): MockInvoice[] {
    return [...this.#invoices.values()]
      .filter((i) => i.account === account && (number === undefined || i.number === number))
      .map((i) => this.status(account, i.id));
  }

  status(account: string, invoiceId: string): MockInvoice {
    const { id: invoiceIdOut, number, status, events } = this.#get(invoiceId, account);
    return { id: invoiceIdOut, account, number, status, events: [...events] };
  }

  /** POST /scenarios/:id — moves the invoice now, whatever the timeline says. */
  force(invoiceId: string, scenario: MockScenario): MockInvoice {
    const invoice = this.#get(invoiceId);
    if (FINAL.has(invoice.status)) {
      throw new MockConflict(`invoice ${invoiceId} is already ${invoice.status}`);
    }
    this.#record(invoice, scenario.status, scenario.reason);
    return this.status(invoice.account, invoiceId);
  }

  /** « Encaissée »: the seller reports the payment. Reporting it twice changes nothing. */
  reportPayment(account: string, invoiceId: string): MockInvoice {
    const invoice = this.#get(invoiceId, account);
    if (invoice.status === 'refused' || invoice.status === 'rejected') {
      throw new MockConflict(`invoice ${invoiceId} is ${invoice.status}`);
    }
    if (invoice.status !== 'payment_received') this.#record(invoice, 'payment_received');
    return this.status(account, invoiceId);
  }

  /** POST /inbound — a supplier invoice addressed to `account`. */
  inject(account: string, xml: string): MockInbound {
    try {
      parseInvoiceXml(xml);
    } catch (e) {
      if (e instanceof InvoiceXmlError) throw new MockUnreadable(e.message);
      throw e;
    }
    const item = {
      id: id('inb', ++this.#seq.inbound),
      account,
      receivedAt: this.#clock.now().toISOString(),
      xml,
    };
    this.#inbound.push(item);
    return { id: item.id, receivedAt: item.receivedAt, xml };
  }

  listInbound(account: string, since: Date): MockInbound[] {
    return this.#inbound
      .filter((i) => i.account === account && Date.parse(i.receivedAt) >= since.getTime())
      .map(({ id: inboundId, receivedAt, xml }) => ({ id: inboundId, receivedAt, xml }));
  }

  lookup(siren: string): RoutingInfo | null {
    if (!/^\d{9}$/.test(siren) || this.#control.unknownSirens.includes(siren)) return null;
    return { siren, platform: 'Mock PDP' };
  }

  /** The webhook the platform sends for the invoice's latest event, signed now. */
  webhookFor(invoiceId: string): WebhookRequest {
    const invoice = this.#get(invoiceId);
    const event = invoice.events.at(-1);
    if (!event) throw new MockNotFound(`no event on ${invoiceId}`);
    const body = this.#webhookBody(invoice, event);
    return {
      headers: new Headers({
        [MOCK_HEADERS.signature]: signWebhook(this.#options.webhookSecret, body),
      }),
      body,
    };
  }

  #webhookBody(invoice: Stored, event: MockEvent): string {
    const webhook: MockWebhook = {
      code: 'issued_invoice.state_change',
      triggered_at: Math.floor(this.#clock.now().getTime() / 1000),
      data: {
        account_id: invoice.account,
        invoice_id: invoice.id,
        event_id: event.id,
        state: event.status,
      },
    };
    return JSON.stringify(webhook);
  }

  #notify(invoice: Stored, event: MockEvent): void {
    if (!this.#webhookUrl) return;
    this.#deliver(this.#webhookBody(invoice, event), event.id, 1);
  }

  #deliver(body: string, deliveryId: string, attempt: number): void {
    const url = this.#webhookUrl;
    if (!url) return;
    const delivery = (async () => {
      let delivered = false;
      if (this.#control.webhookFailures > 0) {
        this.#control.webhookFailures--;
      } else {
        try {
          const res = await this.#fetch(url, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              // Transport signature: real time, whatever the business clock says.
              [MOCK_HEADERS.signature]: signWebhook(this.#options.webhookSecret, body),
              [MOCK_HEADERS.deliveryId]: deliveryId,
              [MOCK_HEADERS.deliveryAttempt]: String(attempt),
            },
            body,
            signal: AbortSignal.timeout(5_000),
          });
          delivered = res.ok;
        } catch {
          delivered = false;
        }
      }
      if (delivered) return;
      const delay = WEBHOOK_RETRY_MS[attempt - 1];
      if (delay === undefined) {
        this.#options.log?.(`webhook ${deliveryId}: gave up after ${attempt} attempts`);
        return;
      }
      const cancel = this.#clock.setTimeout(() => {
        this.#timers.delete(cancel);
        this.#deliver(body, deliveryId, attempt + 1);
      }, delay);
      this.#timers.add(cancel);
    })();
    this.#deliveries.add(delivery);
    void delivery.finally(() => this.#deliveries.delete(delivery));
  }

  /** Resolves when no webhook request is in flight (retries waiting on the clock do not count). */
  async idle(): Promise<void> {
    while (this.#deliveries.size > 0) await Promise.all(this.#deliveries);
  }
}
