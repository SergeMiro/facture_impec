// Runs one scenario as a client would: HTTP to the API (admin, then tenant key), HTTP to the mock's
// control endpoints, then checks the end state on both sides.
import type { InvoiceState } from '@fi/core';
import { MOCK_HEADERS, MockInvoice } from '@fi/pdp-adapter';
import { z } from 'zod';
import { SCENARIO_SELLER, scenarioDraft } from './invoice';
import type { Scenario } from './scenario';

export interface Endpoints {
  apiUrl: string;
  mockUrl: string;
  adminToken: string;
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
  failures: string[];
}

const Summary = z.object({ id: z.string(), number: z.string().nullable(), status: z.string() });
const Detail = Summary.extend({
  issues: z.array(z.object({ ruleId: z.string(), severity: z.string(), messageFr: z.string() })),
  events: z.array(
    z.object({
      type: z.string(),
      event: z.string().nullable(),
      toStatus: z.string().nullable(),
      actor: z.string(),
    }),
  ),
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
    body: JSON.stringify({ ...SCENARIO_SELLER, pdpProvider: 'mock', pdpAccount: account }),
  });
  const api = <T>(schema: z.ZodType<T>, path: string, init: RequestInit = {}) =>
    call(schema, `${at.apiUrl}${path}`, { ...init, token: apiKey });

  // Create: each invoice `repeat.create` times at once; every answer must be the same invoice.
  const ids: string[] = [];
  for (let i = 1; i <= scenario.invoices; i++) {
    const body = JSON.stringify({ draft: scenarioDraft(i) });
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

  // Wait for every invoice to reach the expected status.
  const deadline = started + (scenario.expect.withinSeconds + 15) * 1000;
  let seconds = Number.NaN;
  let last = '';
  while (performance.now() < deadline) {
    const { invoices } = await api(List, `/invoices?limit=200`);
    const mine = invoices.filter((i) => ids.includes(i.id));
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

  const invoices: InvoiceOutcome[] = [];
  for (const id of ids) {
    const detail = await api(Detail, `/invoices/${id}`);
    const number = detail.number ?? id;
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
    failures,
  };
}
