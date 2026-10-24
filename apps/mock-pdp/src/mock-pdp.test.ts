import {
  createMockPdpAdapter,
  MOCK_HEADERS,
  type MockInvoice,
  MockWebhook,
  verifyWebhookSignature,
} from '@fi/pdp-adapter';
import { pdpAdapterContract } from '@fi/pdp-adapter/contract';
import { describe, expect, it, vi } from 'vitest';
import { createMockPdp } from './app';
import { MAX_TIMEOUT_MS, ManualClock, systemClock } from './clock';
import { WEBHOOK_RETRY_MS } from './engine';
import { cii, draft, payableOf, ubl } from './test-invoice';

const SECRET = 'mock-pdp-test-secret';
const ACCOUNT = '100000009';

interface Sent {
  url: string;
  headers: Headers;
  body: string;
}

function setup(options: { webhook?: (sent: Sent) => number } = {}) {
  const clock = new ManualClock('2026-10-15T08:00:00Z');
  const sent: Sent[] = [];
  const { app, engine } = createMockPdp({
    clock,
    speed: 86_400,
    webhookSecret: SECRET,
    ...(options.webhook && {
      webhookUrl: 'http://api.test/webhooks/pdp/mock',
      fetch: async (url, init) => {
        const s = {
          url: String(url),
          headers: new Headers(init?.headers),
          body: String(init?.body),
        };
        sent.push(s);
        return new Response(null, { status: options.webhook?.(s) ?? 202 });
      },
    }),
  });
  const call = (path: string, init: RequestInit & { account?: string | null } = {}) => {
    const headers = new Headers(init.headers);
    if (init.account !== null) headers.set(MOCK_HEADERS.account, init.account ?? ACCOUNT);
    return app.request(path, { ...init, headers });
  };
  const send = (xml: string, key?: string) =>
    call('/invoices', {
      method: 'POST',
      body: xml,
      headers: key ? { [MOCK_HEADERS.idempotencyKey]: key } : {},
    });
  const status = async (id: string) =>
    (await (await call(`/invoices/${id}/status`)).json()) as MockInvoice;
  const control = (body: unknown) =>
    call('/control', { method: 'PUT', body: JSON.stringify(body), account: null });
  return { app, engine, clock, sent, call, send, status, control };
}

const ms = (businessSeconds: number) => (businessSeconds * 1000) / 86_400;

describe('POST /invoices', () => {
  it('deposits a valid CII invoice', async () => {
    const { send, status } = setup();
    const res = await send(cii(draft('F2026-0100')), 'k1');
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string; id: string };
    expect(body).toEqual({ status: 'deposited', id: 'inv_000001' });
    const invoice = await status(body.id);
    expect(invoice).toMatchObject({ account: ACCOUNT, number: 'F2026-0100', status: 'deposited' });
    expect(invoice.events).toEqual([
      { id: 'evt_000001', status: 'deposited', at: '2026-10-15T08:00:00.000Z' },
    ]);
  });

  it('deposits a valid UBL invoice and checks it with the same rules', async () => {
    const { send, status } = setup();
    const res = await send(ubl(draft('F2026-0110')), 'k-ubl');
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect(await status(id)).toMatchObject({ number: 'F2026-0110', status: 'deposited' });
    const bad = await send(ubl(draft('F2026-0111', (d) => (d.buyer.name = ''))));
    expect(bad.status).toBe(422);
    const body = (await bad.json()) as { errors: { rule: string }[] };
    expect(body.errors.map((e) => e.rule)).toContain('BR-07');
  });

  it('refuses an invoice with blocking errors, with the core rule ids and French messages', async () => {
    const { send } = setup();
    const res = await send(cii(draft('F2026-0101', (d) => (d.buyer.name = ''))));
    expect(res.status).toBe(422);
    const body = (await res.json()) as {
      status: string;
      errors: { rule: string; message: string }[];
    };
    expect(body.status).toBe('rejected');
    expect(body.errors).toContainEqual({
      rule: 'BR-07',
      message: 'Le nom de votre client manque.',
    });
  });

  it('refuses a file that is not an invoice, and an empty body', async () => {
    const { send } = setup();
    const res = await send('<hello/>');
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ status: 'rejected', errors: [{ rule: 'XML' }] });
    expect((await send('  ')).status).toBe(400);
  });

  it('deposits once per idempotency key, and refuses the same number under another key', async () => {
    const { send, call } = setup();
    const xml = cii(draft('F2026-0102'));
    const first = await send(xml, 'k1');
    const again = await send(xml, 'k1');
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(await again.json()).toEqual({ status: 'deposited', id: 'inv_000001' });
    const other = await send(xml, 'k2');
    expect(other.status).toBe(422);
    expect(await other.json()).toMatchObject({ errors: [{ rule: 'BR-FR-CO-02' }] });
    const listed = (await (await call('/invoices?number=F2026-0102')).json()) as MockInvoice[];
    expect(listed.map((i) => i.id)).toEqual(['inv_000001']);
    expect(await (await call('/invoices?number=F2026-9999')).json()).toEqual([]);
  });

  it('needs the account header', async () => {
    const { call } = setup();
    const res = await call('/invoices', { method: 'POST', body: '<x/>', account: null });
    expect(res.status).toBe(401);
  });
});

