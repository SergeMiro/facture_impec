// The task pane's only door to the API. Every answer is checked with Zod (rule 4); an API error
// arrives as ApiFailure with the server's French message, a network failure as Offline.
import {
  ChaseDraft,
  ChaseStep,
  DOC_KINDS,
  LayoutMapping,
  SheetMapping,
  type SheetSnapshot,
} from '@fi/core';
import { z } from 'zod';

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The request never reached the API: the action can wait for the connection. */
export class Offline extends Error {}

const ErrorBody = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

/** An accounting firm's brand on the company (white label, M7). */
const Brand = z.object({
  firmName: z.string(),
  accentColor: z.string().optional(),
  full: z.boolean(),
});

const Tenant = z.object({
  id: z.string(),
  name: z.string(),
  siren: z.string(),
  pdpProvider: z.string(),
  mode: z.string(),
  sandboxEnabled: z.boolean(),
  whiteLabel: Brand.nullable().default(null),
});
const User = z.object({ email: z.string(), role: z.string() });

export const Me = z.object({
  tenant: Tenant,
  user: User.nullable(),
  testMode: z.object({ enabled: z.boolean(), available: z.boolean() }),
  /** Prod: real sends wait until the operator switches the company live. */
  awaitingGoLive: z.boolean().default(false),
});
export type Me = z.infer<typeof Me>;

const SignupOffer = z.object({ termsVersion: z.string(), termsUrl: z.string().nullable() });
export type SignupOffer = z.infer<typeof SignupOffer>;
const Options = z.object({
  magicLink: z.boolean(),
  signup: SignupOffer.nullable().default(null),
});

const PostalAddress = z.object({
  line1: z.string().optional(),
  line2: z.string().optional(),
  line3: z.string().optional(),
  city: z.string().optional(),
  postCode: z.string().optional(),
  subdivision: z.string().optional(),
  country: z.string().optional(),
});
export type PostalAddress = z.infer<typeof PostalAddress>;

/** What the company directory knows of a SIREN (« Créer un compte »). */
export const DirectoryCompany = z.object({
  siren: z.string(),
  name: z.string().nullable(),
  address: PostalAddress.nullable(),
  vatId: z.string().nullable(),
  vatSource: z.enum(['dgfip', 'computed']),
  masked: z.boolean(),
});
export type DirectoryCompany = z.infer<typeof DirectoryCompany>;

export interface SignupRequest {
  siren: string;
  email: string;
  company: { name: string; address: PostalAddress | null; vatId: string | null };
  termsVersion: string;
}

/** Réglages → Abonnement (GET /billing). */
export const BillingView = z.object({
  enabled: z.boolean(),
  status: z.enum(['trial', 'active', 'past_due', 'ended', 'pilot']),
  plan: z.enum(['essentiel', 'croissance']).nullable(),
  interval: z.enum(['month', 'year']).nullable(),
  trialEndsAt: z.string().nullable(),
  periodEnd: z.string().nullable(),
  trial: z.object({ sends: z.number(), left: z.number() }).nullable(),
  month: z.object({
    month: z.string(),
    sent: z.number(),
    included: z.number().nullable(),
    overage: z.boolean(),
  }),
  offers: z.array(
    z.object({
      plan: z.enum(['essentiel', 'croissance']),
      interval: z.enum(['month', 'year']),
      included: z.number(),
      overage: z.boolean(),
    }),
  ),
  portal: z.boolean(),
});
export type BillingView = z.infer<typeof BillingView>;
export type Offer = BillingView['offers'][number];
const PageUrl = z.object({ url: z.string().url() });

export const Tone = z.enum(['ok', 'warning', 'error', 'progress', 'neutral']);

export const RowStatus = z.object({
  rowKey: z.string(),
  rows: z.array(z.number().int()),
  invoiceId: z.string().nullable(),
  number: z.string().nullable(),
  isTest: z.boolean(),
  status: z.string().nullable(),
  label: z.string(),
  detail: z.string(),
  tone: Tone,
  errors: z.number(),
  warnings: z.number(),
});
export type RowStatus = z.infer<typeof RowStatus>;

export const SyncResult = z.object({
  sheet: z.string(),
  test: z.boolean(),
  rows: z.array(RowStatus),
  ignoredRows: z.array(z.number()),
});
export type SyncResult = z.infer<typeof SyncResult>;

