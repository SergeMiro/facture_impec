// RGPD (plan §10, docs/RGPD.md): a tenant takes all its data away, or deletes what the law lets it
// delete. Invoices that reached a platform stay (10 years, Code de commerce L123-22), received ones
// too (they are the company's purchase records) with their accountant exports, and so does the
// append-only audit log, which holds hashes and ids, never names or e-mails.
import {
  agentRuns,
  and,
  apiKeys,
  asc,
  audit,
  auditEvents,
  chasePlans,
  eq,
  inArray,
  inboundExports,
  inboundQueue,
  invoiceEvents,
  invoices,
  isNull,
  magicLinks,
  or,
  paymentReports,
  pdpSubmissions,
  sessions,
  sheetMappings,
  sql,
  type TenantRow,
  tenants,
  users,
  validationResults,
  weeklyReports,
} from '@fi/db';
import { z } from 'zod';
import { isOwner, type Principal } from './auth';
import { chaseView } from './collect';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { exportView } from './inbound';
import { settingsView } from './settings';
import { eventView, invoiceSummary, tenantView } from './views';

export const DeleteBody = z.object({ confirmSiren: z.string().min(1).max(20) });

/** Who made an export that outlives its author's deletion. */
const DELETED_PERSON = 'deleted';

function assertOwner(principal: Principal) {
  if (!isOwner(principal)) throw new ApiError(403, 'owner_only');
}

/** Everything stored about the tenant, secrets excepted (key hashes, the sealed AI key). */
export async function exportTenant(deps: ApiDeps, tenant: TenantRow, principal: Principal) {
  assertOwner(principal);
  const db = deps.db;
  const [people, keys, mappings, rows, runs, log, received, plans, payments, reports, sent] =
    await Promise.all([
      db.select().from(users).where(eq(users.tenantId, tenant.id)).orderBy(asc(users.createdAt)),
      db.select().from(apiKeys).where(eq(apiKeys.tenantId, tenant.id)),
      db.select().from(sheetMappings).where(eq(sheetMappings.tenantId, tenant.id)),
      db
        .select()
        .from(invoices)
        .where(eq(invoices.tenantId, tenant.id))
        .orderBy(asc(invoices.createdAt)),
      db
        .select()
        .from(agentRuns)
        .where(eq(agentRuns.tenantId, tenant.id))
        .orderBy(asc(agentRuns.id)),
      db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.tenantId, tenant.id))
        .orderBy(asc(auditEvents.id)),
      db
        .select()
        .from(inboundQueue)
        .where(eq(inboundQueue.tenantId, tenant.id))
        .orderBy(asc(inboundQueue.receivedAt)),
      db.select().from(chasePlans).where(eq(chasePlans.tenantId, tenant.id)),
      db.select().from(paymentReports).where(eq(paymentReports.tenantId, tenant.id)),
      db
        .select()
        .from(weeklyReports)
        .where(eq(weeklyReports.tenantId, tenant.id))
        .orderBy(asc(weeklyReports.week)),
      db
        .select()
        .from(inboundExports)
        .where(eq(inboundExports.tenantId, tenant.id))
        .orderBy(asc(inboundExports.createdAt)),
    ]);
  const ids = rows.map((r) => r.id);
  const events = ids.length
    ? await db
        .select()
        .from(invoiceEvents)
        .where(inArray(invoiceEvents.invoiceId, ids))
        .orderBy(asc(invoiceEvents.id))
    : [];
  return {
    exportedAt: deps.now().toISOString(),
    tenant: tenantView(tenant),
    settings: settingsView(deps, tenant),
    users: people.map((u) => ({
      email: u.email,
      role: u.role,
      createdAt: u.createdAt.toISOString(),
    })),
    apiKeys: keys.map((k) => ({
      label: k.label,
      createdAt: k.createdAt.toISOString(),
      revokedAt: k.revokedAt?.toISOString() ?? null,
    })),
    sheetMappings: mappings.map((m) => ({
      workbookId: m.workbookId,
      sheet: m.sheet,
      mapping: m.mapping,
      updatedAt: m.updatedAt.toISOString(),
    })),
    invoices: rows.map((r) => ({
      ...invoiceSummary(r),
      document: r.document,
      events: events.filter((e) => e.invoiceId === r.id).map(eventView),
      chase: chaseView(plans.find((p) => p.invoiceId === r.id)),
      payment: (({ amount, paidOn, status, provider }) => ({ amount, paidOn, status, provider }))(
        payments.find((p) => p.invoiceId === r.id) ?? {
          amount: null,
          paidOn: null,
          status: null,
          provider: null,
        },
      ),
    })),
    weeklyReports: reports.map((w) => ({
      week: w.week,
      recipients: w.recipients,
      sentAt: w.sentAt.toISOString(),
    })),
    receivedInvoices: received.map((r) => ({
      provider: r.provider,
      pdpRef: r.pdpRef,
      receivedAt: r.receivedAt.toISOString(),
      status: r.status,
      isTest: r.isTest,
      supplierName: r.supplierName,
      number: r.number,
      issueDate: r.issueDate,
      amount: r.amount,
      currency: r.currency,
      flags: r.triage?.flags ?? null,
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decidedBy: r.decidedBy,
      disputeReason: r.disputeReason,
      exportId: r.exportId,
      xml: r.xml,
    })),
    accountantExports: sent.map((e) => ({ ...exportView(e), fec: e.fec, csv: e.csv })),
    agentRuns: runs.map((r) => ({
      agent: r.agent,
      provider: r.provider,
      model: r.model,
      status: r.status,
      reason: r.reason,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      startedAt: r.startedAt.toISOString(),
    })),
    auditEvents: log.map((a) => ({
      at: a.at.toISOString(),
      actor: a.actor,
      action: a.action,
      objectType: a.objectType,
      objectId: a.objectId,
    })),
  };
}

