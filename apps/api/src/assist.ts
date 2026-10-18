// The fiche facture's help (plan §5 screen 4, §6 phases 4–5): ExplainAgent on the invoice's issues,
// the TestAgent rehearsal, the XML and the PDF. None of it changes the invoice.
import { explainDegradedNote, explainIssues, type RehearsalChecks, rehearse } from '@fi/agents';
import {
  cellForPath,
  type Invoice,
  type Issue,
  parseInvoiceXml,
  toCii,
  transition,
} from '@fi/core';
import { readFacturXPdf, toFacturXPdf } from '@fi/core/pdf';
import { audit, type InvoiceRow, invoiceEvents, sha256, type TenantRow } from '@fi/db';
import { eventFor } from '@fi/pdp-adapter';
import { t } from '@fi/shared';
import { tenantAi } from './ai';
import type { ApiDeps } from './deps';
import { invoiceDetailData } from './invoices';
import { routeFor } from './platform';
import { injectScenario } from './sandbox';

/** Rules behind the mentions obligatoires the rehearsal lists (docs/RULES.md). */
export const MENTION_RULES: ReadonlySet<string> = new Set([
  'BR-FR-05',
  'BR-FR-06',
  'BR-FR-08',
  'BR-FR-11',
  'FF-CAT-01',
  'FF-DEB-01',
  'FF-DUE-01',
  'FF-PMD-01',
]);

const cellsOf = (row: InvoiceRow) => row.excelBinding?.cells ?? {};

export async function explainInvoice(
  deps: ApiDeps,
  tenant: TenantRow,
  row: InvoiceRow,
  signal?: AbortSignal,
) {
  const { issues } = await invoiceDetailData(deps, row);
  const cells = cellsOf(row);
  const result = await explainIssues(row.document, issues, {
    tenantId: tenant.id,
    invoiceId: row.id,
    ai: tenantAi(deps.ai, tenant),
    orchestrator: deps.ai.orchestrator,
    cellFor: (path) => cellForPath(cells, path) ?? null,
    ...(signal && { signal }),
  });
  return {
    explanations: result.explanations,
    degraded: result.degraded,
    note: result.degraded ? explainDegradedNote(result.degraded) : null,
  };
}

export const invoicePdf = (deps: ApiDeps, document: Invoice) =>
  toFacturXPdf(document, { fonts: deps.fonts, now: deps.now() });

const errorsOf = (issues: readonly Issue[]) => issues.filter((i) => i.severity === 'error');

/** The rehearsal's checks for one invoice (plan §6 TestAgent): facts the code establishes. */
export function rehearsalChecks(
  deps: ApiDeps,
  tenant: TenantRow,
  row: InvoiceRow,
  issues: readonly Issue[],
): RehearsalChecks {
  const document = row.document;
  const xml = toCii(document);
  return {
    valid: async () => {
      const errors = errorsOf(issues);
      return errors.length === 0
        ? { ok: true }
        : { ok: false, detail: t('rehearsal.detail.errors', { count: errors.length }) };
    },
    xml: async () => {
      const parsed = parseInvoiceXml(xml);
      const lost = errorsOf(parsed.issues);
      return lost.length === 0 && parsed.invoice.number === document.number
        ? { ok: true }
        : { ok: false, detail: t('rehearsal.detail.technical') };
    },
    pdf: async () => {
      const content = await readFacturXPdf(await invoicePdf(deps, document));
      return content.xml === xml
        ? { ok: true }
        : { ok: false, detail: t('rehearsal.detail.technical') };
    },
    directory: async () => {
      const siren = document.buyer.legalId?.id;
      if (!siren) return { ok: false, detail: t('rehearsal.detail.noSiren') };
      const route = routeFor(deps, tenant, row.isTest);
      if (!route?.adapter) return { ok: false, detail: t('rehearsal.detail.noPlatform') };
      const found = await route.adapter.lookupRecipient({ account: route.account, siren });
      return found ? { ok: true } : { ok: false, detail: t('rehearsal.detail.notFound') };
    },
    mentions: async () => {
      const missing = issues.filter((i) => MENTION_RULES.has(i.ruleId));
      const first = missing[0];
      return first
        ? {
            ok: false,
            detail: t('rehearsal.detail.missingMentions', {
              count: missing.length,
              first: first.messageFr,
            }),
          }
        : { ok: true };
    },
    rejection: async () => {
      // A copy goes to the test platform, which rejects it on request: the answer must come back
      // through the adapter and land where the state machine puts a rejected invoice.
      const route = routeFor(deps, tenant, true);
      if (!deps.test || !route?.adapter) {
        return { ok: false, detail: t('rehearsal.detail.noTestPlatform') };
      }
      const stamp = deps.now().getTime().toString(36).toUpperCase();
      const copy = { ...document, number: `TEST-R${stamp}-${document.number ?? ''}`.slice(0, 35) };
      const sent = await route.adapter.sendInvoice({
        account: route.account,
        xml: toCii(copy),
        format: 'CII',
        idempotencyKey: sha256(`rehearsal\u0000${row.id}\u0000${stamp}`),
      });
      if (sent.outcome === 'rejected') {
        const first = sent.errors[0]?.message ?? '';
        return { ok: false, detail: t('rehearsal.detail.platformRefused', { first }) };
      }
      const reason = { code: 'REHEARSAL', text: t('scenario.reason.rehearsal') };
      const played = await injectScenario(deps, route, sent.pdpRef, [
        { status: 'rejected', reason },
      ]);
      const last = played
        ? (await route.adapter.getStatus({ account: route.account, pdpRef: sent.pdpRef })).at(-1)
        : { status: 'rejected' as const, reason };
      const event = last ? eventFor(last.status) : null;
      const moved = event ? transition('deposited', event, 'pdp') : null;
      return moved?.ok && moved.to === 'rejected_by_pdp' && last?.reason?.text === reason.text
        ? { ok: true }
        : { ok: false, detail: t('rehearsal.detail.technical') };
    },
  };
}

/** « Lancer la répétition »: an agent_runs row, a timeline note and an audit event; no status change. */
export async function rehearseInvoice(deps: ApiDeps, tenant: TenantRow, row: InvoiceRow) {
  const startedAt = deps.now().toISOString();
  const { issues } = await invoiceDetailData(deps, row);
  const result = await rehearse(rehearsalChecks(deps, tenant, row, issues));
  const failed = result.checklist.filter((c) => !c.ok).map((c) => c.item);
  await deps.ai.store.record({
    tenantId: tenant.id,
    invoiceId: row.id,
    agent: 'test',
    provider: 'none',
    model: 'deterministic',
    promptHash: '-',
    status: 'ok',
    reason: null,
    attempts: 1,
    inputTokens: 0,
    outputTokens: 0,
    error: null,
    startedAt,
    finishedAt: deps.now().toISOString(),
  });
  await deps.db.transaction(async (tx) => {
    await tx.insert(invoiceEvents).values({
      invoiceId: row.id,
      type: 'note',
      actor: 'agent:test',
      event: 'rehearsal',
      payload: { ready: result.ready, failed },
    });
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'agent:test',
      action: 'invoice.rehearse',
      objectType: 'invoice',
      objectId: row.id,
      after: { ready: result.ready, failed, fingerprint: row.fingerprint },
    });
  });
  return result;
}
