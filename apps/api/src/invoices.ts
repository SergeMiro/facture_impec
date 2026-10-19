// Outbound invoices: create, edit, validate, send, cancel (plan §4, §6 phases 3 and 6). Every write
// runs in one transaction with its status transition and audit event; status changes go through
// applyTransition only.
import {
  computeInvoice,
  type FilledField,
  type HistoryEntry,
  hasErrors,
  type Invoice,
  type InvoiceDraft,
  type InvoiceState,
  type Issue,
  NumberingHistory,
  parisToday,
  validate,
} from '@fi/core';
import {
  and,
  applyTransition,
  audit,
  type DbOrTx,
  desc,
  type ExcelBinding,
  eq,
  hashOf,
  type InvoiceRow,
  inArray,
  invoiceEvents,
  invoices,
  isNotNull,
  lockInvoice,
  ne,
  type PartyRow,
  parties,
  pdpSubmissions,
  sha256,
  sql,
  type TenantRow,
  type Tx,
  validationResults,
} from '@fi/db';
import { t } from '@fi/shared';
import { planAutopilot } from './autopilot';
import { assertMaySend } from './billing';
import { chasePlanOf } from './collect';
import type { ApiDeps } from './deps';
import { ApiError, isUniqueViolation } from './errors';
import { PartyBook } from './parties';
import { awaitsGoLive, routeFor } from './platform';
import { RULESET } from './ruleset';

export const EDITABLE: readonly InvoiceState[] = ['draft', 'needs_fix', 'validated'];
const BEFORE_DEPOSIT: readonly InvoiceState[] = [
  'draft',
  'needs_fix',
  'validated',
  'ready_to_send',
];
/** Already on its way or further: « Envoyer » again changes nothing. */
const ON_ITS_WAY: readonly InvoiceState[] = [
  'ready_to_send',
  'sending',
  'deposited',
  'delivered',
  'accepted',
  'overdue',
  'chasing',
  'paid',
];

export const label = (status: InvoiceState) => t(`invoice.status.${status}`);

export const TEST_PREFIX = 'TEST-';

/** « Mode test » (plan §3): a test invoice's number starts with TEST-, so it can never pass for a real one. */
export function testDraft(draft: InvoiceDraft): InvoiceDraft {
  const number = draft.number?.trim();
  if (!number || number.startsWith(TEST_PREFIX)) return draft;
  return { ...draft, number: `${TEST_PREFIX}${number}` };
}

/** Plan §0.4: tenant + number + fingerprint. The same invoice never gets two keys. */
export const idempotencyKey = (row: Pick<InvoiceRow, 'tenantId' | 'number' | 'fingerprint'>) =>
  sha256(`${row.tenantId}\u0000${row.number ?? ''}\u0000${row.fingerprint}`);

export interface Computed {
  draft: InvoiceDraft;
  document: Invoice;
  fingerprint: string;
}

/** Computes the document; refuses an invoice issued in another company's name. */
export function compute(tenant: TenantRow, draft: InvoiceDraft): Computed {
  const document = computeInvoice(draft);
  const siren = document.seller.legalId?.id;
  if (siren !== undefined && siren !== tenant.siren) {
    throw new ApiError(422, 'seller_mismatch', { siren, tenantSiren: tenant.siren });
  }
  return { draft, document, fingerprint: hashOf(document) };
}

export const columns = ({ draft, document, fingerprint }: Computed) => ({
  draft,
  document,
  fingerprint,
  number: document.number ?? null,
  issueDate: document.issueDate ?? null,
  dueDate: document.dueDate ?? null,
  currency: document.currency ?? null,
  buyerName: document.buyer.name ?? null,
  payable: document.totals.payable,
});

/** What the rules must know about the customer (core RuleContext.buyer), from its fiche. */
export type BuyerSettings = Pick<PartyRow, 'requiresPurchaseOrder' | 'publicEntity'>;

