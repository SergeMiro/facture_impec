// Postgres schema (plan §4). Tables nothing reads yet stay out (docs/DEFERRED.md).
// Change it, then `pnpm --filter @fi/db generate` writes the migration into drizzle/.
import type {
  Address,
  ChaseStep,
  CheckFix,
  Evidence,
  FindingScope,
  InboundTriage,
  Invoice,
  InvoiceDefaultsInput,
  InvoiceDraft,
  Issue,
  LayoutMapping,
  SheetCheck,
  SheetMapping,
} from '@fi/core';
import {
  ACCEPTABLE_RULES,
  CHECK_MESSAGES,
  CHECK_RULES,
  DOC_KINDS,
  FINDING_SEVERITIES,
  INBOUND_STATES,
  LINK_KINDS,
  LINK_METHODS,
  LINK_STATUSES,
  STATES,
} from '@fi/core';
import { BILLING_INTERVALS, BILLING_STATUSES, PLANS, type Plan, type WhiteLabel } from '@fi/shared';
import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
/** Amounts are integer cents (CLAUDE.md rule 4). */
const cents = (name: string) => bigint(name, { mode: 'number' });

/**
 * Where an invoice can sit. `b2brouter_test` is B2Brouter's sandbox seen from prod, where « Mode test »
 * sends (a second key of the same integration); a company itself is on `mock` or `b2brouter`.
 */
export const PDP_PROVIDERS = ['mock', 'b2brouter', 'b2brouter_test'] as const;
export type PdpProvider = (typeof PDP_PROVIDERS)[number];
export const TENANT_PROVIDERS = ['mock', 'b2brouter'] as const;
export type TenantProvider = (typeof TENANT_PROVIDERS)[number];

/** J-3 courtesy, J+1, J+8, J+15 firm, J+30 formal notice draft (plan §6 CollectAgent). */
export const DEFAULT_CHASE_CADENCE = [-3, 1, 8, 15, 30] as const;

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  siren: text('siren').notNull(),
  vatId: text('vat_id'),
  address: jsonb('address_json').$type<Address>(),
  pdpProvider: text('pdp_provider', { enum: TENANT_PROVIDERS }).notNull(),
  /** The tenant's account at the PDP: B2Brouter keeps one per SIREN (docs/B2BROUTER.md §3.2). */
  pdpAccount: text('pdp_account').notNull(),
  /**
   * A company that brings its own B2Brouter key (plan §4 `pdp_credentials_enc`): sealed AES-256-GCM
   * under PDP_KEY_SEALING_KEY, never stored in clear; null = the deployment's key.
   */
  pdpKeySealed: text('pdp_key_sealed'),
  pdpKeyHint: text('pdp_key_hint'),
  mode: text('mode', { enum: ['review', 'autopilot'] })
    .notNull()
    .default('review'),
  autopilotMaxAmount: cents('autopilot_max_amount'),
  /** The margin the company wants on what it resells, % of the sale price (rule B2, R3); null: none. */
  minMarginPercent: integer('min_margin_percent'),
  sandboxEnabled: boolean('sandbox_enabled').notNull().default(true),
  pseudonymizeLlm: boolean('pseudonymize_llm').notNull().default(true),
  /** Option pour le paiement de la TVA d'après les débits: the context of rule FF-DEB-01. */
  vatOnDebits: boolean('vat_on_debits').notNull().default(false),
  /** What every invoice of a sheet reuses (IBAN, payment terms, mentions): core InvoiceDefaults. */
  invoiceDefaults: jsonb('invoice_defaults_json')
    .$type<InvoiceDefaultsInput>()
    .notNull()
    .default({}),
  /** Chasing steps in days from the due date (plan §6 CollectAgent). */
  chaseCadence: jsonb('chase_cadence_json')
    .$type<number[]>()
    .notNull()
    .default([...DEFAULT_CHASE_CADENCE]),
  /**
   * The tenant's own AI settings (@fi/agents AiSettings, read through Zod in the API); null = the
   * AI included in the subscription. The BYOK key is sealed (AES-256-GCM), never stored in clear.
   */
  aiSettings: jsonb('ai_settings_json').$type<Record<string, unknown>>(),
  aiKeySealed: text('ai_key_sealed'),
  aiKeyHint: text('ai_key_hint'),
  /**
   * In prod, real sends wait for the operator to switch the company live once its platform account
   * exists (M7); « Mode test » never waits. Unused in local and sandbox, where nothing is real.
   */
  liveAt: timestamp('live_at', { withTimezone: true }),
  /** An accounting firm's brand on this company (@fi/shared WhiteLabel); null = Facture Impec. */
  whiteLabel: jsonb('white_label_json').$type<WhiteLabel>(),
  /** The terms the person who created the account accepted (sign-up, M7). */
  termsVersion: text('terms_version'),
  termsAcceptedAt: timestamp('terms_accepted_at', { withTimezone: true }),
  // Billing (M7, @fi/shared account.ts): Stripe holds the subscription, these columns mirror it.
  billingStatus: text('billing_status', { enum: BILLING_STATUSES }).notNull().default('trial'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  plan: text('plan', { enum: PLANS }).$type<Plan>(),
  billingInterval: text('billing_interval', { enum: BILLING_INTERVALS }),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  billingPeriodEnd: timestamp('billing_period_end', { withTimezone: true }),
  /** RGPD deletion (plan §10): personal data is gone, the invoices the law keeps stay. */
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const USER_ROLES = ['owner', 'member', 'accountant'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** Lower case. */
    email: text('email').notNull(),
    role: text('role', { enum: USER_ROLES }).notNull().default('owner'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('users_tenant_email').on(t.tenantId, t.email),
    index('users_email').on(t.email),
  ],
);

/**
 * « Recevez un lien de connexion »: the e-mailed link confirms the request, and the task pane, which
 * holds a second secret, collects the session. Both secrets are stored as SHA-256.
 */
export const magicLinks = pgTable('magic_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Null when nobody uses this address: the request looks the same and never confirms. */
  userId: uuid('user_id').references(() => users.id),
  linkHash: text('link_hash').notNull().unique(),
  pollHash: text('poll_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * « Créer un compte » (M7): the company found in SIRENE and the person's address wait here until the
 * e-mailed link confirms the address; only then does the company exist. Same two secrets as a
 * sign-in link, stored as SHA-256.
 */
export const signupRequests = pgTable(
  'signup_requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    siren: text('siren').notNull(),
    /** What the user confirmed on screen: name, head-office address, VAT number. */
    company: jsonb('company_json').$type<SignupCompany>().notNull(),
    termsVersion: text('terms_version').notNull(),
    linkHash: text('link_hash').notNull().unique(),
    pollHash: text('poll_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    tenantId: uuid('tenant_id').references(() => tenants.id),
    createdAt: createdAt(),
  },
  (t) => [index('signup_requests_email').on(t.email, t.createdAt)],
);

export interface SignupCompany {
  name: string;
  address: Address | null;
  vatId: string | null;
}

/** Task pane sessions (`fis_…`), stored as SHA-256 like tenant keys. */
export const sessions = pgTable('sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  hash: text('hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/** The column mapping of one sheet (plan §5 Détection); the workbook keeps a copy in its settings. */
export const sheetMappings = pgTable(
  'sheet_mappings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    workbookId: text('workbook_id').notNull(),
    sheet: text('sheet').notNull(),
    mapping: jsonb('mapping_json').$type<SheetMapping>().notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('sheet_mappings_sheet').on(t.tenantId, t.workbookId, t.sheet)],
);

/** Every agent run, skipped and failed ones included (plan §6). Never holds invoice data. */
export const agentRuns = pgTable(
  'agent_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    invoiceId: uuid('invoice_id'),
    agent: text('agent').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    promptHash: text('prompt_hash').notNull(),
    status: text('status', { enum: ['ok', 'failed', 'skipped'] }).notNull(),
    reason: text('reason'),
    attempts: integer('attempts').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }).notNull(),
  },
  (t) => [index('agent_runs_tenant').on(t.tenantId, t.startedAt)],
);

