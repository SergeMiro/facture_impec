// The task pane's flows against the real API in memory (PGlite): every answer goes through the
// add-in's Zod schemas, so a change on either side that breaks the other fails here.
import {
  fakeAdapter,
  linkToken,
  newTenant,
  runCollect,
  runSend,
  runSync,
  SIRENE_CASES,
  standInBilling,
  type testApi as TestApi,
  testApi,
  testDatabase,
  type WorkerDeps,
} from '@fi/api/testing';
import { addDays, parisToday } from '@fi/core';
import { type MessageKey, TERMS_VERSION, TRIAL_REAL_SENDS, t } from '@fi/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Controller,
  type ControllerDeps,
  type FiState,
  SETTING,
  SHEET_POLL_MAX_MS,
  SHEET_POLL_MS,
} from './controller';
import { FakeWorkbook } from './excel/fake';
import {
  DEMO_DEFAULTS,
  DEMO_ORDERS,
  DEMO_OWNER,
  DEMO_SELLER,
  DEMO_SHEET,
  demoOrders,
  demoSheet,
} from './harness/demo';
import type { Timers } from './offline';
import { memoryStore } from './storage';

const BASE = 'http://api.test';
const OWNER = DEMO_OWNER;
const SELLER = { ...DEMO_SELLER, ownerEmail: OWNER };
const DEFAULTS = DEMO_DEFAULTS;

/** The delays the controller asked for, before they were shrunk. */
const delays: number[] = [];

