// Checks across documents (R2): the Linker and the Checker (core src/checks) read the company's
// registry, and this writes what they found. It runs after each registry refresh (the registry job),
// before « Envoyer » and before the autopilot sends. Links a person confirmed or rejected stay; the
// others are found again each time. A finding keeps its row from one run to the next by its key: open
// while it is found, resolved when it is not, open again when it comes back. A blocking finding on an
// invoice holds it: « Envoyer » asks « Envoyer quand même », the autopilot does not send it.
import {
  type CheckDoc,
  type CheckLine,
  checkRegistry,
  type Evidence,
  type LinkDecision,
  linkId,
  parisToday,
} from '@fi/core';
import {
  and,
  asc,
  audit,
  checkState,
  type Db,
  type DbOrTx,
  docLines,
  docs,
  eq,
  type FindingRow,
  findings,
  hashOf,
  inArray,
  invoiceEvents,
  invoices,
  links,
  rows,
  type SQL,
  sources,
  sql,
  type TenantRow,
  type Tx,
  tenants,
} from '@fi/db';
import { t } from '@fi/shared';
import { planAutopilot } from './autopilot';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { EDITABLE } from './invoices';
import { refreshRegistry } from './registry';

/**
 * What the registry looked like: its documents, each with the version it was read from and the
 * status of its invoice (one sent is no longer the one a finding goes on).
 */
const markOf = sql<string>`count(d.id)::text || ':'
  || coalesce(sum(hashtext(d.id::text || d.source_version || coalesce(i.status, '')))::text, '')`;
/** And what the company set that the rules read: its margin (B2). */
const settingsMark = (margin: SQL) => sql<string>`'|' || coalesce(${margin}::text, '')`;

async function markNow(db: DbOrTx, tenantId: string): Promise<string> {
  const margin = sql`(select t.min_margin_percent from ${tenants} t where t.id = ${tenantId})`;
  const [found] = await rows<{ mark: string }>(
    db,
    sql`select ${markOf} || ${settingsMark(margin)} as mark
          from ${docs} d left join ${invoices} i on i.id = d.invoice_id
         where d.tenant_id = ${tenantId}`,
  );
  return found?.mark ?? '';
}

/** The registry as the core reads it, with the cells of each invoice's sheet. */
async function loadDocs(tx: Tx, tenantId: string): Promise<CheckDoc[]> {
  const found = await tx
    .select({
      doc: docs,
      sheet: sources.sheet,
      status: invoices.status,
      binding: invoices.excelBinding,
    })
    .from(docs)
    .leftJoin(sources, eq(sources.id, docs.sourceId))
    .leftJoin(invoices, eq(invoices.id, docs.invoiceId))
    .where(eq(docs.tenantId, tenantId));
  const lines = await tx
    .select()
    .from(docLines)
    .where(eq(docLines.tenantId, tenantId))
    .orderBy(asc(docLines.docId), asc(docLines.position));
  const linesOf = new Map<string, (typeof lines)[number][]>();
  for (const l of lines) linesOf.set(l.docId, [...(linesOf.get(l.docId) ?? []), l]);
  return found.map(({ doc, sheet, status, binding }) => {
    const cells = binding?.cells ?? {};
    return {
      id: doc.id,
      direction: doc.direction,
      kind: doc.kind,
      typeCode: doc.typeCode,
      currency: doc.currency,
      isTest: doc.isTest,
      number: doc.number,
      issueDate: doc.issueDate,
      partySiren: doc.partySiren,
      partyName: doc.partyName,
      orderRef: doc.orderRef,
      netTotal: doc.netTotal,
      prepaid: doc.prepaid,
      invoiceId: doc.invoiceId,
      locked: status !== null && !EDITABLE.includes(status),
      sheet: sheet ?? binding?.sheet ?? null,
      lines: (linesOf.get(doc.id) ?? []).map(
        (l): CheckLine => ({
          position: l.position,
          itemId: l.itemId,
          name: l.name,
          quantity: l.quantity,
          netPrice: l.netPrice,
          netAmount: l.netAmount,
          discount: l.discount,
          vatRate: l.vatRate,
          unitCode: l.unitCode,
          cell: l.cell,
          priceCell: cells[`lines[${l.position}].price.net`] ?? null,
          rateCell: cells[`lines[${l.position}].vat.rate`] ?? null,
        }),
      ),
      ...(binding?.checks && { sheetChecks: binding.checks }),
    };
  });
}

