import {
  B2BROUTER_HEADERS,
  createB2BrouterAdapter,
  ISSUED_INVOICE_EVENT,
  verifyWebhookSignature,
} from '@fi/pdp-adapter';
import { pdpAdapterContract } from '@fi/pdp-adapter/contract';
import { describe, expect, it } from 'vitest';
import { createMockPdp } from './app';
import { ManualClock } from './clock';
import { WEBHOOK_RETRY_MS } from './engine';
import { cii, draft } from './test-invoice';

const SECRET = 'b2brouter-stand-in-secret';
const ACCOUNT = '100000009';
const KEY = 'test_stand_in_key';
const ms = (businessSeconds: number) => (businessSeconds * 1000) / 86_400;

interface Sent {
  url: string;
  headers: Headers;
  body: string;
}

function setup(options: { alternate?: boolean; webhooks?: boolean } = {}) {
  const clock = new ManualClock('2026-10-15T08:00:00Z');
  const sent: Sent[] = [];
  const { app, engine, b2brouter } = createMockPdp({
    clock,
    speed: 86_400,
    webhookSecret: SECRET,
    // The mock's own webhook stays configured: invoices sent through B2Brouter must not use it.
    webhookUrl: 'http://api.test/webhooks/pdp/mock',
    fetch: async (url, init) => {
      sent.push({
        url: String(url),
        headers: new Headers(init?.headers),
        body: String(init?.body),
      });
      return new Response(null, { status: 202 });
    },
    b2brouter: {
      ...(options.alternate && { alternate: true }),
      ...(options.webhooks && { webhookUrl: 'http://api.test/webhooks/pdp/b2brouter' }),
    },
  });
  const call = (path: string, init: RequestInit & { key?: string | null } = {}) => {
    const headers = new Headers(init.headers);
    if (init.key !== null) headers.set(B2BROUTER_HEADERS.apiKey, init.key ?? KEY);
    return app.request(`/b2brouter${path}`, { ...init, headers });
  };
  const importXml = (xml: string, account = ACCOUNT) =>
    call(`/accounts/${account}/invoices/import?send_after_import=false&issued=true`, {
      method: 'POST',
      body: xml,
      headers: { 'content-type': 'application/xml' },
    });
  const imported = async (number: string) => {
    const res = await importXml(cii(draft(number)));
    expect(res.status).toBe(201);
    return ((await res.json()) as { invoice: { id: number } }).invoice.id;
  };
  return { app, engine, b2brouter, clock, sent, call, importXml, imported };
}

