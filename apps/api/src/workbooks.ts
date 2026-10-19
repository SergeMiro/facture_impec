// The add-in's sheet (plan §5 Détection and Tableau de bord): the agent proposes a mapping, the user
// confirms it, then every sync turns the sheet's rows into invoices and answers one status per row
// for the FI_Statut / FI_Détail columns. A row the server refuses never stops the others.
//
// The pane syncs 1.5 s after every change, so a sync must cost what changed, not what the sheet holds:
// the sheet's invoices are read in one query and matched in memory, an invoice is written only when it
// changed, and checked again only when something its verdict depends on did (src/invoices.ts checkOf).
import { proposeMapping } from '@fi/agents';
import {
  type HistoryEntry,
  type Issue,
  NumberingHistory,
  readSheet,
  type SheetInvoice,
  SheetMapping,
  SheetSnapshot,
} from '@fi/core';
import {
  and,
  audit,
  type ExcelBinding,
  eq,
  type InvoiceRow,
  invoices,
  ne,
  sheetMappings,
  sql,
  type TenantRow,
} from '@fi/db';
import { t } from '@fi/shared';
import { z } from 'zod';
import { tenantAi } from './ai';
import { autopilotNote, planAutopilot } from './autopilot';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import {
  type Computed,
  cancelInvoice,
  checkOf,
  compute,
  createInvoice,
  EDITABLE,
  latestIssues,
  loadHistory,
  rememberChecks,
  type SheetBound,
  saveSheetInvoice,
  testDraft,
} from './invoices';
import { type Enriched, filledNote, PartyBook } from './parties';
import { routeFor } from './platform';

/** Rows one request may carry; a bigger sheet is read in parts (docs/DEFERRED.md). */
export const MAX_ROWS = 5_000;

export const Snapshot = SheetSnapshot.refine((s) => s.rows.length <= MAX_ROWS, {
  message: `at most ${MAX_ROWS} rows`,
});
export const WorkbookId = z.string().regex(/^[\w-]{8,64}$/);
export const SyncBody = z.object({
  snapshot: Snapshot,
  mapping: SheetMapping,
  test: z.boolean().default(false),
});

/** What the add-in writes in FI_Statut and FI_Détail, and how it colours the status cell. */
export type Tone = 'ok' | 'warning' | 'error' | 'progress' | 'neutral';

export interface RowStatus {
  rowKey: string;
  rows: number[];
  invoiceId: string | null;
  number: string | null;
  isTest: boolean;
  status: InvoiceRow['status'] | null;
  label: string;
  detail: string;
  tone: Tone;
  errors: number;
  warnings: number;
}

export interface SyncResult {
  sheet: string;
  test: boolean;
  rows: RowStatus[];
  ignoredRows: number[];
}

const TONES: Partial<Record<InvoiceRow['status'], Tone>> = {
  draft: 'neutral',
  needs_fix: 'error',
  validated: 'ok',
  ready_to_send: 'progress',
  sending: 'progress',
  deposited: 'progress',
  delivered: 'progress',
  accepted: 'ok',
  paid: 'ok',
  rejected_by_pdp: 'error',
  refused_by_customer: 'error',
  disputed: 'warning',
  overdue: 'warning',
  chasing: 'warning',
};

/** One line for FI_Détail: the first thing to do, then how many more. */
export function statusDetail(
  row: Pick<InvoiceRow, 'status'>,
  issues: readonly Issue[],
  extra: string[] = [],
) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  let detail: string;
  if (row.status === 'needs_fix' && errors[0]) {
    detail = t('sheet.detail.errors', { count: errors.length, first: errors[0].messageFr });
  } else if (row.status === 'validated') {
    detail = warnings[0]
      ? t('sheet.detail.warnings', { count: warnings.length, first: warnings[0].messageFr })
      : t('sheet.detail.ready');
  } else if (EDITABLE.includes(row.status)) {
    detail = t('sheet.detail.draft');
  } else {
    detail = t('sheet.detail.locked');
  }
  return {
    detail: [detail, ...extra].join(' '),
    errors: errors.length,
    warnings: warnings.length,
  };
}

type Shown = Pick<InvoiceRow, 'id' | 'number' | 'isTest' | 'status' | 'autopilotAt'>;