/** The invoices an open blocking finding holds. */
async function heldInvoices(tx: Tx, tenantId: string): Promise<Set<string>> {
  const held = await tx
    .selectDistinct({ id: findings.invoiceId })
    .from(findings)
    .where(
      and(
        eq(findings.tenantId, tenantId),
        eq(findings.status, 'open'),
        eq(findings.severity, 'blocking'),
      ),
    );
  return new Set(held.flatMap((h) => (h.id ? [h.id] : [])));
}

export interface CheckRun {
  /** Findings opened, changed or resolved. */
  changed: number;
  open: number;
}

/**
 * Checks the company's registry as it is and writes the links and findings, in one transaction. Runs
 * whether or not the registry moved: a person's « Oui » or « Non » on a link changes what is found.
 */
export async function runChecks(db: Db, tenantId: string, now: Date): Promise<CheckRun> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  if (!tenant || tenant.deletedAt) return { changed: 0, open: 0 };
  return db.transaction(async (tx) => {
    // One check per company at a time: two would write the same findings.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`checks:${tenantId}`}))`);
    const stored = await tx.select().from(links).where(eq(links.tenantId, tenantId));
    const decisions: LinkDecision[] = stored.flatMap((l) =>
      l.status === 'confirmed' || l.status === 'rejected'
        ? [{ kind: l.kind, fromDocId: l.fromDocId, toDocId: l.toDocId, status: l.status }]
        : [],
    );
    const checkDocs = await loadDocs(tx, tenantId);
    const out = checkRegistry({
      docs: checkDocs,
      decisions,
      today: parisToday(now),
      minMarginPercent: tenant.minMarginPercent,
    });

    // Links: what a person decided stays; the rest is what was found now.
    const storedById = new Map(stored.map((l) => [linkId(l), l]));
    const foundIds = new Set<string>();
    for (const l of out.links) {
      const id = linkId(l);
      foundIds.add(id);
      const before = storedById.get(id);
      if (before?.status === 'confirmed' || before?.status === 'rejected') continue;
      if (
        before &&
        before.score === l.score &&
        before.method === l.method &&
        before.status === l.status
      ) {
        continue;
      }
      await tx
        .insert(links)
        .values({ tenantId, ...l })
        .onConflictDoUpdate({
          target: [links.fromDocId, links.toDocId, links.kind],
          set: { score: l.score, method: l.method, status: l.status, updatedAt: now },
        });
    }
    const lost = stored.filter(
      (l) => l.status !== 'confirmed' && l.status !== 'rejected' && !foundIds.has(linkId(l)),
    );
    if (lost.length) {
      await tx.delete(links).where(
        inArray(
          links.id,
          lost.map((l) => l.id),
        ),
      );
    }

    // Findings, by key.
    const heldBefore = await heldInvoices(tx, tenantId);
    const docOf = new Map(checkDocs.map((d) => [d.id, d]));
    const previous = await tx.select().from(findings).where(eq(findings.tenantId, tenantId));
    const byKey = new Map(previous.map((f) => [f.key, f]));
    const seen = new Set<string>();
    const opened: string[] = [];
    let changed = 0;
    for (const f of out.findings) {
      seen.add(f.key);
      const doc = docOf.get(f.docId);
      const fingerprint = hashOf({
        key: f.key,
        docId: f.docId,
        message: f.message,
        amount: f.amount,
        params: f.params,
        evidence: f.evidence,
      });
      const before = byKey.get(f.key);
      if (before?.status === 'open' && before.fingerprint === fingerprint) continue;
      const values = {
        rule: f.rule,
        message: f.message,
        severity: f.severity,
        docId: f.docId,
        invoiceId: doc?.invoiceId ?? null,
        fingerprint,
        amount: f.amount,
        params: f.params,
        evidence: f.evidence,
        status: 'open' as const,
        isTest: doc?.isTest ?? false,
        resolvedAt: null,
        updatedAt: now,
      };
      changed += 1;
      if (!before) {
        await tx.insert(findings).values({ tenantId, key: f.key, ...values, firstSeenAt: now });
        opened.push(f.key);
        continue;
      }
      await tx
        .update(findings)
        .set({ ...values, ...(before.status === 'resolved' && { firstSeenAt: now }) })
        .where(eq(findings.id, before.id));
      if (before.status === 'resolved') opened.push(f.key);
    }
    const gone = previous.filter((f) => f.status === 'open' && !seen.has(f.key));
    if (gone.length) {
      await tx
        .update(findings)
        .set({ status: 'resolved', resolvedAt: now, updatedAt: now })
        .where(
          inArray(
            findings.id,
            gone.map((f) => f.id),
          ),
        );
      changed += gone.length;
    }

    await tx
      .insert(checkState)
      .values({
        tenantId,
        checkedAt: now,
        checkedOn: parisToday(now),
        mark: await markNow(tx, tenantId),
      })
      .onConflictDoUpdate({
        target: checkState.tenantId,
        set: {
          checkedAt: now,
          checkedOn: sql`excluded.checked_on`,
          mark: sql`excluded.mark`,
        },
      });
    if (changed > 0) {
      await audit(tx, {
        tenantId,
        actor: 'system',
        action: 'checks.run',
        objectType: 'tenant',
        objectId: tenantId,
        after: {
          opened,
          resolved: gone.map((f) => f.key),
          open: out.findings.length,
          links: out.links.length,
        },
      });
    }

    // The autopilot: an invoice a blocking finding now holds does not leave by itself, and says why;
    // one no finding holds any more is planned again.
    const heldAfter = await heldInvoices(tx, tenantId);
    const moved = [
      ...[...heldAfter].filter((id) => !heldBefore.has(id)),
      ...[...heldBefore].filter((id) => !heldAfter.has(id)),
    ];
    for (const id of moved) await replan(tx, now, tenant, id, heldAfter.has(id));
    return { changed, open: out.findings.length };
  });
}