/** BR-FR-14's « delivered elsewhere » waits for a delivery address a sheet can give (DEFERRED.md). */
export const buyerSettings = (party?: BuyerSettings | null) => ({
  requiresPurchaseOrder: party?.requiresPurchaseOrder ?? false,
  deliversElsewhere: false,
  publicEntity: party?.publicEntity ?? false,
});

/** The numbers already issued, which the history rules compare with; a cancelled one is free again. */
export async function loadHistory(
  db: DbOrTx,
  tenant: TenantRow,
  isTest: boolean,
): Promise<HistoryEntry[]> {
  const rows = await db
    .select({ id: invoices.id, number: invoices.number, issueDate: invoices.issueDate })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenant.id),
        eq(invoices.direction, 'out'),
        eq(invoices.isTest, isTest),
        ne(invoices.status, 'cancelled'),
        isNotNull(invoices.number),
        isNotNull(invoices.issueDate),
      ),
    );
  return rows.map((h) => ({
    id: h.id,
    number: h.number ?? '',
    issueDate: h.issueDate ?? '',
    sellerSiren: tenant.siren,
  }));
}

export interface Check {
  /** Everything the verdict depends on, hashed: the same key gives the same verdict. */
  key: string;
  run: () => Issue[];
}

/**
 * One check of an invoice: the rules' code, the content, the day, the company's and the customer's
 * settings, and the few issued numbers that decide the history rules. `self` is the invoice in
 * `history`, left out of its own.
 */
export function checkOf(
  tenant: TenantRow,
  computed: Pick<Computed, 'document' | 'fingerprint'>,
  history: NumberingHistory,
  buyer: BuyerSettings | null | undefined,
  now: Date,
  self?: string,
): Check {
  const context = {
    today: parisToday(now),
    history: history.for(computed.document, self),
    seller: { vatOnDebits: tenant.vatOnDebits },
    buyer: buyerSettings(buyer),
  };
  return {
    key: hashOf({ ruleset: RULESET, fingerprint: computed.fingerprint, ...context }),
    run: () => validate(computed.document, context),
  };
}

async function partySettings(db: DbOrTx, partyId: string | null) {
  if (!partyId) return null;
  const [party] = await db.select().from(parties).where(eq(parties.id, partyId));
  return party ?? null;
}

/** The check of a stored invoice, with the numbers issued and its customer's settings as they are now. */
async function checkStored(db: DbOrTx, row: InvoiceRow, tenant: TenantRow, now: Date) {
  const history = new NumberingHistory(await loadHistory(db, tenant, row.isTest));
  return checkOf(tenant, row, history, await partySettings(db, row.partyId), now, row.id);
}

/** Stores a verdict, moves the status, and remembers what it was checked against. */
async function storeVerdict(
  tx: Tx,
  invoiceId: string,
  key: string,
  issues: Issue[],
  now: Date,
): Promise<void> {
  const failed = hasErrors(issues);
  await tx.insert(validationResults).values({
    invoiceId,
    runAt: now,
    severityMax: failed ? 'error' : issues.length > 0 ? 'warning' : 'none',
    issues,
  });
  await applyTransition(tx, {
    invoiceId,
    event: failed ? 'validation_failed' : 'validation_passed',
    actor: 'system',
    payload: {
      errors: issues.filter((i) => i.severity === 'error').length,
      warnings: issues.filter((i) => i.severity === 'warning').length,
    },
  });
  await tx.update(invoices).set({ validatedKey: key }).where(eq(invoices.id, invoiceId));
}

/** Runs the core rules with what we know about the tenant and the customer, stores the verdict. */
async function runValidation(tx: Tx, row: InvoiceRow, tenant: TenantRow, now: Date, check?: Check) {
  const { key, run } = check ?? (await checkStored(tx, row, tenant, now));
  const issues = run();
  await storeVerdict(tx, row.id, key, issues, now);
  return issues;
}

async function findByNumber(
  deps: ApiDeps,
  tenant: TenantRow,
  number: string | null,
  isTest: boolean,
) {
  if (number === null) return undefined;
  const [row] = await deps.db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenant.id),
        eq(invoices.direction, 'out'),
        eq(invoices.isTest, isTest),
        eq(invoices.number, number),
        ne(invoices.status, 'cancelled'),
      ),
    );
  return row;
}

