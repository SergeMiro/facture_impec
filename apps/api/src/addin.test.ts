// The add-in's routes (plan §5 screens 2–4, §3 Mode test): detection, mappings, sheet sync, the
// fiche facture's help (explain, rehearsal, PDF) and the scenario panel, against a scripted platform.
import { detectMapping, type GridCell, grid, type SheetMapping } from '@fi/core';
import type { Database } from '@fi/db';
import { agentRuns, asc, eq, invoiceEvents, invoices } from '@fi/db';
import type {
  PdpReason,
  PdpStatusEvent,
  ScenarioInput,
  ScenarioPort,
  SendInput,
} from '@fi/pdp-adapter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TestPlatform } from './deps';
import { draft, fakeAdapter, newTenant, recordedJobs, testApi, testDatabase } from './test-helpers';
import type { RowStatus, SyncResult } from './workbooks';
import { runSend, runSync, type WorkerDeps } from './workers';

const HEADER: GridCell[] = [
  'N° Facture',
  'Date',
  'Client',
  'SIREN',
  'Désignation',
  'Qté',
  'P.U. HT',
  'TVA',
  'Total TTC',
  'Adresse',
  'Code postal',
  'Ville',
];
const row = (number: string, siren: string | null, price = 450): GridCell[] => [
  number,
  { v: 46310, t: '15/10/2026', f: 'dd/mm/yyyy' },
  'Boulangerie Martin SAS',
  siren,
  'Journée de conseil',
  3,
  price,
  { v: 0.2, t: '20%', f: '0%' },
  price * 3 * 1.2,
  '8 place du Marché',
  '21000',
  'Dijon',
];
const sheet = (...rows: GridCell[][]) =>
  grid('Factures', [['Mes factures 2026'], [], HEADER, ...rows]);
const SHEET = sheet(row('F2026-0042', '200 000 008'), row('F2026-0043', '200000008', 1200));
const MAPPING: SheetMapping = detectMapping(SHEET);
const WORKBOOK = 'wb-0123456789';

const SELLER = {
  vatId: 'FR88100000009',
  address: { line1: '12 rue des Lilas', city: 'Dijon', postCode: '21000', country: 'FR' },
};
const DEFAULTS = {
  siret: '10000000900017',
  iban: 'FR7630006000011234567890189',
  paymentDays: 30,
  operationCategory: 'services',
};

/** A test platform in memory: deposits, a directory, and scenarios when `scenarios` is on. */
function platform() {
  const sent: SendInput[] = [];
  const forced: ScenarioInput[] = [];
  const events = new Map<string, PdpStatusEvent[]>();
  let n = 0;
  const push = (pdpRef: string, status: PdpStatusEvent['status'], reason?: PdpReason) => {
    const list = events.get(pdpRef) ?? [];
    list.push({
      id: `${pdpRef}-${list.length}`,
      status,
      raw: status,
      at: new Date().toISOString(),
      ...(reason && { reason }),
    });
    events.set(pdpRef, list);
  };
  const adapter = fakeAdapter({
    sendInvoice: async (input) => {
      sent.push(input);
      const pdpRef = `inv_${++n}`;
      push(pdpRef, 'deposited');
      return { outcome: 'deposited', pdpRef };
    },
    getStatus: async ({ pdpRef }) => events.get(pdpRef) ?? [],
    lookupRecipient: async ({ siren }) => (siren === '200000008' ? { siren } : null),
  });
  const scenarios: ScenarioPort = {
    async force(input) {
      forced.push(input);
      if (!input.after) push(input.pdpRef, input.status, input.reason);
    },
  };
  return { adapter, scenarios, sent, forced, events };
}

let database: Database;
let pdp: ReturnType<typeof platform>;
let api: ReturnType<typeof testApi>;
let request: ReturnType<typeof testApi>['request'];

beforeAll(async () => {
  database = await testDatabase();
  pdp = platform();
  api = testApi(database, { mock: pdp.adapter }, undefined, {
    test: { provider: 'mock', scenarios: pdp.scenarios },
  });
  ({ request } = api);
});
afterAll(async () => {
  await database.close();
});