async function replan(tx: Tx, now: Date, tenant: TenantRow, id: string, held: boolean) {
  const [row] = await tx
    .select({ status: invoices.status, autopilotAt: invoices.autopilotAt })
    .from(invoices)
    .where(eq(invoices.id, id));
  if (row?.status !== 'validated') return;
  if (held && row.autopilotAt) {
    const reason = 'findings';
    await tx.insert(invoiceEvents).values({
      invoiceId: id,
      type: 'note',
      actor: 'system',
      event: 'autopilot_cancelled',
      payload: { reason: { code: reason, message: t(`autopilot.reason.${reason}`) } },
    });
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'system',
      action: 'invoice.autopilot_cancel',
      objectType: 'invoice',
      objectId: id,
      after: { reason },
    });
  }
  await planAutopilot(tx, now, tenant, id);
}

/** The registry moved, or the day changed (a delivery note gets late without anything moving). */
async function checksStale(db: Db, tenantId: string, now: Date): Promise<boolean> {
  const [state] = await db.select().from(checkState).where(eq(checkState.tenantId, tenantId));
  if (!state) return true;
  return state.checkedOn < parisToday(now) || state.mark !== (await markNow(db, tenantId));
}

/**
 * The registry brought up to date, then checked again when it moved: what the registry job does, and
 * what « Envoyer » and the autopilot do before a send so they read today's findings.
 */
export async function checkNow(db: Db, tenantId: string, now: Date): Promise<CheckRun | null> {
  await refreshRegistry(db, tenantId, now);
  return (await checksStale(db, tenantId, now)) ? runChecks(db, tenantId, now) : null;
}