export interface CreateResult {
  row: InvoiceRow;
  created: boolean;
  /** What the buyer got from its customer in the directory. */
  filled: FilledField[];
  /** The verdict of a new invoice. */
  issues?: Issue[];
}

/**
 * Creating the same invoice twice returns the first one (same number, same fingerprint): a double
 * click or a retried request never makes a second invoice. Same number, other content: 409.
 */
export interface InvoiceInput {
  draft: InvoiceDraft;
  excelBinding?: ExcelBinding | undefined;
  /** « Mode test »: numbered TEST-…, sent to the test platform only. */
  isTest?: boolean | undefined;
  /** The company's customers, when the caller already read them (a sync reads them once). */
  parties?: PartyBook | undefined;
  /** The numbers issued as a sync sees them, and who this invoice is among them. */
  history?: { index: NumberingHistory; self: string } | undefined;
}

/** The buyer completed from its confirmed customer (plan §6 phase 2): the sheet always wins. */
async function enrich(deps: ApiDeps, tenant: TenantRow, input: InvoiceInput) {
  const book = input.parties ?? (await PartyBook.load(deps.db, tenant.id));
  return book.enrich(input.draft);
}

export async function createInvoice(
  deps: ApiDeps,
  tenant: TenantRow,
  input: InvoiceInput,
): Promise<CreateResult> {
  const isTest = input.isTest ?? false;
  const { draft, partyId, party, filled } = await enrich(deps, tenant, input);
  const computed = compute(tenant, isTest ? testDraft(draft) : draft);
  const number = computed.document.number ?? null;
  const existing = async (): Promise<CreateResult> => {
    const row = await findByNumber(deps, tenant, number, isTest);
    if (!row) throw new ApiError(500, 'internal');
    if (row.fingerprint !== computed.fingerprint) {
      throw new ApiError(409, 'number_taken', { number: number ?? '' });
    }
    return { row, created: false, filled };
  };
  if (await findByNumber(deps, tenant, number, isTest)) return existing();

  try {
    const { row, issues } = await deps.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(invoices)
        .values({
          tenantId: tenant.id,
          ...columns(computed),
          isTest,
          source: input.excelBinding ? 'excel' : 'api',
          excelBinding: input.excelBinding ?? null,
          partyId,
        })
        .returning();
      if (!inserted) throw new Error('insert returned nothing');
      await audit(tx, {
        tenantId: tenant.id,
        actor: 'user',
        action: 'invoice.create',
        objectType: 'invoice',
        objectId: inserted.id,
        after: { fingerprint: computed.fingerprint, isTest, partyId },
      });
      const now = deps.now();
      const given = input.history;
      const check = given && checkOf(tenant, computed, given.index, party, now, given.self);
      const issues = await runValidation(tx, inserted, tenant, now, check);
      await planAutopilot(tx, now, tenant, inserted.id);
      return { row: inserted, issues };
    });
    return { row: await reload(deps, row.id), created: true, filled, issues };
  } catch (e) {
    // Two identical requests at once: the second one lost the race on the unique number.
    if (isUniqueViolation(e)) return existing();
    throw e;
  }
}

async function reload(deps: ApiDeps, id: string): Promise<InvoiceRow> {
  const [row] = await deps.db.select().from(invoices).where(eq(invoices.id, id));
  if (!row) throw new ApiError(404, 'not_found');
  return row;
}

export async function getInvoice(deps: ApiDeps, tenant: TenantRow, id: string) {
  const [row] = await deps.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenant.id)));
  if (!row) throw new ApiError(404, 'not_found');
  return row;
}