interface ErrorBody {
  error: { code: string; message: string };
}

async function tenant() {
  const t = await newTenant(request, SELLER);
  const res = await request('/settings', {
    method: 'PATCH',
    token: t.apiKey,
    body: { invoiceDefaults: DEFAULTS },
  });
  expect(res.status).toBe(200);
  return t;
}

async function sync(apiKey: string, body: Record<string, unknown>, req = request) {
  const res = await req(`/workbooks/${WORKBOOK}/sync`, {
    method: 'POST',
    token: apiKey,
    body: { snapshot: SHEET, mapping: MAPPING, ...body },
  });
  return { status: res.status, body: (await res.json()) as SyncResult & ErrorBody };
}

const first = (result: SyncResult): RowStatus => {
  const r = result.rows[0];
  if (!r) throw new Error('no row');
  return r;
};

const worker = (test: TestPlatform | null = api.deps.test): WorkerDeps => ({
  db: database.db,
  pdp: { mock: pdp.adapter },
  test,
  jobs: recordedJobs(),
  ai: api.deps.ai,
  mailer: null,
  now: () => new Date(),
});

/** A test invoice deposited on the test platform. */
async function depositedTestInvoice() {
  const t = await tenant();
  const id = first((await sync(t.apiKey, { test: true })).body).invoiceId ?? '';
  expect((await request(`/invoices/${id}/send`, { method: 'POST', token: t.apiKey })).status).toBe(
    202,
  );
  await runSend(worker(), id);
  return { ...t, id };
}

const status = async (id: string) =>
  (await database.db.select().from(invoices).where(eq(invoices.id, id)))[0];

describe('detection and mappings', () => {
  it('proposes a mapping from the headers when the assistant is off', async () => {
    const t = await tenant();
    const res = await request('/detect', {
      method: 'POST',
      token: t.apiKey,
      body: { snapshot: SHEET },
    });
    const body = (await res.json()) as { mapping: SheetMapping; degraded: string };
    expect(body.degraded).toBe('ai_off');
    expect(body.mapping).toMatchObject({ sheet: 'Factures', headerRow: 3, source: 'heuristic' });
    expect(body.mapping.mapping.buyerSiren).toMatchObject({ column: 'D' });
  });

  it('keeps the confirmed mapping per workbook and sheet', async () => {
    const t = await tenant();
    const path = `/workbooks/${WORKBOOK}/mappings/Factures`;
    const missing = await request(path, { token: t.apiKey });
    expect(missing.status).toBe(404);
    expect(((await missing.json()) as ErrorBody).error.code).toBe('mapping_not_found');
    const mapping = { ...MAPPING, source: 'user' };
    expect(
      (await request(path, { method: 'PUT', token: t.apiKey, body: { mapping } })).status,
    ).toBe(200);
    const saved = await request(path, { token: t.apiKey });
    expect(((await saved.json()) as { mapping: SheetMapping }).mapping).toEqual(mapping);
    const wrongSheet = await request(`/workbooks/${WORKBOOK}/mappings/Autre`, {
      method: 'PUT',
      token: t.apiKey,
      body: { mapping },
    });
    expect(wrongSheet.status).toBe(400);
    expect((await request('/workbooks/x/mappings/Factures', { token: t.apiKey })).status).toBe(400);
    // Another tenant does not see it.
    const other = await tenant();
    expect((await request(path, { token: other.apiKey })).status).toBe(404);
  });
});

