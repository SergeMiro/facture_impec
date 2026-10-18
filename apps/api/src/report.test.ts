// The weekly report (plan §6 ReportAgent): the facts of the last 7 days on demand, and the e-mail to
// the owners once per ISO week from Monday 8:00 Paris.
import { addDays, isoWeekday, parisToday } from '@fi/core';
import type { Database } from '@fi/db';
import { eq, tenants, weeklyReports } from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runWeeklyReports, weekFacts } from './report';
import {
  deliveredInvoice,
  draft,
  fakeAdapter,
  newTenant,
  paris,
  testApi,
  testDatabase,
} from './test-helpers';

let database: Database;
let api: ReturnType<typeof testApi>;
let clock = new Date();

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: fakeAdapter() }, undefined, { now: () => clock });
});
afterAll(async () => {
  await database.close();
});

async function tenantRow(id: string) {
  const [row] = await database.db.select().from(tenants).where(eq(tenants.id, id));
  if (!row) throw new Error('gone');
  return row;
}

describe('weekly report', () => {
  it('counts what left, what was paid, what is late or due soon, and what waits for the user', async () => {
    clock = new Date();
    const t = await newTenant(api.request);
    await deliveredInvoice(
      api,
      t,
      draft(1, (d) => {
        d.dueDate = addDays(parisToday(), 3);
      }),
    );
    const paid = await deliveredInvoice(api, t, draft(2));
    await api.request(`/invoices/${paid.id}/payment`, {
      method: 'POST',
      token: t.apiKey,
      body: {},
    });
    await api.request('/invoices', { method: 'POST', token: t.apiKey, body: { draft: draft(3) } });

    const facts = await weekFacts(api.deps, await tenantRow(t.id), clock);
    expect(facts).toMatchObject({
      sent: { count: 2 },
      paid: { count: 1 },
      overdue: { count: 0, amount: 0 },
      atRisk: { count: 1 },
      toSend: 1,
      toFix: 0,
      refusals: [],
    });
    expect(facts.sent.amount).toBeGreaterThan(0);

    const res = await api.request('/report', { token: t.apiKey });
    expect(res.status).toBe(200);
    const report = (await res.json()) as { numbers: string[]; actions: string[]; text: string };
    expect(report.numbers[0]).toMatch(/^Envoyées : 2 facture\(s\)/);
    expect(report.actions).toEqual(['Envoyez 1 facture(s) prête(s).']);
  });

  it('mails the owners once per week, from Monday 8:00 Paris', async () => {
    const today = parisToday();
    const monday = addDays(today, 8 - isoWeekday(today));
    clock = new Date();
    const t = await newTenant(api.request, { ownerEmail: 'gerant@atelier-dupont.test' });
    const mails = () => api.mailer.sent.filter((m) => m.to === 'gerant@atelier-dupont.test');

    clock = paris(monday, 7);
    expect(await runWeeklyReports(api.deps)).toBe(0);
    clock = paris(monday, 8);
    await runWeeklyReports(api.deps);
    clock = paris(addDays(monday, 2), 15);
    await runWeeklyReports(api.deps);
    expect(mails()).toHaveLength(1);
    expect(mails()[0]?.subject).toMatch(/^Votre semaine avec Facture Impec/);
    const claimed = await database.db
      .select()
      .from(weeklyReports)
      .where(eq(weeklyReports.tenantId, t.id));
    expect(claimed).toMatchObject([{ recipients: 1 }]);

    // The next week, again once; a deployment without mail sends nothing.
    clock = paris(addDays(monday, 7), 9);
    expect(await runWeeklyReports({ ...api.deps, mailer: null })).toBe(0);
    await runWeeklyReports(api.deps);
    expect(mails()).toHaveLength(2);
  });
});