/** The most invoices one status check asks about (the API lists at most 200 at a time). */
const MAX_IDS = 200;
const InvoiceStatuses = z.object({
  invoices: z.array(z.object({ id: z.string(), status: z.string() })),
});

export const Degraded = z.enum(['ai_off', 'daily_budget', 'run_budget', 'error']);
export type Degraded = z.infer<typeof Degraded>;

export const Detection = z.object({ mapping: SheetMapping, degraded: Degraded.nullable() });
export type Detection = z.infer<typeof Detection>;

const SavedMapping = z.object({ mapping: SheetMapping, updatedAt: z.string() });

/** What one read of an included sheet found (R1). */
const SourceStats = z.object({
  docs: z.number(),
  lines: z.number(),
  rows: z.number(),
  ignoredRows: z.number(),
  unreadRows: z.number(),
  /** False: the confirmed header row is nowhere in the sheet any more; nothing was read. */
  headerFound: z.boolean(),
});

/** A sheet of the workbook the company included in the check (« Inclure cette feuille »). */
export const Source = z.object({
  id: z.string(),
  workbookId: z.string(),
  sheet: z.string(),
  kind: z.enum(DOC_KINDS),
  layout: LayoutMapping,
  consentedAt: z.string(),
  readAt: z.string().nullable(),
  changedAt: z.string().nullable(),
  stats: SourceStats.nullable(),
});
export type Source = z.infer<typeof Source>;

/** What a sheet holds: a profile the company confirmed before, else LayoutAgent or the dictionary. */
export const LayoutDetection = z.object({
  layout: LayoutMapping,
  profile: z.object({ id: z.string(), version: z.number() }).nullable(),
  degraded: Degraded.nullable(),
  included: z.boolean(),
});
export type LayoutDetection = z.infer<typeof LayoutDetection>;

const SourceRead = z.object({ source: Source, written: z.number(), removed: z.number() });
export type SourceRead = z.infer<typeof SourceRead>;

/** The « Registre » screen. */
export const Registry = z.object({
  sources: z.array(Source),
  invoices: z.object({ sent: z.number(), received: z.number() }),
  recent: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(DOC_KINDS),
      direction: z.enum(['out', 'in']),
      number: z.string().nullable(),
      issueDate: z.string().nullable(),
      partyName: z.string().nullable(),
      /** Cents; null when a line of the document has no amount. */
      netTotal: z.number().nullable(),
      sheet: z.string().nullable(),
      /** Where the document starts in its sheet, e.g. `Commandes!E2`. */
      cell: z.string().nullable(),
      updatedAt: z.string(),
    }),
  ),
});
export type Registry = z.infer<typeof Registry>;

/** What the checks across documents found (R2): its money at stake and the cells to look at. */
export const Finding = z.object({
  id: z.string(),
  rule: z.string(),
  severity: z.enum(['blocking', 'warning', 'info']),
  message: z.string(),
  /** Cents at stake; null when nothing tells the amount. */
  amount: z.number().nullable(),
  invoiceId: z.string().nullable(),
  /** « Envoyer quand même » sends it back: a finding that changed since asks again. */
  fingerprint: z.string(),
  isTest: z.boolean(),
  evidence: z.array(
    z.object({
      role: z.enum(['invoice', 'order', 'delivery', 'price_list', 'history']),
      docId: z.string(),
      number: z.string().nullable(),
      /** The cell to select, e.g. `Commandes!D2`, in that sheet of that workbook. */
      cell: z.string().nullable(),
      sheet: z.string().nullable(),
      workbookId: z.string().nullable(),
    }),
  ),
  firstSeenAt: z.string(),
});
export type Finding = z.infer<typeof Finding>;
export type Evidence = Finding['evidence'][number];

const DocBrief = z.object({
  id: z.string(),
  kind: z.enum(['invoice', ...DOC_KINDS]),
  number: z.string().nullable(),
  issueDate: z.string().nullable(),
  partyName: z.string().nullable(),
  netTotal: z.number().nullable(),
});