/** Tenant keys, stored as SHA-256: the key itself is shown once, at creation. */
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  hash: text('hash').notNull().unique(),
  label: text('label'),
  createdAt: createdAt(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
});

/** What the platform's directory said about a customer when it was confirmed (plan §4 `pdp_routing_json`). */
export interface PartyRouting {
  /** The platform can deliver to this SIREN. */
  found: boolean;
  checkedAt: string;
}

/**
 * The company's customers (plan §4 `parties`), each one confirmed by the user against the public directory
 * (PartyAgent, plan §6): never saved with a SIREN the directory does not know. A sync fills what the
 * sheet leaves empty from here, finding the customer by its SIREN or by a name the sheet uses for it.
 */
export const parties = pgTable(
  'parties',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    kind: text('kind', { enum: ['customer', 'supplier'] })
      .notNull()
      .default('customer'),
    legalName: text('legal_name').notNull(),
    siren: text('siren').notNull(),
    /** Only a number DGFiP lists: a computed one could be wrong on the customer's invoice. */
    vatId: text('vat_id'),
    address: jsonb('address_json').$type<Address>(),
    /** Where chasing e-mails go when the sheet has no e-mail column. */
    email: text('email'),
    /** The names the sheet gives this customer, as core partyKey writes them; one name, one customer. */
    names: jsonb('names_json').$type<string[]>().notNull().default([]),
    routing: jsonb('pdp_routing_json').$type<PartyRouting>(),
    /** « Envoi automatique » (plan §0.2): opted in for the autopilot, under the company's ceiling. */
    autopilot: boolean('autopilot').notNull().default(false),
    // What the rules must know about this customer (core RuleContext.buyer), set in Clients.
    /** Refuses invoices without its purchase-order number (FF-PO-01). */
    requiresPurchaseOrder: boolean('requires_purchase_order').notNull().default(false),
    /** A public body (B2G): DGFiP G2.32 does not apply. */
    publicEntity: boolean('public_entity').notNull().default(false),
    /** sirene: a customer looked up in the directory; invoice: a supplier as its own invoice names it (R3). */
    source: text('source', { enum: ['sirene', 'invoice'] })
      .notNull()
      .default('sirene'),
    /** When the directory confirmed it; null for a supplier nobody looked up. */
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('parties_siren').on(t.tenantId, t.kind, t.siren)],
);

