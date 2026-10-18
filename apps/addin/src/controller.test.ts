// The task pane's flows against the real API in memory (PGlite): every answer goes through the
// add-in's Zod schemas, so a change on either side that breaks the other fails here.
import {
  fakeAdapter,
  linkToken,
  newTenant,
  runSend,
  runSync,
  type testApi as TestApi,
  testApi,
  testDatabase,
  type WorkerDeps,
} from '@fi/api/testing';
import { type MessageKey, t } from '@fi/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Controller, type FiState, SETTING, SHEET_POLL_MAX_MS, SHEET_POLL_MS } from './controller';
import { FakeWorkbook } from './excel/fake';
import { DEMO_DEFAULTS, DEMO_OWNER, DEMO_SELLER, DEMO_SHEET, demoSheet } from './harness/demo';
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

function pane(book: FakeWorkbook, tokens = memoryStore()) {
  const id = `test-${String(++workbooks).padStart(4, '0')}`;
  const controller = new Controller({
    port: book,
    tokens,
    apiBase: BASE,
    fetch: fetchFn,
    timers: fastTimers,
    writerClock: { now: () => Date.now(), setTimeout: (fn) => setTimeout(fn, 0) },
    newId: () => id,
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