/** The « Contrôles » screen. */
export const Checks = z.object({
  checkedAt: z.string().nullable(),
  /** Cents at stake on the real documents. */
  atStake: z.number(),
  blocking: z.number(),
  findings: z.array(Finding),
  /** Documents that look alike with no number to tie them: « Oui » / « Non ». */
  links: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['billed_by', 'fulfils', 'cost']),
      score: z.number(),
      from: DocBrief.nullable(),
      to: DocBrief.nullable(),
    }),
  ),
});
export type Checks = z.infer<typeof Checks>;
export type ProposedLink = Checks['links'][number];

export const Issue = z.object({
  ruleId: z.string(),
  severity: z.enum(['error', 'warning']),
  path: z.string(),
  messageFr: z.string(),
  fixHintFr: z.string(),
});
export type Issue = z.infer<typeof Issue>;

export const InvoiceEvent = z.object({
  at: z.string(),
  type: z.string(),
  actor: z.string(),
  event: z.string().nullable(),
  fromStatus: z.string().nullable(),
  toStatus: z.string().nullable(),
  payload: z.unknown(),
});
export type InvoiceEvent = z.infer<typeof InvoiceEvent>;

const InvoiceSummary = z.object({
  id: z.string(),
  number: z.string().nullable(),
  status: z.string(),
  statusLabel: z.string(),
  issueDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  currency: z.string().nullable(),
  buyerName: z.string().nullable(),
  payable: z.number().nullable(),
  pdpRef: z.string().nullable(),
  isTest: z.boolean(),
  /** The customer of the fiche clients this invoice was matched to; null: none yet. */
  partyId: z.string().nullable().default(null),
  /** « Envoi automatique »: when it leaves by itself, or held for good by « Annuler ». */
  autopilot: z
    .object({ at: z.string().nullable(), held: z.boolean() })
    .default({ at: null, held: false }),
  excelBinding: z
    .object({
      sheet: z.string(),
      rowKey: z.string(),
      rows: z.array(z.number()).optional(),
      cells: z.record(z.string(), z.string()).optional(),
    })
    .nullable(),
});

/** The chasing plan (« Relancer »): the cadence's steps with their dates and outcomes. */
export const ChasePlan = z.object({
  cadence: z.array(z.number()),
  dueDate: z.string(),
  steps: z.array(ChaseStep),
  nextStepOn: z.string().nullable(),
  paused: z.boolean(),
  promisedUntil: z.string().nullable(),
});
export type ChasePlan = z.infer<typeof ChasePlan>;

export const MONITOR_PROPOSALS = ['fix_and_resend', 'credit_note', 'contact_customer'] as const;

/** The MonitorAgent's advice on a rejection or refusal still open. */
export const NextStep = z.object({
  kind: z.enum(['rejection', 'refusal']),
  proposal: z.enum(MONITOR_PROPOSALS).nullable(),
  why: z.string(),
  rules: z.array(z.string()),
  draft: ChaseDraft.nullable(),
});
export type NextStep = z.infer<typeof NextStep>;

export const InvoiceDetail = InvoiceSummary.extend({
  issues: z.array(Issue),
  /** Open findings of the checks across documents; a blocking one makes « Envoyer quand même ». */
  findings: z.array(Finding).default([]),
  events: z.array(InvoiceEvent),
  chase: ChasePlan.nullable(),
  nextStep: NextStep.nullable(),
});
export type InvoiceDetail = z.infer<typeof InvoiceDetail>;

export const Explanation = z.object({
  ruleId: z.string(),
  path: z.string(),
  severity: z.enum(['error', 'warning']),
  message_fr: z.string(),
  why_it_matters: z.string(),
  fix_steps: z.array(z.string()),
  cell: z.string().nullable(),
});
export type Explanation = z.infer<typeof Explanation>;

export const Explained = z.object({
  explanations: z.array(Explanation),
  note: z.string().nullable(),
});
export type Explained = z.infer<typeof Explained>;

export const Rehearsal = z.object({
  ready: z.boolean(),
  summary: z.string(),
  checklist: z.array(
    z.object({
      item: z.string(),
      label: z.string(),
      ok: z.boolean(),
      detail: z.string().nullable(),
    }),
  ),
});
export type Rehearsal = z.infer<typeof Rehearsal>;

const Sent = InvoiceSummary.extend({ alreadySent: z.boolean() });

export const AI_PROVIDERS = [
  'mistral',
  'anthropic',
  'openai',
  'google',
  'azure',
  'openai-compatible',
] as const;

