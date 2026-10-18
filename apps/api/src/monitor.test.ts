// The MonitorAgent job (plan §6 phase 7): one note of advice per rejection or refusal, queued by the
// send and sync jobs and by the sweep, shown on the fiche while the invoice waits for the user.
import type { Database } from '@fi/db';
import { and, eq, invoiceEvents } from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { awaitingAdvice, runMonitor } from './monitor';
import {
  deliveredInvoice,
  draft,
  fakeAdapter,
  newTenant,
  recordedJobs,
  runSend,
  runSync,
  testApi,
  testDatabase,
  type WorkerDeps,
} from './test-helpers';
import { runSweep } from './workers';

let database: Database;
let api: ReturnType<typeof testApi>;

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: fakeAdapter() });
});
afterAll(async () => {
  await database.close();
});

const worker = (adapter = fakeAdapter(), jobs = recordedJobs()): WorkerDeps => ({
  db: database.db,
  pdp: { mock: adapter },
  test: null,
  jobs,
  ai: api.deps.ai,
  mailer: null,
  now: () => new Date(),
});

const advice = (id: string) =>
  database.db
    .select()
    .from(invoiceEvents)
    .where(and(eq(invoiceEvents.invoiceId, id), eq(invoiceEvents.event, 'monitor')));

interface Detail {
  nextStep: { proposal: string | null; rules: string[]; draft: { to: string } | null } | null;
}
const detail = async (apiKey: string, id: string) =>
  (await (await api.request(`/invoices/${id}`, { token: apiKey })).json()) as Detail;

describe('MonitorAgent job', () => {
  it('advises once after a platform rejection: correct the rules it names, then send again', async () => {
    const t = await newTenant(api.request);
    const res = await api.request('/invoices', {
      method: 'POST',
      token: t.apiKey,
      body: { draft: draft(1) },
    });
    const { id } = (await res.json()) as { id: string };
    await api.request(`/invoices/${id}/send`, { method: 'POST', token: t.apiKey });
    const jobs = recordedJobs();
    const rejecting = fakeAdapter({
      sendInvoice: async () => ({
        outcome: 'rejected',
        errors: [{ rule: 'BR-FR-12', message: 'BR-FR-12 : SIREN du vendeur absent' }],
      }),
    });
    await runSend(worker(rejecting, jobs), id);
    expect(jobs.monitors).toEqual([id]);
    expect(await awaitingAdvice(worker())).toContain(id);

    await runMonitor(worker(), id);
    await runMonitor(worker(), id);
    const notes = await advice(id);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.payload).toMatchObject({
      proposal: 'fix_and_resend',
      rules: ['BR-FR-12'],
      source: 'rules',
      draft: null,
    });
    expect(await awaitingAdvice(worker())).not.toContain(id);
    expect((await detail(t.apiKey, id)).nextStep).toMatchObject({ proposal: 'fix_and_resend' });
  });

  it('answers a customer refusal with a calm draft to the customer when the AI is off', async () => {
    const t = await newTenant(api.request);
    const { id, pdpRef } = await deliveredInvoice(
      api,
      t,
      draft(1, (d) => {
        d.buyer.contact = { email: 'compta@boulangerie-martin.test' };
      }),
    );
    expect((await detail(t.apiKey, id)).nextStep).toBeNull();
    const jobs = recordedJobs();
    const refusal = {
      id: `${pdpRef}_3`,
      status: 'refused' as const,
      raw: 'Refusée',
      at: new Date().toISOString(),
      reason: { code: 'CMD_ERR', text: 'Numéro de commande manquant' },
    };
    await runSync(worker(fakeAdapter({ getStatus: async () => [refusal] }), jobs), {
      provider: 'mock',
      account: t.account,
      pdpRef,
    });
    expect(jobs.monitors).toEqual([id]);

    // The job was lost: the sweep finds the refusal without advice.
    const swept = recordedJobs();
    await runSweep(worker(fakeAdapter(), swept));
    expect(swept.monitors).toContain(id);
    await runMonitor(worker(), id);
    const [note] = await advice(id);
    expect(note?.payload).toMatchObject({
      kind: 'refusal',
      proposal: null,
      source: 'rules',
      draft: { to: 'compta@boulangerie-martin.test' },
    });
    expect(JSON.stringify(note?.payload)).toContain('Numéro de commande manquant');
    expect((await detail(t.apiKey, id)).nextStep?.draft).toMatchObject({
      to: 'compta@boulangerie-martin.test',
    });
  });
});