/**
 * Deletes the people, their sessions, the settings and every invoice that never left (drafts, test
 * invoices); revokes the keys. The tenant row stays, marked deleted, for the invoices the law keeps.
 */
export async function deleteTenant(
  deps: ApiDeps,
  tenant: TenantRow,
  principal: Principal,
  confirmSiren: string,
) {
  assertOwner(principal);
  if (confirmSiren.replace(/\s/g, '') !== tenant.siren) throw new ApiError(400, 'confirm_mismatch');
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    // Never transmitted: no platform reference and no send attempt (a platform may have it).
    const gone = await tx
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenant.id),
          or(
            eq(invoices.isTest, true),
            and(
              isNull(invoices.pdpRef),
              sql`not exists (select 1 from ${pdpSubmissions} where ${pdpSubmissions.invoiceId} = ${invoices.id})`,
            ),
          ),
        ),
      );
    const ids = gone.map((r) => r.id);
    // Chasing drafts quote the customer: no plan outlives the deletion, and the advice notes kept
    // on transmitted invoices lose their drafted reply.
    await tx.delete(chasePlans).where(eq(chasePlans.tenantId, tenant.id));
    await tx
      .update(invoiceEvents)
      .set({ payload: sql`${invoiceEvents.payload} - 'draft'` })
      .where(
        and(
          eq(invoiceEvents.event, 'monitor'),
          sql`${invoiceEvents.invoiceId} in (select id from ${invoices} where ${invoices.tenantId} = ${tenant.id})`,
        ),
      );
    if (ids.length) {
      await tx.delete(paymentReports).where(inArray(paymentReports.invoiceId, ids));
      await tx.delete(validationResults).where(inArray(validationResults.invoiceId, ids));
      await tx.delete(invoiceEvents).where(inArray(invoiceEvents.invoiceId, ids));
      await tx.delete(pdpSubmissions).where(inArray(pdpSubmissions.invoiceId, ids));
      await tx.delete(invoices).where(inArray(invoices.id, ids));
    }
    // Test supplier invoices and their exports go; real ones stay, without who decided on them.
    await tx
      .delete(inboundQueue)
      .where(and(eq(inboundQueue.tenantId, tenant.id), eq(inboundQueue.isTest, true)));
    await tx
      .delete(inboundExports)
      .where(and(eq(inboundExports.tenantId, tenant.id), eq(inboundExports.isTest, true)));
    await tx
      .update(inboundQueue)
      .set({ decidedBy: null })
      .where(eq(inboundQueue.tenantId, tenant.id));
    await tx
      .update(inboundExports)
      .set({ createdBy: DELETED_PERSON })
      .where(eq(inboundExports.tenantId, tenant.id));
    const people = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.tenantId, tenant.id));
    const userIds = people.map((u) => u.id);
    await tx.delete(sessions).where(eq(sessions.tenantId, tenant.id));
    if (userIds.length) await tx.delete(magicLinks).where(inArray(magicLinks.userId, userIds));
    await tx.delete(users).where(eq(users.tenantId, tenant.id));
    await tx.delete(sheetMappings).where(eq(sheetMappings.tenantId, tenant.id));
    await tx.delete(agentRuns).where(eq(agentRuns.tenantId, tenant.id));
    await tx
      .update(apiKeys)
      .set({ revokedAt: now })
      .where(and(eq(apiKeys.tenantId, tenant.id), isNull(apiKeys.revokedAt)));
    await tx
      .update(tenants)
      .set({
        aiSettings: null,
        aiKeySealed: null,
        aiKeyHint: null,
        invoiceDefaults: {},
        deletedAt: now,
      })
      .where(eq(tenants.id, tenant.id));
    const [kept] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(invoices)
      .where(eq(invoices.tenantId, tenant.id));
    const result = {
      deleted: { invoices: ids.length, users: userIds.length },
      keptInvoices: kept?.n ?? 0,
    };
    await audit(tx, {
      tenantId: tenant.id,
      actor: principal.kind === 'session' ? `user:${principal.userId}` : 'user',
      action: 'tenant.delete',
      objectType: 'tenant',
      objectId: tenant.id,
      after: result,
    });
    return result;
  });
}