describe('sheet sync', () => {
  it('turns each row into an invoice and answers its FI_Statut / FI_Détail', async () => {
    const t = await tenant();
    const { body } = await sync(t.apiKey, {});
    expect(body.rows).toHaveLength(2);
    expect(first(body)).toMatchObject({
      rowKey: 'F2026-0042',
      rows: [4],
      number: 'F2026-0042',
      isTest: false,
      status: 'validated',
      label: 'Vérifiée',
      tone: 'ok',
      errors: 0,
    });
    // Synced again: the same invoices, not new ones.
    const again = await sync(t.apiKey, {});
    expect(again.body.rows.map((r) => r.invoiceId)).toEqual(body.rows.map((r) => r.invoiceId));
    const [stored] = await database.db
      .select()
      .from(invoices)
      .where(eq(invoices.id, first(body).invoiceId ?? ''));
    expect(stored?.excelBinding).toMatchObject({
      workbookId: WORKBOOK,
      sheet: 'Factures',
      rowKey: 'F2026-0042',
      cells: { 'buyer.legalId.id': 'Factures!D4' },
    });
  });

  it('shows the first error and points at its cell, then follows the sheet once fixed', async () => {
    const t = await tenant();
    const broken = sheet(row('F2026-0042', null));
    const res = await sync(t.apiKey, { snapshot: broken });
    const r = first(res.body);
    expect(r).toMatchObject({ status: 'needs_fix', tone: 'error' });
    expect(r.errors).toBeGreaterThan(0);
    expect(r.detail).toMatch(/erreur\(s\) à corriger\. D'abord : /);
    const fixed = first(
      (await sync(t.apiKey, { snapshot: sheet(row('F2026-0042', '200000008')) })).body,
    );
    expect(fixed).toMatchObject({ invoiceId: r.invoiceId, status: 'validated' });
  });

  it('never changes an invoice that has left, whatever the sheet says now', async () => {
    const t = await tenant();
    const id = first((await sync(t.apiKey, {})).body).invoiceId ?? '';
    await request(`/invoices/${id}/send`, { method: 'POST', token: t.apiKey });
    const changed = sheet(row('F2026-0042', '200000008', 999));
    const r = first((await sync(t.apiKey, { snapshot: changed })).body);
    expect(r).toMatchObject({ invoiceId: id, status: 'ready_to_send', tone: 'progress' });
    expect(r.detail).toContain('Déjà transmise');
    expect((await status(id))?.payable).toBe(162000);
  });

  it('keeps test invoices apart: TEST- numbers, own rows, consent needed', async () => {
    const t = await tenant();
    const real = first((await sync(t.apiKey, {})).body);
    const test = first((await sync(t.apiKey, { test: true })).body);
    expect(test).toMatchObject({ number: 'TEST-F2026-0042', isTest: true, status: 'validated' });
    expect(test.invoiceId).not.toBe(real.invoiceId);

    await request('/settings', {
      method: 'PATCH',
      token: t.apiKey,
      body: { sandboxEnabled: false },
    });
    const refused = await sync(t.apiKey, { test: true });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe('test_mode_disabled');
    const created = await request('/invoices', {
      method: 'POST',
      token: t.apiKey,
      body: { draft: draft(7), test: true },
    });
    expect(created.status).toBe(403);

    const noPlatform = testApi(database, { mock: pdp.adapter }, undefined, { test: null });
    const other = await tenant();
    const missing = await sync(other.apiKey, { test: true }, noPlatform.request);
    expect(missing.status).toBe(409);
    expect(missing.body.error.code).toBe('test_platform_missing');
  });
});

describe('fiche facture', () => {
  it('explains the issues with the cell to fix, in standard wording when the AI is off', async () => {
    const t = await tenant();
    const id = first(
      (await sync(t.apiKey, { snapshot: sheet(row('F2026-0042', null)) })).body,
    ).invoiceId;
    const res = await request(`/invoices/${id}/explain`, { method: 'POST', token: t.apiKey });
    const body = (await res.json()) as {
      explanations: { ruleId: string; cell: string | null; source: string }[];
      degraded: string;
      note: string;
    };
    expect(body.degraded).toBe('ai_off');
    expect(body.note).toContain('assistant est désactivé');
    expect(body.explanations.length).toBeGreaterThan(0);
    expect(body.explanations.every((e) => e.source === 'rules')).toBe(true);
    expect(body.explanations.some((e) => e.cell === 'Factures!D4')).toBe(true);
  });

  it('serves the Factur-X PDF', async () => {
    const t = await tenant();
    const id = first((await sync(t.apiKey, {})).body).invoiceId;
    const res = await request(`/invoices/${id}/pdf`, { token: t.apiKey });
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('F2026-0042.pdf');
    expect(new TextDecoder().decode((await res.arrayBuffer()).slice(0, 5))).toBe('%PDF-');
  });

  it('rehearses: « Prêt à envoyer » after a simulated rejection came back on a TEST-R copy', async () => {
    const t = await tenant();
    const id = first((await sync(t.apiKey, { test: true })).body).invoiceId ?? '';
    const sentBefore = pdp.sent.length;
    const res = await request(`/invoices/${id}/rehearse`, { method: 'POST', token: t.apiKey });
    const body = (await res.json()) as {
      ready: boolean;
      summary: string;
      checklist: { item: string; ok: boolean; detail: string | null }[];
    };
    expect(body.checklist.filter((c) => !c.ok)).toEqual([]);
    expect(body).toMatchObject({ ready: true, summary: 'Prêt à envoyer' });
    expect(body.checklist.map((c) => c.item)).toEqual([
      'valid',
      'xml',
      'pdf',
      'directory',
      'mentions',
      'rejection',
    ]);
    // The copy went to the test platform; the invoice itself did not move.
    expect(pdp.sent.length).toBe(sentBefore + 1);
    expect(pdp.sent.at(-1)?.xml).toMatch(/<ram:ID>TEST-R[0-9A-Z]+-TEST-F2026-0042<\/ram:ID>/);
    expect(pdp.forced.at(-1)).toMatchObject({ status: 'rejected', reason: { code: 'REHEARSAL' } });
    expect((await status(id))?.status).toBe('validated');
    const runs = await database.db.select().from(agentRuns).where(eq(agentRuns.invoiceId, id));
    expect(runs).toMatchObject([{ agent: 'test', status: 'ok', model: 'deterministic' }]);
    const notes = await database.db
      .select()
      .from(invoiceEvents)
      .where(eq(invoiceEvents.invoiceId, id));
    expect(notes.at(-1)).toMatchObject({ type: 'note', event: 'rehearsal', actor: 'agent:test' });
  });

  it('rehearses without a scenario port too, and lists what is not ready', async () => {
    const plain = testApi(database, { mock: pdp.adapter }, undefined, {
      test: { provider: 'mock', scenarios: null },
    });
    const t = await tenant();
    const good = first((await sync(t.apiKey, { test: true }, plain.request)).body).invoiceId;
    const ok = await plain.request(`/invoices/${good}/rehearse`, {
      method: 'POST',
      token: t.apiKey,
    });
    expect(((await ok.json()) as { ready: boolean }).ready).toBe(true);

    const bad = first(
      (await sync(t.apiKey, { snapshot: sheet(row('F2026-0099', null)) }, plain.request)).body,
    ).invoiceId;
    const res = await plain.request(`/invoices/${bad}/rehearse`, {
      method: 'POST',
      token: t.apiKey,
    });
    const body = (await res.json()) as {
      ready: boolean;
      checklist: { item: string; ok: boolean; detail: string | null }[];
    };
    expect(body.ready).toBe(false);
    const byItem = Object.fromEntries(body.checklist.map((c) => [c.item, c]));
    expect(byItem.valid?.ok).toBe(false);
    expect(byItem.directory?.detail).toContain('SIREN de votre client manque');
    expect(byItem.rejection?.detail).toContain('Contrôle non effectué');
  });
});

describe('Mode test scenarios', () => {
  it('plays « Simuler un rejet PDP » on the platform, and the sync brings it back', async () => {
    const { apiKey, id } = await depositedTestInvoice();
    const res = await request(`/invoices/${id}/scenario`, {
      method: 'POST',
      token: apiKey,
      body: { scenario: 'pdp_reject' },
    });
    expect(res.status).toBe(202);
    expect(pdp.forced.at(-1)).toMatchObject({
      status: 'rejected',
      reason: { code: 'SIMULATION', text: 'Rejet simulé par la plateforme de test.' },
    });
    const target = api.jobs.syncs.at(-1);
    expect(target).toMatchObject({ provider: 'mock' });
    if (!target) throw new Error('no sync');
    await runSync(worker(), target);
    expect((await status(id))?.status).toBe('rejected_by_pdp');
    const audit = await database.db
      .select()
      .from(invoiceEvents)
      .where(eq(invoiceEvents.invoiceId, id))
      .orderBy(asc(invoiceEvents.id));
    expect(audit.map((e) => e.event)).toContain('scenario');
  });

  it('fakes the events where the platform cannot play them, marked as simulated', async () => {
    const fake = testApi(database, { mock: pdp.adapter }, undefined, {
      test: { provider: 'mock', scenarios: null },
    });
    const { apiKey, id } = await depositedTestInvoice();
    const res = await fake.request(`/invoices/${id}/scenario`, {
      method: 'POST',
      token: apiKey,
      body: { scenario: 'customer_refuse' },
    });
    expect(res.status).toBe(202);
    expect(((await res.json()) as { status: string }).status).toBe('refused_by_customer');
    const events = await database.db
      .select()
      .from(invoiceEvents)
      .where(eq(invoiceEvents.invoiceId, id))
      .orderBy(asc(invoiceEvents.id));
    expect(events.at(-1)).toMatchObject({
      type: 'transition',
      toStatus: 'refused_by_customer',
      actor: 'pdp',
      payload: { simulated: true, reason: { code: 'SIMULATION' } },
    });
  });

  it('schedules « paiement à J+45 » after the due date on the business clock', async () => {
    const { apiKey, id } = await depositedTestInvoice();
    await request(`/invoices/${id}/scenario`, {
      method: 'POST',
      token: apiKey,
      body: { scenario: 'pay_late' },
    });
    const [accepted, paid] = pdp.forced.slice(-2);
    expect(accepted).toMatchObject({ status: 'accepted' });
    expect(paid?.status).toBe('payment_received');
    // Due 14/11/2026 (15/10 + 30 days): J+45 from today is the days to the due date plus 45.
    expect(paid?.after).toMatch(/^P\d+D$/);
    expect(Number(paid?.after?.slice(1, -1))).toBeGreaterThanOrEqual(45);
  });

  it('refuses calmly what cannot be simulated', async () => {
    const t = await tenant();
    const real = first((await sync(t.apiKey, {})).body).invoiceId;
    const notTest = await request(`/invoices/${real}/scenario`, {
      method: 'POST',
      token: t.apiKey,
      body: { scenario: 'pdp_reject' },
    });
    expect(((await notTest.json()) as ErrorBody).error.code).toBe('not_test');

    const unsent = first((await sync(t.apiKey, { test: true })).body).invoiceId;
    const needsSend = await request(`/invoices/${unsent}/scenario`, {
      method: 'POST',
      token: t.apiKey,
      body: { scenario: 'pdp_reject' },
    });
    expect(((await needsSend.json()) as ErrorBody).error.code).toBe('scenario_needs_send');

    // A platform rejects at deposit: once the customer accepted, « rejet PDP » no longer applies.
    const { apiKey, id } = await depositedTestInvoice();
    await request(`/invoices/${id}/scenario`, {
      method: 'POST',
      token: apiKey,
      body: { scenario: 'pay_late' },
    });
    const target = api.jobs.syncs.at(-1);
    if (!target) throw new Error('no sync');
    await runSync(worker(), target);
    expect((await status(id))?.status).toBe('accepted');
    const late = await request(`/invoices/${id}/scenario`, {
      method: 'POST',
      token: apiKey,
      body: { scenario: 'pdp_reject' },
    });
    expect(late.status).toBe(409);
    const error = ((await late.json()) as ErrorBody).error;
    expect(error.code).toBe('scenario_not_now');
    expect(error.message).toContain('« Acceptée par le client »');
  });
});
