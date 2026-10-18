// Postgres schema (plan §4), the part M6 needs. Tables of later milestones (parties) arrive with them
// (docs/DEFERRED.md).
// Change it, then `pnpm --filter @fi/db generate` writes the migration into drizzle/.
import type {
  Address,
  ChaseStep,
  InboundTriage,
  Invoice,
  InvoiceDefaultsInput,
  InvoiceDraft,
  Issue,
  SheetMapping,
} from '@fi/core';
import { INBOUND_STATES, STATES } from '@fi/core';
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

export const PDP_PROVIDERS = ['mock', 'b2brouter'] as const;
export type PdpProvider = (typeof PDP_PROVIDERS)[number];

/** J-3 courtesy, J+1, J+8, J+15 firm, J+30 formal notice draft (plan §6 CollectAgent). */
export const DEFAULT_CHASE_CADENCE = [-3, 1, 8, 15, 30] as const;

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  siren: text('siren').notNull(),
  vatId: text('vat_id'),
  address: jsonb('address_json').$type<Address>(),
  pdpProvider: text('pdp_provider', { enum: PDP_PROVIDERS }).notNull(),
  /** The tenant's account at the PDP: B2Brouter keeps one per SIREN (docs/B2BROUTER.md §3.2). */
  pdpAccount: text('pdp_account').notNull(),
  mode: text('mode', { enum: ['review', 'autopilot'] })
    .notNull()
    .default('review'),
  autopilotMaxAmount: cents('autopilot_max_amount'),
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

export interface ExcelBinding {
  workbookId: string;
  sheet: string;
  rowKey: string;
  /** Sheet rows of the invoice, and model path → cell address, as of the last sync. */
  rows?: number[];
  cells?: Record<string, string>;
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

export type TenantRow = typeof tenants.$inferSelect;
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
