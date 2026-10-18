// The task pane's state and actions, shared by the screens and the ribbon buttons (one shared runtime,
// docs/OFFICE.md §2). Screens render `state`; nothing here knows about React.
import { columnIndex, frDate, parseAddress, SheetMapping } from '@fi/core';
import { type MessageKey, t } from '@fi/shared';
import {
  type AiChoice,
  ApiClient,
  ApiFailure,
  type BillingView,
  type Degraded,
  type DirectoryCompany,
  type Explained,
  type ExportFile,
  type Inbound,
  type InboundExport,
  type InvoiceDetail,
  type Me,
  type Offer,
  Offline,
  type Party,
  type PartyFinding,
  type PartyPatch,
  type PartyQuery,
  type PostalAddress,
  type Rehearsal,
  type RowStatus,
  type Scenario,
  type Settings,
  type SettingsPatch,
  type SignupOffer,
  type SyncResult,
  type TestInboundKind,
  type WeeklyReport,
} from './api';
import type { ExcelPort, StatusPlan } from './excel/port';
import {
  detectionSample,
  headersOf,
  readUsedRange,
  type SheetReading,
  statusColumns,
  TooManyRows,
} from './excel/reader';
import { StatusWriter, type WriterClock } from './excel/writer';
import { OfflineQueue, systemTimers, type Timers } from './offline';
import type { KeyValueStore } from './storage';

export type Screen =
  | { name: 'login' }
  | { name: 'signup' }
  | { name: 'detect' }
  | { name: 'dashboard' }
  | { name: 'invoice'; id: string; confirmSend: boolean }
  | { name: 'reception' }
  | { name: 'customers' }
  | { name: 'settings' };

export interface Notice {
  tone: 'error' | 'warning' | 'success' | 'info';
  text: string;
}

export interface Header {
  col: string;
  text: string;
}

export interface OpenInvoice {
  detail: InvoiceDetail;
  explained: Explained | null;
  rehearsal: Rehearsal | null;
  xml: string | null;
  pdfUrl: string | null;
}

/** « Créer un compte »: the SIREN, then the company to confirm, then the e-mailed link to open. */
export interface Signup {
  step: 'siren' | 'company' | 'waiting';
  siren: string;
  /** What the directory found; null: the person types the company (directory down). */
  found: DirectoryCompany | null;
  email: string | null;
}

/** Réception: the supplier invoices of the side « Mode test » shows (test or real). */
export interface Reception {
  test: boolean;
  inbound: Inbound[];
  exports: InboundExport[];
}

/** Clients: the fiche clients, and the last « Chercher dans l'annuaire » with what was asked. */
export interface Customers {
  parties: Party[];
  query: PartyQuery;
  finding: PartyFinding | null;
  /** The buyer's name on the sheet, when « Trouver ce client » started the search. */
  sheetName: string | null;
}

export interface FiState {
  booted: boolean;
  /** Office could not start in this window (opened outside Excel, or blocked). */
  outsideExcel: boolean;
  me: Me | null;
  screen: Screen;
  sheet: string | null;
  workbookId: string | null;
  mapping: SheetMapping | null;
  detection: { mapping: SheetMapping; degraded: Degraded | null; headers: Header[] } | null;
  testMode: boolean;
  sync: { result: SyncResult; at: number } | null;
  invoice: OpenInvoice | null;
  settings: Settings | null;
  /** The weekly card of the Tableau de bord; null until loaded, or where it could not be. */
  report: WeeklyReport | null;
  reception: Reception | null;
  /** Clients; null until loaded. */
  customers: Customers | null;
  /** Actions running now ('sync', 'detect', 'send', …): their buttons show a spinner. */
  busy: string[];
  /** null when online; otherwise the actions waiting for the connection. */
  offline: string[] | null;
  notice: Notice | null;
  magicLink: boolean;
  link: { email: string } | null;
  /** Null where this server offers no sign-up. */
  signupOffer: SignupOffer | null;
  signup: Signup | null;
  /** Réglages → Abonnement; null until loaded. */
  billing: BillingView | null;
  /** Office says purchases may be shown here (false on iPad: Office.context.commerceAllowed). */
  commerce: boolean;
  /** The Stripe page last prepared, for the person to open if the window did not. */
  pageLink: string | null;
}

/** Statuses that move without the user: the open fiche refreshes itself while they last. */
const MOVING = new Set(['ready_to_send', 'sending', 'deposited', 'delivered']);
export const POLL_MS = 3_000;
export const POLL_TIMES = 20;
export const LINK_POLL_MS = 2_000;
export const AUTO_SYNC_MS = 1_500;
/** While invoices on the sheet are on their way: first status check, then twice as late each time. */
export const SHEET_POLL_MS = 30_000;
export const SHEET_POLL_MAX_MS = 300_000;

const TOKEN_KEY = 'token';

const PLAYED: Record<Scenario, MessageKey> = {
  pdp_reject: 'addin.scenario.played.pdp_reject',
  customer_refuse: 'addin.scenario.played.customer_refuse',
  pay_late: 'addin.scenario.played.pay_late',
  siren_unknown: 'addin.scenario.played.siren_unknown',
};
export const SETTING = {
  workbookId: 'fi.workbookId',
  testMode: 'fi.testMode',
  mapping: (sheet: string) => `fi.mapping:${sheet}`,
} as const;

export interface ControllerDeps {
  port: ExcelPort;
  tokens: KeyValueStore;
  apiBase: string;
  fetch?: typeof fetch;
  timers?: Timers;
  writerClock?: WriterClock;
  now?: () => number;
  newId?: () => string;
  /** Opens the task pane from a ribbon button (sideloaded and centrally deployed add-ins only). */
  showTaskpane?: () => Promise<void>;
  /** Blob → URL for the PDF viewer; absent in Node tests. */
  objectUrl?: { create: (blob: Blob) => string; revoke: (url: string) => void };
  /** Opens a Stripe page outside the pane; false when it could not (the pane then shows a link). */
  openUrl?: (url: string) => Promise<boolean>;
  /** Office.context.commerceAllowed; default true. */
  commerceAllowed?: boolean;
}