/** The companies whose findings are behind their registry, or from another day: the sweep queues them. */
export async function checksBehind(db: Db, now: Date): Promise<string[]> {
  const found = await rows<{ tenant_id: string }>(
    db,
    sql`
      with m as (
        select d.tenant_id, ${markOf} as mark
          from ${docs} d left join ${invoices} i on i.id = d.invoice_id
         group by d.tenant_id)
      select m.tenant_id from m
        join ${tenants} t on t.id = m.tenant_id and t.deleted_at is null
        left join ${checkState} s on s.tenant_id = m.tenant_id
       where s.tenant_id is null
          or s.mark <> (m.mark || ${settingsMark(sql`t.min_margin_percent`)})
          or s.checked_on < ${parisToday(now)}`,
  );
  return found.map((r) => r.tenant_id);
}

// ── What the pane shows ─────────────────────────────────────────────────────────────────────────

interface Place {
  number: string | null;
  sheet: string | null;
  workbookId: string | null;
  /** A received invoice: « Voir la facture du fournisseur » opens it in « Réception ». */
  inboundId: string | null;
}

/** Where each document is: its number, and the sheet and workbook it was read from. */
async function placesOf(db: DbOrTx, ids: readonly string[]): Promise<Map<string, Place>> {
  if (ids.length === 0) return new Map();
  const found = await db
    .select({
      id: docs.id,
      number: docs.number,
      sheet: sources.sheet,
      workbookId: sources.workbookId,
      inboundId: docs.inboundId,
      binding: invoices.excelBinding,
    })
    .from(docs)
    .leftJoin(sources, eq(sources.id, docs.sourceId))
    .leftJoin(invoices, eq(invoices.id, docs.invoiceId))
    .where(inArray(docs.id, [...new Set(ids)]));
  return new Map(
    found.map((d) => [
      d.id,
      {
        number: d.number,
        sheet: d.sheet ?? d.binding?.sheet ?? null,
        workbookId: d.workbookId ?? d.binding?.workbookId ?? null,
        inboundId: d.inboundId,
      },
    ]),
  );
}

export function findingView(
  row: FindingRow,
  places: Map<string, Place>,
  costLinks: Map<string, string> = new Map(),
) {
  // The pane selects the cell when the document is in the open workbook.
  const place = (e: Evidence) => {
    const p = places.get(e.docId);
    return {
      ...e,
      sheet: p?.sheet ?? null,
      workbookId: p?.workbookId ?? null,
      inboundId: p?.inboundId ?? null,
    };
  };
  return {
    id: row.id,
    rule: row.rule,
    severity: row.severity,
    message: t(`check.message.${row.message}`, row.params),
    /** Cents at stake, or null. */
    amount: row.amount,
    invoiceId: row.invoiceId,
    /** What « Envoyer quand même » sends back: a finding that changed since asks again. */
    fingerprint: row.fingerprint,
    isTest: row.isTest,
    evidence: row.evidence.map(place),
    /** B2: the link that says this purchase gave the cost, for « Ce n'est pas le même article ». */
    costLinkId:
      costLinks.get(
        costKey(
          row.evidence.find((e) => e.role === 'purchase'),
          row,
        ),
      ) ?? null,
    firstSeenAt: row.firstSeenAt.toISOString(),
  };
}

const costKey = (purchase: Evidence | undefined, row: Pick<FindingRow, 'docId'>) =>
  purchase ? `${purchase.docId}>${row.docId}` : '';

const bySize = (a: FindingRow, b: FindingRow) =>
  (b.amount ?? -1) - (a.amount ?? -1) ||
  Number(b.severity === 'blocking') - Number(a.severity === 'blocking') ||
  (a.key < b.key ? -1 : 1);

async function views(db: DbOrTx, found: FindingRow[]) {
  const places = await placesOf(
    db,
    found.flatMap((f) => [f.docId, ...f.evidence.map((e) => e.docId)]),
  );
  const sold = found.filter((f) => f.rule === 'B2').map((f) => f.docId);
  const cost = sold.length
    ? await db
        .select({ id: links.id, from: links.fromDocId, to: links.toDocId })
        .from(links)
        .where(and(eq(links.kind, 'cost'), inArray(links.toDocId, [...new Set(sold)])))
    : [];
  const costLinks = new Map(cost.map((l) => [`${l.from}>${l.to}`, l.id]));
  return found.sort(bySize).map((f) => findingView(f, places, costLinks));
}

