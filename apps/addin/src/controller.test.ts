// The task pane's flows against the real API in memory (PGlite): every answer goes through the
// add-in's Zod schemas, so a change on either side that breaks the other fails here.

import {
  checkConnection,
  createGoogleClient,
  createMicrosoftClient,
  draft,
  fakeAdapter,
  GOOGLE_SHEET_TYPE,
  GOOGLE_STAND_IN_APP,
  type GoogleConnector,
  GoogleStandIn,
  handleFor,
  inProcess,
  linkToken,
  MICROSOFT_STAND_IN_APP,
  type MicrosoftConnector,
  MicrosoftStandIn,
  mockModel,
  newTenant,
  runCollect,
  runSend,
  runSync,
  SIRENE_CASES,
  standInBilling,
  type testApi as TestApi,
  testAi,
  testApi,
  testDatabase,
  testVies,
  textResult,
  toolCallResult,
  VIES_CASES,
  type WorkerDeps,
} from '@fi/api/testing';
import {
  addDays,
  columnIndex,
  columnLetters,
  computeInvoice,
  frMoney,
  InvoiceDraft,
  parisToday,
  toCii,
} from '@fi/core';
import { type XlsxCell, xlsxOf } from '@fi/core/testing/xlsx';
import { type MessageKey, TERMS_VERSION, TRIAL_REAL_SENDS, t } from '@fi/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  Controller,
  type ControllerDeps,
  decimalFr,
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
import { type MicrosoftPort, MicrosoftPortError } from './microsoft/port';
import { standInMicrosoftPort } from './microsoft/stand-in';
import type { Timers } from './offline';
import { fakeGoogleSheets } from './sheets/fake';
import { googleSheetsPort } from './sheets/port';
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
  api = testApi(database, { mock: adapter }, undefined, { vies: testVies() });
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

    // An instalment first: still chased, for the rest.
    const payable = state().invoice?.detail.payable ?? 0;
    await controller.recordPayment(undefined, 1_000);
    expect(state().invoice?.detail).toMatchObject({ status: 'accepted', amountPaid: 1_000 });
    expect(state().notice?.text).toBe(
      t('addin.chase.partDone', {
        number: row(2)?.number ?? '',
        left: frMoney(payable - 1_000, 'EUR'),
      }),
    );
    await controller.recordPayment();
    expect(state().invoice?.detail.status).toBe('paid');
    expect(state().invoice?.detail.amountPaid).toBe(payable);
    expect(state().notice?.text).toBe(t('addin.chase.paidDone', { number: row(2)?.number ?? '' }));
    await until(
      () => book.cell(DEMO_SHEET, 'M2')?.text?.includes(t('invoice.status.paid')) ?? false,
      'Encaissée on the sheet',
    );
  });

  it('finds any invoice of the company from the Tableau de bord, and opens it', async () => {
    const paid = row(2);
    if (!paid?.invoiceId || !paid.number) throw new Error('row 2 has no invoice');
    await controller.searchInvoices({ q: paid.number.slice(-4).toLowerCase() });
    expect(state().search?.invoices.map((i) => i.id)).toContain(paid.invoiceId);
    await controller.searchInvoices({ stage: 'paid' });
    expect(state().search?.invoices.map((i) => [i.id, i.status])).toEqual([
      [paid.invoiceId, 'paid'],
    ]);
    expect(state().search?.total).toBe(1);
    await controller.searchInvoices({ q: 'aucune-facture-ainsi' });
    expect(state().search).toMatchObject({ invoices: [], total: 0 });
    // « Plus de résultats » adds the next page to what is shown.
    await controller.searchInvoices({});
    const all = state().search?.total ?? 0;
    expect(all).toBeGreaterThan(1);
    await controller.searchInvoices({}, true);
    expect(state().search?.invoices.length).toBe(Math.min(all, 40));
    await controller.openInvoice(paid.invoiceId);
    expect(state().screen).toMatchObject({ name: 'invoice', id: paid.invoiceId });
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
    expect(state().reception).toEqual({
      test: true,
      inbound: [],
      exports: [],
      subcontractors: null,
    });

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
    expect(state().reception).toEqual({
      test: false,
      inbound: [],
      exports: [],
      subcontractors: null,
    });
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

  it("checks the customer's EU VAT number in VIES from the fiche, and says what VIES answered", async () => {
    const euInvoice = async (index: number, vatId: string) => {
      const d = draft(index, (x) => {
        x.buyer = {
          ...x.buyer,
          vatId,
          address: { ...x.buyer.address, country: vatId.slice(0, 2) },
        };
      });
      const res = await api.request('/invoices', {
        method: 'POST',
        token: apiKey,
        body: { draft: d },
      });
      expect(res.status).toBe(201);
      return ((await res.json()) as { id: string }).id;
    };
    await controller.openInvoice(await euInvoice(900, 'LU26375245'));
    expect(state().invoice?.detail.vies).toEqual({ vatId: 'LU26375245', answer: null });
    await controller.checkVies();
    expect(state().invoice?.detail.vies?.answer).toMatchObject({
      valid: true,
      name: 'SOCIETE DE DEMONSTRATION 5245',
      checkedOn: parisToday(),
    });
    expect(state().notice).toEqual({
      tone: 'success',
      text: t('addin.vies.valid', { vatId: 'LU26375245' }),
    });

    await controller.openInvoice(await euInvoice(901, VIES_CASES.invalid));
    await controller.checkVies();
    expect(state().invoice?.detail.vies?.answer).toMatchObject({ valid: false });
    expect(state().notice).toEqual({
      tone: 'warning',
      text: t('addin.vies.invalid', { vatId: VIES_CASES.invalid }),
    });

    await controller.openInvoice(await euInvoice(902, VIES_CASES.busy));
    await controller.checkVies();
    expect(state().invoice?.detail.vies?.answer).toBeNull();
    expect(state().notice).toEqual({ tone: 'error', text: t('api.error.vies_unavailable') });
  });

  it('cancels a sent invoice by a credit note from its fiche; the two fiches link to each other', async () => {
    const worker: WorkerDeps = {
      db: database.db,
      pdp: { mock: adapter },
      test: api.deps.test,
      jobs: api.jobs,
      ai: api.deps.ai,
      mailer: null,
      now: () => new Date(),
    };
    // Paid: no credit note, and the pane says why.
    const paid = row(2)?.invoiceId;
    if (!paid) throw new Error('row 2 has no invoice');
    await controller.openInvoice(paid);
    await controller.creditNote();
    expect(state().notice?.text).toBe(t('api.error.credit_paid'));

    const id = row(4)?.invoiceId;
    if (!id) throw new Error('row 4 has no invoice');
    await controller.openInvoice(id);
    controller.askSend();
    await controller.send();
    await runSend(worker, id);
    await controller.openInvoice(id);
    expect(state().invoice?.detail).toMatchObject({ status: 'deposited', credit: { by: null } });

    await controller.creditNote();
    const avoir = state().invoice?.detail;
    expect(avoir).toMatchObject({ typeCode: '381', isTest: true, credit: { of: { id } } });
    expect(avoir?.number).toMatch(/^TEST-AV\d{4}-0001$/);
    expect(state().notice?.text).toBe(t('addin.credit.made', { number: avoir?.number ?? '' }));

    controller.askSend();
    await controller.send();
    await runSend(worker, avoir?.id ?? '');
    await controller.openInvoice(id);
    expect(state().invoice?.detail).toMatchObject({
      status: 'credited',
      credit: { by: { id: avoir?.id, status: 'deposited' } },
    });
  });

  it('lets a building firm mark a supplier as its sous-traitant, from Réception', async () => {
    const wasTest = state().testMode;
    if (!wasTest) await controller.setTestMode(true);
    expect(await controller.saveSettings({ btp: true })).toBe(true);
    expect(state().me?.tenant.btp).toBe(true);
    controller.navigate({ name: 'reception' });
    await until(() => Array.isArray(state().reception?.subcontractors), 'the switch');
    expect(state().reception?.subcontractors).toEqual([]);
    await controller.receiveTestInbound('normal');
    const [fresh] = state().reception?.inbound ?? [];
    if (!fresh?.supplierSiren) throw new Error('a test invoice with a SIREN expected');
    const codes = () =>
      state()
        .reception?.inbound.find((r) => r.id === fresh.id)
        ?.flags.map((f) => f.code);
    expect(codes()).not.toContain('subcontracting_vat');

    await controller.setSubcontractor(fresh.supplierSiren, true);
    expect(state().notice?.text).toBe(
      t('addin.reception.subcontractorOn', { name: fresh.supplierName }),
    );
    expect(state().reception?.subcontractors).toEqual([fresh.supplierSiren]);
    expect(codes()).toContain('subcontracting_vat');
    await controller.setSubcontractor(fresh.supplierSiren, false);
    expect(codes()).not.toContain('subcontracting_vat');

    expect(await controller.saveSettings({ btp: false })).toBe(true);
    expect(state().me?.tenant.btp).toBe(false);
    if (!wasTest) await controller.setTestMode(false);
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

describe('the checks across documents (R2)', () => {
  const SIREN = '999000201';
  const day = (text: string, value: number) => ({ value, text, format: 'dd/mm/yyyy' });
  // C-41 orders what F2026-101 bills, at 600 € a day instead of 450 €; C-42 is someone else's.
  const book = new FakeWorkbook({
    [DEMO_SHEET]: demoSheet(),
    [DEMO_ORDERS]: {
      A1: 'N° commande',
      B1: 'Date',
      C1: 'Client',
      D1: 'Désignation',
      E1: 'Qté',
      F1: 'PU HT',
      A2: 'C-41',
      B2: day('01/10/2026', 46296),
      C2: 'Boulangerie Martin SAS',
      D2: 'Journée de conseil',
      E2: 2,
      F2: 600,
      A3: 'C-42',
      B3: day('06/10/2026', 46301),
      C3: 'Garage des Lilas',
      D3: 'Étagère murale',
      E3: 2,
      F3: 140,
    },
  });
  const { controller, state } = pane(book);
  const invoiceId = () => {
    const id = controller.rowAt(2)?.invoiceId;
    if (!id) throw new Error('F2026-101 has no invoice');
    return id;
  };
  const b1 = () => state().checks?.findings.find((f) => f.rule === 'B1');

  beforeAll(async () => {
    const vatId = `FR${String((12 + 3 * (Number(SIREN) % 97)) % 97).padStart(2, '0')}${SIREN}`;
    const key = (
      await newTenant(api.request, {
        ...SELLER,
        siren: SIREN,
        vatId,
        ownerEmail: 'controles@entreprise-demo.test',
      })
    ).apiKey;
    const res = await api.request('/settings', {
      method: 'PATCH',
      token: key,
      body: { invoiceDefaults: { ...DEFAULTS, siret: `${SIREN}00015` } },
    });
    expect(res.status).toBe(200);
    await controller.start();
    await controller.signInWithKey(key);
    await until(() => state().detection !== null, 'the invoice columns');
    const columns = state().detection?.mapping;
    if (!columns) throw new Error('no invoice columns');
    await controller.confirmMapping(columns);
    await controller.includeSheet(DEMO_ORDERS);
    const inclusion = state().inclusion;
    if (!inclusion) throw new Error('no proposal');
    await controller.confirmLayout({ ...inclusion.detection.layout, source: 'user' });
  });

  it('shows the 150 € a day the invoice leaves out, with the cells to look at', async () => {
    controller.navigate({ name: 'checks' });
    await until(() => state().checks !== null, 'the checks');
    expect(state().checks).toMatchObject({ atStake: 30_000, blocking: 1, links: [] });
    expect(b1()).toMatchObject({
      severity: 'blocking',
      amount: 30_000,
      invoiceId: invoiceId(),
      isTest: false,
    });
    for (const part of ['F2026-101', 'C-41', 'Journée de conseil', frMoney(30_000, 'EUR')]) {
      expect(b1()?.message).toContain(part);
    }

    const evidence = b1()?.evidence ?? [];
    const fix = evidence.findLast((e) => e.role === 'invoice' && e.cell);
    const order = evidence.find((e) => e.role === 'order' && e.cell);
    if (!fix || !order) throw new Error('no cells');
    // « Voir la commande »: the line of the order.
    await controller.showEvidence(order);
    expect(book.active).toEqual({ sheet: DEMO_ORDERS, cell: 'D2' });
    await controller.showEvidence(fix);
    expect(book.active).toEqual({ sheet: DEMO_SHEET, cell: 'K2' });

    // A document kept by another workbook is named, not selected.
    await controller.showEvidence({ ...order, workbookId: 'another' });
    expect(state().notice?.text).toBe(t('addin.checks.otherWorkbook', { sheet: DEMO_ORDERS }));
    expect(book.active).toEqual({ sheet: DEMO_SHEET, cell: 'K2' });
  });

  it('asks « Oui » or « Non » when two orders look alike, and checks again with the answer', async () => {
    // C-42 becomes the same order as C-41: the invoice no longer says which one it bills.
    book.type(DEMO_ORDERS, 'C3', 'Boulangerie Martin SAS');
    book.type(DEMO_ORDERS, 'D3', 'Journée de conseil');
    book.type(DEMO_ORDERS, 'F3', 600);
    await until(() => (state().checks?.links.length ?? 0) === 2, 'the two proposals', 15_000);
    expect(state().checks?.links.map((l) => [l.from?.number, l.to?.number])).toEqual(
      expect.arrayContaining([
        ['C-41', 'F2026-101'],
        ['C-42', 'F2026-101'],
      ]),
    );
    // Without a link the prices are not compared.
    expect(b1()).toBeUndefined();

    const c42 = state().checks?.links.find((l) => l.from?.number === 'C-42');
    if (!c42) throw new Error('no C-42 proposal');
    await controller.decideLink(c42.id, 'rejected');
    expect(state().notice?.text).toBe(t('addin.checks.decided.rejected'));
    expect(state().checks?.links).toEqual([]);
    expect(b1()?.amount).toBe(30_000);
  });

  it('turns « Envoyer » into « Envoyer quand même »; a finding found meanwhile stops the send', async () => {
    await controller.openInvoice(invoiceId());
    await until(() => state().invoice?.detail.id === invoiceId(), 'the fiche');
    expect(state().invoice?.detail.findings.map((f) => [f.rule, f.amount])).toEqual([
      ['B1', 30_000],
    ]);

    // The order changes while the fiche is open: what the user saw is not what is at stake.
    const reads = () => calls.filter((c) => c.includes(`/sources/${DEMO_ORDERS}/sync`)).length;
    const before = reads();
    book.type(DEMO_ORDERS, 'F2', 700);
    await until(
      () => reads() > before && !state().busy.includes(`source:${DEMO_ORDERS}`),
      'the read of the order',
      15_000,
    );
    controller.askSend();
    await controller.send();
    expect(state().notice?.tone).toBe('error');
    expect(state().notice?.text).toBe(t('api.error.blocking_findings', { count: 1 }));
    expect(state().invoice?.detail.status).toBe('validated');
    // The fiche now shows what is at stake.
    expect(state().invoice?.detail.findings.map((f) => f.amount)).toEqual([50_000]);

    controller.askSend();
    await controller.send();
    expect(state().notice?.text).toBe(t('addin.send.done', { number: 'F2026-101' }));
    expect(calls.filter((c) => c === `POST /invoices/${invoiceId()}/send`)).toHaveLength(2);
    expect(state().invoice?.detail.events.map((e) => e.event)).toContain('sent_despite_findings');
  });
});

describe('purchases and margin (R3)', () => {
  const SIREN = '999000300';
  const day = (text: string, value: number) => ({ value, text, format: 'dd/mm/yyyy' });
  // F2026-101 sells 2 days at 450 €; the latest purchase of the same day cost 500 €, the one before 400 €.
  const PURCHASES = 'Achats';
  const book = new FakeWorkbook({
    [DEMO_SHEET]: demoSheet(),
    [PURCHASES]: {
      A1: 'N° achat',
      B1: 'Date',
      C1: 'Fournisseur',
      D1: 'Désignation',
      E1: 'Qté',
      F1: 'Prix d’achat HT',
      A2: 'A-1',
      B2: day('01/09/2026', 46266),
      C2: 'Conseil Partenaires',
      D2: 'Journée de conseil',
      E2: 5,
      F2: 400,
      A3: 'A-2',
      B3: day('01/10/2026', 46296),
      C3: 'Conseil Partenaires',
      D3: 'Journée de conseil',
      E3: 5,
      F3: 500,
    },
  });
  const { controller, state } = pane(book);
  const b2 = () => state().checks?.findings.find((f) => f.rule === 'B2');

  beforeAll(async () => {
    const vatId = `FR${String((12 + 3 * (Number(SIREN) % 97)) % 97).padStart(2, '0')}${SIREN}`;
    const key = (
      await newTenant(api.request, {
        ...SELLER,
        siren: SIREN,
        vatId,
        ownerEmail: 'achats@entreprise-demo.test',
      })
    ).apiKey;
    const res = await api.request('/settings', {
      method: 'PATCH',
      token: key,
      body: { invoiceDefaults: { ...DEFAULTS, siret: `${SIREN}00015` } },
    });
    expect(res.status).toBe(200);
    await controller.start();
    await controller.signInWithKey(key);
    await until(() => state().detection !== null, 'the invoice columns');
    const columns = state().detection?.mapping;
    if (!columns) throw new Error('no invoice columns');
    await controller.confirmMapping(columns);
    await controller.includeSheet(PURCHASES);
    const inclusion = state().inclusion;
    if (!inclusion) throw new Error('no proposal');
    expect(inclusion.detection.layout.kind).toBe('purchase');
    await controller.confirmLayout({ ...inclusion.detection.layout, source: 'user' });
  });

  it('shows a line sold under its purchase price, and the purchase to look at', async () => {
    controller.navigate({ name: 'checks' });
    await until(() => b2() !== undefined, 'the loss');
    expect(b2()).toMatchObject({ severity: 'blocking', amount: 10_000 });
    expect(b2()?.message).toContain("l'achat A-2 de la feuille « Achats »");
    expect(b2()?.costLinkId).toEqual(expect.any(String));

    // « Voir l'achat »: the row of « Achats ».
    const purchase = b2()?.evidence.find((e) => e.role === 'purchase');
    if (!purchase) throw new Error('no purchase');
    await controller.showEvidence(purchase);
    expect(book.active).toEqual({ sheet: PURCHASES, cell: 'D3' });
    // A supplier invoice received through the platform opens in « Réception ».
    controller.showEvidence({ ...purchase, cell: null, inboundId: 'inbound-1' });
    expect(state().screen).toEqual({ name: 'reception', focus: 'inbound-1' });
    controller.navigate({ name: 'checks' });
  });

  it('takes the purchase before on « Ce n’est pas le même article », and warns under the margin', async () => {
    const link = b2()?.costLinkId;
    if (!link) throw new Error('no cost link');
    await controller.notSameItem(link);
    expect(state().notice?.text).toBe(t('addin.checks.decided.notSameItem'));
    // Bought 400 €, sold 450 €: no loss.
    expect(b2()).toBeUndefined();

    controller.navigate({ name: 'settings' });
    await until(() => state().settings !== null, 'the settings');
    expect(state().settings?.minMarginPercent).toBeNull();
    expect(await controller.saveSettings({ minMarginPercent: 20 })).toBe(true);
    expect(state().settings?.minMarginPercent).toBe(20);
    controller.navigate({ name: 'checks' });
    await until(() => b2() !== undefined, 'the margin');
    // 400 € / 0,8 = 500 €: 50 € short on each day.
    expect(b2()).toMatchObject({ severity: 'warning', amount: 10_000 });
    expect(b2()?.message).toContain('votre marge est de 11,1 %, sous les 20 %');
  });

  it('keeps the margin quiet on « C’est normal », and brings it back on « Retirer » (R7)', async () => {
    const finding = b2();
    if (!finding?.normal) throw new Error('not offered');
    expect(finding.normal.customer).toEqual(expect.any(String));
    await controller.acceptFinding(finding.id, { everyCustomer: false, months: 3 });
    expect(state().notice?.text).toBe(t('addin.checks.decided.normal'));
    expect(b2()).toBeUndefined();
    const exception = state().checks?.exceptions[0];
    expect(exception).toMatchObject({ rule: 'B2', oneCustomer: true, until: expect.any(String) });
    if (!exception) throw new Error('no exception');

    await controller.removeException(exception.id);
    expect(state().notice?.text).toBe(t('addin.checks.decided.removed'));
    expect(state().checks?.exceptions).toEqual([]);
    expect(b2()).toMatchObject({ severity: 'warning', amount: 10_000 });
  });
});

describe('corrections and the assistant (R8)', () => {
  const SIREN = '999000409';
  const day = (text: string, value: number) => ({ value, text, format: 'dd/mm/yyyy' });
  // C-41 orders what F2026-101 bills, at 600 € a day: B1 proposes K2 450 → 600.
  const book = new FakeWorkbook({
    [DEMO_SHEET]: demoSheet(),
    [DEMO_ORDERS]: {
      A1: 'N° commande',
      B1: 'Date',
      C1: 'Client',
      D1: 'Désignation',
      E1: 'Qté',
      F1: 'PU HT',
      A2: 'C-41',
      B2: day('01/10/2026', 46296),
      C2: 'Boulangerie Martin SAS',
      D2: 'Journée de conseil',
      E2: 2,
      F2: 600,
    },
  });
  const K2 = { ...(book.cell(DEMO_SHEET, 'K2') ?? { value: 450, text: '450' }) };
  const CELL = `${DEMO_SHEET}!K2`;
  // The assistant answers only once a test turns it on: the sheets are read without it.
  let assistantOn = false;
  let model = mockModel(textResult('…'));
  let withAi: ReturnType<typeof TestApi>;
  const aiFetch: typeof fetch = async (input, init) => withAi.app.request(String(input), init);
  const { controller, state } = pane(book, memoryStore(), { fetch: aiFetch });
  const b1 = () => state().checks?.findings.find((f) => f.rule === 'B1');
  const k2 = () => book.cell(DEMO_SHEET, 'K2')?.value;
  const openB1 = async () => {
    await until(() => b1()?.fix?.before === '450', 'B1 at 450 €', 15_000);
    const finding = b1();
    if (!finding) throw new Error('no B1');
    return finding;
  };

  beforeAll(async () => {
    withAi = testApi(database, { mock: adapter }, undefined, {
      ai: testAi(database, {
        included: {
          settings: {
            mode: 'included',
            provider: 'mistral',
            models: { agent: 'mock-agent', classify: 'mock-classify' },
          },
          apiKey: 'test',
        },
        handle: (resolved) => (resolved && assistantOn ? handleFor(model) : null),
      }),
    });
    const vatId = `FR${String((12 + 3 * (Number(SIREN) % 97)) % 97).padStart(2, '0')}${SIREN}`;
    const key = (
      await newTenant(withAi.request, {
        ...SELLER,
        siren: SIREN,
        vatId,
        ownerEmail: 'corrections@entreprise-demo.test',
      })
    ).apiKey;
    const res = await withAi.request('/settings', {
      method: 'PATCH',
      token: key,
      body: { invoiceDefaults: { ...DEFAULTS, siret: `${SIREN}00015` } },
    });
    expect(res.status).toBe(200);
    await controller.start();
    await controller.signInWithKey(key);
    await until(() => state().detection !== null, 'the invoice columns');
    const columns = state().detection?.mapping;
    if (!columns) throw new Error('no invoice columns');
    await controller.confirmMapping(columns);
    await controller.includeSheet(DEMO_ORDERS);
    const inclusion = state().inclusion;
    if (!inclusion) throw new Error('no proposal');
    await controller.confirmLayout({ ...inclusion.detection.layout, source: 'user' });
    controller.navigate({ name: 'checks' });
  });

  it('« Corriger pour moi » shows Avant → Après, writes only on « Appliquer », then undoes', async () => {
    const finding = await openB1();
    expect(finding.fix).toMatchObject({ sheet: DEMO_SHEET, cell: 'K2', field: 'price' });
    expect(Number(finding.fix?.after)).toBe(600);
    expect(state().checks?.assistant).toBe(false);

    await controller.fixFinding(finding.id);
    expect(state().card).toMatchObject({
      kind: 'fix',
      findingId: finding.id,
      toolCallId: null,
      conflict: null,
      edit: { status: 'proposed', sheet: DEMO_SHEET, cell: 'K2', before: '450' },
    });
    // Nothing is written before the click.
    expect(k2()).toBe(450);

    await controller.applyCard();
    expect(k2()).toBe(600);
    expect(book.cell(DEMO_SHEET, 'K2')?.format).toBe(K2.format);
    expect(book.active).toEqual({ sheet: DEMO_SHEET, cell: 'K2' });
    expect(state().card).toBeNull();
    expect(state().notice?.text).toBe(
      t('addin.edit.applied', {
        cell: CELL,
        before: '450',
        after: decimalFr(finding.fix?.after ?? ''),
      }),
    );
    const corrected = state().corrected;
    expect(corrected).toMatchObject({ status: 'applied', undoable: true });
    await until(() => b1() === undefined, 'B1 closed');
    if (!corrected) throw new Error('no correction');

    // « Annuler la correction »: the card the other way round, then « Remettre comme avant ».
    await controller.undoCorrection(corrected);
    expect(state().card).toMatchObject({ kind: 'undo', edit: { id: corrected.id } });
    expect(k2()).toBe(600);
    await controller.applyCard();
    expect(k2()).toBe(450);
    expect(state().corrected).toBeNull();
    expect(state().notice?.text).toBe(t('addin.edit.reverted', { cell: CELL, value: '450' }));
    await openB1();
  });

  it('writes nothing over a cell typed since the card, nor over a formula', async () => {
    let finding = await openB1();
    await controller.fixFinding(finding.id);
    // The person types 500 while the card waits.
    book.type(DEMO_SHEET, 'K2', 500);
    await controller.applyCard();
    expect(k2()).toBe(500);
    expect(state().card).toBeNull();
    expect(state().notice).toMatchObject({
      tone: 'warning',
      text: t('addin.edit.conflict.changed', {
        cell: CELL,
        found: '500',
        expected: '450',
        value: decimalFr(finding.fix?.after ?? ''),
      }),
    });

    book.type(DEMO_SHEET, 'K2', 450);
    finding = await openB1();
    book.sheets.get(DEMO_SHEET)?.set('K2', { ...K2, formula: '=450' });
    await controller.fixFinding(finding.id);
    await controller.applyCard();
    expect(book.cell(DEMO_SHEET, 'K2')?.formula).toBe('=450');
    expect(state().notice?.text).toBe(
      t('addin.edit.conflict.formula', {
        cell: CELL,
        found: '=450',
        expected: '450',
        value: decimalFr(finding.fix?.after ?? ''),
      }),
    );
    book.sheets.get(DEMO_SHEET)?.set('K2', { ...K2 });
  });

  it('asks before undoing over a value typed since: « Laisser », then « Remettre quand même »', async () => {
    const finding = await openB1();
    await controller.fixFinding(finding.id);
    await controller.applyCard();
    expect(k2()).toBe(600);
    const corrected = state().corrected;
    if (!corrected) throw new Error('no correction');

    book.type(DEMO_SHEET, 'K2', 700);
    await controller.undoCorrection(corrected);
    await controller.applyCard();
    expect(k2()).toBe(700);
    expect(state().card).toMatchObject({
      kind: 'undo',
      conflict: { reason: 'changed', found: '700' },
    });

    await controller.declineCard();
    expect(state().card).toBeNull();
    expect(state().notice?.text).toBe(t('addin.edit.leftAsIs', { cell: CELL, found: '700' }));
    expect(state().corrected).toMatchObject({ id: corrected.id, undoable: true });
    expect(k2()).toBe(700);

    // Asked again later: the cell still differs, and only « Remettre quand même » writes.
    await controller.undoCorrection(corrected);
    await controller.applyCard();
    expect(state().card?.conflict?.found).toBe('700');
    await controller.overwrite();
    expect(k2()).toBe(450);
    expect(state().card).toBeNull();
    expect(state().corrected).toBeNull();
    await openB1();
  });

  it('opens the chat on the finding; the card the agent asks for waits for « Appliquer »', async () => {
    const finding = await openB1();
    // The assistant off: the chat says so, and « Corriger pour moi » stays.
    await controller.openChat(finding.id);
    expect(state().screen).toEqual({ name: 'chat', findingId: finding.id });
    expect(state().chat?.available).toBe(false);

    assistantOn = true;
    controller.navigate({ name: 'checks' });
    await until(() => state().checks?.assistant === true, 'the assistant');
    await controller.openChat(finding.id);
    expect(state().chat?.available).toBe(true);
    const [opening] = state().chat?.messages ?? [];
    expect(opening?.role).toBe('assistant');
    expect(opening?.parts).toContainEqual({ type: 'text', text: finding.message });

    model = mockModel(
      toolCallResult('proposeFix', {}),
      textResult('C’est corrigé : la facture reprend les 600 € par jour de la commande.'),
    );
    await controller.ask('Corrigez-la pour moi.');
    await until(() => state().card?.toolCallId === 'call-proposeFix', 'the agent’s card');
    expect(state().card).toMatchObject({ kind: 'fix', findingId: finding.id, conflict: null });
    expect(k2()).toBe(450);

    // The pane closes on the card: it waits in the conversation, and comes back with it.
    controller.navigate({ name: 'checks' });
    expect(state().chat).toBeNull();
    await controller.openChat(finding.id);
    await until(() => state().card?.toolCallId === 'call-proposeFix', 'the card again');
    expect(model.doStreamCalls).toHaveLength(1);

    await controller.applyCard();
    expect(k2()).toBe(600);
    // The click goes back to the agent, which says what came of it.
    await until(
      () =>
        state().chat?.status === 'ready' &&
        JSON.stringify(state().chat?.messages.at(-1)).includes('C’est corrigé'),
      'the agent’s answer',
    );
    expect(model.doStreamCalls).toHaveLength(2);
    const told = JSON.stringify(model.doStreamCalls[1]?.prompt);
    expect(told).toContain('"status":"applied"');
    expect(told).toContain('"resolved":true');
    expect(state().chat?.messages.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant']);
    await until(() => b1() === undefined, 'B1 closed');
  });
});

describe('OneDrive files read without Excel (R4)', () => {
  const SIREN = '999000409';
  const FILE = 'Commandes 2026.xlsx';
  const day = (value: number): XlsxCell => ({ date: value });
  // C-41 orders what F2026-101 bills; its price is the one Camille changes in OneDrive.
  const ordersFile = (price: number) =>
    xlsxOf({
      Commandes: [
        ['N° commande', 'Date', 'Client', 'Désignation', 'Qté', 'PU HT'],
        ['C-41', day(46296), 'Boulangerie Martin SAS', 'Journée de conseil', 2, price],
        ['C-42', day(46301), 'Garage des Lilas', 'Étagère murale', 2, 140],
      ],
      Notes: [['Relancer le garage en novembre']],
    });
  let stand: MicrosoftStandIn;
  let microsoft: MicrosoftConnector;
  let r4: ReturnType<typeof TestApi>;
  const r4Fetch: typeof fetch = async (input, init) => r4.app.request(String(input), init);
  const port = standInMicrosoftPort({
    base: 'http://microsoft.test',
    account: 'msa-camille',
    fetch: (input, init) => inProcess(stand.app)(input, init),
  });
  // Only the invoice sheet is in the workbook: the orders live in OneDrive.
  const book = new FakeWorkbook({ [DEMO_SHEET]: demoSheet() });
  const { controller, state, tokens } = pane(book, memoryStore(), {
    fetch: r4Fetch,
    microsoft: port,
  });
  const b1 = () => state().checks?.findings.find((f) => f.rule === 'B1');
  const file = () => state().connector?.connection?.files.find((f) => f.name === FILE);

  beforeAll(async () => {
    stand = new MicrosoftStandIn({
      ...MICROSOFT_STAND_IN_APP,
      publicUrl: 'http://microsoft.test',
      fetcher: inProcess({ request: (path, init) => r4.app.request(path, init) }),
    });
    microsoft = {
      client: createMicrosoftClient({
        ...MICROSOFT_STAND_IN_APP,
        loginUrl: 'http://microsoft.test',
        graphUrl: 'http://microsoft.test/graph/v1.0',
        fetcher: inProcess(stand.app),
      }),
      clientId: MICROSOFT_STAND_IN_APP.clientId,
      sealingKey: Buffer.alloc(32, 9).toString('base64'),
      notificationUrl: 'http://api.test/webhooks/microsoft',
    };
    r4 = testApi(database, { mock: adapter }, undefined, { microsoft });
    const vatId = `FR${String((12 + 3 * (Number(SIREN) % 97)) % 97).padStart(2, '0')}${SIREN}`;
    const key = (
      await newTenant(r4.request, {
        ...SELLER,
        siren: SIREN,
        vatId,
        ownerEmail: 'onedrive@entreprise-demo.test',
      })
    ).apiKey;
    const res = await r4.request('/settings', {
      method: 'PATCH',
      token: key,
      body: { invoiceDefaults: { ...DEFAULTS, siret: `${SIREN}00015` } },
    });
    expect(res.status).toBe(200);
    await controller.start();
    await controller.signInWithKey(key);
    await until(() => state().detection !== null, 'the invoice columns');
    const columns = state().detection?.mapping;
    if (!columns) throw new Error('no invoice columns');
    await controller.confirmMapping(columns);
  });

  it('says calmly when this Office cannot sign in, or when the person closes Microsoft’s window', async () => {
    controller.navigate({ name: 'registry' });
    await until(() => state().connector !== null, 'the OneDrive section');
    expect(state().connector).toMatchObject({
      microsoft: { clientId: MICROSOFT_STAND_IN_APP.clientId },
      connection: null,
    });
    for (const reason of ['unsupported', 'cancelled'] as const) {
      const refusing: MicrosoftPort = {
        signIn: async () => {
          throw new MicrosoftPortError(reason);
        },
        pick: async () => [],
      };
      const other = pane(book, tokens, { fetch: r4Fetch, microsoft: refusing });
      await other.controller.start();
      other.controller.navigate({ name: 'registry' });
      await until(() => other.state().connector !== null, 'the OneDrive section');
      await other.controller.connectMicrosoft();
      expect(other.state().notice?.text).toBe(t(`addin.connector.port.${reason}`));
      expect(other.state().connector?.connection).toBeNull();
    }
  });

  it('suggests OneDrive once, from the workbook’s address or the mail, and never connects by itself', async () => {
    const session = (await tokens.get('token')) ?? '';
    const ONEDRIVE = 'https://d.docs.live.net/4f1c0a2b9d/Documents/Factures%202026.xlsx';
    // The API's answer for a person whose mail domain is served by Microsoft (connectors.test.ts).
    const mailFetch: typeof fetch = async (input, init) => {
      const res = await r4Fetch(input, init);
      if (!String(input).endsWith('/connectors/microsoft') || (init?.method ?? 'GET') !== 'GET') {
        return res;
      }
      return Response.json({ ...(await res.json()), mailOnMicrosoft: true });
    };
    const open = async (url: string | null, store = memoryStore(), fetch = r4Fetch) => {
      await store.set('token', session);
      const p = pane(book, store, { fetch, microsoft: port, documentUrl: () => url });
      await p.controller.start();
      return p;
    };

    for (const url of [
      null,
      'C:\\Users\\camille\\Factures.xlsx',
      'https://d.docs.live.net.evil.test/x.xlsx',
    ]) {
      const here = await open(url);
      await until(() => here.state().connector !== null, 'the OneDrive section');
      expect(here.state().onedriveHint).toBeNull();
    }

    const store = memoryStore();
    const there = await open(ONEDRIVE, store);
    await until(() => there.state().onedriveHint !== null, 'the suggestion');
    expect(there.state().onedriveHint).toBe('document');
    expect(there.state().connector?.connection).toBeNull();
    await there.controller.answerOnedriveHint(false);
    expect(there.state().onedriveHint).toBeNull();
    // Answered: not again on this device, even with the workbook still on OneDrive.
    const later = await open(ONEDRIVE, store);
    await until(() => later.state().screen.name === 'dashboard', 'the dashboard');
    await later.controller.loadRegistry();
    expect(later.state().onedriveHint).toBeNull();
    expect(await store.get('scout.onedrive')).toBe('declined');

    const mail = await open(null, memoryStore(), mailFetch);
    await until(() => mail.state().onedriveHint !== null, 'the suggestion');
    expect(mail.state().onedriveHint).toBe('mail');
    await mail.controller.answerOnedriveHint(true);
    expect(mail.state().screen).toEqual({ name: 'registry' });
    expect(mail.state().onedriveHint).toBeNull();
    expect(mail.state().connector?.connection).toBeNull();

    // A pane without Microsoft's port suggests nothing.
    const bare = memoryStore();
    await bare.set('token', session);
    const none = pane(book, bare, { fetch: mailFetch, documentUrl: () => ONEDRIVE });
    await none.controller.start();
    await none.controller.loadRegistry();
    expect(none.state().onedriveHint).toBeNull();
  });

  it('finds the 300 € an order changed in OneDrive puts at stake, with the file named', async () => {
    await stand.putFile('msa-camille', 'cmd-r4', FILE, ordersFile(450));
    await controller.connectMicrosoft();
    expect(state().notice?.text).toBe(
      t('addin.connector.connected', { account: 'camille.martin@outlook.fr' }),
    );
    expect(state().connector?.connection).toMatchObject({
      accountKind: 'personal',
      status: 'active',
      notified: true,
      files: [],
    });

    // Only the file picked in OneDrive's picker is read.
    await controller.pickFiles();
    expect(state().notice?.text).toBe(t('addin.connector.picked', { count: 1 }));
    expect(file()?.sheets.map((s) => [s.sheet, s.source])).toEqual([
      ['Commandes', null],
      ['Notes', null],
    ]);
    const fileId = file()?.id ?? '';

    // « Inclure »: the proposal and the column pickers come from the API's own read of the file.
    await controller.includeFileSheet(fileId, 'Commandes');
    const inclusion = state().inclusion;
    if (!inclusion) throw new Error('no proposal');
    expect(inclusion.file).toEqual({ id: fileId, name: FILE, provider: 'microsoft' });
    expect(inclusion.detection.layout.kind).toBe('order');
    expect(inclusion.headers.map((h) => h.text)).toEqual([
      'N° commande',
      'Date',
      'Client',
      'Désignation',
      'Qté',
      'PU HT',
    ]);
    expect(controller.inclusionHeaders(2)[0]).toEqual({ col: 'A', text: 'C-41' });
    await controller.confirmLayout({ ...inclusion.detection.layout, source: 'user' });
    expect(state().notice?.text).toBe(
      t('addin.connector.included', { sheet: 'Commandes', file: FILE, docs: 2 }),
    );
    expect(state().inclusion).toBeNull();
    expect(file()?.sheets[0]?.source).toMatchObject({ type: 'file', fileId, kind: 'order' });
    expect(state().registry?.recent).toContainEqual(
      expect.objectContaining({ number: 'C-41', file: FILE, sheet: 'Commandes' }),
    );

    // The order and the invoice agree.
    await controller.loadChecks();
    expect(b1()).toBeUndefined();

    // Camille raises the day to 600 € in OneDrive; Graph tells the API, whose worker reads the file.
    const queued = r4.jobs.connectors.length;
    await stand.putFile('msa-camille', 'cmd-r4', FILE, ordersFile(600));
    const [connection] = r4.jobs.connectors.slice(queued);
    if (!connection) throw new Error('no notification');
    expect(await checkConnection({ ...r4.deps, microsoft }, connection)).toEqual({ read: 1 });

    await controller.loadChecks();
    expect(b1()).toMatchObject({ severity: 'blocking', amount: 30_000 });
    const order = b1()?.evidence.find((e) => e.role === 'order');
    expect(order).toMatchObject({ number: 'C-41', file: FILE, sheet: 'Commandes' });
    // « Voir la commande »: a file's line is named, not looked for in the open workbook.
    if (!order) throw new Error('no order');
    const active = book.active;
    await controller.showEvidence(order);
    expect(state().notice?.text).toBe(
      t('addin.connector.inFile', { file: FILE, sheet: 'Commandes' }),
    );
    expect(book.active).toEqual(active);
  });

  it('takes a sheet out, then disconnects: what the files gave leaves, the invoices stay', async () => {
    controller.navigate({ name: 'registry' });
    await until(() => file() !== undefined, 'the picked file');
    const fileId = file()?.id ?? '';
    await controller.removeFileSheet(fileId, 'Commandes');
    expect(file()?.sheets[0]).toMatchObject({ sheet: 'Commandes', source: null });
    expect(state().registry?.recent.filter((d) => d.file !== null)).toEqual([]);

    await controller.disconnectMicrosoft();
    expect(state().notice?.text).toBe(t('addin.connector.disconnected'));
    expect(state().connector?.connection).toBeNull();
    await controller.loadChecks();
    expect(b1()).toBeUndefined();
    // The three invoices of the sheet stay in the registry.
    expect(state().registry?.invoices.sent).toBe(3);
  });
});

describe('Google Drive files read without Excel (R5)', () => {
  const SIREN = '999000417';
  const FILE = 'Commandes 2026';
  const day = (value: number): XlsxCell => ({ date: value });
  const ordersFile = (price: number) =>
    xlsxOf({
      Commandes: [
        ['N° commande', 'Date', 'Client', 'Désignation', 'Qté', 'PU HT'],
        ['C-41', day(46296), 'Boulangerie Martin SAS', 'Journée de conseil', 2, price],
        ['C-42', day(46301), 'Garage des Lilas', 'Étagère murale', 2, 140],
      ],
    });
  let stand: GoogleStandIn;
  let google: GoogleConnector;
  let r5: ReturnType<typeof TestApi>;
  const r5Fetch: typeof fetch = async (input, init) => r5.app.request(String(input), init);
  const path = (url: string) => {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  };
  /** The person in the browser: our page sets the ticket, Google's window answers, back to the API. */
  const browser = async (url: string) => {
    const begin = await r5.app.request(path(url));
    const cookie = (begin.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const atGoogle = await stand.app.request(path(begin.headers.get('location') ?? ''));
    const back = await r5.app.request(path(atGoogle.headers.get('location') ?? ''), {
      headers: { cookie },
    });
    expect(back.status).toBe(200);
    return true;
  };
  const book = new FakeWorkbook({ [DEMO_SHEET]: demoSheet() });
  const { controller, state, tokens } = pane(book, memoryStore(), {
    fetch: r5Fetch,
    openUrl: browser,
  });
  const b1 = () => state().checks?.findings.find((f) => f.rule === 'B1');
  const file = () => state().google?.connection?.files.find((f) => f.name === FILE);

  beforeAll(async () => {
    stand = new GoogleStandIn({
      ...GOOGLE_STAND_IN_APP,
      fetcher: inProcess({ request: (p, init) => r5.app.request(p, init) }),
    });
    google = {
      client: createGoogleClient({
        ...GOOGLE_STAND_IN_APP,
        accountsUrl: 'http://google.test/accounts',
        oauthUrl: 'http://google.test/oauth',
        apiUrl: 'http://google.test/api',
        fetcher: inProcess(stand.app),
      }),
      sealingKey: Buffer.alloc(32, 9).toString('base64'),
      redirectUrl: 'http://api.test/connectors/google/callback',
      notificationUrl: 'http://api.test/webhooks/google',
    };
    r5 = testApi(database, { mock: adapter }, undefined, { google });
    const vatId = `FR${String((12 + 3 * (Number(SIREN) % 97)) % 97).padStart(2, '0')}${SIREN}`;
    const key = (
      await newTenant(r5.request, {
        ...SELLER,
        siren: SIREN,
        vatId,
        ownerEmail: 'google@entreprise-demo.test',
      })
    ).apiKey;
    const res = await r5.request('/settings', {
      method: 'PATCH',
      token: key,
      body: { invoiceDefaults: { ...DEFAULTS, siret: `${SIREN}00015` } },
    });
    expect(res.status).toBe(200);
    await controller.start();
    await controller.signInWithKey(key);
    await until(() => state().detection !== null, 'the invoice columns');
    const columns = state().detection?.mapping;
    if (!columns) throw new Error('no invoice columns');
    await controller.confirmMapping(columns);
  });

  it('shows a link when the window cannot open by itself', async () => {
    const session = (await tokens.get('token')) ?? '';
    const store = memoryStore();
    await store.set('token', session);
    const blocked = pane(book, store, { fetch: r5Fetch, openUrl: async () => false });
    await blocked.controller.start();
    blocked.controller.navigate({ name: 'registry' });
    await until(() => blocked.state().google !== null, 'the Google Drive section');
    expect(blocked.state().google).toEqual({ available: true, connection: null });
    await blocked.controller.openGoogle();
    expect(blocked.state().notice?.text).toBe(t('addin.google.openLink'));
    expect(blocked.state().googleLink).toMatch(
      /^http:\/\/api\.test\/connectors\/google\/begin\?ticket=/,
    );
    await blocked.controller.signOut();
  });

  it('finds the 300 € an order changed in Google Sheets puts at stake', async () => {
    controller.navigate({ name: 'registry' });
    await until(() => state().google !== null, 'the Google Drive section');
    await stand.putFile('g-camille', 'gs-r5', FILE, ordersFile(450), GOOGLE_SHEET_TYPE);
    stand.choose({ account: 'g-camille', pick: ['gs-r5'] });
    await controller.openGoogle();
    await until(() => file() !== undefined, 'the file picked in Google’s window');
    await until(
      () =>
        state().notice?.text === t('addin.google.updated', { account: 'camille.martin@gmail.com' }),
      'the pane told',
    );
    expect(state().google?.connection).toMatchObject({
      accountKind: 'personal',
      status: 'active',
      notified: true,
    });
    const fileId = file()?.id ?? '';
    await controller.includeFileSheet(fileId, 'Commandes');
    const inclusion = state().inclusion;
    if (!inclusion) throw new Error('no proposal');
    expect(inclusion.file).toEqual({ id: fileId, name: FILE, provider: 'google' });
    await controller.confirmLayout({ ...inclusion.detection.layout, source: 'user' });
    expect(state().notice?.text).toBe(
      t('addin.connector.included', { sheet: 'Commandes', file: FILE, docs: 2 }),
    );
    expect(file()?.sheets[0]?.source).toMatchObject({ type: 'file', fileId, kind: 'order' });
    await controller.loadChecks();
    expect(b1()).toBeUndefined();

    const queued = r5.jobs.connectors.length;
    await stand.putFile('g-camille', 'gs-r5', FILE, ordersFile(600), GOOGLE_SHEET_TYPE);
    const [connection] = r5.jobs.connectors.slice(queued);
    if (!connection) throw new Error('no notification');
    expect(await checkConnection({ ...r5.deps, google }, connection)).toEqual({ read: 1 });
    await controller.loadChecks();
    expect(b1()).toMatchObject({ severity: 'blocking', amount: 30_000 });
  });

  it('removes the file, then disconnects: our token is revoked at Google', async () => {
    const fileId = file()?.id ?? '';
    await controller.removeFileSheet(fileId, 'Commandes');
    expect(file()?.sheets[0]).toMatchObject({ sheet: 'Commandes', source: null });
    await controller.removeFile(fileId);
    expect(state().notice?.text).toBe(t('addin.connector.fileRemoved', { file: FILE }));
    expect(state().google?.connection?.files).toEqual([]);
    await controller.disconnectGoogle();
    expect(state().notice?.text).toBe(t('addin.google.disconnected'));
    expect(state().google?.connection).toBeNull();
    expect(stand.connected('g-camille')).toBe(false);
  });
});

describe('files uploaded from the pane (R6)', () => {
  const SIREN = '999000607';
  const SUPPLIER = '600000004';
  // « Conseil Partenaires » bills the company 5 days of consulting at 500 €; F2026-101 sells 2 at 450 €.
  const supplierInvoice = (number: string) => {
    const vatId = (siren: string) =>
      `FR${String((12 + 3 * (Number(siren) % 97)) % 97).padStart(2, '0')}${siren}`;
    const address = { line1: '1 rue Haute', city: 'Dijon', postCode: '21000', country: 'FR' };
    return toCii(
      computeInvoice(
        InvoiceDraft.parse({
          processType: 'S1',
          number,
          issueDate: '2026-10-01',
          typeCode: '380',
          currency: 'EUR',
          dueDate: '2026-10-31',
          seller: {
            name: 'Conseil Partenaires',
            legalId: { id: SUPPLIER, scheme: '0002' },
            vatId: vatId(SUPPLIER),
            electronicAddress: { id: SUPPLIER, scheme: '0225' },
            address,
          },
          buyer: {
            name: SELLER.name,
            legalId: { id: SIREN, scheme: '0002' },
            vatId: vatId(SIREN),
            electronicAddress: { id: SIREN, scheme: '0225' },
            address,
          },
          payment: { meansCode: '30', accounts: [{ iban: 'FR7630006000011234567890189' }] },
          lines: [
            {
              id: '1',
              quantity: '5',
              unitCode: 'C62',
              price: { net: '500.00' },
              vat: { category: 'S', rate: '20' },
              item: { name: 'Journée de conseil' },
              nature: 'services',
            },
          ],
        }),
      ),
    );
  };
  const book = new FakeWorkbook({ [DEMO_SHEET]: demoSheet() });
  const { controller, state } = pane(book);
  const b2 = () => state().checks?.findings.find((f) => f.rule === 'B2');
  const uploaded = (name: string) => state().uploads?.find((u) => u.name === name);
  const FILE = 'Facture CP-2026-77.xml';

  beforeAll(async () => {
    const vatId = `FR${String((12 + 3 * (Number(SIREN) % 97)) % 97).padStart(2, '0')}${SIREN}`;
    const key = (
      await newTenant(api.request, {
        ...SELLER,
        siren: SIREN,
        vatId,
        ownerEmail: 'import@entreprise-demo.test',
      })
    ).apiKey;
    const res = await api.request('/settings', {
      method: 'PATCH',
      token: key,
      body: { invoiceDefaults: { ...DEFAULTS, siret: `${SIREN}00015` } },
    });
    expect(res.status).toBe(200);
    await controller.start();
    await controller.signInWithKey(key);
    await until(() => state().detection !== null, 'the invoice columns');
    const columns = state().detection?.mapping;
    if (!columns) throw new Error('no invoice columns');
    await controller.confirmMapping(columns);
  });

  it('takes a supplier invoice: its price is the cost, and B2 finds the loss', async () => {
    controller.navigate({ name: 'registry' });
    await until(() => state().uploads !== null, 'the uploads section');
    expect(state().uploads).toEqual([]);
    const xml = new Blob([supplierInvoice('CP-2026-77')], { type: 'application/xml' });
    await controller.uploadFile(xml, FILE);
    expect(state().notice?.text).toBe(
      t('addin.upload.invoiceAdded', { number: 'CP-2026-77', supplier: 'Conseil Partenaires' }),
    );
    expect(uploaded(FILE)).toMatchObject({
      format: 'cii',
      kind: 'invoice',
      sheets: [],
      invoice: { number: 'CP-2026-77', lines: 1, netTotal: 250_000, received: false },
    });
    // The same file again: nothing changed.
    await controller.uploadFile(xml, FILE);
    expect(state().notice?.text).toBe(t('addin.upload.same', { file: FILE }));

    controller.navigate({ name: 'checks' });
    await until(() => b2() !== undefined, 'the loss');
    expect(b2()).toMatchObject({ severity: 'blocking', amount: 10_000 });
    expect(b2()?.message).toContain('(la facture CP-2026-77 de Conseil Partenaires)');
    expect(b2()?.evidence.find((e) => e.role === 'purchase')).toMatchObject({ file: FILE });
  });

  it('says calmly what it cannot take, and « Retirer le fichier » takes the cost away', async () => {
    controller.navigate({ name: 'registry' });
    const plainPdf = [
      '%PDF-1.4',
      '1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj',
      '2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj',
      '3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 595 842]>> endobj',
      'trailer <</Root 1 0 R>>',
      '%%EOF',
    ].join('\n');
    await controller.uploadFile(new Blob([plainPdf]), 'scan.pdf');
    expect(state().notice).toEqual({ tone: 'error', text: t('api.error.upload_plain_pdf') });
    await controller.uploadFile(new Blob(['%PDF-1.4\n']), 'broken.pdf');
    expect(state().notice).toEqual({ tone: 'error', text: t('api.error.upload_unreadable') });
    expect(state().uploads?.map((u) => u.name)).toEqual([FILE]);

    await controller.removeFile(uploaded(FILE)?.id ?? '');
    expect(state().notice?.text).toBe(t('addin.upload.removed', { file: FILE }));
    expect(state().uploads).toEqual([]);
    controller.navigate({ name: 'checks' });
    await until(() => b2() === undefined, 'the loss gone');
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

describe('relocated status columns', () => {
  it('syncs Google edits when the status columns come before the invoice data', async () => {
    const shifted = Object.fromEntries(
      Object.entries(demoSheet()).map(([address, cell]) => {
        const match = /^([A-Z]+)(\d+)$/.exec(address);
        return [`${columnLetters(columnIndex(match?.[1] ?? 'A') + 2)}${match?.[2]}`, cell];
      }),
    );
    const book = new FakeWorkbook({
      [DEMO_SHEET]: { ...shifted, A1: 'FI_Statut', B1: 'FI_Détail' },
    });
    const native = fakeGoogleSheets(book);
    const port = googleSheetsPort(async (request) => native.host.dispatch(request), {
      pollMs: 20,
      reconcileMs: 60_000,
    });
    const { controller, state } = pane(book, memoryStore(), { port });
    try {
      await controller.start();
      await controller.signInWithKey(apiKey);
      await until(() => state().detection !== null, 'Google column detection');
      const mapping = state().detection?.mapping;
      if (!mapping) throw new Error('no mapping');
      await controller.confirmMapping(mapping);
      await controller.sync();
      const path = `/workbooks/${state().workbookId}/sync`;
      const syncs = () => calls.filter((call) => call === `POST ${path}`).length;
      const before = syncs();
      book.type(DEMO_SHEET, 'M2', 600);
      await until(() => syncs() > before, 'edit after front status columns');
    } finally {
      await controller.signOut();
      port.close();
    }
  });

  it('syncs user data between separated status columns, but ignores the two owned columns', async () => {
    const book = new FakeWorkbook({
      [DEMO_SHEET]: {
        ...demoSheet(),
        M1: 'FI_Statut',
        N1: 'Commentaire',
        N2: 'Note',
        O1: 'FI_Détail',
      },
    });
    let changed: (address: string) => void = () => {};
    book.onChange = async (_sheet, handler) => {
      changed = handler;
      return async () => {};
    };
    const { controller, state } = pane(book);
    try {
      await controller.start();
      await controller.signInWithKey(apiKey);
      await until(() => state().detection !== null, 'separated status column detection');
      const mapping = state().detection?.mapping;
      if (!mapping) throw new Error('no mapping');
      await controller.confirmMapping(mapping);
      await controller.sync();
      const path = `/workbooks/${state().workbookId}/sync`;
      const syncs = () => calls.filter((call) => call === `POST ${path}`).length;
      const before = syncs();
      book.type(DEMO_SHEET, 'N2', 'Changed note');
      changed('N2');
      await until(() => syncs() > before, 'user column between status columns');
      const after = syncs();
      changed('M2');
      changed('O2');
      changed('M2:M4,O2:O4');
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(syncs()).toBe(after);
    } finally {
      await controller.signOut();
    }
  });
});