export const Settings = z.object({
  mode: z.enum(['review', 'autopilot']),
  autopilotAvailable: z.boolean(),
  /** Cents: the highest invoice amount the autopilot chases by itself. */
  autopilotMaxAmount: z.number().nullable(),
  sandboxEnabled: z.boolean(),
  testPlatform: z.boolean(),
  pseudonymizeLlm: z.boolean(),
  chaseCadence: z.array(z.number()),
  // Loose: the fields this pane does not edit (payment means, legal notes) go back unchanged, since
  // PATCH /settings replaces the whole object.
  invoiceDefaults: z.looseObject({
    siret: z.string().optional(),
    iban: z.string().optional(),
    bic: z.string().optional(),
    paymentDays: z.number().optional(),
    operationCategory: z.enum(['goods', 'services', 'mixed']).optional(),
  }),
  pdp: z.object({
    provider: z.string(),
    account: z.string(),
    connected: z.boolean(),
    /** The company's own platform key: where the server offers it, and the end of the one saved. */
    ownKey: z
      .object({ available: z.boolean(), hint: z.string().nullable() })
      .default({ available: false, hint: null }),
  }),
  ai: z.object({
    mode: z.enum(['included', 'off', 'byok']),
    includedProvider: z.string().nullable(),
    byokAvailable: z.boolean(),
    provider: z.string().optional(),
    models: z.object({ agent: z.string(), classify: z.string() }).optional(),
    baseUrl: z.string().nullish(),
    keyHint: z.string().nullish(),
  }),
});
export type Settings = z.infer<typeof Settings>;

export type SettingsPatch = Partial<{
  sandboxEnabled: boolean;
  chaseCadence: number[];
  invoiceDefaults: Settings['invoiceDefaults'];
  mode: Settings['mode'];
  autopilotMaxAmount: number | null;
}>;

/** A customer of the fiche clients, confirmed against the company directory (plan §4 parties). */
export const Party = z.object({
  id: z.string(),
  legalName: z.string(),
  siren: z.string(),
  vatId: z.string().nullable(),
  address: PostalAddress.nullable(),
  email: z.string().nullable(),
  names: z.array(z.string()),
  /** What the platform's directory said when the customer was confirmed. */
  routing: z.object({ found: z.boolean(), checkedAt: z.string() }).nullable(),
  autopilot: z.boolean(),
  /** What the checks know about the customer (rules FF-PO-01, DGFIP-G2.32). */
  requiresPurchaseOrder: z.boolean(),
  publicEntity: z.boolean(),
  verifiedAt: z.string(),
});
export type Party = z.infer<typeof Party>;

/** One company « Chercher dans l'annuaire » found (PartyAgent). */
export const PartyCandidate = z.object({
  siren: z.string(),
  name: z.string().nullable(),
  address: PostalAddress.nullable(),
  vatId: z.string().nullable(),
  /** Null: the platform could not be asked. */
  routing: z.boolean().nullable(),
  refusal: z.enum(['closed', 'duplicate']).nullable(),
  keptSiren: z.string().nullable(),
  /** Already in the fiche clients. */
  partyId: z.string().nullable(),
});
export type PartyCandidate = z.infer<typeof PartyCandidate>;

export const PartyFinding = z.object({ question: z.string(), candidates: z.array(PartyCandidate) });
export type PartyFinding = z.infer<typeof PartyFinding>;

export interface PartyQuery {
  name?: string;
  siren?: string;
  postCode?: string;
}

export type PartyPatch = Partial<{
  email: string | null;
  autopilot: boolean;
  requiresPurchaseOrder: boolean;
  publicEntity: boolean;
}>;

/** The weekly report (Tableau de bord card): numbers first, then what to do. */
export const WeeklyReport = z.object({
  subject: z.string(),
  title: z.string(),
  numbers: z.array(z.string()),
  actions: z.array(z.string()),
  text: z.string(),
});
export type WeeklyReport = z.infer<typeof WeeklyReport>;

/** A supplier invoice received (Réception, plan §3 screen 5), as the InboundAgent sorted it. */
export const InboundFlag = z.object({
  code: z.string(),
  level: z.enum(['block', 'alert', 'warn', 'info']),
  message: z.string(),
  details: z.array(z.string()),
  relatedId: z.string().nullable(),
});
export type InboundFlag = z.infer<typeof InboundFlag>;