export interface ExcelBinding {
  workbookId: string;
  sheet: string;
  rowKey: string;
  /** Sheet rows of the invoice, and model path → cell address, as of the last sync. */
  rows?: number[];
  cells?: Record<string, string>;
  /** A1–A3 its own rows showed (core `SheetProblem.check`), for the checks across documents (R2). */
  checks?: SheetCheck[];
}

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    direction: text('direction', { enum: ['out', 'in'] })
      .notNull()
      .default('out'),
    // Copied from the document for lists and uniqueness; the document is the source of truth.
    number: text('number'),
    issueDate: date('issue_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    currency: text('currency'),
    buyerName: text('buyer_name'),
    payable: cents('payable'),
    /** What the user sent; `document` is it after computeInvoice. */
    draft: jsonb('draft_json').$type<InvoiceDraft>().notNull(),
    document: jsonb('document_json').$type<Invoice>().notNull(),
    fingerprint: text('fingerprint').notNull(),
    isTest: boolean('is_test').notNull().default(false),
    /** Written only by applyTransition (src/transition.ts); a trigger refuses any other write. */
    status: text('status', { enum: STATES }).notNull().default('draft'),
    pdpRef: text('pdp_ref'),
    pdpStatusRaw: text('pdp_status_raw'),
    xmlCii: text('xml_cii'),
    source: text('source', { enum: ['api', 'excel', 'pdp_inbound'] })
      .notNull()
      .default('api'),
    excelBinding: jsonb('excel_binding_json').$type<ExcelBinding>(),
    /** The confirmed customer the buyer was completed from (plan §4 `party_id`). */
    partyId: uuid('party_id').references(() => parties.id, { onDelete: 'set null' }),
    /**
     * Autopilot send (plan §0.2): when it leaves, for the content it had then. A change of content
     * starts the wait again; « Annuler l'envoi automatique » holds the invoice for good.
     */
    autopilotAt: timestamp('autopilot_at', { withTimezone: true }),
    autopilotFingerprint: text('autopilot_fingerprint'),
    autopilotHeld: boolean('autopilot_held').notNull().default(false),
    /**
     * What the last check depended on, hashed (src/invoices.ts checkOf in the API): the rules' code, the
     * content, the day, the customer's settings, the numbering neighbours. A sync checks again only
     * when it changed.
     */
    validatedKey: text('validated_key'),
    /**
     * Document lock (R8): a correction of this invoice waits for its click until then. Meanwhile the
     * background keeps its findings as they are and the autopilot does not send it.
     */
    editLockUntil: timestamp('edit_lock_until', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // A number is used once per tenant (BR-FR-CO-02); a cancelled draft frees it.
    uniqueIndex('invoices_number_unique')
      .on(t.tenantId, t.isTest, t.number)
      .where(sql`${t.direction} = 'out' and ${t.status} <> 'cancelled'`),
    index('invoices_tenant_status').on(t.tenantId, t.status),
    index('invoices_pdp_ref').on(t.pdpRef),
    index('invoices_autopilot').on(t.autopilotAt).where(sql`${t.autopilotAt} is not null`),
  ],
);

export const validationResults = pgTable(
  'validation_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    severityMax: text('severity_max', { enum: ['none', 'warning', 'error'] }).notNull(),
    issues: jsonb('issues_json').$type<Issue[]>().notNull(),
  },
  (t) => [index('validation_results_invoice').on(t.invoiceId, t.runAt)],
);

/** The invoice timeline the user sees. */
export const invoiceEvents = pgTable(
  'invoice_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    /** transition: the status changed · pdp_event: a platform event that changed nothing · note */
    type: text('type', { enum: ['transition', 'pdp_event', 'note'] }).notNull(),
    actor: text('actor').notNull(),
    event: text('event'),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    /** The platform's own event id: each one is applied once, whether by webhook or polling. */
    pdpEventId: text('pdp_event_id'),
    payload: jsonb('payload_json').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('invoice_events_invoice').on(t.invoiceId, t.id),
    uniqueIndex('invoice_events_pdp_event')
      .on(t.invoiceId, t.pdpEventId)
      .where(sql`${t.pdpEventId} is not null`),
  ],
);

/** Append-only (a trigger refuses UPDATE, DELETE and TRUNCATE): who did what, with hashes. */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: uuid('tenant_id'),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    objectType: text('object_type').notNull(),
    objectId: text('object_id').notNull(),
    beforeHash: text('before_hash'),
    afterHash: text('after_hash'),
  },
  (t) => [index('audit_events_tenant').on(t.tenantId, t.id)],
);

/**
 * One row per invoice handed to a PDP, keyed by tenant + number + fingerprint (plan §0.4). Written
 * before the platform is called, so a retry after a crash or a lost answer reuses the same key.
 */
