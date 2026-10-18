import { readFileSync } from 'node:fs';
import { parseInvoiceXml } from '@fi/core';
import { describe, expect, it } from 'vitest';
import { signWebhook } from '../signature';
import { PdpRequestError, PdpUnavailableError } from '../types';
import { B2BROUTER_RULES, createB2BrouterAdapter, history } from './adapter';
import {
  B2BROUTER_API_VERSION,
  B2BROUTER_HEADERS,
  B2BROUTER_HOSTS,
  B2bEvent,
  B2bInvoice,
  environmentOfKey,
  keyProblem,
} from './protocol';
import { B2BROUTER_STATE_PATH, pathOf } from './states';

const KEY = 'test_unit_secret_key_value';
const SECRET = 'b2brouter-unit-webhook-secret';
const ACCOUNT = '211';
const XML = readFileSync(
  new URL('../../../../fixtures/golden/01-services-standard-rate.cii.xml', import.meta.url),
  'utf8',
);
const NUMBER = parseInvoiceXml(XML).invoice.number ?? '';
/** Another invoice under the same number: a corrected version, or someone else's document. */
const OTHER_XML = `${XML}\n<!-- corrected -->`;

interface Call {
  method: string;
  url: URL;
  route: string;
  headers: Headers;
  body: string;
}

function fake(
  respond: (c: Call) => Response | Promise<Response>,
  options: { secret?: boolean } = {},
) {
  const calls: Call[] = [];
  const slept: number[] = [];
  const adapter = createB2BrouterAdapter({
    apiKey: KEY,
    ...(options.secret !== false && { webhookSecret: SECRET }),
    directory: { pollMs: 250, polls: 2 },
    sleep: async (ms) => {
      slept.push(ms);
    },
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const raw = init?.body;
      const c: Call = {
        method: init?.method ?? 'GET',
        url,
        route: `${init?.method ?? 'GET'} ${url.pathname}`,
        headers: new Headers(init?.headers),
        body:
          typeof raw === 'string' ? raw : raw ? new TextDecoder().decode(raw as Uint8Array) : '',
      };
      calls.push(c);
      return respond(c);
    },
  });
  return { adapter, calls, slept };
}

const invoice = (fields: Record<string, unknown> = {}) => ({
  id: 4053101,
  type: 'IssuedInvoice',
  number: NUMBER,
  state: 'new',
  created_at: '2026-10-18T08:00:00Z',
  ...fields,
});
/** As the adapter reads it. */
const parsed = (fields: Record<string, unknown>) => B2bInvoice.parse(invoice(fields));
const list = (...invoices: object[]) =>
  Response.json({ invoices, meta: { total_count: invoices.length, offset: 0, limit: 500 } });
const error = (status: number, code: string, message = code) =>
  Response.json({ error: { code, message, type: 'invalid_request_error' } }, { status });
const missing = () => new Response('', { status: 404 });
const send = (adapter: ReturnType<typeof fake>['adapter'], xml = XML, pdf?: Uint8Array) =>
  adapter.sendInvoice({
    account: ACCOUNT,
    xml,
    format: 'CII',
    idempotencyKey: 'k',
    ...(pdf && { pdf }),
  });

