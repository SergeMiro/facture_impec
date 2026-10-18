// What the API returns. Internal columns (drafts, hashes of keys) stay inside.
import type { Issue } from '@fi/core';
import type { InvoiceEventRow, InvoiceRow, TenantRow } from '@fi/db';
import { t } from '@fi/shared';

export function tenantView(row: TenantRow) {
  return {
    id: row.id,
    name: row.name,
    siren: row.siren,
    vatId: row.vatId,
    address: row.address,
    pdpProvider: row.pdpProvider,
    mode: row.mode,
    sandboxEnabled: row.sandboxEnabled,
    pseudonymizeLlm: row.pseudonymizeLlm,
    vatOnDebits: row.vatOnDebits,
    createdAt: row.createdAt.toISOString(),
  };
}

export function invoiceSummary(row: InvoiceRow) {
  return {
    id: row.id,
    number: row.number,
    direction: row.direction,
    status: row.status,
    statusLabel: t(`invoice.status.${row.status}`),
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    currency: row.currency,
    buyerName: row.buyerName,
    /** Cents. */
    payable: row.payable,
    fingerprint: row.fingerprint,
    pdpRef: row.pdpRef,
    isTest: row.isTest,
    source: row.source,
    excelBinding: row.excelBinding,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function eventView(row: InvoiceEventRow) {
  return {
    at: row.at.toISOString(),
    type: row.type,
    actor: row.actor,
    event: row.event,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    payload: row.payload,
  };
}

export function invoiceDetail(row: InvoiceRow, issues: Issue[], events: InvoiceEventRow[]) {
  return {
    ...invoiceSummary(row),
    document: row.document,
    issues,
    events: events.map(eventView),
  };
}