export const pdpSubmissions = pgTable('pdp_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  provider: text('provider', { enum: PDP_PROVIDERS }).notNull(),
  pdpRef: text('pdp_ref'),
  status: text('status', { enum: ['pending', 'deposited', 'rejected'] })
    .notNull()
    .default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Supplier invoices the tenant's platform received for it (plan §4), stored by the inbound poll as they
 * come and triaged by the InboundAgent right after (`triage_json`, M6). The columns next to the file
 * are what the triage and the export look up; `parsed_json` keeps the whole invoice.
 */
export const inboundQueue = pgTable(
  'inbound_queue',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    provider: text('provider', { enum: PDP_PROVIDERS }).notNull(),
    pdpRef: text('pdp_ref').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull(),
    xml: text('xml').notNull(),
    status: text('status', { enum: INBOUND_STATES }).notNull().default('new'),
    /** « Mode test »: injected from the pane, or received on the test platform. Never exported as real. */
    isTest: boolean('is_test').notNull().default(false),
    /** Null until triaged, and for a file that could not be read. */
    parsed: jsonb('parsed_json').$type<Invoice>(),
    triage: jsonb('triage_json').$type<InboundTriage>(),
    triagedAt: timestamp('triaged_at', { withTimezone: true }),
    supplierKey: text('supplier_key'),
    supplierName: text('supplier_name'),
    number: text('number'),
    issueDate: date('issue_date', { mode: 'string' }),
    dueDate: date('due_date', { mode: 'string' }),
    /** BT-112, as written (a credit note's total is positive too). */
    amount: cents('amount'),
    currency: text('currency'),
    /** The IBANs the invoice asks to be paid on: the IBAN-change check compares them. */
    ibans: jsonb('ibans_json').$type<string[]>(),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    /** Who approved or disputed it: the signed-in e-mail, or « api » for a key. */
    decidedBy: text('decided_by'),
    disputeReason: text('dispute_reason'),
    exportId: uuid('export_id').references(() => inboundExports.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // A platform lists the same invoice on every poll: it is stored once.
    uniqueIndex('inbound_queue_pdp_ref').on(t.tenantId, t.provider, t.pdpRef),
    index('inbound_queue_tenant').on(t.tenantId, t.receivedAt),
    index('inbound_queue_supplier').on(t.tenantId, t.supplierKey),
  ],
);

/**
 * One « Exporter vers le comptable »: both files are kept, so that a download that failed can be
 * made again. Entry numbers continue from one export to the next (FEC, article A47 A-1 LPF).
 */
export const inboundExports = pgTable(
  'inbound_exports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    isTest: boolean('is_test').notNull(),
    count: integer('count').notNull(),
    /** Invoices in the CSV only: another currency (core fecReady). */
    skipped: integer('skipped').notNull().default(0),
    firstEntry: integer('first_entry').notNull(),
    lastEntry: integer('last_entry').notNull(),
    fecName: text('fec_name').notNull(),
    fec: text('fec').notNull(),
    csvName: text('csv_name').notNull(),
    csv: text('csv').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('inbound_exports_tenant').on(t.tenantId, t.createdAt)],
);

/**
 * The chasing plan of one invoice (plan §4, §6 CollectAgent): its steps with their dates, what was
 * done and the e-mail drafts. Created once the customer has the invoice; « Relancer » shows it.
 */
export const chasePlans = pgTable(
  'chase_plans',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .unique()
      .references(() => invoices.id),
    /** The cadence and due date the pending steps come from: when either changes, they move. */
    cadence: jsonb('cadence_json').$type<number[]>().notNull(),
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    steps: jsonb('steps_json').$type<ChaseStep[]>().notNull(),
    /** Plan §4 `next_action_at`, as a day: a step is acted on from 9:00 Paris on its day. */
    nextStepOn: date('next_step_on', { mode: 'string' }),
    /** A refusal or a dispute is open (plan §6): nothing goes out. */
    paused: boolean('paused').notNull().default(false),
    /** The customer promised to pay by this day: steps wait until the day after (recordPromise). */
    promisedUntil: date('promised_until', { mode: 'string' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('chase_plans_next').on(t.nextStepOn)],
);

/**
 * « Encaissée » (status 212) reported to the platform after the user recorded a payment. Written
 * before the platform is called; one per invoice, so the payment is reported once.
 */
export const paymentReports = pgTable('payment_reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id')
    .notNull()
    .references(() => tenants.id),
  invoiceId: uuid('invoice_id')
    .notNull()
    .unique()
    .references(() => invoices.id),
  provider: text('provider', { enum: PDP_PROVIDERS }).notNull(),
  amount: cents('amount').notNull(),
  paidOn: date('paid_on', { mode: 'string' }).notNull(),
  status: text('status', { enum: ['pending', 'reported', 'failed'] })
    .notNull()
    .default('pending'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One weekly report per company and ISO week (`2026-W43`), claimed before it is mailed. */
export const weeklyReports = pgTable(
  'weekly_reports',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    week: text('week').notNull(),
    recipients: integer('recipients').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
  },
  (t) => [uniqueIndex('weekly_reports_week').on(t.tenantId, t.week)],
);

/**
 * One row per invoice a company sent for real (deposited at its platform), in the Europe/Paris month
 * it left: the month's count against the plan's quota, and the meter event of each one beyond it.
 */
export const billingUsage = pgTable(
  'billing_usage',
  {
    invoiceId: uuid('invoice_id')
      .primaryKey()
      .references(() => invoices.id),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** `2026-10`. */
    month: text('month').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    /** Beyond the quota of a subscribed company: reported to Stripe as one meter event. */
    billable: boolean('billable').notNull().default(false),
    reportedAt: timestamp('reported_at', { withTimezone: true }),
    reportError: text('report_error'),
  },
  (t) => [index('billing_usage_month').on(t.tenantId, t.month)],
);

/**
 * Ten-year archive (plan §10): the XML of every invoice sent for real as the platform got it, with our PDF,
 * and the XML of every real invoice received. Written once; a trigger refuses any change, and any
 * deletion before `keep_until`. Each row chains the company's previous one, so a row changed or
 * removed behind the trigger's back shows (src/archive.ts in the API).
 */
export const invoiceArchive = pgTable(
  'invoice_archive',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    direction: text('direction', { enum: ['out', 'in'] }).notNull(),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    inboundId: uuid('inbound_id').references(() => inboundQueue.id),
    number: text('number'),
    issueDate: date('issue_date', { mode: 'string' }),
    /** The legal original: the structured invoice. */
    xml: text('xml').notNull(),
    xmlSha256: text('xml_sha256').notNull(),
    /** Base64 of our Factur-X PDF of a sent invoice; received ones have none (not fetched). */
    pdf: text('pdf_base64'),
    pdfSha256: text('pdf_sha256'),
    /** SHA-256 of the company's previous chain, this XML's hash and this PDF's hash. */
    chain: text('chain').notNull(),
    archivedAt: timestamp('archived_at', { withTimezone: true }).notNull(),
    keepUntil: date('keep_until', { mode: 'string' }).notNull(),
  },
  (t) => [
    uniqueIndex('invoice_archive_invoice').on(t.invoiceId).where(sql`${t.invoiceId} is not null`),
    uniqueIndex('invoice_archive_inbound').on(t.inboundId).where(sql`${t.inboundId} is not null`),
    index('invoice_archive_tenant').on(t.tenantId, t.id),
  ],
);

