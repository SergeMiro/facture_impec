// The task pane's state and actions, shared by the screens and the ribbon buttons (one shared runtime,
// docs/OFFICE.md §2). Screens render `state`; nothing here knows about React.
import {
  columnIndex,
  compareDecimal,
  frDate,
  frMoney,
  isDocKind,
  kindFromName,
  type LayoutMapping,
  parseAddress,
  SheetMapping,
} from '@fi/core';
import { type MessageKey, t } from '@fi/shared';
import {
  type AiChoice,
  ApiClient,
  ApiFailure,
  type BillingView,
  balanceOf,
  type ChatMessage,
  type Checks,
  type ConnectedFile,
  type ConnectorView,
  type Degraded,
  type DirectoryCompany,
  type Edit,
  type EditDecided,
  type Evidence,
  type Explained,
  type ExportFile,
  type FileOwner,
  type FixOutcome,
  type GoogleView,
  type Inbound,
  type InboundExport,
  type InvoiceDetail,
  type LayoutDetection,
  type Me,
  type NormalChoice,
  type Offer,
  Offline,
  type Party,
  type PartyFinding,
  type PartyPatch,
  type PartyQuery,
  type PostalAddress,
  type Registry,
  type Rehearsal,
  type RowStatus,
  type Scenario,
  type Settings,
  type SettingsPatch,
  type SignupOffer,
  type Source,
  type SourceRead,
  type SyncResult,
  type TestInboundKind,
  type UndoOutcome,
  type UploadView,
  type WeeklyReport,
} from './api';
import { type CardCall, type ChatStatus, PaneChat, waitingCards } from './chat';
import {
  type CellContent,
  type ExcelPort,
  type SheetSnapshot,
  SpreadsheetError,
  type StatusPlan,
} from './excel/port';
import {
  detectionSample,
  headersOf,
  readUsedRange,
  type SheetReading,
  statusColumns,
  TooManyRows,
} from './excel/reader';
import { isPermanent } from './excel/retry';
import { StatusWriter, type WriterClock } from './excel/writer';
import { type MicrosoftPort, MicrosoftPortError, onMicrosoftCloud } from './microsoft/port';
import { OfflineQueue, systemTimers, type Timers } from './offline';
import type { KeyValueStore } from './storage';

export type Screen =
  | { name: 'login' }
  | { name: 'signup' }
  | { name: 'detect' }
  | { name: 'dashboard' }
  | { name: 'invoice'; id: string; confirmSend: boolean }
  /** `focus`: the supplier invoice to show, from « Voir la facture du fournisseur ». */
  | { name: 'reception'; focus?: string }
  | { name: 'customers' }
  | { name: 'registry' }
  | { name: 'checks' }
  /** R8: the conversation about one finding, from « Demander à l'assistant ». */
  | { name: 'chat'; findingId: string }
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

/** « Inclure cette feuille »: what the sheet holds, for the company to check before saying yes. */
export interface Inclusion {
  sheet: string;
  detection: LayoutDetection;
  headers: Header[];
  /** A sheet of a OneDrive (R4), Google Drive (R5) or uploaded (R6) file: the API reads it itself. */
  file?: { id: string; name: string; provider: FileOwner };
}

/** R8: the conversation about one finding, as `ai`'s Chat holds it. */
export interface Conversation {
  findingId: string;
  /** False when the assistant is off: the finding's own « Corriger pour moi » stays. */
  available: boolean;
  messages: ChatMessage[];
  status: ChatStatus;
}

/** Why nothing was written: the cell no longer holds what the card says it holds. */
export interface CellConflict {
  reason: 'changed' | 'formula' | 'missing';
  /** What the cell shows now (its formula, for a formula). */
  found: string;
  formula?: string;
}

/** R8: a correction, or its undo, shown « Avant → Après »: nothing is written before the click. */
export interface EditCard {
  kind: 'fix' | 'undo';
  findingId: string;
  edit: Edit;
  /** The chat's call it answers; null when asked from the finding's card. */
  toolCallId: string | null;
  /** The undo found something else in the cell: writing over it takes « Remettre quand même ». */
  conflict: CellConflict | null;
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
  /** « Registre » (R1): what the included sheets brought, the latest documents; null until loaded. */
  registry: Registry | null;
  /** « Contrôles » (R2): the open findings and the links to confirm; null until loaded. */
  checks: Checks | null;
  /** R8: the conversation open in the pane; null when none is. */
  chat: Conversation | null;
  /** R8: the correction card waiting for a click. */
  card: EditCard | null;
  /** R8: the correction last applied from this pane, for « Annuler la correction ». */
  corrected: Edit | null;
  /** The sheets of this workbook included in the check: each one is read again when it changes. */
  sources: Source[];
  /** « Fichiers OneDrive » (R4): the connected account and its files; null until loaded. */
  connector: ConnectorView | null;
  /** « Fichiers Google Drive » (R5): the connected account and its files; null until loaded. */
  google: GoogleView | null;
  /** The address of Google's window when the pane could not open it: shown as a link. */
  googleLink: string | null;
  /** « Fichiers importés » (R6): the files uploaded from the pane; null until loaded. */
  uploads: UploadView[] | null;
  /**
   * Scout (R4): why the dashboard suggests « Fichiers OneDrive » once: the workbook itself is there,
   * or the company's mail is with Microsoft. Null once the person answered, or with nothing to say.
   */
  onedriveHint: 'document' | 'mail' | null;
  /** The visible sheets of the workbook. */
  sheets: string[];
  /** Sheets proposed for « Inclure cette feuille »: neither included nor an invoice sheet. */
  otherSheets: string[];
  inclusion: Inclusion | null;
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
/** While Google's window is open, the section asks every 3 s, for 15 minutes at most. */
export const GOOGLE_POLL_MS = 3_000;
const GOOGLE_POLLS = 300;
/** What Google's window changes: the account, its status, the files picked. */
const googleKey = (view: GoogleView | null) => {
  const conn = view?.connection;
  return JSON.stringify(conn ? [conn.label, conn.status, conn.files.map((f) => f.id)] : null);
};
export const AUTO_SYNC_MS = 1_500;
/** While invoices on the sheet are on their way: first status check, then twice as late each time. */
export const SHEET_POLL_MS = 30_000;
export const SHEET_POLL_MAX_MS = 300_000;

const TOKEN_KEY = 'token';
/** Set once the person answered the Scout's suggestion: it is never shown again on this device. */
const SCOUT_KEY = 'scout.onedrive';

/** « 29.5 » as the person reads it: « 29,5 ». */
export const decimalFr = (value: string) => value.replace('.', ',');

/** The sheet's name says orders, delivery notes, purchases or a price list (« Commandes », « BL »). */
export const namedLikeSource = (sheet: string): boolean => {
  const kind = kindFromName(sheet);
  return kind !== null && isDocKind(kind);
};

/** An included sheet the pane listens to: its pending auto-read, and the read running now. */
interface SourceWatch {
  stop: (() => Promise<void>) | null;
  timer: unknown;
  reading: Promise<void> | null;
  again: boolean;
}

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
  /** Microsoft's sign-in and OneDrive's picker (R4); absent: « Fichiers OneDrive » offers nothing. */
  microsoft?: MicrosoftPort;
  /** Office.context.document.url: where the open workbook lives (Scout, R4); null when unknown. */
  documentUrl?: () => string | null;
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
  registry: null,
  checks: null,
  chat: null,
  card: null,
  corrected: null,
  sources: [],
  connector: null,
  google: null,
  googleLink: null,
  uploads: null,
  onedriveHint: null,
  sheets: [],
  otherSheets: [],
  inclusion: null,
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
  readonly #deps: Required<
    Omit<ControllerDeps, 'fetch' | 'objectUrl' | 'commerceAllowed' | 'microsoft'>
  > &
    Pick<ControllerDeps, 'objectUrl' | 'microsoft'>;
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
  #googleTimer: unknown = null;
  #linkRequest: { id: string; kind: 'login' | 'signup' } | null = null;
  #poll: { timer: unknown; left: number } | null = null;
  #sheetPoll: { timer: unknown; delay: number } | null = null;
  readonly #sourceWatch = new Map<string, SourceWatch>();
  /** The rows « Inclure » names columns from: the sheet's, or the sample a OneDrive file came with. */
  #inclusionRows: SheetSnapshot | null = null;
  #chat: PaneChat | null = null;

