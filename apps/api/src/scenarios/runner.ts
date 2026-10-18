// Runs one scenario as a client would: HTTP to the API (admin, then tenant key), HTTP to the mock's
// control endpoints, then checks the end state on both sides (and the chasing, for `chase`).
import { addDays, type InvoiceState, parisToday } from '@fi/core';
import type { PdpProvider } from '@fi/db';
import { MOCK_HEADERS, MockInvoice } from '@fi/pdp-adapter';
import { z } from 'zod';
import { ChaseView, checkChase, OutboxMail, planEnded } from './chase';
import { SCENARIO_SELLER, scenarioDraft } from './invoice';
import type { Scenario } from './scenario';

export interface Endpoints {
  /** The adapter the scenario's company uses (default the mock's); both reach the same engine. */
  provider?: PdpProvider;
  apiUrl: string;
  mockUrl: string;
  adminToken: string;
  /** Chasing: the API's clock starts running at the platform's speed (Stack.startBusinessClock). */
  startBusinessClock?: () => void;
}

export interface InvoiceOutcome {
  number: string;
  status: InvoiceState;
  /** Invoices the platform holds under this number. */
  deposits: number;
  /** `deposited` transitions on our timeline. */
  depositedTransitions: number;
  timeline: string[];
}

export interface ScenarioReport {
  name: string;
  description: string;
  ok: boolean;
  /** From the first « Envoyer » until every invoice reached the expected status. */
  seconds: number;
  expected: Scenario['expect'];
  invoices: InvoiceOutcome[];
  /** One line per chasing step, for `chase` scenarios. */
  chase: string[];
  failures: string[];
}