/** The open findings on one invoice, for its detail. */
export async function invoiceFindings(db: DbOrTx, invoiceId: string) {
  const found = await db
    .select()
    .from(findings)
    .where(and(eq(findings.invoiceId, invoiceId), eq(findings.status, 'open')));
  return views(db, found);
}

/** The « Contrôles » screen: the open findings, the money at stake, the links that wait for a yes or no. */
export async function checksView(deps: Pick<ApiDeps, 'db' | 'now'>, tenant: TenantRow) {
  await checkNow(deps.db, tenant.id, deps.now());
  const open = await deps.db
    .select()
    .from(findings)
    .where(and(eq(findings.tenantId, tenant.id), eq(findings.status, 'open')));
  const proposed = await deps.db
    .select()
    .from(links)
    .where(and(eq(links.tenantId, tenant.id), eq(links.status, 'proposed')));
  const ids = proposed.flatMap((l) => [l.fromDocId, l.toDocId]);
  const about = ids.length
    ? await deps.db
        .select({
          id: docs.id,
          kind: docs.kind,
          number: docs.number,
          issueDate: docs.issueDate,
          partyName: docs.partyName,
          netTotal: docs.netTotal,
        })
        .from(docs)
        .where(inArray(docs.id, ids))
    : [];
  const docView = new Map(about.map((d) => [d.id, d]));
  const [state] = await deps.db.select().from(checkState).where(eq(checkState.tenantId, tenant.id));
  const real = open.filter((f) => !f.isTest);
  return {
    checkedAt: state?.checkedAt.toISOString() ?? null,
    /** Cents at stake on the real documents. */
    atStake: real.reduce((sum, f) => sum + (f.amount ?? 0), 0),
    blocking: real.filter((f) => f.severity === 'blocking').length,
    findings: await views(deps.db, open),
    links: proposed
      .map((l) => ({
        id: l.id,
        kind: l.kind,
        score: l.score,
        from: docView.get(l.fromDocId) ?? null,
        to: docView.get(l.toDocId) ?? null,
      }))
      .sort(
        (a, b) =>
          b.score - a.score ||
          (a.to?.number ?? '').localeCompare(b.to?.number ?? '') ||
          (a.from?.number ?? '').localeCompare(b.from?.number ?? ''),
      ),
  };
}

/**
 * « Oui » / « Non » on a proposed link: it stays as decided, and the documents are checked again. A
 * « Oui » settles the document: the other proposals for it are not found again.
 */
export async function decideLink(
  deps: Pick<ApiDeps, 'db' | 'now'>,
  tenant: TenantRow,
  actor: string,
  id: string,
  status: 'confirmed' | 'rejected',
) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(links)
      .where(and(eq(links.id, id), eq(links.tenantId, tenant.id)))
      .for('update');
    if (!row) throw new ApiError(404, 'link_not_found');
    await tx
      .update(links)
      .set({ status, decidedBy: actor, decidedAt: now, updatedAt: now })
      .where(eq(links.id, id));
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: status === 'confirmed' ? 'link.confirm' : 'link.reject',
      objectType: 'link',
      objectId: id,
      before: { status: row.status },
      after: { status, kind: row.kind, from: row.fromDocId, to: row.toDocId },
    });
  });
  await runChecks(deps.db, tenant.id, now);
  return checksView(deps, tenant);
}

/**
 * The send gate: the invoice's open blocking findings, each one acknowledged by its fingerprint or
 * not. Called inside « Envoyer »'s transaction, after `checkNow`.
 */
export async function blockingFindings(tx: Tx, invoiceId: string) {
  return tx
    .select()
    .from(findings)
    .where(
      and(
        eq(findings.invoiceId, invoiceId),
        eq(findings.status, 'open'),
        eq(findings.severity, 'blocking'),
      ),
    );
}
