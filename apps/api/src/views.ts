// What the API returns. Internal columns (drafts, hashes of keys) stay inside.
import type { Issue } from '@fi/core';
import type { ChasePlanRow, InvoiceEventRow, InvoiceRow, TenantRow } from '@fi/db';
import { t } from '@fi/shared';
import { chaseView } from './collect';
import { ADVISED } from './monitor';

export function tenantView(row: TenantRow) {
  return {
    id: row.id,
    name: row.name,
    siren: row.siren,
    vatId: row.vatId,
    address: row.address,
    pdpProvider: row.pdpProvider,
    mode: row.mode,
    autopilotMaxAmount: row.autopilotMaxAmount,
    sandboxEnabled: row.sandboxEnabled,
    pseudonymizeLlm: row.pseudonymizeLlm,
    vatOnDebits: row.vatOnDebits,
    liveAt: row.liveAt?.toISOString() ?? null,
    whiteLabel: row.whiteLabel,
    billing: {
      status: row.billingStatus,
      plan: row.plan,
      interval: row.billingInterval,
      trialEndsAt: row.trialEndsAt?.toISOString() ?? null,
      periodEnd: row.billingPeriodEnd?.toISOString() ?? null,
    },
    terms: row.termsVersion
      ? { version: row.termsVersion, acceptedAt: row.termsAcceptedAt?.toISOString() ?? null }
      : null,
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

/** The MonitorAgent's advice on the latest rejection or refusal, while it is still open. */
function nextStep(row: InvoiceRow, events: InvoiceEventRow[]) {
  if (![...ADVISED, 'disputed'].includes(row.status)) return null;
  const last = events.findLast(
    (e) => e.type === 'transition' && (ADVISED as readonly string[]).includes(e.toStatus ?? ''),
  );
  const advice =
    last &&
    events.findLast((e) => e.type === 'note' && e.event === 'monitor' && e.payload.for === last.id);
  return advice ? advice.payload : null;
}

export interface DetailData {
  issues: Issue[];
  events: InvoiceEventRow[];
  plan?: ChasePlanRow | undefined;
}

export function invoiceDetail(row: InvoiceRow, { issues, events, plan }: DetailData) {
  return {
    ...invoiceSummary(row),
    document: row.document,
    issues,
    events: events.map(eventView),
    chase: chaseView(plan),
    nextStep: nextStep(row, events),
  };
}