function rowStatus(
  row: Shown,
  sheetInvoice: SheetInvoice,
  issues: readonly Issue[],
  notes: string[] = [],
): RowStatus {
  const planned = autopilotNote(row);
  const problems = [
    ...sheetInvoice.problems.map((p) => p.messageFr),
    ...notes,
    ...(planned ? [planned] : []),
  ];
  return {
    rowKey: sheetInvoice.rowKey,
    rows: sheetInvoice.rows,
    invoiceId: row.id,
    number: row.number,
    isTest: row.isTest,
    status: row.status,
    label: t(`invoice.status.${row.status}`),
    tone: TONES[row.status] ?? 'neutral',
    ...statusDetail(row, issues, problems),
  };
}

function refusedStatus(row: SheetRow, isTest: boolean, e: ApiError): RowStatus {
  return {
    rowKey: row.sheetInvoice.rowKey,
    rows: row.sheetInvoice.rows,
    invoiceId: null,
    number: row.sheetInvoice.draft.number ?? null,
    isTest,
    status: null,
    label: t('sheet.status.refused'),
    detail: e.body.error.message,
    tone: 'error',
    errors: 1,
    warnings: 0,
  };
}

/** The invoices this sheet made that are still alive, light: no document, no XML. */
async function boundInvoices(
  deps: ApiDeps,
  tenant: TenantRow,
  workbookId: string,
  sheet: string,
  isTest: boolean,
): Promise<SheetBound[]> {
  return deps.db
    .select({
      id: invoices.id,
      status: invoices.status,
      number: invoices.number,
      isTest: invoices.isTest,
      fingerprint: invoices.fingerprint,
      partyId: invoices.partyId,
      excelBinding: invoices.excelBinding,
      validatedKey: invoices.validatedKey,
      autopilotAt: invoices.autopilotAt,
      autopilotHeld: invoices.autopilotHeld,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenant.id),
        eq(invoices.isTest, isTest),
        ne(invoices.status, 'cancelled'),
        sql`${invoices.excelBinding}->>'workbookId' = ${workbookId}`,
        sql`${invoices.excelBinding}->>'sheet' = ${sheet}`,
      ),
    );
}