export const Inbound = z.object({
  id: z.string(),
  status: z.enum(['new', 'approved', 'disputed', 'exported']),
  statusLabel: z.string(),
  isTest: z.boolean(),
  triaged: z.boolean(),
  supplierName: z.string(),
  number: z.string().nullable(),
  creditNote: z.boolean(),
  issueDate: z.string().nullable(),
  dueDate: z.string().nullable(),
  amount: z.number().int().nullable(),
  currency: z.string().nullable(),
  iban: z.string().nullable(),
  receivedAt: z.string(),
  flags: z.array(InboundFlag),
  canApprove: z.boolean(),
  needsIbanCheck: z.boolean(),
  canDispute: z.boolean(),
  decidedAt: z.string().nullable(),
  disputeReason: z.string().nullable(),
  exportId: z.string().nullable(),
});
export type Inbound = z.infer<typeof Inbound>;

export const InboundExport = z.object({
  id: z.string(),
  isTest: z.boolean(),
  count: z.number().int(),
  skipped: z.number().int(),
  fecName: z.string(),
  csvName: z.string(),
  createdAt: z.string(),
});
export type InboundExport = z.infer<typeof InboundExport>;

export const TEST_INBOUND_KINDS = ['normal', 'duplicate', 'iban_change'] as const;
export type TestInboundKind = (typeof TEST_INBOUND_KINDS)[number];
export type ExportFile = 'fec' | 'csv';

export type AiChoice =
  | { mode: 'included' }
  | { mode: 'off' }
  | {
      mode: 'byok';
      provider: (typeof AI_PROVIDERS)[number];
      models: { agent: string; classify: string };
      baseUrl?: string;
      apiKey?: string;
    };

const LinkStarted = z.object({ requestId: z.string() });
const LinkPoll = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({ status: z.literal('ok'), token: z.string() }),
]);
export type LinkPoll = z.infer<typeof LinkPoll>;

export const SCENARIOS = ['pdp_reject', 'customer_refuse', 'pay_late', 'siren_unknown'] as const;
export type Scenario = (typeof SCENARIOS)[number];

const sourcesPath = (workbookId: string, sheet?: string) =>
  `/workbooks/${encodeURIComponent(workbookId)}/sources${sheet === undefined ? '' : `/${encodeURIComponent(sheet)}`}`;

interface RequestOptions {
  method?: string;
  body?: unknown;
}

export class ApiClient {
  readonly #base: string;
  readonly #token: () => string | null;
  readonly #fetch: typeof fetch;

  constructor(
    base: string,
    token: () => string | null,
    // Wrapped: a browser's fetch called as a method of this class throws "Illegal invocation".
    fetchFn: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.#base = base.replace(/\/$/, '');
    this.#token = token;
    this.#fetch = fetchFn;
  }