const INITIAL: FiState = {
  booted: false,
  outsideExcel: false,
  me: null,
  screen: { name: 'login' },
  sheet: null,
  workbookId: null,
  mapping: null,
  detection: null,
  testMode: false,
  sync: null,
  invoice: null,
  settings: null,
  report: null,
  reception: null,
  customers: null,
  busy: [],
  offline: null,
  notice: null,
  magicLink: false,
  link: null,
  signupOffer: null,
  signup: null,
  billing: null,
  commerce: true,
  pageLink: null,
};

export class Controller {
  #state: FiState = INITIAL;
  readonly #listeners = new Set<() => void>();
  readonly #deps: Required<Omit<ControllerDeps, 'fetch' | 'objectUrl' | 'commerceAllowed'>> &
    Pick<ControllerDeps, 'objectUrl'>;
  readonly api: ApiClient;
  readonly #writer: StatusWriter;
  readonly #queue: OfflineQueue;
  #token: string | null = null;
  #reading: SheetReading | null = null;
  #statusCols: { statusCol: string; detailCol: string } | null = null;
  #stopListening: (() => Promise<void>) | null = null;
  #autoSync: unknown = null;
  #syncing: Promise<void> | null = null;
  #syncAgain = false;
  #linkTimer: unknown = null;
  #linkRequest: { id: string; kind: 'login' | 'signup' } | null = null;
  #poll: { timer: unknown; left: number } | null = null;
  #sheetPoll: { timer: unknown; delay: number } | null = null;