describe('lifecycle', () => {
  it('plays the default timeline in business time, sped up', async () => {
    const { send, status, clock } = setup();
    const { id } = (await (await send(cii(draft('F2026-0110')), 'k')).json()) as { id: string };
    await clock.advance(ms(5 * 60) - 1);
    expect((await status(id)).status).toBe('deposited');
    await clock.advance(1);
    expect((await status(id)).status).toBe('received_by_platform');
    await clock.advance(ms(3600 + 2 * 86_400 + 30 * 86_400));
    const done = await status(id);
    expect(done.events.map((e) => e.status)).toEqual([
      'deposited',
      'received_by_platform',
      'delivered',
      'accepted',
      'payment_received',
    ]);
    expect(clock.pending).toBe(0);
  });

  it('follows a timeline set through /control, reasons included', async () => {
    const { send, status, clock, control } = setup();
    const res = await control({
      speed: 1,
      timeline: [
        { status: 'delivered', after: 'PT1S' },
        { status: 'refused', after: 'PT1S', reason: { code: 'REF', text: 'Montant contesté' } },
        { status: 'payment_received', after: 'PT1S' },
      ],
    });
    expect(res.status).toBe(200);
    const { id } = (await (await send(cii(draft('F2026-0111')), 'k')).json()) as { id: string };
    await clock.advance(10_000);
    const invoice = await status(id);
    expect(invoice.status).toBe('refused');
    expect(invoice.events.at(-1)?.reason).toEqual({ code: 'REF', text: 'Montant contesté' });
  });

  it('forces a transition through /scenarios and stops the timeline at a final status', async () => {
    const { send, status, clock, call } = setup();
    const { id } = (await (await send(cii(draft('F2026-0112')), 'k')).json()) as { id: string };
    const force = (body: unknown) =>
      call(`/scenarios/${id}`, { method: 'POST', body: JSON.stringify(body), account: null });
    const res = await force({ status: 'rejected', reason: { text: 'Destinataire inconnu' } });
    expect(res.status).toBe(200);
    await clock.advance(ms(40 * 86_400));
    expect((await status(id)).events.map((e) => e.status)).toEqual(['deposited', 'rejected']);
    expect((await force({ status: 'accepted' })).status).toBe(409);
    expect((await force({ status: 'deposited' })).status).toBe(400);
    expect(
      (await call('/scenarios/inv_999999', { method: 'POST', body: '{"status":"accepted"}' }))
        .status,
    ).toBe(404);
  });

  it('plays a delayed scenario on the business clock, instead of the rest of the timeline', async () => {
    const { send, status, clock, call } = setup();
    const { id } = (await (await send(cii(draft('F2026-0117')), 'k')).json()) as { id: string };
    await call(`/scenarios/${id}`, { method: 'POST', body: '{"status":"accepted"}' });
    const late = await call(`/scenarios/${id}`, {
      method: 'POST',
      body: JSON.stringify({ status: 'payment_received', after: 'P75D', reason: { text: 'J+45' } }),
    });
    expect(late.status).toBe(200);
    await clock.advance(ms(74 * 86_400));
    expect((await status(id)).status).toBe('accepted');
    await clock.advance(ms(2 * 86_400));
    expect((await status(id)).events.map((e) => e.status)).toEqual([
      'deposited',
      'accepted',
      'payment_received',
    ]);
    expect(clock.pending).toBe(0);
    const bad = await call(`/scenarios/${id}`, {
      method: 'POST',
      body: '{"status":"accepted","after":"soon"}',
    });
    expect(bad.status).toBe(400);
  });

  it('never moves an invoice backwards', async () => {
    const { send, status, clock, call } = setup();
    const { id } = (await (await send(cii(draft('F2026-0113')), 'k')).json()) as { id: string };
    await call(`/scenarios/${id}`, { method: 'POST', body: '{"status":"accepted"}' });
    await clock.advance(ms(3 * 86_400));
    expect((await status(id)).events.map((e) => e.status)).toEqual(['deposited', 'accepted']);
  });

  it('adds up the payments, is paid once they reach the amount due, refuses a refused invoice', async () => {
    const { send, status, call } = setup();
    const pay = (id: string, amount = 12_000) =>
      call(`/invoices/${id}/payments`, { method: 'POST', body: JSON.stringify({ amount }) });
    const invoice = draft('F2026-0114');
    const due = payableOf(invoice);
    const { id } = (await (await send(cii(invoice), 'k1')).json()) as { id: string };
    const events = async () => (await status(id)).events.map((e) => e.status);
    expect((await pay(id, 4_000)).status).toBe(201);
    expect(await events()).toEqual(['deposited']);
    expect((await pay(id, due - 4_000)).status).toBe(201);
    expect((await pay(id, due)).status).toBe(201);
    expect(await events()).toEqual(['deposited', 'payment_received']);

    const other = (await (await send(cii(draft('F2026-0115')), 'k2')).json()) as { id: string };
    await call(`/scenarios/${other.id}`, { method: 'POST', body: '{"status":"refused"}' });
    expect((await pay(other.id)).status).toBe(409);
    expect((await call(`/invoices/${id}/payments`, { method: 'POST', body: '{}' })).status).toBe(
      400,
    );
  });

  it('keeps accounts apart', async () => {
    const { send, call } = setup();
    const { id } = (await (await send(cii(draft('F2026-0116')), 'k')).json()) as { id: string };
    expect((await call(`/invoices/${id}/status`, { account: '200000008' })).status).toBe(404);
  });
});