export async function invoiceDetailData(deps: ApiDeps, row: InvoiceRow) {
  const [last] = await deps.db
    .select({ issues: validationResults.issues })
    .from(validationResults)
    .where(eq(validationResults.invoiceId, row.id))
    .orderBy(desc(validationResults.runAt), desc(validationResults.id))
    .limit(1);
  const events = await deps.db
    .select()
    .from(invoiceEvents)
    .where(eq(invoiceEvents.invoiceId, row.id))
    .orderBy(invoiceEvents.id);
  return { issues: last?.issues ?? [], events, plan: await chasePlanOf(deps.db, row.id) };
}

/** Locks the tenant's invoice for the rest of the transaction. */
async function lockOwn(tx: Tx, tenant: TenantRow, id: string): Promise<InvoiceRow> {
  const row = await lockInvoice(tx, id);
  if (!row || row.tenantId !== tenant.id) throw new ApiError(404, 'not_found');
  return row;
}

export async function updateInvoice(
  deps: ApiDeps,
  tenant: TenantRow,
  id: string,
  input: InvoiceInput,
): Promise<{ row: InvoiceRow; issues: Issue[]; filled: FilledField[] }> {
  let number: string | null = null;
  const { draft, partyId, filled } = await enrich(deps, tenant, input);
  try {
    const issues = await deps.db.transaction(async (tx) => {
      const row = await lockOwn(tx, tenant, id);
      if (!EDITABLE.includes(row.status)) {
        throw new ApiError(409, 'not_editable', { status: label(row.status) });
      }
      // A test invoice stays a test invoice, and a real one stays real.
      const computed = compute(tenant, row.isTest ? testDraft(draft) : draft);
      number = computed.document.number ?? null;
      const [updated] = await tx
        .update(invoices)
        .set({
          ...columns(computed),
          ...(input.excelBinding && { excelBinding: input.excelBinding }),
          partyId,
          updatedAt: deps.now(),
        })
        .where(eq(invoices.id, row.id))
        .returning();
      if (!updated) throw new ApiError(404, 'not_found');
      await audit(tx, {
        tenantId: tenant.id,
        actor: 'user',
        action: 'invoice.update',
        objectType: 'invoice',
        objectId: row.id,
        before: { fingerprint: row.fingerprint, partyId: row.partyId },
        after: { fingerprint: computed.fingerprint, partyId },
      });
      const issues = await runValidation(tx, updated, tenant, deps.now());
      await planAutopilot(tx, deps.now(), tenant, row.id);
      return issues;
    });
    return { row: await reload(deps, id), issues, filled };
  } catch (e) {
    if (isUniqueViolation(e)) throw new ApiError(409, 'number_taken', { number: number ?? '' });
    throw e;
  }
}

/** The customer's settings changed: its invoices not yet sent are checked again now. */
export async function recheckParty(tx: Tx, tenant: TenantRow, party: PartyRow, now: Date) {
  const rows = await tx
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenant.id),
        eq(invoices.partyId, party.id),
        inArray(invoices.status, [...EDITABLE]),
      ),
    );
  const histories = new Map<boolean, NumberingHistory>();
  for (const row of rows) {
    let history = histories.get(row.isTest);
    if (!history) {
      history = new NumberingHistory(await loadHistory(tx, tenant, row.isTest));
      histories.set(row.isTest, history);
    }
    const { key, run } = checkOf(tenant, row, history, party, now, row.id);
    if (key === row.validatedKey) continue;
    await storeVerdict(tx, row.id, key, run(), now);
    await planAutopilot(tx, now, tenant, row.id);
  }
}

/** A sheet invoice already stored, as the sheet has it now (src/workbooks.ts syncSheet). */
export interface SheetChange {
  computed: Computed;
  partyId: string | null;
  excelBinding: ExcelBinding;
  check: Check;
  /** Its last verdict: when only the context changed, a new one is stored only if it differs. */
  last: Issue[] | undefined;
}

/** What a sync needs to know about an invoice it already made. */
export type SheetBound = Pick<
  InvoiceRow,
  | 'id'
  | 'status'
  | 'number'
  | 'isTest'
  | 'fingerprint'
  | 'partyId'
  | 'excelBinding'
  | 'validatedKey'
  | 'autopilotAt'
  | 'autopilotHeld'
>;

