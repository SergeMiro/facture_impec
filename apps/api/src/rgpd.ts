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
  billingUsage,
  chasePlans,
  chats,
  checkState,
  connectedFiles,
  connections,
  type Db,
  docLines,
  docs,
  edits,
  eq,
  findings,
  inArray,
  inboundExports,
  inboundQueue,
  invoiceEvents,
  invoices,
  isNull,
  itemSynonyms,
  items,
  layoutProfiles,
  links,
  lt,
  magicLinks,
  or,
  parties,
  paymentReports,
  pdpSubmissions,
  ruleExceptions,
  sessions,
  sheetMappings,
  signupRequests,
  sources,
  sql,
  type TenantRow,
  tenants,
  users,
  validationResults,
  weeklyReports,
} from '@fi/db';
import { z } from 'zod';
import { archiveRegister } from './archive';
import { isOwner, type Principal } from './auth';
import { cancelSubscription } from './billing';
import { chaseView } from './collect';
import { unwatch } from './connectors';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { exportView } from './inbound';
import { partyView } from './parties';
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
  const [
    people,
    keys,
    mappings,
    rows,
    runs,
    log,
    received,
    plans,
    payments,
    reports,
    sent,
    usage,
    customers,
    archive,
    articles,
    documents,
    lines,
    profiles,
    sheets,
    linked,
    found,
    checked,
    corrections,
    conversations,
    accounts,
    picked,
    exceptions,
    synonyms,
  ] = await Promise.all([
    db.select().from(users).where(eq(users.tenantId, tenant.id)).orderBy(asc(users.createdAt)),
    db.select().from(apiKeys).where(eq(apiKeys.tenantId, tenant.id)),
    db.select().from(sheetMappings).where(eq(sheetMappings.tenantId, tenant.id)),
    db
      .select()
      .from(invoices)
      .where(eq(invoices.tenantId, tenant.id))
      .orderBy(asc(invoices.createdAt)),
    db.select().from(agentRuns).where(eq(agentRuns.tenantId, tenant.id)).orderBy(asc(agentRuns.id)),
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
    db
      .select()
      .from(billingUsage)
      .where(eq(billingUsage.tenantId, tenant.id))
      .orderBy(asc(billingUsage.sentAt)),
    db
      .select()
      .from(parties)
      .where(eq(parties.tenantId, tenant.id))
      .orderBy(asc(parties.legalName)),
    archiveRegister(db, tenant.id),
    db.select().from(items).where(eq(items.tenantId, tenant.id)).orderBy(asc(items.key)),
    db
      .select()
      .from(docs)
      .where(eq(docs.tenantId, tenant.id))
      .orderBy(asc(docs.direction), asc(docs.issueDate), asc(docs.number)),
    db
      .select()
      .from(docLines)
      .where(eq(docLines.tenantId, tenant.id))
      .orderBy(asc(docLines.docId), asc(docLines.position)),
    db
      .select()
      .from(layoutProfiles)
      .where(eq(layoutProfiles.tenantId, tenant.id))
      .orderBy(asc(layoutProfiles.createdAt)),
    db
      .select()
      .from(sources)
      .where(eq(sources.tenantId, tenant.id))
      .orderBy(asc(sources.workbookId), asc(sources.sheet)),
    db.select().from(links).where(eq(links.tenantId, tenant.id)).orderBy(asc(links.createdAt)),
    db
      .select()
      .from(findings)
      .where(eq(findings.tenantId, tenant.id))
      .orderBy(asc(findings.firstSeenAt), asc(findings.key)),
    db.select().from(checkState).where(eq(checkState.tenantId, tenant.id)),
    db.select().from(edits).where(eq(edits.tenantId, tenant.id)).orderBy(asc(edits.createdAt)),
    db.select().from(chats).where(eq(chats.tenantId, tenant.id)).orderBy(asc(chats.createdAt)),
    db.select().from(connections).where(eq(connections.tenantId, tenant.id)),
    db
      .select()
      .from(connectedFiles)
      .where(eq(connectedFiles.tenantId, tenant.id))
      .orderBy(asc(connectedFiles.name)),
    db
      .select()
      .from(ruleExceptions)
      .where(eq(ruleExceptions.tenantId, tenant.id))
      .orderBy(asc(ruleExceptions.createdAt)),
    db
      .select()
      .from(itemSynonyms)
      .where(eq(itemSynonyms.tenantId, tenant.id))
      .orderBy(asc(itemSynonyms.createdAt)),
  ]);
  const sheetOf = new Map(sheets.map((s) => [s.id, s.sheet]));
  const itemKeys = new Map(articles.map((a) => [a.id, a.key]));
  const linesOf = new Map<string, typeof lines>();
  for (const l of lines) {
    const list = linesOf.get(l.docId);
    if (list) list.push(l);
    else linesOf.set(l.docId, [l]);
  }
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
    /** The layouts the company confirmed for its other sheets, and the sheets it included. */
    layoutProfiles: profiles.map((p) => ({
      kind: p.kind,
      layout: p.layout,
      version: p.version,
      confirmedAt: p.confirmedAt.toISOString(),
    })),
    includedSheets: sheets.map((s) => ({
      type: s.type,
      workbookId: s.workbookId,
      fileId: s.fileId,
      sheet: s.sheet,
      kind: s.kind,
      layout: s.layout,
      consentedAt: s.consentedAt.toISOString(),
      readAt: s.readAt?.toISOString() ?? null,
      stats: s.stats,
    })),
    /** The Microsoft (R4) and Google (R5) accounts connected to read files, tokens excepted, and their files. */
    connections: accounts.map((c) => ({
      provider: c.provider,
      account: c.label,
      accountKind: c.accountKind,
      status: c.status,
      connectedAt: c.connectedAt.toISOString(),
      checkedAt: c.checkedAt?.toISOString() ?? null,
    })),
    connectedFiles: picked.map((f) => ({
      id: f.id,
      name: f.name,
      sheets: f.sheets,
      problem: f.problem,
      pickedAt: f.pickedAt.toISOString(),
      checkedAt: f.checkedAt?.toISOString() ?? null,
      changedAt: f.changedAt?.toISOString() ?? null,
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
    billingUsage: usage.map((u) => ({
      invoiceId: u.invoiceId,
      month: u.month,
      sentAt: u.sentAt.toISOString(),
      billable: u.billable,
      reportedAt: u.reportedAt?.toISOString() ?? null,
    })),
    accountantExports: sent.map((e) => ({ ...exportView(e), fec: e.fec, csv: e.csv })),
    customers: customers.filter((p) => p.kind === 'customer').map(partyView),
    /** The suppliers of received invoices, as their invoices name them (R3). */
    suppliers: customers
      .filter((p) => p.kind === 'supplier')
      .map((p) => ({
        legalName: p.legalName,
        siren: p.siren,
        address: p.address,
        source: p.source,
        createdAt: p.createdAt.toISOString(),
      })),
    /** The ten-year register; the documents themselves are the invoices above and their XML. */
    archive,
    /**
     * The invoices above, the received ones and the documents of the included sheets, line by line,
     * with the article of each line.
     */
    registry: {
      items: articles.map((a) => ({ key: a.key, name: a.name })),
      documents: documents.map((d) => ({
        id: d.id,
        direction: d.direction,
        kind: d.kind,
        invoiceId: d.invoiceId,
        inboundId: d.inboundId,
        sheet: d.sourceId ? (sheetOf.get(d.sourceId) ?? null) : null,
        sheetKey: d.sourceKey,
        orderRef: d.orderRef,
        isTest: d.isTest,
        typeCode: d.typeCode,
        number: d.number,
        issueDate: d.issueDate,
        partySiren: d.partySiren,
        partyName: d.partyName,
        currency: d.currency,
        netTotal: d.netTotal,
        lines: (linesOf.get(d.id) ?? []).map(({ id, docId, tenantId, itemId, ...line }) => ({
          ...line,
          item: itemId ? (itemKeys.get(itemId) ?? null) : null,
        })),
      })),
      /** R2: which order each invoice bills (documents by `id` above), and who said « Oui » or « Non ». */
      links: linked.map((l) => ({
        kind: l.kind,
        from: l.fromDocId,
        to: l.toDocId,
        score: l.score,
        method: l.method,
        status: l.status,
        decidedAt: l.decidedAt?.toISOString() ?? null,
      })),
      /** What the checks across documents found, open or resolved. */
      findings: found.map((f) => ({
        id: f.id,
        rule: f.rule,
        message: f.message,
        severity: f.severity,
        document: f.docId,
        amount: f.amount,
        params: f.params,
        evidence: f.evidence,
        status: f.status,
        isTest: f.isTest,
        firstSeenAt: f.firstSeenAt.toISOString(),
        resolvedAt: f.resolvedAt?.toISOString() ?? null,
      })),
      checkedAt: checked[0]?.checkedAt.toISOString() ?? null,
      /** R8: the corrections offered in the pane (« Avant → Après ») and what became of each. */
      edits: corrections.map((e) => ({
        finding: e.findingId,
        invoice: e.invoiceId,
        by: e.by,
        sheet: e.sheet,
        cell: e.cell,
        field: e.field,
        before: e.beforeValue,
        beforeFormula: e.beforeFormula,
        after: e.afterValue,
        status: e.status,
        found: e.foundValue,
        reason: e.reason,
        createdAt: e.createdAt.toISOString(),
        appliedAt: e.appliedAt?.toISOString() ?? null,
        revertedAt: e.revertedAt?.toISOString() ?? null,
      })),
      /** R8: the conversations with the assistant, one per finding, as the pane shows them. */
      chats: conversations.map((c) => ({
        finding: c.findingId,
        messages: c.messages,
        updatedAt: c.updatedAt.toISOString(),
      })),
      /** R7: « C'est normal », what a person said a rule may leave quiet, and until when. */
      exceptions: exceptions.map((e) => ({
        rule: e.rule,
        party: e.party,
        partyName: e.partyName,
        item: itemKeys.get(e.itemId) ?? null,
        itemName: e.itemName,
        until: e.until,
        finding: e.findingKey,
        createdBy: e.createdBy,
        createdAt: e.createdAt.toISOString(),
      })),
      /** R7: articles proposed as one, and a person's « Oui » or « Non ». */
      synonyms: synonyms.map((s) => ({
        item: itemKeys.get(s.itemId) ?? null,
        alias: itemKeys.get(s.aliasId) ?? null,
        status: s.status,
        score: s.score,
        decidedAt: s.decidedAt?.toISOString() ?? null,
      })),
    },
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
  // First, so that nothing is charged to a company that no longer exists; if Stripe cannot be
  // reached, nothing is deleted and the owner tries again.
  await cancelSubscription(deps, tenant);
  // Best effort: Graph and Google stop notifying us, Google forgets our token; an unrenewed
  // subscription or channel ends by itself anyway.
  await unwatch(deps, tenant.id);
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
    // The registry is rebuilt from the invoices at any time; nothing reads it once the account is gone.
    // Its links and findings go with it, a person's « Oui » and « Non » too, and the chats and
    // corrections made on them, and what the person taught the checks (R7).
    await tx.delete(ruleExceptions).where(eq(ruleExceptions.tenantId, tenant.id));
    await tx.delete(itemSynonyms).where(eq(itemSynonyms.tenantId, tenant.id));
    await tx.delete(chats).where(eq(chats.tenantId, tenant.id));
    await tx.delete(edits).where(eq(edits.tenantId, tenant.id));
    await tx.delete(findings).where(eq(findings.tenantId, tenant.id));
    await tx.delete(links).where(eq(links.tenantId, tenant.id));
    await tx.delete(checkState).where(eq(checkState.tenantId, tenant.id));
    await tx.delete(docLines).where(eq(docLines.tenantId, tenant.id));
    await tx.delete(docs).where(eq(docs.tenantId, tenant.id));
    await tx.delete(items).where(eq(items.tenantId, tenant.id));
    // The sheets' layouts and consents go with the account; their documents went with the registry.
    await tx.delete(sources).where(eq(sources.tenantId, tenant.id));
    await tx.delete(layoutProfiles).where(eq(layoutProfiles.tenantId, tenant.id));
    // The connected account's token and its picked files (R4).
    await tx.delete(connectedFiles).where(eq(connectedFiles.tenantId, tenant.id));
    await tx.delete(connections).where(eq(connections.tenantId, tenant.id));
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
    await tx.delete(signupRequests).where(eq(signupRequests.tenantId, tenant.id));
    if (userIds.length) await tx.delete(magicLinks).where(inArray(magicLinks.userId, userIds));
    await tx.delete(users).where(eq(users.tenantId, tenant.id));
    await tx.delete(sheetMappings).where(eq(sheetMappings.tenantId, tenant.id));
    // The customer directory holds contacts (an e-mail may name a person); the invoices keep their buyer.
    await tx.delete(parties).where(eq(parties.tenantId, tenant.id));
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
        pdpKeySealed: null,
        pdpKeyHint: null,
        invoiceDefaults: {},
        whiteLabel: null,
        ...(tenant.billingStatus !== 'pilot' && { billingStatus: 'ended' as const }),
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

/** How long an expired link, session or sign-up request stays, for the support's sake. */
export const PURGE_AFTER_MS = 86_400_000;

/**
 * Removes what only served to sign in or sign up once it can no longer be used (docs/RGPD.md):
 * links and sign-up requests a day after they expire, sessions a day after they expire or end. A
 * sign-up request holds an address of someone who may never have become a customer.
 */
export async function purgeExpired(deps: { db: Db; now: () => Date }) {
  const before = new Date(+deps.now() - PURGE_AFTER_MS);
  return deps.db.transaction(async (tx) => {
    const links = await tx
      .delete(magicLinks)
      .where(lt(magicLinks.expiresAt, before))
      .returning({ id: magicLinks.id });
    const signups = await tx
      .delete(signupRequests)
      .where(lt(signupRequests.expiresAt, before))
      .returning({ id: signupRequests.id });
    const ended = await tx
      .delete(sessions)
      .where(or(lt(sessions.expiresAt, before), lt(sessions.revokedAt, before)))
      .returning({ id: sessions.id });
    return { links: links.length, signups: signups.length, sessions: ended.length };
  });
}