describe('failures on demand', () => {
  it('error: answers 503 and keeps nothing', async () => {
    const { send, control, status } = setup();
    await control({ failNext: { count: 1, mode: 'error' } });
    const xml = cii(draft('F2026-0120'));
    expect((await send(xml, 'k')).status).toBe(503);
    const res = await send(xml, 'k');
    expect(res.status).toBe(201);
    const { id } = (await res.json()) as { id: string };
    expect((await status(id)).events).toHaveLength(1);
  });

  it('drop-response: keeps the invoice, loses the answer; the retry with the same key finds it', async () => {
    const { send, control, engine } = setup();
    await control({ failNext: { count: 1, mode: 'drop-response' } });
    const xml = cii(draft('F2026-0121'));
    expect((await send(xml, 'k')).status).toBe(503);
    const retry = await send(xml, 'k');
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual({ status: 'deposited', id: 'inv_000001' });
    expect(engine.control.failNext).toEqual({ count: 0, mode: 'drop-response' });
  });

  it('refuses a control it cannot read', async () => {
    const { control } = setup();
    expect((await control({ speed: -1 })).status).toBe(400);
    expect((await control({ timeline: [{ status: 'accepted', after: '2 days' }] })).status).toBe(
      400,
    );
  });

  it('reset forgets invoices, inbound and controls', async () => {
    const { send, control, call, engine } = setup();
    await control({ speed: 10, unknownSirens: ['200000008'] });
    const { id } = (await (await send(cii(draft('F2026-0122')), 'k')).json()) as { id: string };
    expect((await call('/control/reset', { method: 'POST' })).status).toBe(204);
    expect((await call(`/invoices/${id}/status`)).status).toBe(404);
    expect(engine.control).toMatchObject({ speed: 86_400, unknownSirens: [] });
  });
});