export type SheetSave =
  | { kind: 'unchanged' }
  /** Checked again with the same verdict: only the key is new (rememberChecks). */
  | { kind: 'checked'; key: string; issues: Issue[] }
  /** `issues` is null when the verdict did not move. */
  | { kind: 'saved'; row: InvoiceRow; issues: Issue[] | null };

/**
 * Writes what changed in one transaction: the content (with its audit event), the rows it sits on,
 * a new verdict. A sheet that did not change writes nothing; a context that changed (the day, a
 * neighbour's number, the customer's settings) writes a verdict only when it differs.
 */
export async function saveSheetInvoice(
  deps: ApiDeps,
  tenant: TenantRow,
  before: SheetBound,
  change: SheetChange,
): Promise<SheetSave> {
  const content =
    change.computed.fingerprint !== before.fingerprint || change.partyId !== before.partyId;
  const moved = hashOf(before.excelBinding) !== hashOf(change.excelBinding);
  const recheck = content || change.check.key !== before.validatedKey || before.status === 'draft';
  if (!content && !moved && !recheck) return { kind: 'unchanged' };
  const issues = recheck ? change.check.run() : null;
  const news =
    issues !== null &&
    (content || before.status === 'draft' || hashOf(issues) !== hashOf(change.last ?? null));
  if (!content && !moved && issues && !news) {
    return { kind: 'checked', key: change.check.key, issues };
  }
  try {
    const row = await deps.db.transaction(async (tx) => {
      const row = await lockOwn(tx, tenant, before.id);
      // Changed since the sheet was read (« Envoyer », another pane): the next sync sees it as it is.
      const same = row.fingerprint === before.fingerprint && row.partyId === before.partyId;
      if (!EDITABLE.includes(row.status) || !same) return null;
      const now = deps.now();
      await tx
        .update(invoices)
        .set({
          excelBinding: change.excelBinding,
          ...(content && { ...columns(change.computed), partyId: change.partyId, updatedAt: now }),
          ...(issues && !news && { validatedKey: change.check.key }),
        })
        .where(eq(invoices.id, row.id));
      if (content) {
        await audit(tx, {
          tenantId: tenant.id,
          actor: 'user',
          action: 'invoice.update',
          objectType: 'invoice',
          objectId: row.id,
          before: { fingerprint: row.fingerprint, partyId: row.partyId },
          after: { fingerprint: change.computed.fingerprint, partyId: change.partyId },
        });
      }
      if (issues && news) await storeVerdict(tx, row.id, change.check.key, issues, now);
      if (content || news) await planAutopilot(tx, now, tenant, row.id);
      return row;
    });
    return { kind: 'saved', row: await reload(deps, before.id), issues: row ? issues : null };
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new ApiError(409, 'number_taken', { number: change.computed.document.number ?? '' });
    }
    throw e;
  }
}

/** The keys of invoices checked again with the same verdict, in one statement for a whole sheet. */
export async function rememberChecks(
  db: DbOrTx,
  checked: readonly { id: string; fingerprint: string; key: string }[],
): Promise<void> {
  if (checked.length === 0) return;
  const values = sql.join(
    checked.map((c) => sql`(${c.id}::uuid, ${c.fingerprint}, ${c.key})`),
    sql`, `,
  );
  // The fingerprint guards against a change written meanwhile: its key is not this one.
  await db.execute(sql`update invoices set validated_key = v.key
    from (values ${values}) as v(id, fingerprint, key)
    where invoices.id = v.id and invoices.fingerprint = v.fingerprint`);
}

/** The last verdict of each invoice, in one query for a whole sheet. */
export async function latestIssues(db: DbOrTx, ids: readonly string[]) {
  if (ids.length === 0) return new Map<string, Issue[]>();
  const rows = await db
    .selectDistinctOn([validationResults.invoiceId], {
      invoiceId: validationResults.invoiceId,
      issues: validationResults.issues,
    })
    .from(validationResults)
    .where(inArray(validationResults.invoiceId, [...ids]))
    .orderBy(
      validationResults.invoiceId,
      desc(validationResults.runAt),
      desc(validationResults.id),
    );
  return new Map(rows.map((r) => [r.invoiceId, r.issues]));
}