  constructor(deps: ControllerDeps) {
    this.#deps = {
      timers: systemTimers,
      writerClock: { now: () => Date.now(), setTimeout: (fn, ms) => setTimeout(fn, ms) },
      now: () => Date.now(),
      newId: () => crypto.randomUUID(),
      showTaskpane: async () => {},
      openUrl: async () => false,
      documentUrl: () => null,
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
    if (screen.name !== 'chat' || screen.findingId !== this.#chat?.findingId) this.#closeChat();
    this.#set({ screen, notice: null });
    if (screen.name === 'settings') {
      if (!this.#state.settings) void this.loadSettings();
      void this.loadBilling();
    }
    if (screen.name === 'dashboard') void this.loadReport();
    if (screen.name === 'reception') void this.loadReception();
    if (screen.name === 'customers') void this.loadCustomers();
    if (screen.name === 'registry') void this.loadRegistry();
    if (screen.name === 'checks') void this.loadChecks();
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
    if (e instanceof SpreadsheetError) {
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
    await this.#loadSources();
    await this.#openSheet(this.#state.sheet ?? (await this.#deps.port.activeSheet()));
    void this.#followSources();
    void this.#scout();
  }

  /** Opens this sheet with its mapping: from the workbook first, else the server's copy. */
  async #openSheet(sheet: string): Promise<void> {
    if (this.#isSource(sheet)) {
      // An included sheet is read into the Registre, never checked as invoices.
      if (this.#state.sheet === sheet) this.#set({ sheet: null, mapping: null, sync: null });
      this.navigate({ name: 'registry' });
      this.notify('info', t('addin.registry.isSource', { sheet }));
      return;
    }
    const mapping = await this.#mappingOf(sheet);
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

  /** The sheet's confirmed columns: saved in the workbook, or asked from the server. */
  async #mappingOf(sheet: string): Promise<SheetMapping | null> {
    const { port } = this.#deps;
    const local = await port.getSetting(SETTING.mapping(sheet));
    if (local) {
      const parsed = SheetMapping.safeParse(JSON.parse(local));
      if (parsed.success && parsed.data.sheet === sheet) return parsed.data;
    }
    if (!this.#state.workbookId) return null;
    try {
      const { mapping } = await this.api.getMapping(this.#state.workbookId, sheet);
      await port.setSetting(SETTING.mapping(sheet), JSON.stringify(mapping));
      return mapping;
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 404) return null;
      throw e;
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
    this.#closeChat();
    this.#stopFollowing();
    this.#stopGoogle();
    await this.#stopListening?.();
    this.#stopListening = null;
    await Promise.all([...this.#sourceWatch.keys()].map((sheet) => this.#unwatchSource(sheet)));
    this.#inclusionRows = null;
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
      registry: null,
      checks: null,
      card: null,
      corrected: null,
      sources: [],
      connector: null,
      google: null,
      googleLink: null,
      uploads: null,
      onedriveHint: null,
      sheets: [],
      otherSheets: [],
      inclusion: null,
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
      this.#set({
        mapping,
        detection: null,
        screen: { name: 'dashboard' },
        otherSheets: this.#state.otherSheets.filter((s) => s !== mapping.sheet),
      });
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
    if (this.#state.screen.name === 'checks') await this.#refreshChecks();
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
    const own = [this.#statusCols.statusCol, this.#statusCols.detailCol].map(columnIndex);
    return address.split(',').every((area) => {
      const cols = [...area.matchAll(/([A-Z]{1,3})\d*/g)].map((m) => columnIndex(m[1] ?? 'A'));
      const lo = Math.min(...cols);
      const hi = Math.max(...cols);
      // Only two columns are ours. A rectangle spanning separated status columns also contains
      // user data; separate owned areas such as M2:M4,O2:O4 are still our own writes.
      return cols.length > 0 && hi - lo <= 1 && own.includes(lo) && own.includes(hi);
    });
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

  /**
   * « Envoyer », after the user confirmed it on the fiche (Review mode, plan §0). With blocking
   * findings open, the user confirmed « Envoyer quand même » for those very findings: a new one
   * found meanwhile stops the send, and the fiche shows it.
   */
  send = async (): Promise<void> => {
    const invoice = this.#state.invoice?.detail;
    if (!invoice) return;
    this.cancelSend();
    const number = invoice.number ?? '';
    const acknowledge = invoice.findings
      .filter((f) => f.severity === 'blocking')
      .map((f) => f.fingerprint);
    const sent = await this.#act(
      'send',
      async () => {
        const result = await this.api.send(invoice.id, acknowledge);
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
    else if (!sent && this.#state.invoice?.detail.id === invoice.id) {
      await this.#act('invoice', () => this.#refreshInvoice());
    }
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

  /**
   * « Encaissée », after the user confirmed it: `amount` cents received (default: the balance). The
   * balance paid, chasing stops; less, it goes on for the rest. The platform is told either way.
   */
  recordPayment = async (paidOn?: string, amount?: number): Promise<void> => {
    const paidBefore = this.#state.invoice?.detail.amountPaid;
    const ok = await this.#chase(
      'payment',
      (id) => this.api.recordPayment(id, { paidOn, amount, paidBefore }),
      (d) =>
        d.status === 'paid'
          ? t('addin.chase.paidDone', { number: d.number ?? '' })
          : t('addin.chase.partDone', {
              number: d.number ?? '',
              left: frMoney(balanceOf(d), d.currency ?? 'EUR'),
            }),
    );
    if (ok) void this.sync();
  };

  /** « Établir un avoir », after the user confirmed it: the credit note's fiche opens. */
  creditNote = async (): Promise<void> => {
    const id = this.#state.invoice?.detail.id;
    if (!id) return;
    const avoir = await this.#act('credit', () => this.api.creditNote(id));
    if (!avoir || this.#state.invoice?.detail.id !== id) return;
    await this.openInvoice(avoir.id);
    this.notify('success', t('addin.credit.made', { number: avoir.number ?? '' }));
    void this.sync();
  };

  /** « Abandonner la créance », after the user confirmed it: chasing stops. */
  writeOff = async (): Promise<void> => {
    const ok = await this.#chase(
      'writeOff',
      (id) => this.api.writeOff(id),
      (d) => t('addin.writeOff.done', { number: d.number ?? '' }),
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
    // The checks read the two switches: the API checked its invoices again, the sheet shows it.
    const rules = patch.requiresPurchaseOrder !== undefined || patch.publicEntity !== undefined;
    const name = { name: party.legalName };
    this.notify(
      'success',
      patch.autopilot !== undefined
        ? t(patch.autopilot ? 'addin.customers.autopilotOn' : 'addin.customers.autopilotOff', name)
        : t(rules ? 'addin.customers.rulesSaved' : 'addin.customers.saved', name),
    );
    if (patch.autopilot !== undefined || rules) void this.sync();
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

  // ── Registre: the workbook's other sheets (R1) ────────────────────────────────────────────────
  #isSource(sheet: string): boolean {
    return this.#state.sources.some((s) => s.sheet === sheet);
  }

  /**
   * Visible sheets that are neither included nor an invoice sheet (one with confirmed columns); those
   * whose name says orders, delivery notes, purchases or prices first.
   */
  async #proposals(sheets: string[], sources: Source[]): Promise<string[]> {
    const included = new Set(sources.map((s) => s.sheet));
    const out: string[] = [];
    for (const sheet of sheets) {
      if (included.has(sheet) || (sheet === this.#state.sheet && this.#state.mapping)) continue;
      if (await this.#deps.port.getSetting(SETTING.mapping(sheet))) continue;
      out.push(sheet);
    }
    return [...out.filter(namedLikeSource), ...out.filter((s) => !namedLikeSource(s))];
  }

  /** At sign-in: the included sheets of this workbook. Never stops the invoices from opening. */
  async #loadSources(): Promise<void> {
    const { workbookId } = this.#state;
    if (!workbookId) return;
    try {
      const [{ sources }, sheets] = await Promise.all([
        this.api.sources(workbookId),
        this.#deps.port.sheetNames(),
      ]);
      this.#set({ sources, sheets, otherSheets: await this.#proposals(sheets, sources) });
    } catch {
      // Offline or a hiccup: the Registre asks again when it opens.
    }
  }

  /**
   * Listens to every included sheet still in the workbook, and reads the new ones once: changes made
   * while the pane was closed reach the Registre too. Stops listening to the sheets removed elsewhere.
   */
  async #followSources(): Promise<void> {
    try {
      const wanted = new Set(this.#state.sources.map((s) => s.sheet));
      for (const sheet of this.#sourceWatch.keys()) {
        if (!wanted.has(sheet)) await this.#unwatchSource(sheet);
      }
      for (const { sheet } of this.#state.sources) {
        if (this.#sourceWatch.has(sheet) || !this.#state.sheets.includes(sheet)) continue;
        await this.#watchSource(sheet);
        void this.syncSource(sheet);
      }
    } catch (e) {
      this.#fail(e);
    }
  }

  async #watchSource(sheet: string): Promise<void> {
    if (this.#sourceWatch.has(sheet)) return;
    const watch: SourceWatch = { stop: null, timer: null, reading: null, again: false };
    this.#sourceWatch.set(sheet, watch);
    try {
      watch.stop = await this.#deps.port.onChange(sheet, () => {
        if (!this.#state.me) return;
        if (watch.timer !== null) this.#deps.timers.clearTimeout(watch.timer);
        watch.timer = this.#deps.timers.setTimeout(() => {
          watch.timer = null;
          void this.syncSource(sheet);
        }, AUTO_SYNC_MS);
      });
    } catch (e) {
      this.#sourceWatch.delete(sheet);
      throw e;
    }
  }

  async #unwatchSource(sheet: string): Promise<void> {
    const watch = this.#sourceWatch.get(sheet);
    if (!watch) return;
    this.#sourceWatch.delete(sheet);
    if (watch.timer !== null) this.#deps.timers.clearTimeout(watch.timer);
    await watch.stop?.();
  }

  #putSource(source: Source): void {
    const sources = [...this.#state.sources.filter((s) => s.sheet !== source.sheet), source];
    this.#set({ sources: sources.sort((a, b) => a.sheet.localeCompare(b.sheet)) });
  }

  /** « Lire maintenant », and every change to an included sheet: only what changed is written. */
  syncSource = async (sheet: string): Promise<void> => {
    const watch = this.#sourceWatch.get(sheet);
    if (watch?.reading) {
      watch.again = true;
      return watch.reading;
    }
    const reading = (async () => {
      do {
        if (watch) watch.again = false;
        await this.#act(`source:${sheet}`, () => this.#syncSourceOnce(sheet), {
          key: `source:${sheet}`,
          label: t('addin.offline.source', { sheet }),
        });
      } while (watch?.again);
    })().finally(() => {
      if (watch) watch.reading = null;
    });
    if (watch) watch.reading = reading;
    return reading;
  };

  async #syncSourceOnce(sheet: string): Promise<void> {
    const { workbookId } = this.#state;
    if (!workbookId || !this.#state.me || !this.#isSource(sheet)) return;
    const { snapshot } = readUsedRange(sheet, await this.#deps.port.usedRange(sheet));
    let read: SourceRead;
    try {
      read = await this.api.syncSource(workbookId, snapshot);
    } catch (e) {
      // Removed from another pane in the meantime: nothing left to read.
      if (e instanceof ApiFailure && e.status === 404) return this.#forgetSource(sheet);
      throw e;
    }
    const before = this.#state.sources.find((s) => s.sheet === sheet)?.stats;
    this.#putSource(read.source);
    if (before?.headerFound !== false && read.source.stats?.headerFound === false) {
      this.notify('warning', t('addin.registry.headerLost', { sheet }));
    }
    const changed = read.written > 0 || read.removed > 0;
    if (changed && this.#state.screen.name === 'registry') await this.#refreshRegistry();
    if (changed && this.#state.screen.name === 'checks') await this.#refreshChecks();
  }

  async #forgetSource(sheet: string): Promise<void> {
    await this.#unwatchSource(sheet);
    const sources = this.#state.sources.filter((s) => s.sheet !== sheet);
    this.#set({ sources, otherSheets: await this.#proposals(this.#state.sheets, sources) });
  }

  async #refreshRegistry(): Promise<void> {
    try {
      this.#set({ registry: await this.api.registry() });
    } catch {
      // Not worth a notice: the screen keeps what it showed, the next read asks again.
    }
  }

  /** The « Registre » screen: the totals, this workbook's sheets, and the sheets to propose. */
  loadRegistry = async (): Promise<void> => {
    const { workbookId } = this.#state;
    if (!workbookId) return;
    await this.#act('registry', async () => {
      const [registry, { sources }, sheets] = await Promise.all([
        this.api.registry(),
        this.api.sources(workbookId),
        this.#deps.port.sheetNames(),
      ]);
      this.#set({
        registry,
        sources,
        sheets,
        otherSheets: await this.#proposals(sheets, sources),
      });
    });
    await this.#followSources();
    await Promise.all([this.#refreshConnector(), this.#refreshGoogle(), this.#refreshUploads()]);
  };

  /** « Inclure cette feuille » / « Revoir les colonnes »: what the sheet holds. Nothing is saved. */
  includeSheet = async (sheet: string): Promise<void> => {
    const { workbookId } = this.#state;
    if (!workbookId) return;
    this.#inclusionRows = null;
    this.#set({ inclusion: null });
    await this.#act(`include:${sheet}`, async () => {
      const reading = readUsedRange(sheet, await this.#deps.port.usedRange(sheet));
      if (reading.snapshot.rows.length === 0) {
        this.notify('info', t('addin.detect.empty', { sheet }));
        return;
      }
      const detection = await this.api.detectSource(workbookId, detectionSample(reading.snapshot));
      this.#inclusionRows = reading.snapshot;
      const headers = headersOf(reading.snapshot, detection.layout.headerRow);
      this.#set({ inclusion: { sheet, detection, headers }, notice: null });
    });
  };

  /** The column headers of another row, when the company moves the header row. */
  inclusionHeaders = (row: number): Header[] =>
    this.#inclusionRows ? headersOf(this.#inclusionRows, row) : [];

  cancelInclusion = (): void => {
    this.#inclusionRows = null;
    this.#set({ inclusion: null });
  };

  /** The company confirmed what the sheet holds: the whole sheet is read once, then followed. */
  confirmLayout = async (layout: LayoutMapping): Promise<void> => {
    const file = this.#state.inclusion?.file;
    if (file) {
      await this.#confirmFileLayout(file, layout);
      return;
    }
    const { workbookId } = this.#state;
    if (!workbookId) return;
    const { sheet } = layout;
    const read = await this.#act('include', async () => {
      const { snapshot } = readUsedRange(sheet, await this.#deps.port.usedRange(sheet));
      return this.api.includeSource(workbookId, layout, snapshot);
    });
    if (!read) return;
    this.#inclusionRows = null;
    this.#putSource(read.source);
    this.#set({ inclusion: null, otherSheets: this.#state.otherSheets.filter((s) => s !== sheet) });
    this.notify(
      'success',
      t('addin.registry.included', { sheet, docs: read.source.stats?.docs ?? 0 }),
    );
    await this.#act('include', () => this.#watchSource(sheet));
    await this.#refreshRegistry();
  };

  /** « Retirer »: the sheet leaves the check, its documents leave the Registre; the sheet stays. */
  removeSource = async (sheet: string): Promise<void> => {
    const { workbookId } = this.#state;
    if (!workbookId) return;
    const done = await this.#act(`source:${sheet}`, () => this.api.removeSource(workbookId, sheet));
    if (!done) return;
    await this.#forgetSource(sheet);
    this.notify('success', t('addin.registry.removed', { sheet }));
    await this.#refreshRegistry();
  };

  /** « Voir la feuille »: activates it at its header row. */
  showSheet = async (sheet: string): Promise<void> => {
    const row = this.#state.sources.find((s) => s.sheet === sheet)?.layout.headerRow ?? 1;
    await this.#act('select', () => this.#deps.port.select(sheet, `A${row}`));
  };

  // ── Fichiers OneDrive (R4) ────────────────────────────────────────────────────────────────────
  async #refreshConnector(): Promise<void> {
    try {
      this.#set({ connector: await this.api.connector() });
    } catch {
      // Not worth a notice: the section keeps what it showed, the next read asks again.
    }
  }

  /**
   * Scout (plan §R4): suggests « Fichiers OneDrive » once, when the workbook is itself on OneDrive or
   * SharePoint, or the API found the company's mail with Microsoft. It never connects by itself.
   */
  async #scout(): Promise<void> {
    if (!this.#deps.microsoft || (await this.#deps.tokens.get(SCOUT_KEY))) return;
    await this.#refreshConnector();
    const view = this.#state.connector;
    if (!view?.microsoft || view.connection) return;
    const hint = onMicrosoftCloud(this.#deps.documentUrl())
      ? 'document'
      : view.mailOnMicrosoft
        ? 'mail'
        : null;
    this.#set({ onedriveHint: hint });
  }

  /** « Voir les fichiers OneDrive » or « Non merci »: either way, the suggestion is not made again. */
  answerOnedriveHint = async (open: boolean): Promise<void> => {
    this.#set({ onedriveHint: null });
    await this.#deps.tokens.set(SCOUT_KEY, open ? 'opened' : 'declined');
    if (open) this.navigate({ name: 'registry' });
  };

  /** Why Microsoft's side said no, in the pane's words. */
  #signInFailed(e: unknown): boolean {
    if (!(e instanceof MicrosoftPortError)) return false;
    // The person reads a calm line; Microsoft's own reason stays in the console for support.
    if (e.reason === 'failed') console.warn(e);
    this.notify(
      e.reason === 'cancelled' ? 'info' : 'warning',
      t(`addin.connector.port.${e.reason}`),
    );
    return true;
  }

  /**
   * « Connecter OneDrive » / « Reconnecter OneDrive »: Microsoft signs the person in (consent the
   * first time), and the API exchanges that token for its own access to the files they pick.
   */
  connectMicrosoft = async (): Promise<void> => {
    const app = this.#state.connector?.microsoft;
    const port = this.#deps.microsoft;
    if (!app || !port) {
      this.notify(
        'info',
        t(port ? 'addin.connector.port.unsupported' : 'addin.connector.port.unavailable'),
      );
      return;
    }
    const again = this.#state.connector?.connection !== null;
    const view = await this.#act('connector', async () => {
      let token: string;
      try {
        token = await port.signIn(app);
      } catch (e) {
        if (this.#signInFailed(e)) return null;
        throw e;
      }
      return this.api.connect(token);
    });
    if (!view?.connection) return;
    this.#set({ connector: view, onedriveHint: null });
    this.notify(
      'success',
      t(again ? 'addin.connector.reconnected' : 'addin.connector.connected', {
        account: view.connection.label,
      }),
    );
  };

  /** « Choisir des fichiers »: OneDrive's own picker; only the files picked there are ever read. */
  pickFiles = async (): Promise<void> => {
    const view = this.#state.connector;
    const port = this.#deps.microsoft;
    const picker = view?.connection?.picker;
    if (!view?.microsoft || !port || !picker) {
      this.notify(
        'info',
        t(port ? 'addin.connector.port.unsupported' : 'addin.connector.port.unavailable'),
      );
      return;
    }
    const app = view.microsoft;
    const next = await this.#act('connector:pick', async () => {
      let files: Awaited<ReturnType<MicrosoftPort['pick']>>;
      try {
        files = await port.pick({
          clientId: app.clientId,
          picker,
          labels: { title: t('addin.connector.pickerTitle'), close: t('addin.connector.close') },
        });
      } catch (e) {
        if (this.#signInFailed(e)) return null;
        throw e;
      }
      if (files.length === 0) return null;
      return { view: await this.api.pickFiles(files), count: files.length };
    });
    if (!next) return;
    this.#set({ connector: next.view });
    this.notify('success', t('addin.connector.picked', { count: next.count }));
  };