describe('webhooks', () => {
  it('pushes every event, signed, with a delivery id', async () => {
    const { send, clock, sent, engine } = setup({ webhook: () => 202 });
    const { id } = (await (await send(cii(draft('F2026-0130')), 'k')).json()) as { id: string };
    await engine.idle();
    await clock.advance(ms(40 * 86_400));
    await engine.idle();
    expect(sent).toHaveLength(5);
    for (const s of sent) {
      expect(s.url).toBe('http://api.test/webhooks/pdp/mock');
      expect(verifyWebhookSignature(SECRET, s.headers.get(MOCK_HEADERS.signature), s.body)).toBe(
        true,
      );
      expect(s.headers.get(MOCK_HEADERS.deliveryAttempt)).toBe('1');
    }
    const bodies = sent.map((s) => MockWebhook.parse(JSON.parse(s.body)));
    expect(bodies.map((b) => b.data.state)).toEqual([
      'deposited',
      'received_by_platform',
      'delivered',
      'accepted',
      'payment_received',
    ]);
    expect(bodies[0]).toMatchObject({
      code: 'issued_invoice.state_change',
      data: { account_id: ACCOUNT, invoice_id: id, event_id: 'evt_000001' },
    });
    expect(sent[0]?.headers.get(MOCK_HEADERS.deliveryId)).toBe('evt_000001');
  });

  it('retries a failed delivery with backoff, then gives up', async () => {
    const { send, clock, sent, engine, control } = setup({ webhook: () => 500 });
    await control({ speed: 1, timeline: [] });
    await send(cii(draft('F2026-0131')), 'k');
    await engine.idle();
    expect(sent).toHaveLength(1);
    await clock.advance(WEBHOOK_RETRY_MS[0] ?? 0);
    await engine.idle();
    expect(sent.map((s) => s.headers.get(MOCK_HEADERS.deliveryAttempt))).toEqual(['1', '2']);
    await clock.advance(60_000);
    await engine.idle();
    expect(sent).toHaveLength(WEBHOOK_RETRY_MS.length + 1);
    expect(clock.pending).toBe(0);
  });

  it('webhookFailures: fails the next deliveries on purpose, the retry gets through', async () => {
    const { send, clock, sent, engine, control } = setup({ webhook: () => 202 });
    await control({ speed: 1, timeline: [], webhookFailures: 2 });
    await send(cii(draft('F2026-0132')), 'k');
    await clock.advance(10_000);
    await engine.idle();
    expect(sent.map((s) => s.headers.get(MOCK_HEADERS.deliveryAttempt))).toEqual(['3']);
  });
});

describe('inbound and directory', () => {
  it('stores an inbound invoice and lists it since a date', async () => {
    const { call, clock } = setup();
    const xml = cii(draft('FOURN-1'));
    const res = await call('/inbound', { method: 'POST', body: xml });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      id: 'inb_000001',
      receivedAt: '2026-10-15T08:00:00.000Z',
    });
    await clock.advance(1000);
    await call('/inbound', { method: 'POST', body: cii(draft('FOURN-2')) });
    const list = async (query: string, account?: string) =>
      (await (await call(`/inbound${query}`, { ...(account && { account }) })).json()) as unknown[];
    expect(await list('')).toHaveLength(2);
    expect(await list('?since=2026-10-15T08:00:00.500Z')).toHaveLength(1);
    expect(await list('', '200000008')).toHaveLength(0);
    expect((await call('/inbound?since=yesterday')).status).toBe(400);
    expect((await call('/inbound', { method: 'POST', body: 'not xml' })).status).toBe(422);
  });

  it('finds a SIREN unless told it is unknown', async () => {
    const { call, control } = setup();
    expect(await (await call('/directory/200000008')).json()).toEqual({
      siren: '200000008',
      platform: 'Mock PDP',
    });
    await control({ unknownSirens: ['200000008'] });
    expect((await call('/directory/200000008')).status).toBe(404);
    expect((await call('/directory/12')).status).toBe(404);
  });
});

describe('health', () => {
  it('answers /health', async () => {
    const res = await setup().app.request('/health');
    expect(await res.json()).toEqual({ ok: true, service: 'mock-pdp' });
  });
});

let contractNumber = 0;
pdpAdapterContract('mock-pdp', async () => {
  const { app, engine, clock } = setup();
  return {
    adapter: createMockPdpAdapter({
      baseUrl: 'http://mock.test',
      webhookSecret: SECRET,
      fetch: async (url, init) => app.request(String(url), init),
    }),
    account: ACCOUNT,
    validInvoice: () => cii(draft(`CONTRACT-${++contractNumber}`)),
    invalidInvoice: () => cii(draft(`CONTRACT-${++contractNumber}`, (d) => (d.buyer.name = ''))),
    knownSiren: '200000008',
    settle: () => clock.advance(ms(40 * 86_400)),
    signedWebhook: (pdpRef) => engine.webhookFor(pdpRef),
  };
});

describe('system clock', () => {
  it('waits longer than Node allows in one timeout (a 30-day step at real speed)', async () => {
    vi.useFakeTimers();
    try {
      const fired: number[] = [];
      systemClock.setTimeout(() => fired.push(1), MAX_TIMEOUT_MS + 60_000);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(fired).toEqual([]);
      await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS);
      expect(fired).toEqual([1]);
      const cancel = systemClock.setTimeout(() => fired.push(2), MAX_TIMEOUT_MS * 2);
      await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS + 1);
      cancel();
      await vi.advanceTimersByTimeAsync(MAX_TIMEOUT_MS);
      expect(fired).toEqual([1]);
    } finally {
      vi.useRealTimers();
    }
  });
});
