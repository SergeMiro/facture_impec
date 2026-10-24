// What the API returns. Internal columns (drafts, hashes of keys) stay inside.
import type { Issue } from '@fi/core';
import type { ChasePlanRow, InvoiceEventRow, InvoiceRow, TenantRow, VatCheckRow } from '@fi/db';
import { t } from '@fi/shared';
import type { findingView } from './checks';
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
    pdpAccount: row.pdpAccount,
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
    /** 380 invoice, 381 credit note (« avoir »), 386 advance invoice. */
    typeCode: row.document.typeCode ?? '380',
    direction: row.direction,
    status: row.status,
    statusLabel: t(`invoice.status.${row.status}`),
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    currency: row.currency,
    buyerName: row.buyerName,
    /** Cents. */
    payable: row.payable,
    /** Cents received so far (« Encaissée », in instalments or at once). */
    amountPaid: row.amountPaid,
    fingerprint: row.fingerprint,
    pdpRef: row.pdpRef,
    isTest: row.isTest,
    source: row.source,
    excelBinding: row.excelBinding,
    partyId: row.partyId,
    /** Autopilot send (plan §0.2): when it leaves by itself, and whether the user held it. */
    autopilot: { at: row.autopilotAt?.toISOString() ?? null, held: row.autopilotHeld },
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
  /** Open findings of the checks across documents (R2, src/checks.ts). */
  findings?: ReturnType<typeof findingView>[];
  /** A credit note: the invoice it cancels (`of`); an invoice: its credit note (`by`), src/credits.ts. */
  credit?: {
    of: CreditLink | null;
    by: (CreditLink & { status: string; statusLabel: string }) | null;
  };
  /** The customer's EU number outside France and VIES' last answer on it (src/vat-checks.ts). */
  vies?: { vatId: string; answer: VatCheckRow | null } | null;
}

interface CreditLink {
  id: string;
  number: string | null;
  issueDate?: string | null;
}

export function invoiceDetail(
  row: InvoiceRow,
  { issues, events, plan, findings, credit, vies }: DetailData,
) {
  return {
    ...invoiceSummary(row),
    document: row.document,
    issues,
    findings: findings ?? [],
    events: events.map(eventView),
    chase: chaseView(plan),
    nextStep: nextStep(row, events),
    credit: credit ?? { of: null, by: null },
    vies: vies ? { vatId: vies.vatId, answer: vies.answer && viesAnswerView(vies.answer) } : null,
  };
}

/** One answer of VIES as the fiche shows it: what it said, when, with its proof. */
export function viesAnswerView(row: VatCheckRow) {
  return {
    valid: row.valid,
    name: row.name,
    address: row.address,
    requestIdentifier: row.requestIdentifier,
    checkedOn: row.checkedOn,
  };
}
