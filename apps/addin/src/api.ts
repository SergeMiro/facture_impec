// The task pane's only door to the API. Every answer is checked with Zod (rule 4); an API error
// arrives as ApiFailure with the server's French message, a network failure as Offline.
import { ChaseDraft, ChaseStep, SheetMapping, type SheetSnapshot } from '@fi/core';
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
  pdp: z.object({ provider: z.string(), account: z.string(), connected: z.boolean() }),
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

  invoice = (id: string) => this.#json(InvoiceDetail, `/invoices/${id}`);
  /** Where these invoices are now: cheaper than a sync, which reads and validates the whole sheet. */
  statuses = (ids: string[]) =>
    this.#json(
      InvoiceStatuses,
      `/invoices?limit=${MAX_IDS}&ids=${ids.slice(0, MAX_IDS).join(',')}`,
    );
  explain = (id: string) => this.#json(Explained, `/invoices/${id}/explain`, { method: 'POST' });
  rehearse = (id: string) => this.#json(Rehearsal, `/invoices/${id}/rehearse`, { method: 'POST' });
  send = (id: string) => this.#json(Sent, `/invoices/${id}/send`, { method: 'POST' });
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