const Summary = z.object({ id: z.string(), number: z.string().nullable(), status: z.string() });
const Detail = Summary.extend({
  dueDate: z.string().nullable(),
  issues: z.array(z.object({ ruleId: z.string(), severity: z.string(), messageFr: z.string() })),
  events: z.array(
    z.object({
      type: z.string(),
      event: z.string().nullable(),
      toStatus: z.string().nullable(),
      actor: z.string(),
      at: z.string(),
      payload: z.unknown(),
    }),
  ),
  chase: ChaseView,
});
const List = z.object({ invoices: z.array(Summary) });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function call<T>(
  schema: z.ZodType<T>,
  url: string,
  init: RequestInit & { token?: string; account?: string } = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  if (init.account) headers.set(MOCK_HEADERS.account, init.account);
  if (init.body) headers.set('content-type', 'application/json');
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${url} → ${res.status} ${text}`);
  return schema.parse(text ? JSON.parse(text) : null);
}

export async function runScenario(
  name: string,
  scenario: Scenario,
  at: Endpoints,
  log: (line: string) => void = () => {},
): Promise<ScenarioReport> {
  const failures: string[] = [];
  const account = `${SCENARIO_SELLER.siren}-${name}`;

  await call(z.unknown(), `${at.mockUrl}/control/reset`, { method: 'POST' });
  await call(z.unknown(), `${at.mockUrl}/control`, {
    method: 'PUT',
    body: JSON.stringify(scenario.platform),
  });
  const { apiKey } = await call(z.object({ apiKey: z.string() }), `${at.apiUrl}/admin/tenants`, {
    method: 'POST',
    token: at.adminToken,
    body: JSON.stringify({
      ...SCENARIO_SELLER,
      pdpProvider: at.provider ?? 'mock',
      pdpAccount: account,
    }),
  });
  const api = <T>(schema: z.ZodType<T>, path: string, init: RequestInit = {}) =>
    call(schema, `${at.apiUrl}${path}`, { ...init, token: apiKey });
  const { chase } = scenario;
  if (chase) {
    await api(z.unknown(), '/settings', { method: 'PATCH', body: JSON.stringify(chase.settings) });
  }

  // Create: each invoice `repeat.create` times at once; every answer must be the same invoice.
  const ids: string[] = [];
  for (let i = 1; i <= scenario.invoices; i++) {
    const draft = scenarioDraft(i);
    if (chase) {
      draft.dueDate = addDays(parisToday(), chase.dueInDays);
      draft.buyer.contact = { ...draft.buyer.contact, email: chase.customerEmail };
    }
    const body = JSON.stringify({ draft });
    const answers = await Promise.all(
      Array.from({ length: scenario.repeat.create }, () =>
        api(Detail, '/invoices', { method: 'POST', body }),
      ),
    );
    const first = answers[0];
    if (!first) throw new Error('no answer');
    if (new Set(answers.map((a) => a.id)).size !== 1) {
      failures.push(`${first.number}: created ${new Set(answers.map((a) => a.id)).size} times`);
    }
    if (first.status !== 'validated') {
      const errors = first.issues.filter((x) => x.severity === 'error').map((x) => x.ruleId);
      throw new Error(`${first.number} did not validate: ${errors.join(', ')}`);
    }
    ids.push(first.id);
  }
  log(`[${name}] ${ids.length} invoice(s) created and validated`);

  // Send: « Envoyer » `repeat.send` times at once on every invoice.
  const started = performance.now();
  await Promise.all(
    ids.flatMap((id) =>
      Array.from({ length: scenario.repeat.send }, () =>
        api(z.unknown(), `/invoices/${id}/send`, { method: 'POST' }),
      ),
    ),
  );

  // Wait for every invoice to reach the expected status. Chasing counts days from the moment every
  // invoice has reached the customer: the queues' real-time delays before that are not business days.
  const SENT = ['validated', 'ready_to_send', 'sending', 'deposited'];
  let clockStarted = false;
  const deadline = started + (scenario.expect.withinSeconds + 15) * 1000;
  let seconds = Number.NaN;
  let last = '';
  while (performance.now() < deadline) {
    const { invoices } = await api(List, `/invoices?limit=200`);
    const mine = invoices.filter((i) => ids.includes(i.id));
    if (chase && !clockStarted && mine.every((i) => !SENT.includes(i.status))) {
      at.startBusinessClock?.();
      clockStarted = true;
      log(`[${name}] at the customer: business clock runs`);
    }
    const done = mine.filter((i) => i.status === scenario.expect.status).length;
    const progress = `${done}/${ids.length} ${scenario.expect.status}`;
    if (progress !== last)
      log(`[${name}] ${progress} after ${((performance.now() - started) / 1000).toFixed(1)} s`);
    last = progress;
    if (done === ids.length) {
      seconds = (performance.now() - started) / 1000;
      break;
    }
    await sleep(200);
  }

  // The chasing run that follows the payment ends each plan.
  const details = async () => Promise.all(ids.map((id) => api(Detail, `/invoices/${id}`)));
  if (chase) {
    const until = performance.now() + 5_000;
    while (performance.now() < until && !(await details()).every((d) => planEnded(d.chase))) {
      await sleep(100);
    }
  }

  const invoices: InvoiceOutcome[] = [];
  const chaseLines: string[] = [];
  const outbox = chase
    ? (
        await call(z.object({ mails: z.array(OutboxMail) }), `${at.apiUrl}/admin/outbox`, {
          token: at.adminToken,
        })
      ).mails
    : [];
  for (const detail of await details()) {
    const number = detail.number ?? detail.id;
    const held = await call(
      z.array(MockInvoice),
      `${at.mockUrl}/invoices?number=${encodeURIComponent(number)}`,
      { account },
    );
    const transitions = detail.events.filter((e) => e.type === 'transition');
    invoices.push({
      number,
      status: detail.status as InvoiceState,
      deposits: held.length,
      depositedTransitions: transitions.filter((e) => e.event === 'deposited').length,
      timeline: transitions.map((e) => e.toStatus ?? '?'),
    });
    if (chase) {
      const checked = checkChase(
        { number, dueDate: detail.dueDate ?? '', events: detail.events, chase: detail.chase },
        chase,
        outbox,
      );
      chaseLines.push(...checked.lines.map((l) => `${number} ${l}`));
      failures.push(...checked.failures);
    }
  }

  const want = scenario.expect;
  for (const i of invoices) {
    if (i.status !== want.status)
      failures.push(`${i.number}: ${i.status}, expected ${want.status}`);
    if (i.deposits !== want.depositsPerInvoice) {
      failures.push(
        `${i.number}: ${i.deposits} deposit(s) at the platform, expected ${want.depositsPerInvoice}`,
      );
    }
    const wantTransitions = want.depositsPerInvoice > 0 ? 1 : 0;
    if (i.depositedTransitions !== wantTransitions) {
      failures.push(
        `${i.number}: ${i.depositedTransitions} deposited transition(s), expected ${wantTransitions}`,
      );
    }
  }
  if (!(seconds <= want.withinSeconds)) {
    failures.push(
      Number.isNaN(seconds)
        ? `not every invoice reached ${want.status}`
        : `took ${seconds.toFixed(1)} s, limit ${want.withinSeconds} s`,
    );
  }
  return {
    name,
    description: scenario.description,
    ok: failures.length === 0,
    seconds,
    expected: want,
    invoices,
    chase: chaseLines,
    failures,
  };
}