// ── Sheets of the workbook (R1) ────────────────────────────────────────────────────────────────
// The company's other sheets (orders, delivery notes, purchases, price lists) feed the registry once
// it says « Inclure cette feuille ». Nothing is read from a sheet it did not include.

/** A layout the company confirmed, found again for any sheet with the same header row. */
export const layoutProfiles = pgTable(
  'layout_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** SHA-256 of the header row's labels and columns (core `headerSignature`). */
    fingerprint: text('fingerprint').notNull(),
    kind: text('kind', { enum: DOC_KINDS }).notNull(),
    layout: jsonb('layout_json').$type<LayoutMapping>().notNull(),
    /** The user who confirmed it, or `key` for the API key. */
    confirmedBy: text('confirmed_by').notNull(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }).notNull(),
    /** Raised each time the company confirms it again with changes. */
    version: integer('version').notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('layout_profiles_fingerprint').on(t.tenantId, t.fingerprint)],
);

/** One sheet the company included: where it is, how it reads, when it was last read. */
export const sources = pgTable(
  'sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** A sheet of the open workbook (R1), of a file the API reads itself (R4), or uploaded (R6). */
    type: text('type', { enum: ['sheet', 'file', 'upload'] })
      .notNull()
      .default('sheet'),
    /** The open workbook's id; for a file, its `connected_files` id; for an upload, its `uploads` id. */
    workbookId: text('workbook_id').notNull(),
    /** A sheet of a picked file: it goes with the file. */
    fileId: uuid('file_id').references(() => connectedFiles.id, { onDelete: 'cascade' }),
    /** A sheet of an uploaded workbook (R6): it goes with the upload. */
    uploadId: uuid('upload_id').references(() => uploads.id, { onDelete: 'cascade' }),
    sheet: text('sheet').notNull(),
    profileId: uuid('profile_id').references(() => layoutProfiles.id),
    kind: text('kind', { enum: DOC_KINDS }).notNull(),
    /** Its own copy: a profile confirmed again later does not change a sheet already read. */
    layout: jsonb('layout_json').$type<LayoutMapping>().notNull(),
    /** Of its header row: rows inserted above it move the header, found again by this. */
    fingerprint: text('fingerprint'),
    /** « Inclure cette feuille »: when, and who. */
    consentedAt: timestamp('consented_at', { withTimezone: true }).notNull(),
    consentedBy: text('consented_by').notNull(),
    /** SHA-256 of the last snapshot read: the same one again changes nothing. */
    etag: text('etag'),
    readAt: timestamp('read_at', { withTimezone: true }),
    /** The last read that changed the registry. */
    changedAt: timestamp('changed_at', { withTimezone: true }),
    stats: jsonb('stats_json').$type<SourceStats>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('sources_sheet').on(t.tenantId, t.workbookId, t.sheet)],
);

/** What the last read of a sheet found. */
export interface SourceStats {
  docs: number;
  lines: number;
  rows: number;
  ignoredRows: number;
  unreadRows: number;
  /** False when no row of the sheet has the confirmed headers any more: it was read as before. */
  headerFound: boolean;
}

// ── Registry (R0) ───────────────────────────────────────────────────────────────────────────────
// Every invoice of the company, sent or received, as a document and its lines, each line tied to the
// article it is about: what the checks of documents together read. Derived data, written only by the
// registry.refresh job (apps/api/src/registry.ts) from `invoices` and `inbound_queue`, and rebuilt
// from them at any time.

/** An article of the company: its own reference (BT-155 sold, BT-156 bought), else its name. */
export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** `ref:<reference>`, `name:<normalized name>`, or a supplier's article `supplier:<key>:…`. */
    key: text('key').notNull(),
    /** As first seen. */
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('items_key').on(t.tenantId, t.key)],
);

export const docs = pgTable(
  'docs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** out: an invoice of the company, an order or a delivery to a customer, its prices; in: bought. */
    direction: text('direction', { enum: ['out', 'in'] }).notNull(),
    kind: text('kind', { enum: ['invoice', ...DOC_KINDS] })
      .notNull()
      .default('invoice'),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    inboundId: uuid('inbound_id').references(() => inboundQueue.id),
    /** A supplier invoice uploaded from the pane (R6): it goes with the upload. */
    uploadId: uuid('upload_id').references(() => uploads.id, { onDelete: 'cascade' }),
    /** A document read from an included sheet: the sheet, and its key there (number, or `row:14`). */
    sourceId: uuid('source_id').references(() => sources.id, { onDelete: 'cascade' }),
    sourceKey: text('source_key'),
    isTest: boolean('is_test').notNull(),
    typeCode: text('type_code'),
    number: text('number'),
    issueDate: date('issue_date', { mode: 'string' }),
    /** The other company: the customer of an outgoing invoice, the supplier of a received one. */
    partySiren: text('party_siren'),
    partyName: text('party_name'),
    currency: text('currency'),
    /** On an invoice the order it bills (BT-13); on a delivery note the order it delivers. */
    orderRef: text('order_ref'),
    /** BT-109; on a sheet document, the sum of its lines when every one has an amount. */
    netTotal: cents('net_total'),
    /** What advances already paid of it (BT-113), brought to HT: B5 counts an advance once. */
    prepaid: cents('prepaid'),
    /** What the lines were read from (the invoice's fingerprint, a sheet document's hash): another one projects them again. */
    sourceVersion: text('source_version').notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('docs_invoice').on(t.invoiceId),
    uniqueIndex('docs_inbound').on(t.inboundId),
    uniqueIndex('docs_upload').on(t.uploadId),
    uniqueIndex('docs_source').on(t.sourceId, t.sourceKey),
    index('docs_tenant').on(t.tenantId, t.direction, t.issueDate),
  ],
);