describe('B2Brouter requests', () => {
  it('sends the key and the pinned version in headers, never in the URL', async () => {
    const { adapter, calls } = fake(() => Response.json({ invoice: invoice({ state: 'sent' }) }));
    await adapter.getStatus({ account: ACCOUNT, pdpRef: '4053101' }).catch(() => {});
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      expect(c.headers.get(B2BROUTER_HEADERS.apiKey)).toBe(KEY);
      expect(c.headers.get(B2BROUTER_HEADERS.apiVersion)).toBe(B2BROUTER_API_VERSION);
      expect(c.url.origin).toBe(B2BROUTER_HOSTS.production);
      expect(c.url.href).not.toContain(KEY);
    }
  });

  it('keeps a base path, and the key out of error messages', async () => {
    const calls: string[] = [];
    const adapter = createB2BrouterAdapter({
      apiKey: KEY,
      baseUrl: 'http://stand-in.test/b2brouter/',
      fetch: async (url) => {
        calls.push(String(url));
        return Response.json(
          { error: { code: 'invalid_api_key', message: 'Invalid API key' } },
          { status: 401, headers: { [B2BROUTER_HEADERS.requestId]: 'req_42' } },
        );
      },
    });
    const failure = await adapter.getStatus({ account: ACCOUNT, pdpRef: '7' }).catch((e) => e);
    expect(calls[0]).toBe('http://stand-in.test/b2brouter/invoices/7');
    expect(failure).toBeInstanceOf(PdpRequestError);
    expect(failure.status).toBe(401);
    expect(failure.message).toContain('invalid_api_key');
    expect(failure.message).toContain('req_42');
    expect(failure.message).not.toContain(KEY);
  });

  it('is unavailable when the network fails, on 5xx and on 429', async () => {
    const status = (respond: () => Response) =>
      fake(respond).adapter.getStatus({ account: ACCOUNT, pdpRef: '1' });
    await expect(
      status(() => {
        throw new TypeError('fetch failed');
      }),
    ).rejects.toBeInstanceOf(PdpUnavailableError);
    for (const code of [500, 502, 429]) {
      await expect(status(() => new Response('', { status: code }))).rejects.toBeInstanceOf(
        PdpUnavailableError,
      );
    }
  });

  it('is a request error for an unknown or malformed invoice id, or an unexpected body', async () => {
    const { adapter, calls } = fake(() => Response.json({ hello: 'world' }));
    await expect(adapter.getStatus({ account: ACCOUNT, pdpRef: 'inv_1' })).rejects.toMatchObject({
      status: 404,
    });
    expect(calls).toEqual([]);
    await expect(adapter.getStatus({ account: ACCOUNT, pdpRef: '1' })).rejects.toBeInstanceOf(
      PdpRequestError,
    );
  });
});