/** Every delay of the controller shrunk to a few milliseconds. */
const fastTimers: Timers = {
  setTimeout: (fn, ms) => {
    delays.push(ms);
    return setTimeout(fn, Math.min(ms, 5));
  },
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

let database: Awaited<ReturnType<typeof testDatabase>>;
let api: ReturnType<typeof TestApi>;
let apiKey: string;
let adapter: ReturnType<typeof fakeAdapter>;
let account: string;
type PlatformEvent = Awaited<ReturnType<typeof adapter.getStatus>>[number];
/** What the platform answers when asked about an invoice. */
let platformEvents: PlatformEvent[] = [];
/** Unplugs the network for the offline tests. */
let down = false;
const calls: string[] = [];

const fetchFn: typeof fetch = async (input, init) => {
  if (down) throw new TypeError('fetch failed');
  const url = String(input);
  calls.push(`${init?.method ?? 'GET'} ${url.replace(BASE, '')}`);
  return api.app.request(url, init);
};

async function until(check: () => boolean, what: string, ms = 8_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

let workbooks = 0;

function pane(book: FakeWorkbook, tokens = memoryStore(), extra: Partial<ControllerDeps> = {}) {
  const id = `test-${String(++workbooks).padStart(4, '0')}`;
  const controller = new Controller({
    port: book,
    tokens,
    apiBase: BASE,
    fetch: fetchFn,
    timers: fastTimers,
    writerClock: { now: () => Date.now(), setTimeout: (fn) => setTimeout(fn, 0) },
    newId: () => id,
    ...extra,
  });
  const state = (): FiState => controller.getState();
  return { controller, state, tokens };
}

beforeAll(async () => {
  database = await testDatabase();
  // A platform that takes every invoice and finds every customer; it never answers by itself.
  let deposits = 0;
  adapter = fakeAdapter({
    sendInvoice: async () => ({ outcome: 'deposited', pdpRef: `inv_${++deposits}` }),
    getStatus: async () => platformEvents,
    lookupRecipient: async ({ siren }) => ({ siren }),
  });
  api = testApi(database, { mock: adapter });
  const tenant = await newTenant(api.request, SELLER);
  apiKey = tenant.apiKey;
  account = tenant.account;
  const res = await api.request('/settings', {
    method: 'PATCH',
    token: apiKey,
    body: { invoiceDefaults: DEFAULTS },
  });
  expect(res.status).toBe(200);
});
afterAll(async () => {
  await database.close();
});

describe('a new user on the demo sheet', () => {
  const book = new FakeWorkbook({ [DEMO_SHEET]: demoSheet() });
  const { controller, state } = pane(book);
  const row = (n: number) => controller.rowAt(n);

  it('signs in with the key and gets a column proposal', async () => {
    await controller.start();
    expect(state().screen.name).toBe('login');
    expect(book.settings.get(SETTING.workbookId)).toBe('wb-test-0001');

    await controller.signInWithKey(apiKey);
    expect(state().me?.tenant.siren).toBe('100000009');
    await until(() => state().detection !== null, 'the detection');
    const detection = state().detection;
    expect(state().screen.name).toBe('detect');
    // No AI in the tests: the headers alone, and the screen says so.
    expect(detection?.degraded).toBe('ai_off');
    expect(detection?.mapping.mapping.number?.column).toBe('A');
    expect(detection?.mapping.mapping.buyerSiren?.column).toBe('E');
    expect(detection?.headers.slice(0, 2)).toEqual([
      { col: 'A', text: 'N° Facture' },
      { col: 'B', text: 'Date' },
    ]);
  });

  it('confirms the columns, then writes one status per row in FI_Statut / FI_Détail only', async () => {
    const proposal = state().detection?.mapping;
    if (!proposal) throw new Error('no proposal');
    const before = new Map(book.sheets.get(DEMO_SHEET));
    await controller.confirmMapping(proposal);
    await until(() => state().sync !== null, 'the first sync');

    expect(state().screen.name).toBe('dashboard');
    expect(book.cell(DEMO_SHEET, 'M1')?.text).toBe('FI_Statut');
    expect(book.cell(DEMO_SHEET, 'N1')?.text).toBe('FI_Détail');
    expect(row(2)?.tone).toBe('ok');
    expect(row(3)?.tone).toBe('error');
    expect(row(4)?.tone).toBe('error');
    expect(book.cell(DEMO_SHEET, 'M3')?.text).toBe(row(3)?.label);
    expect(book.cell(DEMO_SHEET, 'M3')?.fill).toBe('#FDE7E9');
    // The user's own cells are exactly as they were.
    for (const [address, cell] of before) expect(book.cell(DEMO_SHEET, address)).toEqual(cell);

    expect(JSON.parse(book.settings.get(SETTING.mapping(DEMO_SHEET)) ?? '{}').sheet).toBe(
      DEMO_SHEET,
    );
    await until(() => calls.some((c) => c.startsWith('PUT /workbooks/')), 'the server copy');
    const saved = await api.request(`/workbooks/wb-test-0001/mappings/${DEMO_SHEET}`, {
      token: apiKey,
    });
    expect(saved.status).toBe(200);
  });

  it('opens the fiche, explains the error and selects its cell', async () => {
    const id = row(3)?.invoiceId;
    if (!id) throw new Error('row 3 has no invoice');
    await controller.openInvoice(id);
    await until(() => state().invoice?.explained !== null, 'the explanations');
    const explained = state().invoice?.explained?.explanations ?? [];
    const siren = explained.find((x) => x.ruleId === 'FF-SIREN-01');
    expect(siren?.cell).toBe('Factures!E3');
    expect(siren?.fix_steps.length).toBeGreaterThan(0);

    await controller.fixInSheet('Factures!E3');
    expect(book.active).toEqual({ sheet: DEMO_SHEET, cell: 'E3' });
  });

  it('re-checks by itself after the user fixes the cell, and the fiche follows', async () => {
    const syncs = () => calls.filter((c) => c.endsWith('/sync')).length;
    const before = syncs();
    book.type(DEMO_SHEET, 'E3', '400 000 006');
    await until(() => row(3)?.tone === 'ok', 'row 3 to pass');
    await until(
      () => state().invoice?.detail.issues.every((i) => i.severity !== 'error') ?? false,
      'the fiche to refresh',
    );
    // Our own status writes fire change events too; they must not start another sync.
    await new Promise((r) => setTimeout(r, 100));
    expect(syncs() - before).toBe(1);

    await controller.rehearse();
    expect(state().invoice?.rehearsal?.ready).toBe(true);
    expect(state().invoice?.rehearsal?.summary).toBe(t('rehearsal.ready'));

    book.type(DEMO_SHEET, 'B4', '14/10/2026');
    await until(() => row(4)?.tone === 'ok', 'row 4 to pass');
  });

  it('shows the XML and lets « Envoyer » from the ribbon only open the confirmation', async () => {
    await controller.viewXml();
    expect(state().invoice?.xml).toContain('<rsm:CrossIndustryInvoice');
    await controller.viewXml();
    expect(state().invoice?.xml).toBeNull();

    await book.select(DEMO_SHEET, 'C2');
    const sends = calls.filter((c) => c.endsWith('/send')).length;
    await controller.sendFromRibbon();
    const screen = state().screen;
    expect(screen.name === 'invoice' && screen.confirmSend).toBe(true);
    expect(state().invoice?.detail.number).toBe('F2026-101');
    expect(calls.filter((c) => c.endsWith('/send')).length).toBe(sends);
    controller.cancelSend();

    await book.select(DEMO_SHEET, 'C9');
    await controller.sendFromRibbon();
    expect(state().notice?.text).toBe(t('addin.send.pickRow'));
  });

  it('turns Mode test on only once the company allows it, then labels test rows', async () => {
    expect(await controller.saveSettings({ sandboxEnabled: false })).toBe(true);
    await controller.setTestMode(true);
    expect(state().testMode).toBe(false);
    expect(state().notice?.text).toBe(t('addin.testMode.disabled'));

    expect(await controller.saveSettings({ sandboxEnabled: true })).toBe(true);
    expect(state().me?.testMode.enabled).toBe(true);
    await controller.setTestMode(true);
    expect(state().testMode).toBe(true);
    expect(book.settings.get(SETTING.testMode)).toBe('on');
    await until(() => row(2)?.isTest === true, 'the test invoices');
    expect(row(2)?.number).toMatch(/^TEST-/);
    expect(book.cell(DEMO_SHEET, 'M2')?.text).toBe(
      t('addin.sheet.testLabel', { label: row(2)?.label ?? '' }),
    );
  });

  it('sends a test invoice after the confirmation, and explains why a scenario must wait', async () => {
    const id = row(2)?.invoiceId;
    if (!id) throw new Error('row 2 has no invoice');
    await controller.openInvoice(id);
    controller.askSend();
    await controller.send();
    expect(calls).toContain(`POST /invoices/${id}/send`);
    expect(state().notice?.text).toBe(t('addin.send.done', { number: row(2)?.number ?? '' }));

    // The recorded jobs never deposit it: the platform has not answered yet.
    await controller.playScenario('pdp_reject');
    expect(state().notice?.tone).toBe('error');
    expect(state().notice?.text).toBe(t('api.error.scenario_needs_send'));
  });

  it('follows the sent invoice on the sheet by itself, less and less often, until it arrives', async () => {
    const id = row(2)?.invoiceId;
    if (!id) throw new Error('row 2 has no invoice');
    controller.navigate({ name: 'dashboard' });
    const worker: WorkerDeps = {
      db: database.db,
      pdp: { mock: adapter },
      test: api.deps.test,
      jobs: api.jobs,
      ai: api.deps.ai,
      mailer: null,
      now: () => new Date(),
    };
    const sheetSays = (status: string) =>
      book.cell(DEMO_SHEET, 'M2')?.text ===
      t('addin.sheet.testLabel', { label: t(`invoice.status.${status}` as MessageKey) });
    // Nothing moves yet: the checks space out (the offline retries are the only other long delays).
    await until(() => delays.includes(SHEET_POLL_MAX_MS), 'the checks to space out');
    const checks = delays.filter((d) => d >= SHEET_POLL_MS);
    expect(checks.slice(checks.lastIndexOf(SHEET_POLL_MS)).slice(0, 5)).toEqual([
      30_000, 60_000, 120_000, 240_000, 300_000,
    ]);

    await runSend(worker, id);
    await until(() => sheetSays('deposited'), 'the deposit on the sheet');
    const { pdpRef } = (await (await api.request(`/invoices/${id}`, { token: apiKey })).json()) as {
      pdpRef: string;
    };

    const event = (n: number, status: PlatformEvent['status']): PlatformEvent => ({
      id: `evt-${n}`,
      status,
      raw: status,
      at: new Date().toISOString(),
    });
    platformEvents = [event(1, 'delivered')];
    await runSync(worker, { provider: 'mock', account, pdpRef });
    await until(() => sheetSays('delivered'), 'the delivery on the sheet');

    platformEvents = [event(1, 'delivered'), event(2, 'accepted')];
    await runSync(worker, { provider: 'mock', account, pdpRef });
    await until(() => sheetSays('accepted'), 'the acceptance on the sheet');
    // Accepted: the platform has nothing urgent left to say, the checks stop.
    const asked = calls.filter((c) => c.startsWith('GET /invoices?')).length;
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c.startsWith('GET /invoices?')).length).toBe(asked);
  });

  it('keeps a sync waiting while offline and runs it when the connection is back', async () => {
    controller.navigate({ name: 'dashboard' });
    const at = state().sync?.at ?? 0;
    down = true;
    await controller.sync();
    expect(state().offline).toEqual([t('addin.offline.sync')]);
    down = false;
    controller.online();
    await until(() => state().offline === null && (state().sync?.at ?? 0) > at, 'the queued sync');
  });

  it('loads the settings with the fields the pane edits', async () => {
    controller.navigate({ name: 'settings' });
    await until(() => state().settings !== null, 'the settings');
    expect(state().settings?.invoiceDefaults.siret).toBe(DEFAULTS.siret);
    expect(state().settings?.pseudonymizeLlm).toBe(true);
    expect(await controller.saveSettings({ chaseCadence: [-3, 7, 15] })).toBe(true);
    expect(state().settings?.chaseCadence).toEqual([-3, 7, 15]);

    // This deployment mails (the test outbox): the chasing autopilot can be chosen, with a ceiling.
    expect(state().settings?.autopilotAvailable).toBe(true);
    expect(await controller.saveSettings({ mode: 'autopilot', autopilotMaxAmount: 150_000 })).toBe(
      true,
    );
    expect(state().settings).toMatchObject({ mode: 'autopilot', autopilotMaxAmount: 150_000 });
    expect(await controller.saveSettings({ mode: 'review' })).toBe(true);
    expect(state().settings?.mode).toBe('review');

    // This deployment seals no company platform key: the form is hidden, and the API says why.
    expect(state().settings?.pdp.ownKey).toEqual({ available: false, hint: null });
    expect(await controller.savePdpKey('test_company_key_1234')).toBe(false);
    expect(state().notice?.text).toBe(t('api.error.pdp_key_disabled'));
  });

  it('chases the accepted invoice from its fiche, records a promise, then « Encaissée »', async () => {
    const id = row(2)?.invoiceId;
    if (!id) throw new Error('row 2 has no invoice');
    // The CollectAgent's sweep gives the accepted invoice its plan (the company's cadence).
    expect(await runCollect(api.deps)).toMatchObject({ planned: 1 });
    await controller.openInvoice(id);
    expect(state().invoice?.detail.chase?.cadence).toEqual([-3, 7, 15]);

    expect(await controller.prepareChase()).toBe(true);
    const manual = state().invoice?.detail.chase?.steps.find((s) => s.reason === 'manual');
    expect(manual).toMatchObject({ status: 'drafted' });
    expect(manual?.draft?.subject).toContain(row(2)?.number ?? '?');
    expect(state().notice?.text).toBe(t('addin.chase.prepared', { number: row(2)?.number ?? '' }));
    if (!manual) throw new Error('no manual step');
    expect(await controller.markChaseSent(manual.offset)).toBe(true);
    expect(
      state().invoice?.detail.chase?.steps.find((s) => s.offset === manual.offset),
    ).toMatchObject({ status: 'sent', by: 'user' });

    const promised = addDays(parisToday(), 3);
    expect(await controller.promisePayment(promised)).toBe(true);
    expect(state().invoice?.detail.chase?.promisedUntil).toBe(promised);
    expect(await controller.promisePayment(null)).toBe(true);
    expect(state().invoice?.detail.chase?.promisedUntil).toBeNull();

    await controller.recordPayment();
    expect(state().invoice?.detail.status).toBe('paid');
    expect(state().notice?.text).toBe(t('addin.chase.paidDone', { number: row(2)?.number ?? '' }));
    await until(
      () => book.cell(DEMO_SHEET, 'M2')?.text?.includes(t('invoice.status.paid')) ?? false,
      'Encaissée on the sheet',
    );
  });

  it('shows the week on the dashboard', async () => {
    controller.navigate({ name: 'dashboard' });
    await until(() => state().report !== null, 'the weekly report');
    expect(state().report?.numbers.length).toBeGreaterThan(0);
    expect(state().report?.title).toBeTruthy();
  });

  it('receives test supplier invoices, flags the duplicate and the new IBAN, then exports', async () => {
    expect(state().testMode).toBe(true);
    controller.navigate({ name: 'reception' });
    await until(() => state().reception !== null, 'the received invoices');
    expect(state().reception).toEqual({ test: true, inbound: [], exports: [] });

    // The duplicate and the IBAN change both start from a first, normal invoice.
    await controller.receiveTestInbound('duplicate');
    expect(state().notice?.text).toBe(t('api.error.inbound_test_needs_one'));
    await controller.receiveTestInbound('normal');
    await controller.receiveTestInbound('duplicate');
    await controller.receiveTestInbound('iban_change');
    expect(state().notice?.text).toBe(t('addin.reception.testReceived'));
    const [changed, twin, first] = state().reception?.inbound ?? [];
    if (!changed || !twin || !first) throw new Error('three test invoices expected');
    const codes = (r: typeof first) => r.flags.map((f) => f.code);
    expect(codes(first)).toEqual(['new_supplier']);
    expect(codes(twin)).toEqual(['duplicate']);
    expect(twin.flags[0]?.relatedId).toBe(first.id);
    expect(twin.canApprove).toBe(false);
    expect(codes(changed)).toEqual(['iban_changed']);
    expect(changed.needsIbanCheck).toBe(true);
    expect(state().reception?.inbound.every((r) => r.isTest)).toBe(true);

    await controller.approveInbound(first.id);
    expect(state().notice?.text).toBe(
      t('addin.reception.approved', { number: first.number ?? '' }),
    );
    // A new IBAN is only approved once the user says it was checked with the supplier.
    await controller.approveInbound(changed.id);
    expect(state().notice?.text).toBe(t('api.error.inbound_iban_unchecked'));
    await controller.approveInbound(changed.id, true);
    expect(await controller.disputeInbound(twin.id, 'Doublon de la facture déjà reçue')).toBe(true);
    const status = () => state().reception?.inbound.map((r) => r.status);
    expect(status()).toEqual(['approved', 'disputed', 'approved']);

    await controller.exportInbound();
    expect(state().notice?.text).toBe(t('addin.reception.exported', { count: 2 }));
    expect(status()).toEqual(['exported', 'disputed', 'exported']);
    const made = state().reception?.exports[0];
    expect(made).toMatchObject({ isTest: true, count: 2, skipped: 0 });
    if (!made) throw new Error('no export');
    expect(made.fecName).toMatch(/^TEST-\d{9}FEC\d{8}\.txt$/);
    const fec = await controller.exportFile(made.id, 'fec');
    expect((await fec?.text())?.split('\r\n')[0]).toMatch(/^JournalCode\tJournalLib\t/);
    const csv = await controller.exportFile(made.id, 'csv');
    expect(await csv?.text()).toContain(first.number ?? '?');

    // Out of Mode test, the real side: nothing received, nothing exported.
    await controller.setTestMode(false);
    await until(() => state().reception?.test === false, 'the real received invoices');
    expect(state().reception).toEqual({ test: false, inbound: [], exports: [] });
  });

  it("finds the fiche's customer in the directory, saves it, then opts it in for the autopilot", async () => {
    const id = row(3)?.invoiceId;
    if (!id) throw new Error('row 3 has no invoice');
    await controller.openInvoice(id);
    expect(state().invoice?.detail).toMatchObject({ buyerName: 'Garage Dupont', partyId: null });
    await controller.findCustomer();
    expect(state().screen.name).toBe('customers');
    const finding = state().customers?.finding;
    expect(finding?.question).toBe(t('party.question.many', { count: 3 }));
    const first = finding?.candidates[0];
    if (!first) throw new Error('no candidate');
    expect(first).toMatchObject({ name: 'GARAGE DUPONT', routing: true, partyId: null });

    await controller.confirmCustomer(first.siren, state().customers?.sheetName ?? undefined);
    const party = state().customers?.parties[0];
    if (!party) throw new Error('no customer saved');
    expect(party).toMatchObject({
      legalName: 'GARAGE DUPONT',
      siren: first.siren,
      autopilot: false,
    });
    expect(state().customers?.finding?.candidates[0]?.partyId).toBe(party.id);
    expect(state().notice?.text).toBe(t('addin.customers.confirmed', { name: 'GARAGE DUPONT' }));

    expect(await controller.updateCustomer(party.id, { email: 'compta@garage.example' })).toBe(
      true,
    );
    expect(await controller.updateCustomer(party.id, { autopilot: true })).toBe(true);
    expect(state().customers?.parties[0]).toMatchObject({
      email: 'compta@garage.example',
      autopilot: true,
    });
    expect(state().notice?.text).toBe(t('addin.customers.autopilotOn', { name: 'GARAGE DUPONT' }));

    // The checks read this switch: the API checked its invoices again (parties.test.ts), the sheet syncs.
    expect(await controller.updateCustomer(party.id, { requiresPurchaseOrder: true })).toBe(true);
    expect(state().customers?.parties[0]?.requiresPurchaseOrder).toBe(true);
    expect(state().notice?.text).toBe(t('addin.customers.rulesSaved', { name: 'GARAGE DUPONT' }));

    await controller.removeCustomer(party.id);
    expect(state().customers?.parties).toEqual([]);
  });

  it("holds an invoice for good on « Annuler l'envoi automatique »", async () => {
    const id = row(3)?.invoiceId;
    if (!id) throw new Error('row 3 has no invoice');
    await controller.openInvoice(id);
    expect(state().invoice?.detail.autopilot).toEqual({ at: null, held: false });
    await controller.cancelAutopilot();
    expect(state().invoice?.detail.autopilot).toEqual({ at: null, held: true });
    expect(state().invoice?.detail.events.at(-1)).toMatchObject({ event: 'autopilot_held' });
    expect(state().notice?.text).toBe(
      t('addin.autopilot.held', { number: state().invoice?.detail.number ?? '' }),
    );
  });
});