export const docLines = pgTable(
  'doc_lines',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    docId: uuid('doc_id')
      .notNull()
      .references(() => docs.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** In the document's order, from 0. */
    position: integer('position').notNull(),
    itemId: uuid('item_id').references(() => items.id),
    lineId: text('line_id'), // BT-126
    name: text('name'), // BT-153
    sellerRef: text('seller_ref'), // BT-155
    buyerRef: text('buyer_ref'), // BT-156
    standardId: text('standard_id'), // BT-157
    quantity: text('quantity'), // BT-129, decimal as written
    unitCode: text('unit_code'), // BT-130
    netPrice: text('net_price'), // BT-146, decimal as written
    /** The line's allowances (BT-136), summed. */
    discount: cents('discount'),
    netAmount: cents('net_amount'), // BT-131
    vatCategory: text('vat_category'), // BT-151
    vatRate: text('vat_rate'), // BT-152
    orderLineRef: text('order_line_ref'), // BT-132
    /** The sheet cell of the line's designation, for an invoice made from a sheet. */
    cell: text('cell'),
  },
  (t) => [index('doc_lines_doc').on(t.docId), index('doc_lines_item').on(t.tenantId, t.itemId)],
);

// ── Checks across documents (R2) ───────────────────────────────────────────────────────────────
// Which order an invoice bills (links), and what the rules found reading them together (findings).
// Written by apps/api/src/checks.ts after each registry refresh and before a send; a person's yes or
// no on a link stays, everything else is found again each time.

export const links = pgTable(
  'links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    kind: text('kind', { enum: LINK_KINDS }).notNull(),
    /** billed_by: the order (or delivery note) → its invoice; fulfils: the delivery note → its order. */
    fromDocId: uuid('from_doc_id')
      .notNull()
      .references(() => docs.id, { onDelete: 'cascade' }),
    toDocId: uuid('to_doc_id')
      .notNull()
      .references(() => docs.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    method: text('method', { enum: LINK_METHODS }).notNull(),
    status: text('status', { enum: LINK_STATUSES }).notNull(),
    /** Who said « Oui » or « Non » (a user id, or `key`), and when. */
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('links_pair').on(t.fromDocId, t.toDocId, t.kind),
    index('links_tenant').on(t.tenantId, t.status),
  ],
);

export const findings = pgTable(
  'findings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    rule: text('rule', { enum: CHECK_RULES }).notNull(),
    /** fr.json `check.message.<message>`, filled with `params`. */
    message: text('message', { enum: CHECK_MESSAGES }).notNull(),
    severity: text('severity', { enum: FINDING_SEVERITIES }).notNull(),
    /** The document it is about: an invoice, an order, a delivery note. */
    docId: uuid('doc_id')
      .notNull()
      .references(() => docs.id, { onDelete: 'cascade' }),
    /** When that document is one of the company's invoices: the send gate reads this. */
    invoiceId: uuid('invoice_id').references(() => invoices.id, { onDelete: 'cascade' }),
    /** Who it is from one check to the next (core `CheckFinding.key`). */
    key: text('key').notNull(),
    /** SHA-256 of its amount, values and cells: another one is a change worth an audit event. */
    fingerprint: text('fingerprint').notNull(),
    amount: cents('amount'),
    params: jsonb('params_json').$type<Record<string, string>>().notNull(),
    evidence: jsonb('evidence_json').$type<Evidence[]>().notNull(),
    /** The price cell the code knows how to correct, and to what (R8). */
    fix: jsonb('fix_json').$type<CheckFix>(),
    /** The customer and article, when a person may call it normal (R7). */
    scope: jsonb('scope_json').$type<FindingScope>(),
    /** The invoice bills less than it should: the weekly report's money not invoiced (R7). */
    short: boolean('short').notNull().default(false),
    status: text('status', { enum: ['open', 'resolved'] })
      .notNull()
      .default('open'),
    isTest: boolean('is_test').notNull(),
    firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('findings_key').on(t.tenantId, t.key),
    index('findings_open').on(t.tenantId, t.status),
    index('findings_invoice').on(t.invoiceId),
  ],
);

// ── Patterns and learning (R7) ─────────────────────────────────────────────────────────────────
// What a person taught the checks: a finding that is normal for a customer and an article, and two
// articles that are one. Written by apps/api/src/patterns.ts; every check reads them.

/** « C'est normal »: the rule stays quiet on the article, for the customer or any (party null), until `until`. */
export const ruleExceptions = pgTable(
  'rule_exceptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    rule: text('rule', { enum: ACCEPTABLE_RULES }).notNull(),
    /** core `partyOf`: `siren:…` or `name:…`; null: every customer. */
    party: text('party'),
    /** As the finding named them, for the list in « Contrôles ». */
    partyName: text('party_name'),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    itemName: text('item_name').notNull(),
    /** Europe/Paris, its last day; null: no end. */
    until: date('until', { mode: 'string' }),
    /** The finding the person answered. */
    findingKey: text('finding_key').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('rule_exceptions_tenant').on(t.tenantId)],
);