  async #send(path: string, { method = 'GET', body }: RequestOptions = {}): Promise<Response> {
    const headers: Record<string, string> = {};
    const token = this.#token();
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    try {
      res = await this.#fetch(`${this.#base}${path}`, {
        method,
        headers,
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    } catch (e) {
      throw new Offline(e instanceof Error ? e.message : String(e));
    }
    // A proxy or gateway answering for an API that is down is the same as no connection.
    if (res.status === 502 || res.status === 504) throw new Offline(`HTTP ${res.status}`);
    if (!res.ok) {
      const parsed = ErrorBody.safeParse(await res.json().catch(() => null));
      if (parsed.success) {
        throw new ApiFailure(res.status, parsed.data.error.code, parsed.data.error.message);
      }
      throw new ApiFailure(res.status, 'internal', `HTTP ${res.status}`);
    }
    return res;
  }

  async #json<T>(schema: z.ZodType<T>, path: string, options?: RequestOptions): Promise<T> {
    const res = await this.#send(path, options);
    return schema.parse(await res.json());
  }

  options = () => this.#json(Options, '/auth/options');
  requestLink = (email: string) =>
    this.#json(LinkStarted, '/auth/magic-link', { method: 'POST', body: { email } });
  pollLink = (requestId: string) =>
    this.#json(LinkPoll, '/auth/magic-link/poll', { method: 'POST', body: { requestId } });
  logout = async () => {
    await this.#send('/auth/logout', { method: 'POST' });
  };
  me = () => this.#json(Me, '/me');

  lookupCompany = (siren: string) =>
    this.#json(
      DirectoryCompany,
      `/onboarding/company/${encodeURIComponent(siren.replace(/\s/g, ''))}`,
    );
  signup = (request: SignupRequest) =>
    this.#json(LinkStarted, '/onboarding/signup', {
      method: 'POST',
      body: { ...request, acceptTerms: true },
    });
  pollSignup = (requestId: string) =>
    this.#json(LinkPoll, '/onboarding/poll', { method: 'POST', body: { requestId } });

  billing = () => this.#json(BillingView, '/billing');
  checkout = (offer: Pick<Offer, 'plan' | 'interval'>) =>
    this.#json(PageUrl, '/billing/checkout', {
      method: 'POST',
      body: { plan: offer.plan, interval: offer.interval },
    });
  portal = () => this.#json(PageUrl, '/billing/portal', { method: 'POST' });
  /** RGPD erasure: the owner types the SIREN again. */
  deleteAccount = async (confirmSiren: string) => {
    await this.#send('/tenant', { method: 'DELETE', body: { confirmSiren } });
  };

  detect = (snapshot: SheetSnapshot) =>
    this.#json(Detection, '/detect', { method: 'POST', body: { snapshot } });
  getMapping = (workbookId: string, sheet: string) =>
    this.#json(
      SavedMapping,
      `/workbooks/${encodeURIComponent(workbookId)}/mappings/${encodeURIComponent(sheet)}`,
    );
  saveMapping = (workbookId: string, mapping: SheetMapping) =>
    this.#json(
      SavedMapping,
      `/workbooks/${encodeURIComponent(workbookId)}/mappings/${encodeURIComponent(mapping.sheet)}`,
      { method: 'PUT', body: { mapping } },
    );
  sync = (
    workbookId: string,
    body: { snapshot: SheetSnapshot; mapping: SheetMapping; test: boolean },
  ) =>
    this.#json(SyncResult, `/workbooks/${encodeURIComponent(workbookId)}/sync`, {
      method: 'POST',
      body,
    });

  /** The workbook's other sheets (R1): orders, delivery notes, purchases, price lists. */
  detectSource = (workbookId: string, snapshot: SheetSnapshot) =>
    this.#json(LayoutDetection, `${sourcesPath(workbookId)}/detect`, {
      method: 'POST',
      body: { snapshot },
    });
  sources = (workbookId: string) =>
    this.#json(z.object({ sources: z.array(Source) }), sourcesPath(workbookId));
  /** « Inclure cette feuille »: the confirmed layout, and the whole sheet for its first read. */
  includeSource = (workbookId: string, layout: LayoutMapping, snapshot: SheetSnapshot) =>
    this.#json(SourceRead, sourcesPath(workbookId, layout.sheet), {
      method: 'PUT',
      body: { layout, snapshot },
    });
  removeSource = (workbookId: string, sheet: string) =>
    this.#json(
      z.object({ removed: z.boolean(), sheet: z.string() }),
      sourcesPath(workbookId, sheet),
      {
        method: 'DELETE',
      },
    );
  syncSource = (workbookId: string, snapshot: SheetSnapshot) =>
    this.#json(SourceRead, `${sourcesPath(workbookId, snapshot.sheet)}/sync`, {
      method: 'POST',
      body: { snapshot },
    });
  registry = () => this.#json(Registry, '/registry');
  /** « Contrôles » (R2): the open findings, the money at stake, the links to confirm. */
  checks = () => this.#json(Checks, '/checks');
  decideLink = (id: string, status: 'confirmed' | 'rejected') =>
    this.#json(Checks, `/links/${id}`, { method: 'POST', body: { status } });

  invoice = (id: string) => this.#json(InvoiceDetail, `/invoices/${id}`);
  /** Where these invoices are now: cheaper than a sync, which reads and validates the whole sheet. */
  statuses = (ids: string[]) =>
    this.#json(
      InvoiceStatuses,
      `/invoices?limit=${MAX_IDS}&ids=${ids.slice(0, MAX_IDS).join(',')}`,
    );
  explain = (id: string) => this.#json(Explained, `/invoices/${id}/explain`, { method: 'POST' });
  rehearse = (id: string) => this.#json(Rehearsal, `/invoices/${id}/rehearse`, { method: 'POST' });
  /** `acknowledge`: the blocking findings the user saw and sends past (« Envoyer quand même »). */
  send = (id: string, acknowledge: string[] = []) =>
    this.#json(Sent, `/invoices/${id}/send`, {
      method: 'POST',
      ...(acknowledge.length > 0 && { body: { acknowledge } }),
    });
  scenario = (id: string, scenario: Scenario) =>
    this.#json(InvoiceDetail, `/invoices/${id}/scenario`, { method: 'POST', body: { scenario } });
  /** « Encaissée »: the customer paid; chasing stops and the platform is told. */
  recordPayment = (id: string, paidOn?: string) =>
    this.#json(InvoiceDetail, `/invoices/${id}/payment`, {
      method: 'POST',
      body: paidOn ? { paidOn } : {},
    });
  /** « Promesse de paiement » until that day; null withdraws it. */
  promise = (id: string, until: string | null) =>
    this.#json(InvoiceDetail, `/invoices/${id}/promise`, { method: 'POST', body: { until } });
  prepareChase = (id: string) =>
    this.#json(InvoiceDetail, `/invoices/${id}/chase`, { method: 'POST' });
  markChaseSent = (id: string, offset: number) =>
    this.#json(InvoiceDetail, `/invoices/${id}/chase/steps/${offset}/sent`, { method: 'POST' });
  report = () => this.#json(WeeklyReport, '/report');
  /** The XML as text, the PDF as bytes: the fiche shows them inline. */
  xml = async (id: string) => (await this.#send(`/invoices/${id}/xml`)).text();
  pdf = async (id: string) => (await this.#send(`/invoices/${id}/pdf`)).blob();

  settings = () => this.#json(Settings, '/settings');
  patchSettings = (patch: SettingsPatch) =>
    this.#json(Settings, '/settings', { method: 'PATCH', body: patch });
  saveAi = (choice: AiChoice) =>
    this.#json(Settings, '/settings/ai', { method: 'PUT', body: choice });
  savePdpKey = (body: { apiKey: string; account?: string }) =>
    this.#json(Settings, '/settings/pdp', { method: 'PUT', body });
  removePdpKey = () => this.#json(Settings, '/settings/pdp', { method: 'DELETE' });

  parties = () => this.#json(z.object({ parties: z.array(Party) }), '/parties');
  searchParties = (query: PartyQuery) =>
    this.#json(PartyFinding, '/parties/search', { method: 'POST', body: query });
  confirmParty = (siren: string, name?: string) =>
    this.#json(Party, '/parties', { method: 'POST', body: { siren, ...(name && { name }) } });
  patchParty = (id: string, patch: PartyPatch) =>
    this.#json(Party, `/parties/${id}`, { method: 'PATCH', body: patch });
  deleteParty = async (id: string) => {
    await this.#send(`/parties/${id}`, { method: 'DELETE' });
  };
  /** « Annuler l'envoi automatique »: the invoice waits for « Envoyer » for good. */
  cancelAutopilot = (id: string) =>
    this.#json(InvoiceDetail, `/invoices/${id}/autopilot/cancel`, { method: 'POST' });
  exportData = async () => (await this.#send('/tenant/export')).blob();

  inbound = (test: boolean) =>
    this.#json(z.object({ inbound: z.array(Inbound) }), `/inbound?test=${test}`);
  inboundExports = (test: boolean) =>
    this.#json(z.object({ exports: z.array(InboundExport) }), `/inbound/exports?test=${test}`);
  approveInbound = (id: string, ibanChecked: boolean) =>
    this.#json(Inbound, `/inbound/${id}/approve`, { method: 'POST', body: { ibanChecked } });
  disputeInbound = (id: string, reason: string) =>
    this.#json(Inbound, `/inbound/${id}/dispute`, { method: 'POST', body: { reason } });
  exportInbound = (test: boolean) =>
    this.#json(InboundExport, '/inbound/export', { method: 'POST', body: { test } });
  exportFile = async (id: string, file: ExportFile) =>
    (await this.#send(`/inbound/exports/${id}/${file}`)).blob();
  testInbound = (kind: TestInboundKind) =>
    this.#json(Inbound, '/inbound/test', { method: 'POST', body: { kind } });
}