  constructor(deps: ControllerDeps) {
    this.#deps = {
      timers: systemTimers,
      writerClock: { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms) },
      now: () => Date.now(),
      newId: () => crypto.randomUUID(),
      showTaskpane: async () => {},
      openUrl: async () => false,
      ...deps,
    };
    this.#state = { ...INITIAL, commerce: deps.commerceAllowed !== false };
    this.api = new ApiClient(deps.apiBase, () => this.#token, deps.fetch);
    this.#writer = new StatusWriter(deps.port, this.#deps.writerClock);
    this.#queue = new OfflineQueue(
      (labels) =>
        this.#set({ offline: labels.length > 0 ? labels : this.#state.offline && labels }),
      this.#deps.timers,
    );
  }

  // ── Store (useSyncExternalStore) ──────────────────────────────────────────────────────────────
  getState = (): FiState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  #set(patch: Partial<FiState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const l of this.#listeners) l();
  }

  #busy(key: string, on: boolean): void {
    const busy = this.#state.busy.filter((k) => k !== key);
    this.#set({ busy: on ? [...busy, key] : busy });
  }

  notify(tone: Notice['tone'], text: string): void {
    this.#set({ notice: { tone, text } });
  }

  dismiss = (): void => this.#set({ notice: null });

  navigate = (screen: Screen): void => {
    if (screen.name !== 'invoice') this.#closeInvoice();
    this.#set({ screen, notice: null });
    if (screen.name === 'settings') {
      if (!this.#state.settings) void this.loadSettings();
      void this.loadBilling();
    }
    if (screen.name === 'dashboard') void this.loadReport();
    if (screen.name === 'reception') void this.loadReception();
    if (screen.name === 'customers') void this.loadCustomers();
  };

  /** The connection is back (browser `online` event). */
  online = (): void => this.#queue.retryNow();

  /** Office never started in this window: the pane says to open it from Excel. */
  outside = (): void => this.#set({ outsideExcel: true, booted: true });

  // ── Errors ────────────────────────────────────────────────────────────────────────────────────
  #fail(e: unknown): void {
    if (e instanceof ApiFailure) {
      if (e.status === 401) {
        void this.#signedOut({ tone: 'error', text: e.message });
        return;
      }
      this.notify('error', e.message);
      return;
    }
    if (e instanceof TooManyRows) {
      this.notify('error', t('addin.sync.tooMany', { rows: e.rows }));
      return;
    }
    console.error(e);
    this.notify('error', t('addin.error.unexpected'));
  }

  /**
   * Runs an action with its spinner. Offline: a `queue`d action waits for the connection, any
   * other says « en attente de connexion »; other errors become a calm notice.
   */
  async #act<T>(
    busy: string,
    fn: () => Promise<T>,
    queue?: { key: string; label: string },
  ): Promise<T | undefined> {
    this.#busy(busy, true);
    try {
      const value = await fn();
      if (this.#state.offline && this.#queue.labels.length === 0) this.#set({ offline: null });
      return value;
    } catch (e) {
      if (!(e instanceof Offline)) {
        this.#fail(e);
        return undefined;
      }
      this.#set({ offline: this.#queue.labels });
      if (queue) {
        this.#queue.add(queue.key, queue.label, async () => {
          try {
            await fn();
            if (this.#queue.labels.length <= 1) this.#set({ offline: null });
          } catch (err) {
            if (err instanceof Offline) throw err;
            this.#fail(err);
          }
        });
      } else {
        this.notify('warning', t('addin.offline.notQueued'));
      }
      return undefined;
    } finally {
      this.#busy(busy, false);
    }
  }

  // ── Start, sign in, sign out ──────────────────────────────────────────────────────────────────
  async start(): Promise<void> {
    try {
      const { port, tokens } = this.#deps;
      this.#token = await tokens.get(TOKEN_KEY);
      const sheet = await port.activeSheet();
      let workbookId = await port.getSetting(SETTING.workbookId);
      if (!workbookId) {
        workbookId = `wb-${this.#deps.newId()}`;
        await port.setSetting(SETTING.workbookId, workbookId);
      }
      const testMode = (await port.getSetting(SETTING.testMode)) === 'on';
      this.#set({ sheet, workbookId, testMode });
      const options = await this.api.options().catch(() => ({ magicLink: false, signup: null }));
      this.#set({ magicLink: options.magicLink, signupOffer: options.signup });
      if (this.#token) {
        // Signed in before: the dashboard waits for the API instead of asking to sign in again.
        this.#set({ screen: { name: 'dashboard' } });
        await this.#act('start', () => this.#signedIn(), {
          key: 'start',
          label: t('addin.offline.start'),
        });
      } else {
        this.#set({ screen: { name: 'login' } });
      }
    } catch (e) {
      this.#fail(e);
    } finally {
      this.#set({ booted: true });
    }
  }

  async #signedIn(): Promise<void> {
    const me = await this.api.me();
    this.#set({ me, notice: null, link: null, signup: null });
    await this.#openSheet(this.#state.sheet ?? (await this.#deps.port.activeSheet()));
  }

  /** The mapping of this sheet: from the workbook first, else the server's copy. */
  async #openSheet(sheet: string): Promise<void> {
    const { port } = this.#deps;
    let mapping: SheetMapping | null = null;
    const local = await port.getSetting(SETTING.mapping(sheet));
    if (local) {
      const parsed = SheetMapping.safeParse(JSON.parse(local));
      if (parsed.success && parsed.data.sheet === sheet) mapping = parsed.data;
    }
    if (!mapping && this.#state.workbookId) {
      try {
        mapping = (await this.api.getMapping(this.#state.workbookId, sheet)).mapping;
        await port.setSetting(SETTING.mapping(sheet), JSON.stringify(mapping));
      } catch (e) {
        if (!(e instanceof ApiFailure && e.status === 404)) throw e;
      }
    }
    this.#stopFollowing();
    this.#set({ sheet, mapping, sync: null, detection: null });
    await this.#listen(sheet);
    if (mapping) {
      this.#set({ screen: { name: 'dashboard' } });
      void this.sync();
      void this.loadReport();
    } else {
      this.#set({ screen: { name: 'detect' } });
      void this.detect();
    }
  }

  signInWithKey = async (key: string): Promise<void> => {
    const previous = this.#token;
    this.#token = key.trim();
    const ok = await this.#act('login', async () => {
      await this.api.me();
      return true;
    });
    if (!ok) {
      this.#token = previous;
      return;
    }
    await this.#deps.tokens.set(TOKEN_KEY, key.trim());
    await this.#act('login', () => this.#signedIn());
  };

  requestLink = async (email: string): Promise<void> => {
    const started = await this.#act('login', () => this.api.requestLink(email));
    if (!started) return;
    this.#linkRequest = { id: started.requestId, kind: 'login' };
    this.#set({ link: { email: email.trim() }, notice: null });
    this.#pollLink();
  };

  cancelLink = (): void => {
    this.#linkRequest = null;
    if (this.#linkTimer !== null) this.#deps.timers.clearTimeout(this.#linkTimer);
    this.#linkTimer = null;
    this.#set({ link: null });
  };

  #pollLink(): void {
    this.#linkTimer = this.#deps.timers.setTimeout(async () => {
      this.#linkTimer = null;
      const request = this.#linkRequest;
      if (!request) return;
      try {
        const answer =
          request.kind === 'login'
            ? await this.api.pollLink(request.id)
            : await this.api.pollSignup(request.id);
        if (this.#linkRequest !== request) return;
        if (answer.status === 'pending') {
          this.#pollLink();
          return;
        }
        this.#linkRequest = null;
        this.#token = answer.token;
        await this.#deps.tokens.set(TOKEN_KEY, answer.token);
        if (request.kind === 'signup') {
          // A new account rehearses first: Mode test on, the banner says so.
          await this.#deps.port.setSetting(SETTING.testMode, 'on');
          this.#set({ testMode: true });
        }
        await this.#act('login', () => this.#signedIn());
        if (request.kind === 'signup' && this.#state.me) {
          this.notify(
            'success',
            t('addin.signup.created', { company: this.#state.me.tenant.name }),
          );
        }
      } catch (e) {
        if (e instanceof Offline) {
          this.#pollLink();
          return;
        }
        if (request.kind === 'login') this.cancelLink();
        else this.cancelSignup();
        this.#fail(e);
      }
    }, LINK_POLL_MS);
  }

  // ── Créer un compte ───────────────────────────────────────────────────────────────────────────
  startSignup = (): void => {
    this.cancelLink();
    this.#set({
      screen: { name: 'signup' },
      signup: { step: 'siren', siren: '', found: null, email: null },
      notice: null,
    });
  };

  cancelSignup = (): void => {
    if (this.#linkRequest?.kind === 'signup') {
      this.#linkRequest = null;
      if (this.#linkTimer !== null) this.#deps.timers.clearTimeout(this.#linkTimer);
      this.#linkTimer = null;
    }
    this.#set({ screen: { name: 'login' }, signup: null });
  };

  /** Back from the company to the SIREN, or from waiting for the link to the company. */
  signupBack = (): void => {
    const signup = this.#state.signup;
    if (!signup) return;
    if (signup.step === 'company')
      this.#set({ signup: { ...signup, step: 'siren' }, notice: null });
    if (signup.step === 'waiting') {
      this.#linkRequest = null;
      this.#set({ signup: { ...signup, step: 'company' }, notice: null });
    }
  };

  lookupCompany = async (siren: string): Promise<void> => {
    const s = siren.replace(/\s/g, '');
    this.#busy('signup', true);
    try {
      const found = await this.api.lookupCompany(s);
      this.#set({ signup: { step: 'company', siren: s, found, email: null }, notice: null });
    } catch (e) {
      if (e instanceof ApiFailure && e.code === 'directory_unavailable') {
        // The directory is down: the person types the company; the API checks it again later.
        this.#set({ signup: { step: 'company', siren: s, found: null, email: null } });
        this.notify('warning', e.message);
      } else if (e instanceof Offline) {
        this.notify('warning', t('addin.offline.notQueued'));
      } else {
        this.#fail(e);
      }
    } finally {
      this.#busy('signup', false);
    }
  };

  submitSignup = async (
    email: string,
    company: { name: string; address: PostalAddress | null; vatId: string | null },
  ): Promise<void> => {
    const signup = this.#state.signup;
    const offer = this.#state.signupOffer;
    if (!signup || !offer) return;
    const started = await this.#act('signup', () =>
      this.api.signup({ siren: signup.siren, email, company, termsVersion: offer.termsVersion }),
    );
    if (!started) return;
    this.#linkRequest = { id: started.requestId, kind: 'signup' };
    this.#set({ signup: { ...signup, step: 'waiting', email: email.trim() }, notice: null });
    this.#pollLink();
  };

  // ── Abonnement ────────────────────────────────────────────────────────────────────────────────
  loadBilling = async (): Promise<void> => {
    const billing = await this.#act('billing', () => this.api.billing());
    if (billing) this.#set({ billing });
  };

  openCheckout = async (offer: Pick<Offer, 'plan' | 'interval'>): Promise<void> => {
    const page = await this.#act('billing', () => this.api.checkout(offer));
    if (page) await this.#openPage(page.url);
  };

  openPortal = async (): Promise<void> => {
    const page = await this.#act('billing', () => this.api.portal());
    if (page) await this.#openPage(page.url);
  };

  async #openPage(url: string): Promise<void> {
    const opened = await this.#deps.openUrl(url).catch(() => false);
    this.#set({ pageLink: url });
    this.notify('info', t(opened ? 'addin.billing.opened' : 'addin.billing.openLink'));
  }

  /** RGPD erasure from Réglages (owner, SIREN typed again); the pane signs out. */
  deleteAccount = async (confirmSiren: string): Promise<void> => {
    const done = await this.#act('delete', async () => {
      await this.api.deleteAccount(confirmSiren);
      return true;
    });
    if (done) await this.#signedOut({ tone: 'success', text: t('addin.account.deleted') });
  };

  signOut = async (): Promise<void> => {
    if (this.#token?.startsWith('fis_')) await this.api.logout().catch(() => undefined);
    await this.#signedOut(null);
  };

  async #signedOut(notice: Notice | null): Promise<void> {
    this.#token = null;
    await this.#deps.tokens.remove(TOKEN_KEY);
    this.#queue.clear();
    this.#closeInvoice();
    this.#stopFollowing();
    await this.#stopListening?.();
    this.#stopListening = null;
    this.#set({
      me: null,
      screen: { name: 'login' },
      mapping: null,
      detection: null,
      sync: null,
      settings: null,
      // Another company may sign in next on this pane: nothing of this one stays on screen.
      report: null,
      reception: null,
      customers: null,
      offline: null,
      link: null,
      signup: null,
      billing: null,
      pageLink: null,
      notice,
    });
  }

  // ── Détection ─────────────────────────────────────────────────────────────────────────────────
  async #read(sheet: string): Promise<SheetReading> {
    const reading = readUsedRange(sheet, await this.#deps.port.usedRange(sheet));
    this.#reading = reading;
    return reading;
  }

  detect = async (): Promise<void> => {
    const sheet = await this.#activeSheet();
    if (!sheet) return;
    await this.#act('detect', async () => {
      const reading = await this.#read(sheet);
      if (reading.snapshot.rows.length === 0) {
        this.#set({ detection: null });
        this.notify('info', t('addin.detect.empty', { sheet }));
        return;
      }
      const { mapping, degraded } = await this.api.detect(detectionSample(reading.snapshot));
      this.#set({
        detection: { mapping, degraded, headers: headersOf(reading.snapshot, mapping.headerRow) },
      });
    });
  };

  /** « Colonnes » with a confirmed mapping: shows it for editing, without asking the agent again. */
  editMapping = async (): Promise<void> => {
    const { mapping, sheet } = this.#state;
    if (!mapping || !sheet) return this.detect();
    await this.#act('detect', async () => {
      const reading = await this.#read(sheet);
      const headers = headersOf(reading.snapshot, mapping.headerRow);
      this.#set({ detection: { mapping, degraded: null, headers } });
    });
  };

  /** The column headers of another row, when the user moves the header row. */
  headersFor = (row: number): Header[] =>
    this.#reading ? headersOf(this.#reading.snapshot, row) : [];

  confirmMapping = async (mapping: SheetMapping): Promise<void> => {
    const { workbookId } = this.#state;
    if (!workbookId) return;
    await this.#act('confirm', async () => {
      await this.#deps.port.setSetting(SETTING.mapping(mapping.sheet), JSON.stringify(mapping));
      this.#set({ mapping, detection: null, screen: { name: 'dashboard' } });
      void this.#act('saveMapping', () => this.api.saveMapping(workbookId, mapping), {
        key: `mapping:${mapping.sheet}`,
        label: t('addin.offline.mapping'),
      });
      void this.sync();
    });
  };

  // ── Tableau de bord: sync and statuses ────────────────────────────────────────────────────────
  /** The active sheet; switching sheets loads that sheet's mapping. */
  async #activeSheet(): Promise<string | null> {
    try {
      const sheet = await this.#deps.port.activeSheet();
      if (sheet !== this.#state.sheet && this.#state.me) {
        await this.#openSheet(sheet);
        return null;
      }
      return sheet;
    } catch (e) {
      this.#fail(e);
      return null;
    }
  }

  /** « Vérifier »: reads the sheet, asks the server, writes FI_Statut / FI_Détail. */
  sync = async (): Promise<void> => {
    if (this.#syncing) {
      this.#syncAgain = true;
      return this.#syncing;
    }
    this.#syncing = (async () => {
      do {
        this.#syncAgain = false;
        await this.#act('sync', () => this.#syncOnce(), {
          key: 'sync',
          label: t('addin.offline.sync'),
        });
      } while (this.#syncAgain);
    })().finally(() => {
      this.#syncing = null;
    });
    return this.#syncing;
  };

  async #syncOnce(): Promise<void> {
    const { sheet, mapping, workbookId, testMode } = this.#state;
    if (!sheet || !mapping || !workbookId || !this.#state.me) return;
    const reading = await this.#read(sheet);
    const result = await this.api.sync(workbookId, {
      snapshot: reading.snapshot,
      mapping,
      test: testMode,
    });
    const plan = this.#plan(reading, mapping, result);
    this.#statusCols = { statusCol: plan.statusCol, detailCol: plan.detailCol };
    await this.#writer.write(plan);
    this.#set({ sync: { result, at: this.#deps.now() } });
    this.#followSheet(sheet, result);
    const open = this.#state.invoice?.detail;
    const row = open && result.rows.find((r) => r.invoiceId === open.id);
    if (open && row && row.status !== open.status) await this.#refreshInvoice();
  }

  /**
   * Keeps FI_Statut up to date without a click while invoices on the sheet are on their way: asks
   * where they are (30 s, then twice as late up to 5 min) and checks the sheet as soon as one moved.
   */
  #followSheet(sheet: string, result: SyncResult): void {
    this.#stopFollowing();
    const known = new Map<string, string>();
    for (const r of result.rows) {
      if (r.invoiceId && r.status && MOVING.has(r.status)) known.set(r.invoiceId, r.status);
    }
    if (known.size === 0) return;
    const tick = async () => {
      const follow = this.#sheetPoll;
      if (!follow || this.#state.sheet !== sheet || !this.#state.me) return;
      let moved = false;
      try {
        const { invoices } = await this.api.statuses([...known.keys()]);
        moved = invoices.some((i) => known.has(i.id) && known.get(i.id) !== i.status);
      } catch {
        // Offline or a hiccup: not worth a notice, the next check asks again.
      }
      if (this.#sheetPoll !== follow) return;
      if (moved) {
        this.#sheetPoll = null;
        void this.sync();
        return;
      }
      follow.delay = Math.min(follow.delay * 2, SHEET_POLL_MAX_MS);
      follow.timer = this.#deps.timers.setTimeout(tick, follow.delay);
    };
    this.#sheetPoll = {
      timer: this.#deps.timers.setTimeout(tick, SHEET_POLL_MS),
      delay: SHEET_POLL_MS,
    };
  }

  #stopFollowing(): void {
    if (this.#sheetPoll) this.#deps.timers.clearTimeout(this.#sheetPoll.timer);
    this.#sheetPoll = null;
  }

  #plan(reading: SheetReading, mapping: SheetMapping, result: SyncResult): StatusPlan {
    const cols = statusColumns(reading);
    const cells = result.rows.flatMap((r) =>
      r.rows.map((row, i) => ({
        row,
        status: r.isTest ? t('addin.sheet.testLabel', { label: r.label }) : r.label,
        detail: i === 0 ? r.detail : '',
        tone: r.tone,
      })),
    );
    return {
      sheet: reading.snapshot.sheet,
      headerRow: mapping.headerRow,
      ...cols,
      lastRow: Math.max(reading.lastRow, mapping.headerRow),
      cells,
    };
  }

  async #listen(sheet: string): Promise<void> {
    await this.#stopListening?.();
    this.#stopListening = await this.#deps.port.onChange(sheet, (address) => {
      if (this.#ownColumnsOnly(address) || !this.#state.mapping || !this.#state.me) return;
      if (this.#autoSync !== null) this.#deps.timers.clearTimeout(this.#autoSync);
      this.#autoSync = this.#deps.timers.setTimeout(() => {
        this.#autoSync = null;
        void this.sync();
      }, AUTO_SYNC_MS);
    });
  }

  /** Our own writes fire the change event too: they must not start another sync. */
  #ownColumnsOnly(address: string): boolean {
    if (!this.#statusCols) return false;
    const cols = [...address.matchAll(/([A-Z]{1,3})\d*/g)].map((m) => columnIndex(m[1] ?? 'A'));
    const own = [this.#statusCols.statusCol, this.#statusCols.detailCol].map(columnIndex);
    const lo = Math.min(...cols);
    const hi = Math.max(...cols);
    return cols.length > 0 && lo >= Math.min(...own) && hi <= Math.max(...own);
  }

  rowAt(row: number): RowStatus | undefined {
    return this.#state.sync?.result.rows.find((r) => r.rows.includes(row));
  }

  // ── Fiche facture ─────────────────────────────────────────────────────────────────────────────
  openInvoice = async (id: string, confirmSend = false): Promise<void> => {
    this.#closeInvoice();
    this.#set({ screen: { name: 'invoice', id, confirmSend }, notice: null });
    const detail = await this.#act('invoice', () => this.api.invoice(id));
    if (!detail) return;
    this.#set({ invoice: { detail, explained: null, rehearsal: null, xml: null, pdfUrl: null } });
    if (detail.issues.length > 0) void this.explain();
    if (MOVING.has(detail.status)) this.#watch();
  };

  #patchInvoice(patch: Partial<OpenInvoice>): void {
    const invoice = this.#state.invoice;
    if (invoice) this.#set({ invoice: { ...invoice, ...patch } });
  }

  #closeInvoice(): void {
    if (this.#poll) this.#deps.timers.clearTimeout(this.#poll.timer);
    this.#poll = null;
    const url = this.#state.invoice?.pdfUrl;
    if (url) this.#deps.objectUrl?.revoke(url);
    if (this.#state.invoice) this.#set({ invoice: null });
  }

  async #refreshInvoice(): Promise<void> {
    const id = this.#state.invoice?.detail.id;
    if (!id) return;
    const detail = await this.api.invoice(id);
    if (this.#state.invoice?.detail.id !== id) return;
    const issuesChanged =
      JSON.stringify(detail.issues) !== JSON.stringify(this.#state.invoice.detail.issues);
    this.#patchInvoice({ detail, ...(issuesChanged && { explained: null, rehearsal: null }) });
    if (issuesChanged && detail.issues.length > 0) void this.explain();
  }

  /** Follows an invoice the platform is moving: refreshes the fiche and the sheet when it changes. */
  #watch(times = POLL_TIMES): void {
    if (this.#poll) this.#deps.timers.clearTimeout(this.#poll.timer);
    const id = this.#state.invoice?.detail.id;
    if (!id) return;
    const tick = async () => {
      if (!this.#poll || this.#state.invoice?.detail.id !== id) return;
      this.#poll.left--;
      try {
        const before = this.#state.invoice.detail.status;
        await this.#refreshInvoice();
        if (this.#state.invoice?.detail.status !== before) void this.sync();
      } catch {
        // A missed refresh is not worth a notice: the next tick tries again.
      }
      const status = this.#state.invoice?.detail.status;
      if (this.#poll && this.#poll.left > 0 && status && MOVING.has(status)) {
        this.#poll.timer = this.#deps.timers.setTimeout(tick, POLL_MS);
      } else {
        this.#poll = null;
      }
    };
    this.#poll = { timer: this.#deps.timers.setTimeout(tick, POLL_MS), left: times };
  }

  explain = async (): Promise<void> => {
    const id = this.#state.invoice?.detail.id;
    if (!id) return;
    const explained = await this.#act('explain', () => this.api.explain(id));
    if (explained && this.#state.invoice?.detail.id === id) this.#patchInvoice({ explained });
  };

  /** « Corriger dans la feuille »: selects the cell an explanation points at. */
  fixInSheet = async (address: string): Promise<void> => {
    const target = parseAddress(address);
    if (!target) return;
    await this.#act('select', () => this.#deps.port.select(target.sheet, target.cell));
  };

  rehearse = async (): Promise<void> => {
    const id = this.#state.invoice?.detail.id;
    if (!id) return;
    const rehearsal = await this.#act('rehearse', () => this.api.rehearse(id));
    if (!rehearsal || this.#state.invoice?.detail.id !== id) return;
    this.#patchInvoice({ rehearsal });
    await this.#act('invoice', () => this.#refreshInvoice());
  };

  askSend = (): void => {
    const s = this.#state.screen;
    if (s.name === 'invoice') this.#set({ screen: { ...s, confirmSend: true } });
  };

  cancelSend = (): void => {
    const s = this.#state.screen;
    if (s.name === 'invoice') this.#set({ screen: { ...s, confirmSend: false } });
  };

  /** « Envoyer », after the user confirmed it on the fiche (Review mode, plan §0). */
  send = async (): Promise<void> => {
    const invoice = this.#state.invoice?.detail;
    if (!invoice) return;
    this.cancelSend();
    const number = invoice.number ?? '';
    const sent = await this.#act(
      'send',
      async () => {
        const result = await this.api.send(invoice.id);
        this.notify(
          'success',
          t(result.alreadySent ? 'addin.send.already' : 'addin.send.done', { number }),
        );
        if (this.#state.invoice?.detail.id === invoice.id) {
          await this.#refreshInvoice();
          this.#watch();
        }
        void this.sync();
        return result;
      },
      { key: `send:${invoice.id}`, label: t('addin.offline.send', { number }) },
    );
    if (!sent && this.#state.offline) this.notify('warning', t('addin.send.queued', { number }));
  };

  playScenario = async (scenario: Scenario): Promise<void> => {
    const id = this.#state.invoice?.detail.id;
    if (!id) return;
    const detail = await this.#act('scenario', () => this.api.scenario(id, scenario));
    if (!detail || this.#state.invoice?.detail.id !== id) return;
    this.#patchInvoice({ detail });
    this.notify('info', t(PLAYED[scenario]));
    this.#watch(POLL_TIMES);
    void this.sync();
  };

  // ── Relancer (plan §6 CollectAgent) ─────────────────────────────────────────────────────────────
  /** Runs a chasing action on the open invoice; the fiche shows the answer. */
  async #chase(
    busy: string,
    call: (id: string) => Promise<InvoiceDetail>,
    done: (detail: InvoiceDetail) => string,
  ): Promise<boolean> {
    const id = this.#state.invoice?.detail.id;
    if (!id) return false;
    const detail = await this.#act(busy, () => call(id));
    if (!detail || this.#state.invoice?.detail.id !== id) return false;
    this.#patchInvoice({ detail });
    this.notify('success', done(detail));
    return true;
  }

  /** « Encaissée », after the user confirmed it: chasing stops and the platform is told. */
  recordPayment = async (paidOn?: string): Promise<void> => {
    const ok = await this.#chase(
      'payment',
      (id) => this.api.recordPayment(id, paidOn),
      (d) => t('addin.chase.paidDone', { number: d.number ?? '' }),
    );
    if (ok) void this.sync();
  };

  /** « Promesse de paiement » until `until` (YYYY-MM-DD); null withdraws it. */
  promisePayment = (until: string | null): Promise<boolean> =>
    this.#chase(
      'promise',
      (id) => this.api.promise(id, until),
      () =>
        until
          ? t('addin.chase.promiseSaved', { date: frDate(until) })
          : t('addin.chase.promiseRemoved'),
    );

  /** « Préparer une relance maintenant ». */
  prepareChase = (): Promise<boolean> =>
    this.#chase(
      'chase',
      (id) => this.api.prepareChase(id),
      (d) => t('addin.chase.prepared', { number: d.number ?? '' }),
    );

  /** « Marquer comme envoyée »: the user sent this step from their own mailbox. */
  markChaseSent = (offset: number): Promise<boolean> =>
    this.#chase(
      'chaseSent',
      (id) => this.api.markChaseSent(id, offset),
      (d) => t('addin.chase.markedSent', { number: d.number ?? '' }),
    );

  /** « Annuler l'envoi automatique »: this invoice now waits for « Envoyer », even after a change. */
  cancelAutopilot = async (): Promise<void> => {
    const id = this.#state.invoice?.detail.id;
    if (!id) return;
    const detail = await this.#act('autopilot', () => this.api.cancelAutopilot(id));
    if (!detail || this.#state.invoice?.detail.id !== id) return;
    this.#patchInvoice({ detail });
    this.notify('success', t('addin.autopilot.held', { number: detail.number ?? '' }));
    void this.sync();
  };

  /** « Trouver ce client »: Clients, searching the directory for the fiche's buyer. */
  findCustomer = async (): Promise<void> => {
    const name = this.#state.invoice?.detail.buyerName ?? '';
    this.navigate({ name: 'customers' });
    if (name.trim().length >= 3) await this.searchCustomers({ name }, name);
  };

  viewXml = async (): Promise<void> => {
    const id = this.#state.invoice?.detail.id;
    if (!id) return;
    if (this.#state.invoice?.xml) return this.#patchInvoice({ xml: null });
    const xml = await this.#act('xml', () => this.api.xml(id));
    if (xml !== undefined) this.#patchInvoice({ xml });
  };

  viewPdf = async (): Promise<void> => {
    const id = this.#state.invoice?.detail.id;
    const urls = this.#deps.objectUrl;
    if (!id || !urls) return;
    const open = this.#state.invoice?.pdfUrl;
    if (open) {
      urls.revoke(open);
      return this.#patchInvoice({ pdfUrl: null });
    }
    const blob = await this.#act('pdf', () => this.api.pdf(id));
    if (blob) this.#patchInvoice({ pdfUrl: urls.create(blob) });
  };

  // ── Mode test ─────────────────────────────────────────────────────────────────────────────────
  setTestMode = async (on: boolean): Promise<void> => {
    // Switched on only where the server accepts test invoices, so the banner never says otherwise.
    const me = this.#state.me;
    if (on && me && !me.testMode.enabled)
      return this.notify('warning', t('addin.testMode.disabled'));
    if (on && me && !me.testMode.available) {
      return this.notify('warning', t('api.error.test_platform_missing'));
    }
    const saved = await this.#act('testMode', async () => {
      await this.#deps.port.setSetting(SETTING.testMode, on ? 'on' : null);
      return true;
    });
    if (!saved) return;
    this.#set({ testMode: on });
    this.notify('info', t(on ? 'addin.testMode.on' : 'addin.testMode.off'));
    if (this.#state.screen.name === 'invoice') this.navigate({ name: 'dashboard' });
    if (this.#state.screen.name === 'reception') void this.loadReception();
    void this.sync();
  };

  // ── Tableau de bord ───────────────────────────────────────────────────────────────────────────
  /** The weekly card: without it the dashboard still works, so a failure stays quiet. */
  loadReport = async (): Promise<void> => {
    this.#busy('report', true);
    try {
      this.#set({ report: await this.api.report() });
    } catch {
      // The card is left out; the next visit to the dashboard asks again.
    } finally {
      this.#busy('report', false);
    }
  };

  // ── Réception (plan §3 screen 5) ──────────────────────────────────────────────────────────────
  loadReception = async (): Promise<void> => {
    const test = this.#state.testMode;
    const reception = await this.#act('reception', async () => {
      const [{ inbound }, { exports }] = await Promise.all([
        this.api.inbound(test),
        this.api.inboundExports(test),
      ]);
      return { test, inbound, exports };
    });
    if (reception) this.#set({ reception });
  };

  #putInbound(row: Inbound): void {
    const r = this.#state.reception;
    if (!r || r.test !== row.isTest) return;
    const known = r.inbound.some((i) => i.id === row.id);
    const inbound = known ? r.inbound.map((i) => (i.id === row.id ? row : i)) : [row, ...r.inbound];
    this.#set({ reception: { ...r, inbound } });
  }

  /** « Bon pour paiement »; `ibanChecked` when the user confirmed a new IBAN with the supplier. */
  approveInbound = async (id: string, ibanChecked = false): Promise<void> => {
    const row = await this.#act(`approve:${id}`, () => this.api.approveInbound(id, ibanChecked));
    if (!row) return;
    this.#putInbound(row);
    this.notify('success', t('addin.reception.approved', { number: row.number ?? '' }));
  };

  disputeInbound = async (id: string, reason: string): Promise<boolean> => {
    const row = await this.#act(`dispute:${id}`, () => this.api.disputeInbound(id, reason));
    if (!row) return false;
    this.#putInbound(row);
    this.notify('success', t('addin.reception.disputedDone', { number: row.number ?? '' }));
    return true;
  };

  exportInbound = async (): Promise<void> => {
    const made = await this.#act('exportInbound', () =>
      this.api.exportInbound(this.#state.testMode),
    );
    if (!made) return;
    this.notify(
      'success',
      made.skipped > 0
        ? t('addin.reception.exportedSkipped', { count: made.count, skipped: made.skipped })
        : t('addin.reception.exported', { count: made.count }),
    );
    await this.loadReception();
  };

  /** One file of an export, for a download link. */
  exportFile = (id: string, file: ExportFile): Promise<Blob | undefined> =>
    this.#act(`file:${id}:${file}`, () => this.api.exportFile(id, file));

  /** « Recevoir une facture de test » (Mode test only). */
  receiveTestInbound = async (kind: TestInboundKind): Promise<void> => {
    const row = await this.#act('testInbound', () => this.api.testInbound(kind));
    if (!row) return;
    this.#putInbound(row);
    this.notify('info', t('addin.reception.testReceived'));
  };

  // ── Clients (plan §4 parties, §6 PartyAgent) ──────────────────────────────────────────────────
  loadCustomers = async (): Promise<void> => {
    const loaded = await this.#act('customers', () => this.api.parties());
    if (!loaded) return;
    const c = this.#state.customers;
    this.#set({
      customers: { query: {}, finding: null, sheetName: null, ...c, parties: loaded.parties },
    });
  };

  #customers(patch: Partial<Customers>): void {
    const c = this.#state.customers ?? { parties: [], query: {}, finding: null, sheetName: null };
    this.#set({ customers: { ...c, ...patch } });
  }

  #putParty(party: Party): void {
    const parties = (this.#state.customers?.parties ?? []).filter((p) => p.id !== party.id);
    parties.push(party);
    parties.sort((a, b) => a.legalName.localeCompare(b.legalName, 'fr'));
    const finding = this.#state.customers?.finding;
    this.#customers({
      parties,
      ...(finding && {
        finding: {
          ...finding,
          candidates: finding.candidates.map((c) =>
            c.siren === party.siren ? { ...c, partyId: party.id } : c,
          ),
        },
      }),
    });
  }

  /** « Chercher dans l'annuaire »: by SIREN, or by name (and post code). */
  searchCustomers = async (query: PartyQuery, sheetName: string | null = null): Promise<void> => {
    this.#customers({ query, finding: null, sheetName });
    const finding = await this.#act('partySearch', () => this.api.searchParties(query));
    if (finding) this.#customers({ query, finding });
  };

  /**
   * « C'est ce client »: saved to the fiche clients under the sheet's name for it too, so the next
   * syncs find it by that name and fill the sheet's blanks. `name` is the one typed for a company
   * whose name the directory withholds.
   */
  confirmCustomer = async (siren: string, name?: string): Promise<void> => {
    const party = await this.#act(`party:${siren}`, () => this.api.confirmParty(siren, name));
    if (!party) return;
    this.#putParty(party);
    this.notify('success', t('addin.customers.confirmed', { name: party.legalName }));
    void this.sync();
  };

  updateCustomer = async (id: string, patch: PartyPatch): Promise<boolean> => {
    const party = await this.#act(`party:${id}`, () => this.api.patchParty(id, patch));
    if (!party) return false;
    this.#putParty(party);
    this.notify(
      'success',
      patch.autopilot === undefined
        ? t('addin.customers.saved', { name: party.legalName })
        : t(patch.autopilot ? 'addin.customers.autopilotOn' : 'addin.customers.autopilotOff', {
            name: party.legalName,
          }),
    );
    if (patch.autopilot !== undefined) void this.sync();
    return true;
  };

  removeCustomer = async (id: string): Promise<void> => {
    const party = this.#state.customers?.parties.find((p) => p.id === id);
    const done = await this.#act(`party:${id}`, async () => {
      await this.api.deleteParty(id);
      return true;
    });
    if (!done) return;
    this.#customers({
      parties: (this.#state.customers?.parties ?? []).filter((p) => p.id !== id),
      finding: null,
    });
    this.notify('success', t('addin.customers.removed', { name: party?.legalName ?? '' }));
    void this.sync();
  };

  // ── Réglages ──────────────────────────────────────────────────────────────────────────────────
  loadSettings = async (): Promise<void> => {
    const settings = await this.#act('settings', () => this.api.settings());
    if (settings) this.#set({ settings });
  };

  saveSettings = async (patch: SettingsPatch): Promise<boolean> => {
    const settings = await this.#act('saveSettings', () => this.api.patchSettings(patch));
    if (!settings) return false;
    this.#set({ settings });
    if (patch.sandboxEnabled !== undefined) {
      const me = await this.#act('settings', () => this.api.me());
      if (me) this.#set({ me });
    }
    this.notify('success', t('addin.settings.saved'));
    return true;
  };

  saveAi = async (choice: AiChoice): Promise<boolean> => {
    const settings = await this.#act('saveAi', () => this.api.saveAi(choice));
    if (!settings) return false;
    this.#set({ settings });
    this.notify('success', t('addin.settings.aiSaved'));
    return true;
  };

  /** « Votre propre clé B2Brouter »: tried by the server before it is saved. */
  savePdpKey = async (apiKey: string, account?: string): Promise<boolean> => {
    const settings = await this.#act('pdpKey', () =>
      this.api.savePdpKey({ apiKey, ...(account && { account }) }),
    );
    if (!settings) return false;
    this.#set({ settings });
    this.notify('success', t('addin.settings.pdpKeySaved'));
    return true;
  };

  removePdpKey = async (): Promise<void> => {
    const settings = await this.#act('pdpKey', () => this.api.removePdpKey());
    if (!settings) return;
    this.#set({ settings });
    this.notify('success', t('addin.settings.pdpKeyRemoved'));
  };

  exportData = (): Promise<Blob | undefined> => this.#act('export', () => this.api.exportData());

  // ── Ribbon buttons (docs/OFFICE.md §3: the pane may be hidden) ────────────────────────────────
  async #showPane(): Promise<void> {
    try {
      await this.#deps.showTaskpane();
    } catch {
      // Ignored for Marketplace add-ins since 2026-02-23: the user opens the pane with « Ouvrir ».
    }
  }

  verifyFromRibbon = async (): Promise<void> => {
    if (!this.#state.me) return this.#showPane();
    const sheet = await this.#activeSheet();
    if (!sheet || !this.#state.mapping) return this.#showPane();
    await this.sync();
  };

  /** Never sends from the ribbon: opens the fiche of the selected row, where the user confirms. */
  sendFromRibbon = async (): Promise<void> => {
    if (!this.#state.me) return this.#showPane();
    try {
      const { sheet, row } = await this.#deps.port.activeCell();
      if (sheet !== this.#state.sheet) await this.#activeSheet();
      const status = sheet === this.#state.sheet ? this.rowAt(row) : undefined;
      if (status?.invoiceId) await this.openInvoice(status.invoiceId, true);
      else this.notify('info', t('addin.send.pickRow'));
    } catch (e) {
      this.#fail(e);
    }
    await this.#showPane();
  };

  toggleTestModeFromRibbon = (): Promise<void> => this.setTestMode(!this.#state.testMode);
}