/** Two articles that are one: `alias` is read as `item`. Proposed by the checks, answered by a person. */
export const itemSynonyms = pgTable(
  'item_synonyms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** The article sold. */
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    /** The article bought (or another name of it). */
    aliasId: uuid('alias_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    status: text('status', { enum: ['proposed', 'confirmed', 'rejected'] }).notNull(),
    /** 0–100, how much the names share. */
    score: integer('score').notNull(),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('item_synonyms_pair').on(t.itemId, t.aliasId),
    index('item_synonyms_tenant').on(t.tenantId, t.status),
  ],
);

/** What the last check of a company read: the sweep checks again when the registry moved, or daily. */
export const checkState = pgTable('check_state', {
  tenantId: uuid('tenant_id')
    .primaryKey()
    .references(() => tenants.id),
  checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
  /** Europe/Paris day of the check: a delivery note gets late without anything changing (B3). */
  checkedOn: date('checked_on', { mode: 'string' }).notNull(),
  /** The registry's documents when it ran: their count and last change. */
  mark: text('mark').notNull(),
});

// ── Chat and edits (R8) ────────────────────────────────────────────────────────────────────────
// A conversation per finding, and the journal of the cells the pane changed for it. Written by
// apps/api/src/edits.ts and apps/api/src/chat.ts; the pane writes the cell, the API keeps the record.

/**
 * proposed: the « Avant → Après » card waits for its click · applied · declined · reverted: « Avant »
 * written back · conflict: the cell held something else, nothing was written.
 */
export const EDIT_STATUSES = ['proposed', 'applied', 'declined', 'reverted', 'conflict'] as const;
export type EditStatus = (typeof EDIT_STATUSES)[number];