export async function revalidateInvoice(deps: ApiDeps, tenant: TenantRow, id: string) {
  const issues = await deps.db.transaction(async (tx) => {
    const row = await lockOwn(tx, tenant, id);
    if (!EDITABLE.includes(row.status)) {
      throw new ApiError(409, 'not_editable', { status: label(row.status) });
    }
    const issues = await runValidation(tx, row, tenant, deps.now());
    await planAutopilot(tx, deps.now(), tenant, row.id);
    return issues;
  });
  return { row: await reload(deps, id), issues };
}

/**
 * « Envoyer » (Review mode, plan §0.2): approves the invoice and queues the send job. Pressing it
 * again — double click, retried request — returns the invoice as it is and queues nothing new.
 */
export async function requestSend(deps: ApiDeps, tenant: TenantRow, id: string) {
  const alreadySent = await deps.db.transaction(async (tx) => {
    const row = await lockOwn(tx, tenant, id);
    if (ON_ITS_WAY.includes(row.status)) return true;
    if (row.status === 'draft' || row.status === 'needs_fix') {
      throw new ApiError(409, 'has_errors');
    }
    if (row.status !== 'validated') {
      throw new ApiError(409, 'not_sendable', { status: label(row.status) });
    }
    if (!routeFor(deps, tenant, row.isTest)?.adapter) {
      throw new ApiError(409, row.isTest ? 'test_platform_missing' : 'pdp_not_configured');
    }
    if (!row.isTest && awaitsGoLive(deps, tenant)) throw new ApiError(409, 'not_live');
    if (!row.isTest) await assertMaySend(deps, tx, tenant);
    await applyTransition(tx, { invoiceId: row.id, event: 'approve', actor: 'user' });
    if (row.autopilotAt) {
      await tx
        .update(invoices)
        .set({ autopilotAt: null, autopilotFingerprint: null })
        .where(eq(invoices.id, row.id));
    }
    return false;
  });
  const row = await reload(deps, id);
  // After the commit: a crash right here leaves the invoice in ready_to_send, and the sweep queues
  // it (src/workers.ts). Queuing twice is harmless: one send job per invoice at a time.
  if (row.status === 'ready_to_send' || row.status === 'sending') await deps.jobs.enqueueSend(id);
  return { row, alreadySent };
}

/**
 * Only before the platform may have the invoice (plan §4); afterwards only a credit note. `reason`
 * goes on the timeline: `row_removed` when its rows left the sheet.
 */
export async function cancelInvoice(
  deps: ApiDeps,
  tenant: TenantRow,
  id: string,
  reason?: 'row_removed',
) {
  await deps.db.transaction(async (tx) => {
    const row = await lockOwn(tx, tenant, id);
    if (!BEFORE_DEPOSIT.includes(row.status)) {
      throw new ApiError(409, 'cannot_cancel', { status: label(row.status) });
    }
    // A send whose answer was lost: the platform may hold the invoice although we never heard.
    const [attempt] = await tx
      .select({ id: pdpSubmissions.id })
      .from(pdpSubmissions)
      .where(and(eq(pdpSubmissions.invoiceId, row.id), eq(pdpSubmissions.status, 'pending')))
      .limit(1);
    if (attempt) throw new ApiError(409, 'send_attempted');
    await applyTransition(tx, {
      invoiceId: row.id,
      event: 'cancel',
      actor: 'user',
      ...(reason && { payload: { reason } }),
    });
  });
  return reload(deps, id);
}

/** POST /validate: the core rules on a draft, nothing stored. */
export function validateDraft(deps: ApiDeps, tenant: TenantRow, draft: InvoiceDraft) {
  const { document } = compute(tenant, draft);
  const issues = validate(document, {
    today: parisToday(deps.now()),
    seller: { vatOnDebits: tenant.vatOnDebits },
  });
  return { valid: !hasErrors(issues), document, issues };
}