describe('the other sheets of the workbook (R1)', () => {
  const SIREN = '999000128';
  const book = new FakeWorkbook({
    [DEMO_SHEET]: demoSheet(),
    [DEMO_ORDERS]: demoOrders(),
    Notes: { A1: 'Penser à rappeler le comptable' },
  });
  const { controller, state, tokens } = pane(book);
  let later: ReturnType<typeof pane>;
  let key: string;
  const sourceReads = () => calls.filter((c) => c.includes('/sources/Commandes/sync')).length;
  const invoiceSyncs = () => calls.filter((c) => /^POST \/workbooks\/[^/]+\/sync$/.test(c)).length;
  const order = async (number: string, from = controller) =>
    (await from.api.registry()).recent.find((d) => d.number === number);
  const settle = () => new Promise((r) => setTimeout(r, 50));

  beforeAll(async () => {
    const vatId = `FR${String((12 + 3 * (Number(SIREN) % 97)) % 97).padStart(2, '0')}${SIREN}`;
    key = (
      await newTenant(api.request, {
        ...SELLER,
        siren: SIREN,
        vatId,
        ownerEmail: 'registre@entreprise-demo.test',
      })
    ).apiKey;
  });

  it('proposes the other sheets, then includes « Commandes » once the company confirms it', async () => {
    await controller.start();
    await controller.signInWithKey(key);
    await until(() => state().detection !== null, 'the invoice columns');
    const columns = state().detection?.mapping;
    if (!columns) throw new Error('no invoice columns');
    await controller.confirmMapping(columns);
    expect(state().otherSheets).toEqual(['Commandes', 'Notes']);

    controller.navigate({ name: 'registry' });
    await until(() => state().registry !== null, 'the registry');
    expect(state().registry?.sources).toEqual([]);

    await controller.includeSheet('Commandes');
    const inclusion = state().inclusion;
    if (!inclusion) throw new Error('no proposal');
    expect(inclusion.detection).toMatchObject({
      degraded: 'ai_off',
      profile: null,
      included: false,
      layout: { kind: 'order', headerRow: 1, source: 'heuristic' },
    });
    expect(inclusion.headers.slice(0, 2)).toEqual([
      { col: 'A', text: 'N° commande' },
      { col: 'B', text: 'Date' },
    ]);
    expect(controller.inclusionHeaders(2)[0]).toEqual({ col: 'A', text: 'C-41' });
    // Nothing is kept before « Confirmer et inclure ».
    const workbookId = state().workbookId ?? '';
    expect((await controller.api.sources(workbookId)).sources).toEqual([]);

    await controller.confirmLayout({ ...inclusion.detection.layout, source: 'user' });
    expect(state().inclusion).toBeNull();
    expect(state().sources).toMatchObject([
      { sheet: 'Commandes', kind: 'order', stats: { docs: 2, lines: 3, headerFound: true } },
    ]);
    expect(state().otherSheets).toEqual(['Notes']);
    expect(state().notice?.text).toBe(
      t('addin.registry.included', { sheet: 'Commandes', docs: 2 }),
    );
    expect(state().registry?.recent.map((d) => [d.kind, d.number, d.sheet, d.netTotal])).toEqual(
      expect.arrayContaining([
        ['order', 'C-41', 'Commandes', 4 * 8_500 + 14_000],
        ['order', 'C-42', 'Commandes', 2 * 14_000],
      ]),
    );
  });

  it('reads « Commandes » again when a cell changes there, while « Factures » stays active', async () => {
    controller.navigate({ name: 'dashboard' });
    await until(() => !state().busy.includes('sync'), 'the invoice check');
    expect(book.active.sheet).toBe(DEMO_SHEET);
    const invoices = invoiceSyncs();
    const before = sourceReads();
    // Two quick edits: one read.
    book.type('Commandes', 'F2', 5);
    book.type('Commandes', 'F2', 6);
    await until(
      () => sourceReads() > before && !state().busy.includes('source:Commandes'),
      'the read of Commandes',
    );
    await settle();
    expect(sourceReads()).toBe(before + 1);
    expect((await order('C-41'))?.netTotal).toBe(6 * 8_500 + 14_000);
    expect(state().sources[0]?.changedAt).not.toBeNull();
    // The invoice sheet was not checked again for an edit elsewhere.
    expect(invoiceSyncs()).toBe(invoices);
  });

  it('opens the Registre instead of checking « Commandes » as invoices', async () => {
    book.active = { sheet: 'Commandes', cell: 'A1' };
    await controller.verifyFromRibbon();
    expect(state().screen.name).toBe('registry');
    expect(state().notice?.text).toBe(t('addin.registry.isSource', { sheet: 'Commandes' }));
    // The invoice sheet keeps its columns.
    expect(state().sheet).toBe(DEMO_SHEET);
    expect(state().mapping).not.toBeNull();
    await controller.showSheet('Commandes');
    expect(book.active).toEqual({ sheet: 'Commandes', cell: 'A1' });
    book.active = { sheet: DEMO_SHEET, cell: 'A1' };
  });

  it('stops listening at sign-out; the next pane reads what changed meanwhile, then follows it', async () => {
    await controller.signOut();
    expect(state().sources).toEqual([]);
    const before = sourceReads();
    book.type('Commandes', 'F4', 3);
    await settle();
    expect(sourceReads()).toBe(before);

    later = pane(book, tokens);
    await later.controller.start();
    await later.controller.signInWithKey(key);
    await until(
      () => sourceReads() > before && !later.state().busy.includes('source:Commandes'),
      'the first read',
    );
    expect((await order('C-42', later.controller))?.netTotal).toBe(3 * 14_000);
    expect(later.state().screen.name).toBe('dashboard');
    expect(later.state().otherSheets).toEqual(['Notes']);

    book.type('Commandes', 'F2', 2);
    await until(() => sourceReads() > before + 1, 'the read after the edit');
    await until(() => !later.state().busy.includes('source:Commandes'), 'the read to end');
    expect((await order('C-41', later.controller))?.netTotal).toBe(2 * 8_500 + 14_000);
  });

  it('« Retirer » takes the orders out of the registry and stops reading the sheet', async () => {
    await later.controller.removeSource('Commandes');
    expect(later.state().sources).toEqual([]);
    expect(later.state().otherSheets).toEqual(['Commandes', 'Notes']);
    expect(later.state().notice?.text).toBe(t('addin.registry.removed', { sheet: 'Commandes' }));
    expect((await later.controller.api.registry()).recent).toEqual([]);
    const before = sourceReads();
    book.type('Commandes', 'F2', 1);
    await settle();
    expect(sourceReads()).toBe(before);
    // The sheet itself is untouched.
    expect(book.cell('Commandes', 'A2')?.text).toBe('C-41');
  });
});

