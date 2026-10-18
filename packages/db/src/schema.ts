// Postgres schema (plan §4), the part M2 needs. Tables of later milestones (users, parties,
// agent_runs, chase_plans, inbound_queue) arrive with them (docs/DEFERRED.md).
// Change it, then `pnpm --filter @fi/db generate` writes the migration into drizzle/.
import type { Address, Invoice, InvoiceDraft, Issue } from '@fi/core';
import { STATES } from '@fi/core';
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
  createdAt: createdAt(),
});

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

export type TenantRow = typeof tenants.$inferSelect;
export type InvoiceRow = typeof invoices.$inferSelect;
export type InvoiceEventRow = typeof invoiceEvents.$inferSelect;
export type PdpSubmissionRow = typeof pdpSubmissions.$inferSelect;