describe('B2Brouter sendInvoice', () => {
  it('imports without sending, then sends: one invoice, its reference', async () => {
    const { adapter, calls } = fake((c) => {
      if (c.route === `GET /accounts/${ACCOUNT}/invoices`) return list();
      if (c.route === `POST /accounts/${ACCOUNT}/invoices/import`) {
        return Response.json({ invoice: invoice() }, { status: 201 });
      }
      if (c.route === 'POST /invoices/send_invoice/4053101')
        return new Response(null, { status: 204 });
      return missing();
    });
    expect(await send(adapter)).toEqual({ outcome: 'deposited', pdpRef: '4053101' });
    const importCall = calls.find((c) => c.route.endsWith('/invoices/import'));
    expect(importCall?.url.searchParams.get('send_after_import')).toBe('false');
    expect(importCall?.url.searchParams.get('issued')).toBe('true');
    expect(importCall?.body).toBe(XML);
    expect(calls[0]?.url.searchParams.get('number')).toBe(NUMBER);
  });

  it('attaches the PDF view to a new import', async () => {
    const { adapter, calls } = fake((c) => {
      if (c.route === `GET /accounts/${ACCOUNT}/invoices`) return list();
      if (c.route.endsWith('/invoices/import'))
        return Response.json({ invoice: invoice() }, { status: 201 });
      if (c.route === 'POST /invoices/4053101/add_attachment')
        return Response.json({}, { status: 201 });
      return new Response(null, { status: 204 });
    });
    await send(adapter, XML, new Uint8Array([0x25, 0x50, 0x44, 0x46]));
    const attach = calls.find((c) => c.route.endsWith('/add_attachment'));
    expect(attach?.url.searchParams.get('filename')).toBe(`${NUMBER}.pdf`);
    expect(attach?.headers.get('content-type')).toBe('application/octet-stream');
  });

  it('reuses the invoice the platform already holds when its file is ours', async () => {
    const { adapter, calls } = fake((c) => {
      if (c.route === `GET /accounts/${ACCOUNT}/invoices`) {
        // The number filter is a prefix match: a longer number must not be taken for ours.
        return list(
          invoice({ id: 9, number: `${NUMBER}-2`, state: 'sent' }),
          invoice({ state: 'registered' }),
        );
      }
      if (c.route === 'GET /invoices/4053101/as/original') return new Response(XML);
      return missing();
    });
    expect(await send(adapter)).toEqual({ outcome: 'deposited', pdpRef: '4053101' });
    expect(calls.map((c) => c.method)).toEqual(['GET', 'GET']);
  });

  it('replaces a draft from an earlier attempt of a corrected invoice', async () => {
    const { adapter, calls } = fake((c) => {
      if (c.route === `GET /accounts/${ACCOUNT}/invoices`) return list(invoice({ id: 8 }));
      if (c.route === 'GET /invoices/8/as/original') return new Response(OTHER_XML);
      if (c.route === 'DELETE /invoices/8') return Response.json({ invoice: invoice({ id: 8 }) });
      if (c.route.endsWith('/invoices/import'))
        return Response.json({ invoice: invoice() }, { status: 201 });
      return new Response(null, { status: 204 });
    });
    expect(await send(adapter)).toEqual({ outcome: 'deposited', pdpRef: '4053101' });
    expect(calls.map((c) => c.route)).toContain('DELETE /invoices/8');
  });

  it('refuses calmly when the number belongs to another sent document', async () => {
    const { adapter, calls } = fake((c) => {
      if (c.route === `GET /accounts/${ACCOUNT}/invoices`) return list(invoice({ state: 'sent' }));
      if (c.route.endsWith('/as/original')) return new Response(OTHER_XML);
      return missing();
    });
    const result = await send(adapter);
    expect(result).toEqual({
      outcome: 'rejected',
      errors: [{ rule: B2BROUTER_RULES.numberTaken, message: expect.stringContaining(NUMBER) }],
    });
    expect(calls.some((c) => c.method === 'POST' || c.method === 'DELETE')).toBe(false);
  });

  it('finds its own import when the number appeared meanwhile (a lost answer)', async () => {
    let listed = 0;
    const { adapter } = fake((c) => {
      if (c.route === `GET /accounts/${ACCOUNT}/invoices`)
        return listed++ === 0 ? list() : list(invoice());
      if (c.route.endsWith('/invoices/import')) return error(422, 'parameter_taken');
      if (c.route.endsWith('/as/original')) return new Response(XML);
      if (c.route === 'POST /invoices/send_invoice/4053101')
        return new Response(null, { status: 204 });
      return missing();
    });
    expect(await send(adapter)).toEqual({ outcome: 'deposited', pdpRef: '4053101' });
  });

  it('passes on the platform refusal of an import, in French, one item per problem', async () => {
    const { adapter } = fake((c) => {
      if (c.route === `GET /accounts/${ACCOUNT}/invoices`) return list();
      return Response.json(
        { errors: ['BR-FR-01: SIREN invalide', 'BR-06: nom manquant'] },
        { status: 422 },
      );
    });
    const result = await send(adapter);
    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') return;
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toEqual({
      rule: B2BROUTER_RULES.platform,
      message: expect.stringMatching(
        /^La plateforme a refusé la facture : BR-FR-01: SIREN invalide\./,
      ),
    });
  });

  it('takes a refused send for a success once the invoice has left « new »', async () => {
    // What the platform says when the invoice is read after the refused send.
    const platform = (state: string) =>
      fake((c) => {
        if (c.route === `GET /accounts/${ACCOUNT}/invoices`) return list();
        if (c.route.endsWith('/invoices/import')) {
          return Response.json({ invoice: invoice() }, { status: 201 });
        }
        if (c.route.startsWith('POST /invoices/send_invoice/')) return error(422, 'invalid_state');
        if (c.route === 'GET /invoices/4053101')
          return Response.json({ invoice: invoice({ state }) });
        return missing();
      }).adapter;
    expect(await send(platform('new'))).toMatchObject({
      outcome: 'rejected',
      errors: [{ rule: 'invalid_state' }],
    });
    expect(await send(platform('sent'))).toEqual({ outcome: 'deposited', pdpRef: '4053101' });
  });

  it('is a request error for XML without a number', async () => {
    const { adapter, calls } = fake(() => missing());
    await expect(send(adapter, '<Invoice/>')).rejects.toBeInstanceOf(PdpRequestError);
    expect(calls).toEqual([]);
  });
});