describe('B2Brouter stand-in', () => {
  it('answers 401 without a sandbox key, and says which request it was', async () => {
    const { call } = setup();
    for (const key of [null, 'prod_live_key', 'stag_key']) {
      const res = await call(`/accounts/${ACCOUNT}/invoices`, { key });
      expect(res.status).toBe(401);
      expect(await res.json()).toMatchObject({ error: { code: 'invalid_api_key' } });
      expect(res.headers.get(B2BROUTER_HEADERS.requestId)).toMatch(/^req_/);
    }
  });

  it('imports a draft, refuses its number twice, an unreadable file and an invalid invoice', async () => {
    const { importXml } = setup();
    const res = await importXml(cii(draft('B2B-1')));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      invoice: { id: expect.any(Number), number: 'B2B-1', state: 'new', type: 'IssuedInvoice' },
    });

    const again = await importXml(cii(draft('B2B-1')));
    expect(again.status).toBe(422);
    expect(await again.json()).toMatchObject({
      error: { code: 'parameter_taken', param: 'number' },
    });

    expect((await importXml('not an invoice')).status).toBe(406);
    const invalid = await importXml(cii(draft('B2B-2', (d) => (d.buyer.name = ''))));
    expect(invalid.status).toBe(422);
    expect(await invalid.json()).toEqual({ errors: expect.arrayContaining([expect.any(String)]) });
  });

  it('sends a draft once; a sent invoice cannot be deleted, a draft can', async () => {
    const { call, imported } = setup();
    const id = await imported('B2B-3');
    expect((await call(`/invoices/send_invoice/${id}`, { method: 'POST' })).status).toBe(204);
    expect((await call(`/invoices/send_invoice/${id}`, { method: 'POST' })).status).toBe(422);
    expect(await (await call(`/invoices/${id}`)).json()).toMatchObject({
      invoice: { state: 'sent' },
    });
    expect((await call(`/invoices/${id}`, { method: 'DELETE' })).status).toBe(422);

    const other = await imported('B2B-4');
    expect((await call(`/invoices/${other}`, { method: 'DELETE' })).status).toBe(200);
    expect((await call(`/invoices/${other}`)).status).toBe(404);
  });

  it('serves the original file as it was imported', async () => {
    const { call, imported } = setup();
    const xml = cii(draft('B2B-5'));
    const id = await imported('B2B-5');
    expect(await (await call(`/invoices/${id}/as/original`)).text()).toBe(xml);
  });

  it('lists events with the state each one reached, then pages, with meta', async () => {
    const { call, clock, imported } = setup();
    const id = await imported('B2B-6');
    await call(`/invoices/send_invoice/${id}`, { method: 'POST' });
    await clock.advance(ms(40 * 86_400));
    const res = await call(`/accounts/${ACCOUNT}/events?invoice_id=${id}&offset=0&limit=2`);
    const body = (await res.json()) as {
      events: { invoice: { state: string } }[];
      meta: { total_count: number; limit: number };
    };
    expect(body.events.map((e) => e.invoice.state)).toEqual(['sent', 'registered']);
    expect(body.meta).toMatchObject({ limit: 2, total_count: expect.any(Number) });
    expect(body.meta.total_count).toBeGreaterThan(2);
  });

  it('puts list counts at the top level in the alternate shape', async () => {
    const { call, imported } = setup({ alternate: true });
    await imported('B2B-7');
    const body = await (await call(`/accounts/${ACCOUNT}/invoices?number=B2B`)).json();
    expect(body).toMatchObject({ total_count: 1, offset: 0, invoices: [{ number: 'B2B-7' }] });
    expect(body).not.toHaveProperty('meta');
  });

  it('lists received invoices, answers 302 for them and serves their file', async () => {
    const { call, engine } = setup();
    const xml = cii(draft('SUPPLIER-1'));
    engine.inject(ACCOUNT, xml);
    const list = (await (
      await call(`/accounts/${ACCOUNT}/invoices?type=ReceivedInvoice&updated_at_from=2026-10-14`)
    ).json()) as { invoices: { id: number; type: string }[] };
    expect(list.invoices).toEqual([expect.objectContaining({ type: 'ReceivedInvoice' })]);
    const id = list.invoices[0]?.id;
    expect((await call(`/invoices/${id}`)).status).toBe(302);
    expect(await (await call(`/invoices/${id}/as/original`)).text()).toBe(xml);
  });

  it('records a payment for either an amount or the full invoice, not both', async () => {
    const { call, engine, imported } = setup();
    const id = await imported('B2B-8');
    await call(`/invoices/send_invoice/${id}`, { method: 'POST' });
    const pay = (payment: object) =>
      call(`/accounts/${ACCOUNT}/payments`, {
        method: 'POST',
        body: JSON.stringify({ payment }),
        headers: { 'content-type': 'application/json' },
      });
    expect((await pay({ invoice_id: id, amount: 120, full: true })).status).toBe(422);
    expect((await pay({ invoice_id: id, amount: 120 })).status).toBe(201);
    expect(engine.list(ACCOUNT, 'B2B-8')[0]?.status).toBe('payment_received');
  });

  it('answers the directory 202 first, then the company (documented shape)', async () => {
    const { call, engine } = setup();
    const first = await call('/directory/fr/0002/200000008');
    expect(first.status).toBe(202);
    expect(await first.json()).toMatchObject({ status: 'processing' });
    const second = await call('/directory/fr/0002/200000008');
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ cin_value: '200000008', invoice: {} });

    engine.setControl({ unknownSirens: ['300000007'] });
    await call('/directory/fr/0002/300000007');
    expect((await call('/directory/fr/0002/300000007')).status).toBe(404);
    expect(await (await call('/directory/fr/0002/12')).json()).toMatchObject({
      error: { code: 'parameter_invalid' },
    });
  });

  it('answers a known company at once, wrapped, in the alternate shape', async () => {
    const { call } = setup({ alternate: true });
    const res = await call('/directory/fr/0002/200000008');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ external_company: { cin_value: '200000008' } });
    expect(await (await call('/directory/fr/0002/12')).json()).toMatchObject({
      error: { code: 'invalid_identifier' },
    });
  });

  it('pushes signed B2Brouter webhooks instead of the mock ones', async () => {
    const { call, clock, imported, sent } = setup({ webhooks: true });
    const id = await imported('B2B-9');
    await call(`/invoices/send_invoice/${id}`, { method: 'POST' });
    await clock.advance(ms(2 * 86_400));
    expect(sent.length).toBeGreaterThan(0);
    for (const s of sent) {
      expect(s.url).toBe('http://api.test/webhooks/pdp/b2brouter');
      const signature = s.headers.get(B2BROUTER_HEADERS.signature);
      expect(verifyWebhookSignature(SECRET, signature, s.body)).toBe(true);
      expect(JSON.parse(s.body)).toMatchObject({
        code: ISSUED_INVOICE_EVENT,
        data: { account_id: ACCOUNT, invoice_id: id },
      });
    }
    expect(JSON.parse(sent[0]?.body ?? '{}').data.state).toBe('sent');
  });

  it('retries a failed webhook like the mock does', async () => {
    const { call, clock, engine, imported, sent } = setup({ webhooks: true });
    engine.setControl({ webhookFailures: 1 });
    const id = await imported('B2B-12');
    await call(`/invoices/send_invoice/${id}`, { method: 'POST' });
    expect(sent).toEqual([]);
    await clock.advance(WEBHOOK_RETRY_MS[0] ?? 0);
    // Half a real second is half a business day: later events went out meanwhile, first time.
    const deposit = sent.filter((s) => JSON.parse(s.body).data.state === 'sent');
    expect(deposit.map((s) => s.headers.get(B2BROUTER_HEADERS.deliveryAttempt))).toEqual(['2']);
  });

  it('sends flat webhook bodies in the alternate shape', async () => {
    const { call, imported, sent } = setup({ alternate: true, webhooks: true });
    const id = await imported('B2B-10');
    await call(`/invoices/send_invoice/${id}`, { method: 'POST' });
    expect(JSON.parse(sent[0]?.body ?? '{}')).toEqual(
      expect.objectContaining({ account_id: ACCOUNT, invoice_id: id, state: 'sent' }),
    );
    expect(JSON.parse(sent[0]?.body ?? '{}')).not.toHaveProperty('code');
  });

  it('forgets its drafts when the engine is reset', async () => {
    const { call, engine, imported } = setup();
    const id = await imported('B2B-11');
    engine.reset();
    expect((await call(`/invoices/${id}`)).status).toBe(404);
  });
});

for (const alternate of [false, true]) {
  let number = 0;
  pdpAdapterContract(`B2Brouter stand-in${alternate ? ', alternate shapes' : ''}`, async () => {
    const { app, b2brouter, clock, engine } = setup({ alternate });
    // A received invoice, so that listInbound has something to read.
    engine.inject(ACCOUNT, cii(draft('SUPPLIER-CONTRACT')));
    return {
      adapter: createB2BrouterAdapter({
        apiKey: KEY,
        baseUrl: 'http://mock.test/b2brouter/',
        webhookSecret: SECRET,
        fetch: async (url, init) => app.request(String(url), init),
        directory: { pollMs: 0, polls: 3 },
      }),
      account: ACCOUNT,
      validInvoice: () => cii(draft(`B2B-CONTRACT-${++number}`)),
      invalidInvoice: () => cii(draft(`B2B-CONTRACT-${++number}`, (d) => (d.buyer.name = ''))),
      knownSiren: '200000008',
      settle: () => clock.advance(ms(40 * 86_400)),
      signedWebhook: (pdpRef) => b2brouter.webhookFor(pdpRef),
    };
  });
}