  /** « Inclure » on a sheet of a picked file: what it holds, from the API's own read of the file. */
  includeFileSheet = async (fileId: string, sheet: string): Promise<void> => {
    const found = this.#pickedFile(fileId);
    if (!found) return;
    const { file, provider } = found;
    this.#inclusionRows = null;
    this.#set({ inclusion: null });
    await this.#act(`file:${fileId}:${sheet}`, async () => {
      const { sample, ...detection } = await this.api.detectFileSheet(fileId, sheet, provider);
      if (sample.rows.length === 0) {
        this.notify('info', t('addin.detect.empty', { sheet }));
        return;
      }
      this.#inclusionRows = sample;
      const headers = headersOf(sample, detection.layout.headerRow);
      this.#set({
        inclusion: { sheet, detection, headers, file: { id: file.id, name: file.name, provider } },
        notice: null,
      });
    });
  };

  /** A picked or uploaded file, whichever section shows it. */
  #pickedFile(fileId: string): { file: ConnectedFile; provider: FileOwner } | null {
    const fromMicrosoft = this.#state.connector?.connection?.files.find((f) => f.id === fileId);
    if (fromMicrosoft) return { file: fromMicrosoft, provider: 'microsoft' };
    const fromGoogle = this.#state.google?.connection?.files.find((f) => f.id === fileId);
    if (fromGoogle) return { file: fromGoogle, provider: 'google' };
    const uploaded = this.#state.uploads?.find((f) => f.id === fileId);
    return uploaded ? { file: uploaded, provider: 'upload' } : null;
  }

  async #refreshFiles(provider: FileOwner) {
    const files = {
      microsoft: () => this.#refreshConnector(),
      google: () => this.#refreshGoogle(),
      upload: () => this.#refreshUploads(),
    };
    await Promise.all([files[provider](), this.#refreshRegistry()]);
  }

  async #confirmFileLayout(
    file: { id: string; name: string; provider: FileOwner },
    layout: LayoutMapping,
  ) {
    const read = await this.#act('include', () =>
      this.api.includeFileSheet(file.id, layout, file.provider),
    );
    if (!read) return;
    this.#inclusionRows = null;
    this.#set({ inclusion: null });
    this.notify(
      'success',
      t('addin.connector.included', {
        sheet: layout.sheet,
        file: file.name,
        docs: read.source.stats?.docs ?? 0,
      }),
    );
    await this.#refreshFiles(file.provider);
  }

  /** « Retirer » on a sheet of a file: its documents leave the Registre; the file stays picked. */
  removeFileSheet = async (fileId: string, sheet: string): Promise<void> => {
    const provider = this.#pickedFile(fileId)?.provider ?? 'microsoft';
    const done = await this.#act(`file:${fileId}:${sheet}`, () =>
      this.api.removeFileSheet(fileId, sheet, provider),
    );
    if (!done) return;
    this.notify('success', t('addin.registry.removed', { sheet }));
    await this.#refreshFiles(provider);
  };

  /** « Retirer le fichier »: it is no longer read; what its sheets gave leaves the Registre. */
  removeFile = async (fileId: string): Promise<void> => {
    const found = this.#pickedFile(fileId);
    const name = found?.file.name;
    if (found?.provider === 'upload') {
      const list = await this.#act(`file:${fileId}`, () => this.api.removeUpload(fileId));
      if (!list) return;
      this.#set({ uploads: list.uploads });
      this.notify('success', t('addin.upload.removed', { file: name ?? '' }));
      await this.#refreshRegistry();
      return;
    }
    if (found?.provider === 'google') {
      const view = await this.#act(`file:${fileId}`, () => this.api.removeGoogleFile(fileId));
      if (!view) return;
      this.#set({ google: view });
      this.notify('success', t('addin.connector.fileRemoved', { file: name ?? '' }));
      await this.#refreshRegistry();
      return;
    }
    const view = await this.#act(`file:${fileId}`, () => this.api.removeFile(fileId));
    if (!view) return;
    this.#set({ connector: view });
    this.notify('success', t('addin.connector.fileRemoved', { file: name ?? '' }));
    await this.#refreshRegistry();
  };

  /**
   * « Déconnecter OneDrive », once confirmed: the token, the files and what they gave are deleted
   * here. Microsoft keeps the consent until the person withdraws it there (docs/MICROSOFT365.md).
   */
  disconnectMicrosoft = async (): Promise<void> => {
    const view = await this.#act('connector', () => this.api.disconnect());
    if (!view) return;
    this.#set({ connector: view });
    this.notify('success', t('addin.connector.disconnected'));
    await this.#refreshRegistry();
  };

  // ── Fichiers importés (R6) ──────────────────────────────────────────────────────────────────
  async #refreshUploads(): Promise<void> {
    try {
      this.#set({ uploads: (await this.api.uploads()).uploads });
    } catch {
      // Not worth a notice: the section keeps what it showed, the next read asks again.
    }
  }

  /**
   * « Importer un fichier »: a workbook joins the section, its sheets to include like a picked
   * file's; a supplier invoice gives its prices as the cost. The same name again replaces the file.
   */
  uploadFile = async (file: Blob, name: string): Promise<void> => {
    const known = this.#state.uploads?.some((u) => u.name === name) ?? false;
    const added = await this.#act('upload', () => this.api.upload(name, file));
    if (!added) return;
    const { upload, replaced } = added;
    const others = (this.#state.uploads ?? []).filter((u) => u.id !== upload.id && u.name !== name);
    this.#set({
      uploads: [...others, upload].sort((a, b) => a.name.localeCompare(b.name)),
    });
    if (known && !replaced) {
      this.notify('info', t('addin.upload.same', { file: name }));
      return;
    }
    if (upload.invoice) {
      this.notify(
        'success',
        t('addin.upload.invoiceAdded', {
          number: upload.invoice.number ?? '',
          supplier: upload.invoice.supplier ?? '',
        }),
      );
    } else {
      this.notify(
        'success',
        t(replaced ? 'addin.upload.replaced' : 'addin.upload.added', { file: name }),
      );
    }
    await this.#refreshRegistry();
  };

  // ── Fichiers Google Drive (R5) ──────────────────────────────────────────────────────────────
  async #refreshGoogle(): Promise<GoogleView | null> {
    try {
      const google = await this.api.google();
      this.#set({ google });
      return google;
    } catch {
      // Not worth a notice: the section keeps what it showed, the next read asks again.
      return null;
    }
  }

  /**
   * « Connecter Google Drive », « Choisir des fichiers », « Reconnecter Google Drive »: Google's own
   * window, in a browser, signs the person in and shows its picker; the API hears back from Google
   * directly. The pane asks the API meanwhile and says so when the files arrive.
   */
  openGoogle = async (): Promise<void> => {
    const page = await this.#act('google', () => this.api.googleStart());
    if (!page) return;
    const opened = await this.#deps.openUrl(page.url).catch(() => false);
    this.#set({ googleLink: opened ? null : page.url });
    this.notify('info', t(opened ? 'addin.google.opened' : 'addin.google.openLink'));
    this.#stopGoogle();
    this.#pollGoogle(googleKey(this.#state.google), GOOGLE_POLLS);
  };

  #stopGoogle(): void {
    if (this.#googleTimer !== null) this.#deps.timers.clearTimeout(this.#googleTimer);
    this.#googleTimer = null;
  }

  #pollGoogle(before: string, left: number): void {
    if (left <= 0) return;
    this.#googleTimer = this.#deps.timers.setTimeout(async () => {
      this.#googleTimer = null;
      const view = await this.#refreshGoogle();
      if (!view || googleKey(view) === before) {
        this.#pollGoogle(before, left - 1);
        return;
      }
      this.#set({ googleLink: null });
      const conn = view.connection;
      if (conn) {
        this.notify('success', t('addin.google.updated', { account: conn.label }));
      }
    }, GOOGLE_POLL_MS);
  }

  /** « Déconnecter Google Drive », once confirmed: our token is revoked at Google, files go. */
  disconnectGoogle = async (): Promise<void> => {
    this.#stopGoogle();
    const view = await this.#act('google', () => this.api.disconnectGoogle());
    if (!view) return;
    this.#set({ google: view, googleLink: null });
    this.notify('success', t('addin.google.disconnected'));
    await this.#refreshRegistry();
  };

  // ── Contrôles (R2) ────────────────────────────────────────────────────────────────────────────
  async #refreshChecks(): Promise<void> {
    try {
      this.#set({ checks: await this.api.checks() });
    } catch {
      // Not worth a notice: the screen keeps what it showed, the next read asks again.
    }
  }

  /** The « Contrôles » screen: the API checks the documents again first when they moved. */
  loadChecks = async (): Promise<void> => {
    const checks = await this.#act('checks', () => this.api.checks());
    if (checks) this.#set({ checks });
  };

  /** « Oui » / « Non » on documents that look alike: the checks run again with the answer. */
  decideLink = async (id: string, status: 'confirmed' | 'rejected'): Promise<void> => {
    const checks = await this.#act(`link:${id}`, () => this.api.decideLink(id, status));
    if (!checks) return;
    this.#set({ checks });
    this.notify('success', t(`addin.checks.decided.${status}`));
  };

  /** « Ce n'est pas le même article »: this purchase gives no cost to the invoice; the one before does. */
  notSameItem = async (linkId: string): Promise<void> => {
    const checks = await this.#act(`link:${linkId}`, () => this.api.decideLink(linkId, 'rejected'));
    if (!checks) return;
    this.#set({ checks });
    this.notify('success', t('addin.checks.decided.notSameItem'));
  };

  /** « C'est normal » (R7): the finding's rule stays quiet on its article; the checks run again. */
  acceptFinding = async (id: string, choice: NormalChoice): Promise<void> => {
    const checks = await this.#act(`normal:${id}`, () => this.api.acceptFinding(id, choice));
    if (!checks) return;
    this.#set({ checks });
    this.notify('success', t('addin.checks.decided.normal'));
  };

  /** « Retirer » on an exception: the rule speaks again. */
  removeException = async (id: string): Promise<void> => {
    const checks = await this.#act(`exception:${id}`, () => this.api.removeException(id));
    if (!checks) return;
    this.#set({ checks });
    this.notify('success', t('addin.checks.decided.removed'));
  };

  /** « Oui » / « Non » on « Est-ce le même article ? ». */
  decideSynonym = async (id: string, status: 'confirmed' | 'rejected'): Promise<void> => {
    const checks = await this.#act(`synonym:${id}`, () => this.api.decideSynonym(id, status));
    if (!checks) return;
    this.#set({ checks });
    this.notify(
      'success',
      t(
        status === 'confirmed'
          ? 'addin.checks.decided.synonymConfirmed'
          : 'addin.checks.decided.synonymRejected',
      ),
    );
  };

  /**
   * « Corriger la ligne », « Voir la commande »…: selects the cell in the open workbook; a document
   * of another workbook is named instead. A supplier invoice received through the platform has no
   * cell: « Réception » shows it.
   */
  showEvidence = async (evidence: Evidence): Promise<void> => {
    if (!evidence.cell && evidence.inboundId) {
      this.navigate({ name: 'reception', focus: evidence.inboundId });
      return;
    }
    const target = evidence.cell ? parseAddress(evidence.cell) : null;
    if (!target) return;
    if (evidence.file) {
      this.notify(
        'info',
        t('addin.connector.inFile', { file: evidence.file, sheet: target.sheet }),
      );
      return;
    }
    if (evidence.workbookId && evidence.workbookId !== this.#state.workbookId) {
      this.notify('info', t('addin.checks.otherWorkbook', { sheet: target.sheet }));
      return;
    }
    await this.#act('select', () => this.#deps.port.select(target.sheet, target.cell));
  };

  // ── Assistant and corrections (R8) ────────────────────────────────────────────────────────────
  /** « Demander à l'assistant »: the conversation kept with the finding, or its opening. */
  openChat = async (findingId: string): Promise<void> => {
    this.#closeChat();
    this.navigate({ name: 'chat', findingId });
    const opened = await this.#act('chat', () => this.api.chat(findingId));
    const screen = this.#state.screen;
    if (!opened || screen.name !== 'chat' || screen.findingId !== findingId) return;
    const chat = new PaneChat({
      findingId,
      messages: opened.messages,
      api: this.api,
      changed: (messages, status) => {
        const open = this.#state.chat;
        if (this.#chat === chat && open) this.#set({ chat: { ...open, messages, status } });
      },
      onCard: (call) => void this.#cardFor(findingId, call),
      onError: (e) => this.#chatFailed(e),
    });
    this.#chat = chat;
    this.#set({
      chat: { findingId, available: opened.available, messages: opened.messages, status: 'ready' },
    });
    // A card the pane closed on before the click: the agent still waits for its answer.
    for (const call of waitingCards(opened.messages)) void this.#cardFor(findingId, call);
  };

  /** The question typed in the chat; the answer streams into the conversation. */
  ask = async (text: string): Promise<void> => {
    const chat = this.#chat;
    const question = text.trim();
    if (!chat || !question || !this.#state.chat?.available) return;
    this.#set({ notice: null });
    await chat.sendMessage({ text: question });
  };

  /** « Arrêter »: the answer stops where it is. */
  stopAnswer = async (): Promise<void> => {
    await this.#chat?.stop();
  };

  #closeChat(): void {
    const chat = this.#chat;
    this.#chat = null;
    if (chat) void chat.stop();
    if (this.#state.chat) this.#set({ chat: null });
  }

  #chatFailed(e: Error): void {
    if (e instanceof Offline) {
      this.#set({ offline: this.#queue.labels });
      this.notify('warning', t('addin.offline.notQueued'));
    } else if (e instanceof ApiFailure) {
      this.#fail(e);
    } else {
      // The server's stream says only that the answer failed; nothing of the question is lost.
      console.error(e);
      this.notify('error', t('api.error.chat_failed'));
    }
  }

  /** The agent asked for a card: the server builds it from the finding, or says why it cannot. */
  async #cardFor(findingId: string, call: CardCall): Promise<void> {
    const other = this.#otherMode(findingId);
    if (other) {
      this.#answer(findingId, call.toolCallId, call.tool, 'refused', call.editId ?? null, {
        message: other,
      });
      return;
    }
    try {
      const edit =
        call.tool === 'proposeFix'
          ? await this.api.fix(findingId, { by: 'agent', toolCallId: call.toolCallId })
          : await this.api.undoEdit(call.editId ?? (await this.api.lastEdit(findingId)).id);
      const kind = call.tool === 'proposeFix' ? 'fix' : 'undo';
      this.#set({ card: { kind, findingId, edit, toolCallId: call.toolCallId, conflict: null } });
    } catch (e) {
      if (e instanceof ApiFailure && e.status !== 401) {
        // An invoice already sent, nothing one cell corrects, nothing to undo: the agent says why.
        this.#answer(findingId, call.toolCallId, call.tool, 'refused', call.editId ?? null, {
          message: e.message,
        });
        return;
      }
      // Offline: the card is asked again when the chat opens next.
      if (e instanceof Offline) this.notify('warning', t('addin.offline.notQueued'));
      else this.#fail(e);
    }
  }

  /**
   * The row feeds the invoice of the pane's mode (Mode test or not): written there, a correction of the
   * other mode's invoice would be read into the wrong one, and its finding would stay.
   */
  #otherMode(findingId: string): string | null {
    const finding = this.#state.checks?.findings.find((f) => f.id === findingId);
    if (!finding || finding.isTest === this.#state.testMode) return null;
    return t(finding.isTest ? 'addin.edit.otherMode.real' : 'addin.edit.otherMode.test');
  }

  /** « Corriger pour moi » on the finding's card: the same card, without the chat. */
  fixFinding = async (findingId: string): Promise<void> => {
    const other = this.#otherMode(findingId);
    if (other) {
      this.notify('warning', other);
      return;
    }
    const edit = await this.#act(`fix:${findingId}`, () =>
      this.api.fix(findingId, { by: 'person' }),
    );
    if (edit)
      this.#set({ card: { kind: 'fix', findingId, edit, toolCallId: null, conflict: null } });
  };

  /** « Annuler la correction »: the card that puts « Avant » back. */
  undoCorrection = async (edit: Edit): Promise<void> => {
    const other = edit.findingId ? this.#otherMode(edit.findingId) : null;
    if (other) {
      this.notify('warning', other);
      return;
    }
    const undo = await this.#act(`fix:${edit.findingId}`, () => this.api.undoEdit(edit.id));
    if (!undo) return;
    const findingId = undo.findingId ?? edit.findingId ?? '';
    this.#set({ card: { kind: 'undo', findingId, edit: undo, toolCallId: null, conflict: null } });
  };

  /** « Appliquer »: checks the cell still holds « Avant », writes « Après », checks the invoice again. */
  applyCard = (): Promise<void> => this.#applyCard(false);

  /** « Remettre quand même »: the undo writes over what the person typed since. */
  overwrite = (): Promise<void> => this.#applyCard(true);

  async #applyCard(force: boolean): Promise<void> {
    const card = this.#state.card;
    if (!card) return;
    await this.#act('edit', async () => {
      let edit: Edit;
      try {
        // Asked again right before writing: the lock is renewed, and an invoice sent since refuses.
        edit =
          card.kind === 'fix'
            ? await this.api.fix(card.findingId, {
                by: card.toolCallId ? 'agent' : 'person',
                ...(card.toolCallId && { toolCallId: card.toolCallId }),
              })
            : await this.api.undoEdit(card.edit.id);
      } catch (e) {
        if (!(e instanceof ApiFailure) || e.status === 401) throw e;
        this.#set({ card: null });
        this.notify('warning', e.message);
        this.#answerCard(card, 'refused', { message: e.message });
        return;
      }
      const [from, to] =
        card.kind === 'fix' ? [edit.before, edit.after] : [edit.after, edit.before];
      const held =
        edit.workbookId && edit.workbookId !== this.#state.workbookId
          ? { reason: 'missing' as const, found: '', otherWorkbook: true }
          : force
            ? null
            : await this.#held(edit, from);
      if (held) return this.#conflict({ ...card, edit }, held);
      const { port } = this.#deps;
      await port.select(edit.sheet, edit.cell);
      await port.writeCell(edit.sheet, edit.cell, Number(to));
      await this.#syncSheet(edit.sheet);
      const decided = await this.api.decideEdit(edit.id, {
        status: card.kind === 'fix' ? 'applied' : 'reverted',
      });
      this.#decided(card, decided);
    });
  }

  /** What the cell holds instead of `expected`; null when it holds it, as a plain value. */
  async #held(edit: Edit, expected: string): Promise<CellConflict | null> {
    let cell: CellContent;
    try {
      cell = await this.#deps.port.readCell(edit.sheet, edit.cell);
    } catch (e) {
      if (isPermanent(e)) return { reason: 'missing', found: '' };
      throw e;
    }
    if (cell.formula) return { reason: 'formula', found: cell.formula, formula: cell.formula };
    if (cell.value === '' || cell.value === null) return { reason: 'missing', found: '' };
    const value =
      typeof cell.value === 'number'
        ? String(cell.value)
        : String(cell.value)
            .replace(/[\s  €]/g, '')
            .replace(',', '.');
    return compareDecimal(value, expected) === 0
      ? null
      : { reason: 'changed', found: cell.text || String(cell.value) };
  }

  /** Nothing written: the server keeps why; a correction ends here, an undo asks first. */
  async #conflict(card: EditCard, held: CellConflict & { otherWorkbook?: boolean }): Promise<void> {
    const { edit } = card;
    const decided = await this.api.decideEdit(edit.id, {
      status: 'conflict',
      found: held.found,
      reason: held.reason,
      ...(held.formula && { formula: held.formula }),
    });
    const cell = `${edit.sheet}!${edit.cell}`;
    const [from, to] = card.kind === 'fix' ? [edit.before, edit.after] : [edit.after, edit.before];
    if (card.kind === 'undo' && !held.otherWorkbook) {
      this.#set({ card: { ...card, edit: decided.edit, conflict: held }, corrected: decided.edit });
      void this.#deps.port.select(edit.sheet, edit.cell).catch(() => {});
      return;
    }
    const message = held.otherWorkbook
      ? t('addin.edit.otherWorkbook', { sheet: edit.sheet })
      : t(`addin.edit.conflict.${held.reason}`, {
          cell,
          found: held.found,
          expected: decimalFr(from),
          value: decimalFr(to),
        });
    this.#set({ card: null });
    this.notify('warning', message);
    this.#answerCard(card, 'conflict', { message });
    await this.#refreshChecks();
  }

  /** Written and checked again: « corrigé » only when the checks closed the finding. */
  #decided(card: EditCard, { edit, resolved, remaining }: EditDecided): void {
    const cell = `${edit.sheet}!${edit.cell}`;
    if (card.kind === 'fix') {
      this.#set({ card: null, corrected: edit });
      const values = { cell, before: decimalFr(edit.before), after: decimalFr(edit.after) };
      this.notify(
        'success',
        resolved
          ? t('addin.edit.applied', values)
          : t('addin.edit.appliedOpen', { ...values, count: remaining.length }),
      );
      this.#answerCard(card, 'applied', {
        resolved: resolved === true,
        remaining: remaining.map((r) => r.message),
      });
    } else {
      this.#set({ card: null, corrected: null });
      this.notify('success', t('addin.edit.reverted', { cell, value: decimalFr(edit.before) }));
      this.#answerCard(card, 'reverted', { resolved: resolved === true });
    }
    void this.#refreshChecks();
  }

  /** « Ne pas appliquer », « Garder la correction », « Laisser »: nothing is written. */
  declineCard = async (): Promise<void> => {
    const card = this.#state.card;
    if (!card) return;
    const decided = await this.#act('edit', () =>
      this.api.decideEdit(card.edit.id, { status: card.kind === 'fix' ? 'declined' : 'kept' }),
    );
    if (!decided) return;
    const { edit } = decided;
    if (card.kind === 'fix') {
      this.#set({ card: null });
      this.notify('info', t('addin.edit.declined'));
      this.#answerCard(card, 'declined');
    } else if (card.conflict) {
      const values = { cell: `${edit.sheet}!${edit.cell}`, found: card.conflict.found };
      this.#set({ card: null, corrected: edit });
      this.notify('info', t('addin.edit.leftAsIs', values));
      this.#answerCard(card, 'conflict', { message: t('addin.edit.leftAsIs', values) });
    } else {
      this.#set({ card: null, corrected: edit });
      this.notify('info', t('addin.edit.kept'));
      this.#answerCard(card, 'declined');
    }
    void this.#refreshChecks();
  };

  #answerCard(
    card: EditCard,
    status: 'applied' | 'declined' | 'conflict' | 'refused' | 'reverted',
    more: { resolved?: boolean; remaining?: string[]; message?: string } = {},
  ): void {
    if (!card.toolCallId) return;
    const tool = card.kind === 'fix' ? 'proposeFix' : 'undoEdit';
    this.#answer(card.findingId, card.toolCallId, tool, status, card.edit.id, more);
  }

  /** The person's click, told to the agent: the chat asks it again to say what came of it. */
  #answer(
    findingId: string,
    toolCallId: string,
    tool: CardCall['tool'],
    status: 'applied' | 'declined' | 'conflict' | 'refused' | 'reverted',
    editId: string | null,
    more: { resolved?: boolean; remaining?: string[]; message?: string },
  ): void {
    const chat = this.#chat;
    // The chat was closed: the call stays open, and is asked again when it opens next.
    if (!chat || chat.findingId !== findingId) return;
    if (tool === 'proposeFix' && status !== 'reverted') {
      const output: FixOutcome = { status, editId, ...more };
      void chat.addToolOutput({ tool, toolCallId, output });
    } else if (tool === 'undoEdit' && status !== 'applied') {
      const { remaining: _, ...rest } = more;
      const output: UndoOutcome = { status, editId: editId ?? '', ...rest };
      void chat.addToolOutput({ tool, toolCallId, output });
    }
  }

  /** Reads an invoice sheet again and tells the server, the active one or not (after a correction). */
  async #syncSheet(sheet: string): Promise<void> {
    if (this.#syncing) await this.#syncing;
    if (sheet === this.#state.sheet && this.#state.mapping) {
      await this.#syncOnce();
    } else {
      const { workbookId, testMode } = this.#state;
      const mapping = await this.#mappingOf(sheet);
      if (!mapping || !workbookId) return;
      const reading = readUsedRange(sheet, await this.#deps.port.usedRange(sheet));
      const result = await this.api.sync(workbookId, {
        snapshot: reading.snapshot,
        mapping,
        test: testMode,
      });
      await this.#writer.write(this.#plan(reading, mapping, result));
    }
    // The write fired the change event: the sheet was just read, no second sync.
    if (this.#autoSync !== null) this.#deps.timers.clearTimeout(this.#autoSync);
    this.#autoSync = null;
  }

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
