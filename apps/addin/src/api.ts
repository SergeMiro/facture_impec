// The task pane's only door to the API. Every answer is checked with Zod (rule 4); an API error
// arrives as ApiFailure with the server's French message, a network failure as Offline.
import { SheetMapping, type SheetSnapshot } from '@fi/core';
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

const Tenant = z.object({
  id: z.string(),
  name: z.string(),
  siren: z.string(),
  pdpProvider: z.string(),
  mode: z.string(),
  sandboxEnabled: z.boolean(),
});
const User = z.object({ email: z.string(), role: z.string() });

export const Me = z.object({
  tenant: Tenant,
  user: User.nullable(),
  testMode: z.object({ enabled: z.boolean(), available: z.boolean() }),
});
export type Me = z.infer<typeof Me>;

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

export const InvoiceDetail = InvoiceSummary.extend({
  issues: z.array(Issue),
  events: z.array(InvoiceEvent),
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
  mode: z.string(),
  autopilotAvailable: z.boolean(),
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
}>;

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

  options = () => this.#json(z.object({ magicLink: z.boolean() }), '/auth/options');
  requestLink = (email: string) =>
    this.#json(LinkStarted, '/auth/magic-link', { method: 'POST', body: { email } });
  pollLink = (requestId: string) =>
    this.#json(LinkPoll, '/auth/magic-link/poll', { method: 'POST', body: { requestId } });
  logout = async () => {
    await this.#send('/auth/logout', { method: 'POST' });
  };
  me = () => this.#json(Me, '/me');

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
  /** The XML as text, the PDF as bytes: the fiche shows them inline. */
  xml = async (id: string) => (await this.#send(`/invoices/${id}/xml`)).text();
  pdf = async (id: string) => (await this.#send(`/invoices/${id}/pdf`)).blob();

  settings = () => this.#json(Settings, '/settings');
  patchSettings = (patch: SettingsPatch) =>
    this.#json(Settings, '/settings', { method: 'PATCH', body: patch });
  saveAi = (choice: AiChoice) =>
    this.#json(Settings, '/settings/ai', { method: 'PUT', body: choice });
  exportData = async () => (await this.#send('/tenant/export')).blob();
}
