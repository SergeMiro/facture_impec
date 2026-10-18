// HTTP face of the mock platform (plan §3). The protocol is shared with the adapter in
// @fi/pdp-adapter/src/mock/protocol.ts.
import { MOCK_HEADERS, MockControl, MockScenario } from '@fi/pdp-adapter';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import { B2BrouterStandIn, type B2BrouterStandInOptions } from './b2brouter';
import {
  type EngineOptions,
  MockConflict,
  MockNotFound,
  MockPdpEngine,
  MockUnavailable,
  MockUnreadable,
} from './engine';

const Payment = z.object({ amount: z.number().int().nonnegative() });

async function json(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return undefined;
  }
}

function account(c: Context): string {
  const value = c.req.header(MOCK_HEADERS.account);
  if (!value) throw new MissingAccount();
  return value;
}

class MissingAccount extends Error {}
class BadRequest extends Error {}

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new BadRequest(z.prettifyError(result.error));
  return result.data;
}

export function createApp(
  engine = new MockPdpEngine({ webhookSecret: 'local-mock-pdp-webhook-secret' }),
) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof MissingAccount)
      return c.json({ error: `missing ${MOCK_HEADERS.account}` }, 401);
    if (err instanceof BadRequest) return c.json({ error: err.message }, 400);
    if (err instanceof MockNotFound) return c.json({ error: err.message }, 404);
    if (err instanceof MockConflict) return c.json({ error: err.message }, 409);
    if (err instanceof MockUnreadable) return c.json({ error: err.message }, 422);
    if (err instanceof MockUnavailable) return c.json({ error: 'unavailable' }, 503);
    throw err;
  });

  app.get('/health', (c) => c.json({ ok: true, service: 'mock-pdp' }));

  app.post('/invoices', async (c) => {
    const xml = await c.req.text();
    if (!xml.trim()) throw new BadRequest('empty body: send the invoice XML');
    const key = c.req.header(MOCK_HEADERS.idempotencyKey);
    const { response, created } = engine.deposit(account(c), xml, key);
    if (response.status === 'rejected') return c.json(response, 422);
    return c.json(response, created ? 201 : 200);
  });

  app.get('/invoices', (c) => c.json(engine.list(account(c), c.req.query('number'))));

  app.get('/invoices/:id/status', (c) => c.json(engine.status(account(c), c.req.param('id'))));

  app.post('/invoices/:id/payments', async (c) => {
    parse(Payment, await json(c));
    return c.json(engine.reportPayment(account(c), c.req.param('id')), 201);
  });

  app.post('/scenarios/:id', async (c) =>
    c.json(engine.force(c.req.param('id'), parse(MockScenario, await json(c)))),
  );

  app.post('/inbound', async (c) => c.json(engine.inject(account(c), await c.req.text()), 201));

  app.get('/inbound', (c) => {
    const since = new Date(c.req.query('since') ?? 0);
    if (Number.isNaN(since.getTime())) throw new BadRequest('since must be an ISO date-time');
    return c.json(engine.listInbound(account(c), since));
  });

  app.get('/directory/:siren', (c) => {
    account(c);
    const found = engine.lookup(c.req.param('siren'));
    return found ? c.json(found) : c.json({ error: 'unknown SIREN' }, 404);
  });

  app.get('/control', (c) => c.json(engine.control));
  app.put('/control', async (c) => c.json(engine.setControl(parse(MockControl, await json(c)))));
  app.post('/control/reset', (c) => {
    engine.reset();
    return c.body(null, 204);
  });

  return app;
}

export interface MockPdpOptions extends EngineOptions {
  /** B2Brouter's API over the same engine, at /b2brouter (./b2brouter.ts). */
  b2brouter?: Omit<B2BrouterStandInOptions, 'webhookSecret'> & { webhookSecret?: string };
}

export function createMockPdp(options: MockPdpOptions) {
  const { b2brouter: standIn, ...engineOptions } = options;
  const engine = new MockPdpEngine(engineOptions);
  const app = createApp(engine);
  const b2brouter = new B2BrouterStandIn(engine, {
    ...standIn,
    webhookSecret: standIn?.webhookSecret ?? options.webhookSecret,
  });
  app.route('/b2brouter', b2brouter.app);
  return { engine, app, b2brouter };
}