describe('B2Brouter status mapping', () => {
  const at = (h: number) => `2026-10-18T${String(h).padStart(2, '0')}:00:00.000Z`;
  const event = (state: string, hour: number) => ({
    name: `invoice_${state}`,
    created_at: at(hour),
    invoice: { id: 1, state },
  });

  it('maps every documented state to statuses our state machine knows, oldest first', () => {
    for (const [state, path] of Object.entries(B2BROUTER_STATE_PATH)) {
      expect(pathOf(state)).toBe(path);
      if (path.length > 0) expect(path[0]).toBe('deposited');
    }
    expect(pathOf('annulled')).toBeNull();
    expect(pathOf('constructor')).toBeNull();
  });

  it('turns the current state into the history it proves, with the events’ times', () => {
    const steps = history(
      parsed({ id: 1, state: 'paid', created_at: at(8), state_updated_at: at(12) }),
      [event('registered', 10), event('sent', 9)].map((e) => B2bEvent.parse(e)),
      [],
    );
    expect(steps).toEqual([
      { id: '1:sent', status: 'deposited', raw: 'sent', at: at(9) },
      { id: '1:registered', status: 'received_by_platform', raw: 'registered', at: at(10) },
      { id: '1:paid', status: 'payment_received', raw: 'paid', at: at(12) },
    ]);
  });

  it('keeps times in order when events are missing or late', () => {
    const steps = history(
      parsed({ id: 1, state: 'read', created_at: at(8), state_updated_at: at(7) }),
      [B2bEvent.parse(event('registered', 11))],
      [],
    );
    expect(steps.map((s) => s.at)).toEqual([at(8), at(11), at(11)]);
  });

  it('carries the refusal reason and the transmission error', () => {
    const refused = history(
      parsed({ id: 1, state: 'refused', refuse_reason: 'Prix erroné', refuse_reason_code: 'PRI' }),
      [],
      [],
    );
    expect(refused.at(-1)).toMatchObject({
      status: 'refused',
      reason: { code: 'PRI', text: 'Prix erroné' },
    });
    const failed = history(
      parsed({ id: 1, state: 'error', error_message: 'PEPPOL_NO_RECEIVER' }),
      [],
      [],
    );
    expect(failed.map((s) => s.status)).toEqual(['deposited', 'rejected']);
    expect(failed.at(-1)?.reason).toEqual({
      code: 'PEPPOL_NO_RECEIVER',
      text: 'PEPPOL_NO_RECEIVER',
    });
  });

  it('adds a rejection the responses announce, and nothing for a draft', () => {
    const steps = history(
      parsed({ id: 1, state: 'registered' }),
      [],
      [{ event_name: 'invoice_rejected', received_at: at(15) }],
    );
    expect(steps.at(-1)).toMatchObject({ status: 'rejected', raw: 'invoice_rejected', at: at(15) });
    expect(history(parsed({ id: 1, state: 'new' }), [], [])).toEqual([]);
  });

  it('keeps an undocumented state raw, as « unknown »', () => {
    expect(history(parsed({ id: 1, state: 'annulled', updated_at: at(9) }), [], [])).toEqual([
      { id: '1:annulled', status: 'unknown', raw: 'annulled', at: at(9) },
    ]);
  });

  it('reads every page of events', async () => {
    const pages: string[] = [];
    const { adapter } = fake((c) => {
      if (c.route === 'GET /invoices/1')
        return Response.json({ invoice: invoice({ id: 1, state: 'sent' }) });
      if (c.route === '/invoices/1/responses' || c.route.endsWith('/responses')) {
        return Response.json({ responses: [] });
      }
      pages.push(c.url.searchParams.get('offset') ?? '');
      const offset = Number(c.url.searchParams.get('offset'));
      const events = Array.from({ length: offset === 0 ? 500 : 3 }, () => event('sent', 9));
      return Response.json({ events, total_count: 503 });
    });
    await adapter.getStatus({ account: ACCOUNT, pdpRef: '1' });
    expect(pages).toEqual(['0', '500']);
  });
});

describe('B2Brouter directory', () => {
  const company = {
    name: 'Client SA',
    cin_value: '200000008',
    invoice: { transport_type_code: 'peppol' },
  };

  it('retries the same request while it answers 202, and reads a wrapped entry', async () => {
    let n = 0;
    const { adapter, calls, slept } = fake(() =>
      n++ === 0
        ? Response.json({ status: 'processing', polling_url: 'x' }, { status: 202 })
        : Response.json({ external_company: company }),
    );
    expect(await adapter.lookupRecipient({ account: ACCOUNT, siren: '200000008' })).toEqual({
      siren: '200000008',
      name: 'Client SA',
      platform: 'peppol',
    });
    expect(calls.map((c) => c.route)).toEqual(Array(2).fill('GET /directory/fr/0002/200000008'));
    expect(slept).toEqual([250]);
  });

  it('answers null for an unknown company, a bad SIREN or one that cannot receive', async () => {
    for (const answer of [
      () => missing(),
      () => error(422, 'parameter_invalid'),
      () => error(424, 'incomplete_businesscard'),
    ]) {
      expect(
        await fake(answer).adapter.lookupRecipient({ account: ACCOUNT, siren: '1' }),
      ).toBeNull();
    }
  });

  it('is unavailable when the directory is down or never answers', async () => {
    await expect(
      fake(() => error(424, 'upstream_unavailable')).adapter.lookupRecipient({
        account: ACCOUNT,
        siren: '1',
      }),
    ).rejects.toBeInstanceOf(PdpUnavailableError);
    const pending = fake(() => Response.json({ status: 'processing' }, { status: 202 }));
    await expect(
      pending.adapter.lookupRecipient({ account: ACCOUNT, siren: '1' }),
    ).rejects.toBeInstanceOf(PdpUnavailableError);
    expect(pending.calls).toHaveLength(3);
  });
});