describe('signing in', () => {
  it('collects the session once the e-mailed link is confirmed', async () => {
    const book = new FakeWorkbook({ [DEMO_SHEET]: demoSheet() });
    const { controller, state, tokens } = pane(book);
    await controller.start();
    expect(state().magicLink).toBe(true);
    await controller.requestLink(OWNER);
    expect(state().link).toEqual({ email: OWNER });
    const link = linkToken(api.mailer, OWNER);
    await api.request(`/auth/magic-link/confirm?token=${link}`, { method: 'POST' });
    await until(() => state().me !== null, 'the session');
    expect(state().me?.user?.email).toBe(OWNER);
    expect(await tokens.get('token')).toMatch(/^fis_/);
    // The server already has this workbook's mapping? Not this one: it is a new workbook.
    await until(() => state().screen.name === 'detect', 'the detection screen');

    await controller.signOut();
    expect(state().screen.name).toBe('login');
    expect(await tokens.get('token')).toBeNull();
  });

  it('goes back to the sign-in screen, calmly, when the saved key is refused', async () => {
    const tokens = memoryStore();
    await tokens.set('token', 'fik_not-a-real-key');
    const { controller, state } = pane(new FakeWorkbook({ [DEMO_SHEET]: demoSheet() }), tokens);
    await controller.start();
    await until(() => state().screen.name === 'login', 'the sign-in screen');
    expect(state().notice).toEqual({ tone: 'error', text: t('api.error.unauthorized') });
    expect(await tokens.get('token')).toBeNull();
  });
});

