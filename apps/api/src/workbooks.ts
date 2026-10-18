// The add-in's sheet (plan §5 Détection and Tableau de bord): the agent proposes a mapping, the user
// confirms it, then every sync turns the sheet's rows into invoices and answers one status per row
// for the FI_Statut / FI_Détail columns. A row the server refuses never stops the others.
import { proposeMapping } from '@fi/agents';
import {
  type InvoiceDraft,
  type Issue,
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
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { createInvoice, EDITABLE, invoiceDetailData, updateInvoice } from './invoices';
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
export function statusDetail(row: InvoiceRow, issues: readonly Issue[], extra: string[] = []) {
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

async function rowStatus(
  deps: ApiDeps,
  row: InvoiceRow,
  sheetInvoice: SheetInvoice,
): Promise<RowStatus> {
  const { issues } = await invoiceDetailData(deps, row);
  const problems = sheetInvoice.problems.map((p) => p.messageFr);
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

async function findBound(deps: ApiDeps, tenant: TenantRow, binding: ExcelBinding, isTest: boolean) {
  const [row] = await deps.db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenant.id),
        eq(invoices.isTest, isTest),
        ne(invoices.status, 'cancelled'),
        sql`${invoices.excelBinding}->>'workbookId' = ${binding.workbookId}`,
        sql`${invoices.excelBinding}->>'sheet' = ${binding.sheet}`,
        sql`${invoices.excelBinding}->>'rowKey' = ${binding.rowKey}`,
      ),
    );
  return row;
}

/** The invoice behind one group of rows: created, updated, or left alone once it has left. */
async function upsert(
  deps: ApiDeps,
  tenant: TenantRow,
  draft: InvoiceDraft,
  binding: ExcelBinding,
  isTest: boolean,
): Promise<InvoiceRow> {
  const found = await findBound(deps, tenant, binding, isTest);
  if (!found) {
    return (await createInvoice(deps, tenant, { draft, excelBinding: binding, isTest })).row;
  }
  // Already on its way: the sheet may change, the invoice the customer has does not.
  if (!EDITABLE.includes(found.status)) return found;
  return (await updateInvoice(deps, tenant, found.id, { draft, excelBinding: binding })).row;
}

export async function syncSheet(
  deps: ApiDeps,
  tenant: TenantRow,
  workbookId: string,
  input: z.infer<typeof SyncBody>,
): Promise<SyncResult> {
  if (input.test) assertTestMode(deps, tenant);
  const reading = readSheet(input.snapshot, input.mapping, {
    name: tenant.name,
    siren: tenant.siren,
    vatId: tenant.vatId,
    address: tenant.address,
    defaults: tenant.invoiceDefaults,
  });
  const rows: RowStatus[] = [];
  for (const sheetInvoice of reading.invoices) {
    const binding: ExcelBinding = {
      workbookId,
      sheet: input.snapshot.sheet,
      rowKey: sheetInvoice.rowKey,
      rows: sheetInvoice.rows,
      cells: sheetInvoice.cells,
    };
    try {
      const row = await upsert(deps, tenant, sheetInvoice.draft, binding, input.test);
      rows.push(await rowStatus(deps, row, sheetInvoice));
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      rows.push({
        rowKey: sheetInvoice.rowKey,
        rows: sheetInvoice.rows,
        invoiceId: null,
        number: sheetInvoice.draft.number ?? null,
        isTest: input.test,
        status: null,
        label: t('sheet.status.refused'),
        detail: e.body.error.message,
        tone: 'error',
        errors: 1,
        warnings: 0,
      });
    }
  }
  return { sheet: input.snapshot.sheet, test: input.test, rows, ignoredRows: reading.ignoredRows };
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