describe('B2Brouter payments, inbound and webhooks', () => {
  it('reports a payment in euros through /payments', async () => {
    const { adapter, calls } = fake(() => Response.json({ payment: { id: 1 } }, { status: 201 }));
    await adapter.reportPayment({ account: ACCOUNT, pdpRef: '4053101', amount: 12_050 });
    expect(calls[0]?.route).toBe(`POST /accounts/${ACCOUNT}/payments`);
    expect(JSON.parse(calls[0]?.body ?? '')).toEqual({
      payment: { invoice_id: 4053101, amount: 120.5 },
    });
  });

  it('lists received invoices from the day before, keeping only readable invoices', async () => {
    const { adapter, calls } = fake((c) => {
      if (c.route === `GET /accounts/${ACCOUNT}/invoices`) {
        return list(
          invoice({
            id: 5,
            type: 'ReceivedInvoice',
            state: 'received',
            created_at: '2026-10-18T07:00:00Z',
          }),
          invoice({ id: 6, type: 'ReceivedInvoice', state: 'received' }),
        );
      }
      if (c.route === 'GET /invoices/5/as/original') return new Response(XML);
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
    });
    const inbound = await adapter.listInbound({
      account: ACCOUNT,
      since: new Date('2026-10-18T06:00:00Z'),
    });
    expect(inbound).toEqual([{ pdpRef: '5', receivedAt: '2026-10-18T07:00:00Z', xml: XML }]);
    expect(calls[0]?.url.searchParams.get('type')).toBe('ReceivedInvoice');
    expect(calls[0]?.url.searchParams.get('updated_at_from')).toBe('2026-10-17');
  });

  it('verifies the signature only with a secret', () => {
    const body = JSON.stringify({
      code: 'issued_invoice.state_change',
      data: { account_id: 1, invoice_id: 2 },
    });
    const headers = new Headers({ [B2BROUTER_HEADERS.signature]: signWebhook(SECRET, body) });
    expect(fake(() => missing()).adapter.verifyWebhook({ headers, body })).toBe(true);
    expect(fake(() => missing(), { secret: false }).adapter.verifyWebhook({ headers, body })).toBe(
      false,
    );
  });

  it('reads the envelope and the flat body; ignores other events; refuses the rest', () => {
    const { adapter } = fake(() => missing());
    const notice = [{ account: '211', pdpRef: '4053101' }];
    expect(
      adapter.parseWebhook(
        JSON.stringify({
          code: 'issued_invoice.state_change',
          data: { account_id: 211, invoice_id: 4053101 },
        }),
      ),
    ).toEqual(notice);
    expect(
      adapter.parseWebhook(JSON.stringify({ account_id: 211, invoice_id: 4053101, state: 'sent' })),
    ).toEqual(notice);
    expect(
      adapter.parseWebhook(
        JSON.stringify({ code: 'received_invoice.new', data: { account_id: 211, invoice_id: 1 } }),
      ),
    ).toEqual([]);
    expect(() => adapter.parseWebhook('nope')).toThrow(PdpRequestError);
    expect(() =>
      adapter.parseWebhook(JSON.stringify({ code: 'issued_invoice.state_change', data: {} })),
    ).toThrow(PdpRequestError);
  });
});

describe('B2Brouter keys', () => {
  it('tells the environment from the key prefix', () => {
    expect(environmentOfKey('test_abc')).toBe('sandbox');
    expect(environmentOfKey('stag_abc')).toBe('staging');
    expect(environmentOfKey('prod_abc')).toBe('production');
  });

  it('refuses a key on the other B2Brouter host, without printing the key', () => {
    expect(keyProblem('test_abcdef', B2BROUTER_HOSTS.production)).toBeNull();
    expect(keyProblem('stag_abcdef', B2BROUTER_HOSTS.staging)).toBeNull();
    expect(keyProblem('test_abcdef', 'http://localhost:4010/b2brouter')).toBeNull();
    const problem = keyProblem('test_abcdef', B2BROUTER_HOSTS.staging);
    expect(problem).toMatch(/sandbox key/);
    expect(problem).not.toContain('abcdef');
    expect(keyProblem('prod_abcdef', `${B2BROUTER_HOSTS.staging}/`)).toMatch(/production key/);
  });
});