/** One group of rows, as the invoice it would be; `refused` when the server cannot take it. */
interface SheetRow {
  sheetInvoice: SheetInvoice;
  binding: ExcelBinding;
  enriched: Enriched;
  computed?: Computed;
  refused?: ApiError;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/**
 * Which stored invoice each group of rows is. In order: its own key with the same content; the same
 * content under another key (rows inserted or deleted above an invoice without a number, whose key is
 * its row); its own key (the invoice was edited); the same rows (its number was edited). What is left
 * is a new invoice.
 */
function matchRows(rows: readonly SheetRow[], bound: readonly SheetBound[]) {
  const result: (SheetBound | undefined)[] = rows.map(() => undefined);
  const free = new Set(bound);
  const byKey = new Map<string, SheetBound[]>();
  const byContent = new Map<string, SheetBound[]>();
  const byRows = new Map<string, SheetBound[]>();
  for (const b of bound) {
    push(byKey, b.excelBinding?.rowKey ?? '', b);
    push(byContent, b.fingerprint, b);
    push(byRows, (b.excelBinding?.rows ?? []).join(','), b);
  }
  const take = (
    i: number,
    among: readonly SheetBound[] | undefined,
    fits = (_: SheetBound) => true,
  ) => {
    if (result[i]) return;
    const found = among?.find((b) => free.has(b) && fits(b));
    if (!found) return;
    result[i] = found;
    free.delete(found);
  };
  const content = (r: SheetRow) => r.computed?.fingerprint ?? '';
  rows.forEach((r, i) => {
    take(i, byKey.get(r.binding.rowKey), (b) => b.fingerprint === content(r));
  });
  rows.forEach((r, i) => {
    if (r.computed) take(i, byContent.get(content(r)));
  });
  rows.forEach((r, i) => {
    take(i, byKey.get(r.binding.rowKey));
  });
  rows.forEach((r, i) => {
    take(i, byRows.get(r.sheetInvoice.rows.join(',')));
  });
  return { matched: result, left: [...free] };
}

/** The numbers issued as they will be once this sync is written: the sheet's own, then the others. */
function historyOf(
  stored: readonly HistoryEntry[],
  rows: readonly SheetRow[],
  matched: readonly (SheetBound | undefined)[],
  removed: ReadonlySet<string>,
  tenant: TenantRow,
) {
  const entries = new Map(stored.map((e) => [e.id, e]));
  for (const id of removed) entries.delete(id);
  rows.forEach((r, i) => {
    const target = matched[i];
    if (target && !EDITABLE.includes(target.status)) return;
    if (!r.computed) return;
    const id = target?.id ?? `new:${i}`;
    const { number, issueDate } = r.computed.document;
    if (number && issueDate) entries.set(id, { id, number, issueDate, sellerSiren: tenant.siren });
    else entries.delete(id);
  });
  return new NumberingHistory(entries.values());
}

export async function syncSheet(
  deps: ApiDeps,
  tenant: TenantRow,
  workbookId: string,
  input: z.infer<typeof SyncBody>,
): Promise<SyncResult> {
  if (input.test) assertTestMode(deps, tenant);
  const isTest = input.test;
  const sheet = input.snapshot.sheet;
  const reading = readSheet(input.snapshot, input.mapping, {
    name: tenant.name,
    siren: tenant.siren,
    vatId: tenant.vatId,
    address: tenant.address,
    defaults: tenant.invoiceDefaults,
  });
  const book = await PartyBook.load(deps.db, tenant.id);
  const bound = await boundInvoices(deps, tenant, workbookId, sheet, isTest);

  const rows = reading.invoices.map((sheetInvoice): SheetRow => {
    const binding: ExcelBinding = {
      workbookId,
      sheet,
      rowKey: sheetInvoice.rowKey,
      rows: sheetInvoice.rows,
      cells: sheetInvoice.cells,
    };
    const enriched = book.enrich(sheetInvoice.draft);
    try {
      const computed = compute(tenant, isTest ? testDraft(enriched.draft) : enriched.draft);
      return { sheetInvoice, binding, enriched, computed };
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      return { sheetInvoice, binding, enriched, refused: e };
    }
  });
  const { matched, left } = matchRows(rows, bound);
  // Rows gone from the sheet: their invoice goes too, unless it has already left.
  const removed = left.filter((b) => EDITABLE.includes(b.status));
  const history = historyOf(
    await loadHistory(deps.db, tenant, isTest),
    rows,
    matched,
    new Set(removed.map((b) => b.id)),
    tenant,
  );
  const known = matched.filter((b): b is SheetBound => b !== undefined);
  const last = await latestIssues(
    deps.db,
    known.map((b) => b.id),
  );

  const now = deps.now();
  const statuses: RowStatus[] = [];
  const checked: { id: string; fingerprint: string; key: string }[] = [];
  const unknown: { at: number; row: SheetRow; shown: Shown; notes: string[] }[] = [];
  // An invoice created, written or cancelled: the registry follows (src/registry.ts).
  let changed = removed.length > 0;
  for (const [i, row] of rows.entries()) {
    const target = matched[i];
    try {
      // Already on its way: the sheet may change, the invoice the customer has does not.
      if (target && !EDITABLE.includes(target.status)) {
        statuses.push(rowStatus(target, row.sheetInvoice, last.get(target.id) ?? []));
        continue;
      }
      if (row.refused || !row.computed) throw row.refused ?? new ApiError(500, 'internal');
      const note = filledNote(row.enriched.filled);
      const notes = note ? [note] : [];
      if (!target) {
        const created = await createInvoice(deps, tenant, {
          draft: row.sheetInvoice.draft,
          excelBinding: row.binding,
          isTest,
          parties: book,
          history: { index: history, self: `new:${i}` },
        });
        changed = true;
        if (created.issues) {
          statuses.push(rowStatus(created.row, row.sheetInvoice, created.issues, notes));
        } else {
          unknown.push({ at: statuses.length, row, shown: created.row, notes });
          statuses.push(rowStatus(created.row, row.sheetInvoice, [], notes));
        }
        continue;
      }
      const check = checkOf(tenant, row.computed, history, row.enriched.party, now, target.id);
      const saved = await saveSheetInvoice(deps, tenant, target, {
        computed: row.computed,
        partyId: row.enriched.partyId,
        excelBinding: row.binding,
        check,
        last: last.get(target.id),
      });
      if (saved.kind === 'saved') {
        changed = true;
        const issues = saved.issues ?? last.get(target.id) ?? [];
        statuses.push(rowStatus(saved.row, row.sheetInvoice, issues, notes));
        continue;
      }
      if (saved.kind === 'checked') {
        checked.push({ id: target.id, fingerprint: target.fingerprint, key: saved.key });
      }
      const issues = saved.kind === 'checked' ? saved.issues : (last.get(target.id) ?? []);
      statuses.push(
        rowStatus(await planned(deps, tenant, target), row.sheetInvoice, issues, notes),
      );
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      statuses.push(refusedStatus(row, isTest, e));
    }
  }
  await rememberChecks(deps.db, checked);
  for (const b of removed) {
    await cancelInvoice(deps, tenant, b.id, 'row_removed').catch((e: unknown) => {
      // Sent meanwhile, or a send whose answer was lost: it stays, the sweep finds out.
      if (!(e instanceof ApiError)) throw e;
    });
  }
  if (changed) await deps.jobs.enqueueRegistry(tenant.id);
  if (unknown.length > 0) {
    const found = await latestIssues(
      deps.db,
      unknown.map((u) => u.shown.id),
    );
    for (const u of unknown) {
      const issues = found.get(u.shown.id) ?? [];
      statuses[u.at] = rowStatus(u.shown, u.row.sheetInvoice, issues, u.notes);
    }
  }
  return { sheet, test: isTest, rows: statuses, ignoredRows: reading.ignoredRows };
}

/**
 * An unchanged invoice the autopilot may take now: a first invoice to its customer was delivered
 * since, or the customer was opted in while the pane was closed. Reads only, unless it plans one.
 */
async function planned(deps: ApiDeps, tenant: TenantRow, row: SheetBound): Promise<Shown> {
  const candidate =
    tenant.mode === 'autopilot' &&
    row.status === 'validated' &&
    !row.autopilotAt &&
    !row.autopilotHeld &&
    row.partyId !== null;
  if (!candidate) return row;
  const now = deps.now();
  await deps.db.transaction((tx) => planAutopilot(tx, now, tenant, row.id));
  const [after] = await deps.db
    .select({ autopilotAt: invoices.autopilotAt })
    .from(invoices)
    .where(eq(invoices.id, row.id));
  return { ...row, autopilotAt: after?.autopilotAt ?? null };
}

/** « Mode test » needs the tenant's consent (sandbox_enabled) and a test platform. */
export function assertTestMode(deps: ApiDeps, tenant: TenantRow): void {
  if (!tenant.sandboxEnabled) throw new ApiError(403, 'test_mode_disabled');
  if (!routeFor(deps, tenant, true)?.adapter) throw new ApiError(409, 'test_platform_missing');
}

export async function detect(
  deps: ApiDeps,
  tenant: TenantRow,
  snapshot: SheetSnapshot,
  signal?: AbortSignal,
) {
  const { mapping, degraded } = await proposeMapping(snapshot, {
    tenantId: tenant.id,
    ai: tenantAi(deps.ai, tenant),
    orchestrator: deps.ai.orchestrator,
    ...(signal && { signal }),
  });
  return { mapping, degraded };
}

export async function getMapping(
  deps: ApiDeps,
  tenant: TenantRow,
  workbookId: string,
  sheet: string,
) {
  const [row] = await deps.db
    .select()
    .from(sheetMappings)
    .where(
      and(
        eq(sheetMappings.tenantId, tenant.id),
        eq(sheetMappings.workbookId, workbookId),
        eq(sheetMappings.sheet, sheet),
      ),
    );
  if (!row) throw new ApiError(404, 'mapping_not_found');
  return { mapping: row.mapping, updatedAt: row.updatedAt.toISOString() };
}

export async function saveMapping(
  deps: ApiDeps,
  tenant: TenantRow,
  workbookId: string,
  mapping: SheetMapping,
) {
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(sheetMappings)
      .values({ tenantId: tenant.id, workbookId, sheet: mapping.sheet, mapping, updatedAt: now })
      .onConflictDoUpdate({
        target: [sheetMappings.tenantId, sheetMappings.workbookId, sheetMappings.sheet],
        set: { mapping, updatedAt: now },
      })
      .returning();
    if (!row) throw new Error('upsert returned nothing');
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'mapping.save',
      objectType: 'sheet_mapping',
      objectId: row.id,
      after: mapping,
    });
    return { mapping: row.mapping, updatedAt: row.updatedAt.toISOString() };
  });
}