describe('creating an account', () => {
  const SIREN = '999000102';
  const EMAIL = 'gerance@entreprise-demo.test';
  const book = new FakeWorkbook({ [DEMO_SHEET]: demoSheet() });
  const { controller, state, tokens } = pane(book);

  it('finds the company, mails the link, then signs in by itself, in Mode test', async () => {
    await controller.start();
    expect(state().signupOffer).toEqual({ termsVersion: TERMS_VERSION, termsUrl: null });
    controller.startSignup();
    expect(state().screen.name).toBe('signup');

    await controller.lookupCompany('999 000 102');
    expect(state().signup).toMatchObject({ step: 'company', siren: SIREN });
    const found = state().signup?.found;
    if (!found?.name) throw new Error('the directory found nothing');
    const name = found.name;
    expect(found).toMatchObject({
      name: 'ENTREPRISE DE DEMONSTRATION 0102',
      address: { postCode: '21000', city: 'DIJON', country: 'FR' },
      vatSource: 'dgfip',
      masked: false,
    });

    await controller.submitSignup(EMAIL, {
      name,
      address: found.address,
      vatId: found.vatId,
    });
    expect(state().signup).toMatchObject({ step: 'waiting', email: EMAIL });
    const link = linkToken(api.mailer, EMAIL);
    const confirmed = await api.request(`/onboarding/confirm?token=${link}`, { method: 'POST' });
    expect(confirmed.status).toBe(200);

    await until(() => state().me !== null, 'the new session');
    expect(state().me?.tenant).toMatchObject({ siren: SIREN, name });
    expect(state().me?.user).toEqual({ email: EMAIL, role: 'owner' });
    expect(state().signup).toBeNull();
    expect(await tokens.get('token')).toMatch(/^fis_/);
    // A new account rehearses first.
    expect(state().testMode).toBe(true);
    expect(book.settings.get(SETTING.testMode)).toBe('on');
    expect(state().notice).toEqual({
      tone: 'success',
      text: t('addin.signup.created', { company: name }),
    });
    await controller.signOut();
  });

  it('refuses a company that has an account; lets the person type it when the directory is busy', async () => {
    controller.startSignup();
    await controller.lookupCompany(SIREN);
    expect(state().notice).toEqual({ tone: 'error', text: t('api.error.company_exists') });
    expect(state().signup?.step).toBe('siren');

    await controller.lookupCompany(SIRENE_CASES.busy);
    expect(state().signup).toMatchObject({
      step: 'company',
      siren: SIRENE_CASES.busy,
      found: null,
    });
    expect(state().notice).toEqual({
      tone: 'warning',
      text: t('api.error.directory_unavailable'),
    });
    controller.signupBack();
    expect(state().signup?.step).toBe('siren');
    controller.cancelSignup();
    expect(state().screen.name).toBe('login');
    expect(state().signup).toBeNull();
  });
});