export const edits = pgTable(
  'edits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    findingId: uuid('finding_id').references(() => findings.id, { onDelete: 'set null' }),
    /** Who asked: the agent in the chat, or a person from the finding's card. */
    by: text('by', { enum: ['agent', 'person'] }).notNull(),
    /** The chat's tool call that asked for it. */
    toolCallId: text('tool_call_id'),
    workbookId: text('workbook_id'),
    sheet: text('sheet').notNull(),
    /** A1, without the sheet. */
    cell: text('cell').notNull(),
    field: text('field', { enum: ['price'] }).notNull(),
    /** Decimal text the cell held, and its formula when the pane found one. */
    beforeValue: text('before_value').notNull(),
    beforeFormula: text('before_formula'),
    afterValue: text('after_value').notNull(),
    status: text('status', { enum: EDIT_STATUSES }).notNull().default('proposed'),
    /** At a conflict: what the cell held instead, and why nothing was written. */
    foundValue: text('found_value'),
    reason: text('reason', { enum: ['changed', 'formula', 'missing'] }),
    appliedAt: timestamp('applied_at', { withTimezone: true }),
    revertedAt: timestamp('reverted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('edits_invoice').on(t.invoiceId), index('edits_tenant').on(t.tenantId)],
);

/** One conversation per finding: the messages as the pane shows them (UI messages of `ai`). */
export const chats = pgTable(
  'chats',
  {
    findingId: uuid('finding_id')
      .primaryKey()
      .references(() => findings.id, { onDelete: 'cascade' }),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** The pane's UI messages (`ai`'s UIMessage), the opening first. */
    messages: jsonb('messages_json').$type<object[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('chats_tenant').on(t.tenantId)],
);

export const CONNECTION_PROVIDERS = ['microsoft', 'google'] as const;
export type ConnectionProvider = (typeof CONNECTION_PROVIDERS)[number];
export const FILE_PROBLEMS = [
  'missing',
  'forbidden',
  'too_large',
  'too_many_rows',
  'unreadable',
  'unsupported',
] as const;
export type FileProblem = (typeof FILE_PROBLEMS)[number];

/**
 * An account the company connected to read files the API checks without Excel (R4): Microsoft's, one
 * per company. The refresh token is sealed; the pane never sees it.
 */
export const connections = pgTable(
  'connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    provider: text('provider', { enum: CONNECTION_PROVIDERS }).notNull(),
    /** The account's id (Graph `/me` id, Google's `permissionId`): connecting it again updates the row. */
    accountId: text('account_id').notNull(),
    /** What the pane shows: the account's address. */
    label: text('label').notNull(),
    /**
     * A personal account or a work one: Graph subscribes only the former with Files.Read. Google: Gmail
     * or Workspace, shown only.
     */
    accountKind: text('account_kind', { enum: ['personal', 'work'] }).notNull(),
    /** The directory the account signed in from (`tid`): its token endpoint. Google: `google`. */
    directory: text('directory').notNull(),
    /** The drive's address (Graph `webUrl`): a work account's file picker lives on its host. */
    driveUrl: text('drive_url'),
    /** AES-256-GCM under CONNECTOR_SEALING_KEY. */
    refreshToken: text('refresh_token').notNull(),
    /** `reconnect`: the provider refused the token; nothing is read until the person signs in again. */
    status: text('status', { enum: ['active', 'reconnect'] })
      .notNull()
      .default('active'),
    /** Change notifications: Graph's subscription on a personal OneDrive's root, Google's channel. */
    subscriptionId: text('subscription_id'),
    /** Google's `resourceId` of the channel, needed to stop it (docs/GOOGLE.md §4); null for Microsoft. */
    subscriptionResource: text('subscription_resource'),
    subscriptionExpiresAt: timestamp('subscription_expires_at', { withTimezone: true }),
    /** SHA-256 of the secret Graph sends back with each notification. */
    clientStateHash: text('client_state_hash'),
    connectedBy: text('connected_by').notNull(),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull(),
    /** The last time its files were checked. */
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    /** Microsoft asked to wait (429, Retry-After): no call before. */
    waitUntil: timestamp('wait_until', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('connections_provider').on(t.tenantId, t.provider),
    index('connections_subscription').on(t.subscriptionId),
  ],
);

/** A file the company picked in a connection: the only files the API reads (R4). */
export const connectedFiles = pgTable(
  'connected_files',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => connections.id, { onDelete: 'cascade' }),
    driveId: text('drive_id').notNull(),
    itemId: text('item_id').notNull(),
    name: text('name').notNull(),
    /** Graph's content tag (cTag, else eTag) at the last read: the same one, nothing is downloaded. */
    contentTag: text('content_tag'),
    size: integer('size'),
    /** Its sheets at the last read, in the workbook's order. */
    sheets: jsonb('sheets_json').$type<string[]>().notNull().default([]),
    /** Why the last check could not read it; null when it could. */
    problem: text('problem', { enum: FILE_PROBLEMS }),
    pickedBy: text('picked_by').notNull(),
    pickedAt: timestamp('picked_at', { withTimezone: true }).notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    /** The last download whose content was new. */
    changedAt: timestamp('changed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('connected_files_item').on(t.tenantId, t.driveId, t.itemId)],
);

export const UPLOAD_FORMATS = ['xlsx', 'xlsm', 'csv', 'facturx', 'ubl', 'cii'] as const;
export type UploadFormat = (typeof UPLOAD_FORMATS)[number];

/**
 * A file a person uploaded from the pane (R6): a workbook whose sheets are included like a picked
 * file's, or a supplier invoice (Factur-X, UBL, CII) read into the registry as bought. One per name: the
 * same name again replaces it.
 */
export const uploads = pgTable(
  'uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    name: text('name').notNull(),
    format: text('format', { enum: UPLOAD_FORMATS }).notNull(),
    size: integer('size').notNull(),
    /** SHA-256 of the bytes: the same file again changes nothing. */
    sha256: text('sha256').notNull(),
    /** A workbook's bytes in base64, to read its sheets when they are included; null for an invoice. */
    content: text('content'),
    /** A workbook's sheets, in its order. */
    sheets: jsonb('sheets_json').$type<string[]>().notNull().default([]),
    /** An invoice: what it says, as read (the registry is projected from it). */
    parsed: jsonb('parsed_json').$type<Invoice>(),
    /** An invoice's supplier (core supplierKey) and number: the same one twice is counted once. */
    supplierKey: text('supplier_key'),
    number: text('number'),
    uploadedBy: text('uploaded_by').notNull(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('uploads_name').on(t.tenantId, t.name)],
);

/**
 * What VIES said of a customer's VAT number (plan §6 PartyAgent `vies.check`): one answer per number
 * and day at most, kept with the company's account as its proof of checking. Only answers are kept: a
 * VIES that could not answer leaves nothing.
 */
export const vatChecks = pgTable(
  'vat_checks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id),
    /** As core viesNumber writes it: country code and number. */
    vatId: text('vat_id').notNull(),
    valid: boolean('valid').notNull(),
    /** What VIES gives of the company ("---" and empty read as null; some countries give nothing). */
    name: text('name'),
    address: text('address'),
    /** VIES' consultation number, when it gave one for our requester number. */
    requestIdentifier: text('request_identifier'),
    /** The Paris day of the answer: one per number and day. */
    checkedOn: text('checked_on').notNull(),
    /** VIES' own request date. */
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('vat_checks_day').on(t.tenantId, t.vatId, t.checkedOn)],
);

/** Stripe events already applied: an endpoint may receive the same event twice (docs/BILLING.md). */
export const stripeEvents = pgTable('stripe_events', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

export type TenantRow = typeof tenants.$inferSelect;
export type UploadRow = typeof uploads.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type AgentRunRow = typeof agentRuns.$inferSelect;
export type SheetMappingRow = typeof sheetMappings.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoiceEventRow = typeof invoiceEvents.$inferSelect;
export type PdpSubmissionRow = typeof pdpSubmissions.$inferSelect;
export type InboundRow = typeof inboundQueue.$inferSelect;
export type InboundExportRow = typeof inboundExports.$inferSelect;
export type ChasePlanRow = typeof chasePlans.$inferSelect;
export type PaymentReportRow = typeof paymentReports.$inferSelect;
export type PartyRow = typeof parties.$inferSelect;
export type ArchiveRow = typeof invoiceArchive.$inferSelect;
export type ItemRow = typeof items.$inferSelect;
export type DocRow = typeof docs.$inferSelect;
export type DocLineRow = typeof docLines.$inferSelect;
export type LayoutProfileRow = typeof layoutProfiles.$inferSelect;
export type SourceRow = typeof sources.$inferSelect;
export type LinkRow = typeof links.$inferSelect;
export type FindingRow = typeof findings.$inferSelect;
export type EditRow = typeof edits.$inferSelect;
export type ChatRow = typeof chats.$inferSelect;
export type ConnectionRow = typeof connections.$inferSelect;
export type ConnectedFileRow = typeof connectedFiles.$inferSelect;
export type RuleExceptionRow = typeof ruleExceptions.$inferSelect;
export type ItemSynonymRow = typeof itemSynonyms.$inferSelect;
export type VatCheckRow = typeof vatChecks.$inferSelect;