describe('the subscription, then leaving', () => {
  const SIREN = '999000110';
  let billed: ReturnType<typeof TestApi>;
  let stripe: ReturnType<typeof standInBilling>['stripe'];
  let billedDb: Awaited<ReturnType<typeof testDatabase>>;
  let key: string;
  const opened: string[] = [];
  let opens = true;
  const book = new FakeWorkbook({ [DEMO_SHEET]: demoSheet() });
  const { controller, state, tokens } = pane(book, memoryStore(), {
    fetch: async (input, init) => billed.app.request(String(input), init),
    openUrl: async (url) => {
      opened.push(url);
      return opens;
    },
  });
  /** The Checkout Session of a stand-in page `…/checkout/<id>`. */
  const sessionOf = (url: string | undefined) => url?.split('/').pop() ?? '';

  beforeAll(async () => {
    billedDb = await testDatabase();
    let billing: ReturnType<typeof standInBilling>['billing'];
    ({ stripe, billing } = standInBilling(() => billed.app));
    billed = testApi(billedDb, { mock: adapter }, undefined, { billing });
    const vatId = `FR${String((12 + 3 * (Number(SIREN) % 97)) % 97).padStart(2, '0')}${SIREN}`;
    key = (await newTenant(billed.request, { ...SELLER, siren: SIREN, vatId, billing: 'trial' }))
      .apiKey;
  });
  afterAll(async () => {
    await billedDb.close();
  });

  it('shows the trial in Réglages, opens Stripe Checkout, then shows the paid plan', async () => {
    await controller.start();
    await controller.signInWithKey(key);
    controller.navigate({ name: 'settings' });
    await until(() => state().billing !== null, 'the subscription');
    expect(state().commerce).toBe(true);
    expect(state().billing).toMatchObject({
      enabled: true,
      status: 'trial',
      trial: { sends: TRIAL_REAL_SENDS, left: TRIAL_REAL_SENDS },
    });
    expect(state().billing?.offers.map((o) => [o.plan, o.interval, o.overage])).toEqual([
      ['essentiel', 'month', true],
      ['croissance', 'year', false],
    ]);

    await controller.openCheckout({ plan: 'essentiel', interval: 'month' });
    expect(opened).toHaveLength(1);
    expect(state().pageLink).toBe(opened[0]);
    expect(state().notice).toEqual({ tone: 'info', text: t('addin.billing.opened') });
    await stripe.pay(sessionOf(opened[0]));
    await controller.loadBilling();
    expect(state().billing).toMatchObject({
      status: 'active',
      plan: 'essentiel',
      interval: 'month',
      portal: true,
    });

    // Office could not open it (an old Excel): the link is shown instead.
    opens = false;
    await controller.openPortal();
    expect(opened[1]).toContain('/portal/');
    expect(state().pageLink).toBe(opened[1]);
    expect(state().notice).toEqual({ tone: 'info', text: t('addin.billing.openLink') });
  });

  it('deletes the account once the SIREN is typed again: Stripe stops, the pane signs out', async () => {
    await controller.deleteAccount('999 999 999');
    expect(state().notice).toEqual({ tone: 'error', text: t('api.error.confirm_mismatch') });
    expect(state().me).not.toBeNull();

    await controller.deleteAccount('999 000 110');
    expect(state().screen.name).toBe('login');
    expect(state().notice).toEqual({ tone: 'success', text: t('addin.account.deleted') });
    expect(state().billing).toBeNull();
    expect(state().pageLink).toBeNull();
    expect(await tokens.get('token')).toBeNull();
    expect([...stripe.subscriptions.values()].map((s) => s.status)).toEqual(['canceled']);
    expect((await billed.request('/me', { token: key })).status).toBe(401);
  });

  it('hides purchases where Office forbids them', async () => {
    const ipad = pane(new FakeWorkbook({ [DEMO_SHEET]: demoSheet() }), memoryStore(), {
      commerceAllowed: false,
    });
    expect(ipad.state().commerce).toBe(false);
  });
});
