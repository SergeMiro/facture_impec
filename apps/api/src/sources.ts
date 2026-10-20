// The company's other sheets (R1): orders, delivery notes, purchases and price lists feed the registry
// next to its invoices. The pane proposes a sheet, the company says « Inclure cette feuille » once,
// then every change to it is read again: only the documents that changed are written, and the same
// snapshot twice writes nothing.
//
// A layout the company confirmed is kept as a profile, found again by its header row: the next month's
// sheet with the same headers needs no agent and no question.
import { proposeLayout } from '@fi/agents';
import {
  DIRECTION,
  type DocKind,
  headerSignature,
  headerSignatures,
  isDocKind,
  type LayoutDoc,
  LayoutMapping,
  Party,
  readLayout,
  type SheetSnapshot,
  supplierKey,
} from '@fi/core';
import {
  and,
  audit,
  count,
  desc,
  docLines,
  docs,
  eq,
  hashOf,
  inArray,
  isNotNull,
  layoutProfiles,
  parties,
  type SourceRow,
  type SourceStats,
  sha256,
  sources,
  sql,
  type TenantRow,
  type Tx,
} from '@fi/db';
import { z } from 'zod';
import { tenantAi } from './ai';
import { type Principal, who } from './auth';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { ensureItems, isoDate, itemKey } from './registry';
import { Snapshot } from './workbooks';

export const ConfirmBody = z.object({ layout: LayoutMapping, snapshot: Snapshot });
export const SourceSync = z.object({ snapshot: Snapshot });

const fingerprintOf = (signature: string) => sha256(`layout\u0000${signature}`);

/**
 * What a sheet holds. A profile the company confirmed for the same header row first (no agent, no
 * question); else LayoutAgent, else the dictionary. Nothing is saved: the company has not said yes.
 */
export async function detectSource(
  deps: ApiDeps,
  tenant: TenantRow,
  workbookId: string,
  snapshot: SheetSnapshot,
  signal?: AbortSignal,
) {
  const [included] = await deps.db
    .select({ id: sources.id })
    .from(sources)
    .where(sourceIs(tenant.id, workbookId, snapshot.sheet));
  const candidates = headerSignatures(snapshot).map((h) => ({
    ...h,
    fingerprint: fingerprintOf(h.signature),
  }));
  const profiles = candidates.length
    ? await deps.db
        .select()
        .from(layoutProfiles)
        .where(
          and(
            eq(layoutProfiles.tenantId, tenant.id),
            inArray(
              layoutProfiles.fingerprint,
              candidates.map((c) => c.fingerprint),
            ),
          ),
        )
    : [];
  for (const c of candidates) {
    const profile = profiles.find((p) => p.fingerprint === c.fingerprint);
    if (!profile) continue;
    return {
      layout: {
        ...profile.layout,
        sheet: snapshot.sheet,
        headerRow: c.row,
        warnings: [],
        source: 'profile' as const,
      },
      profile: { id: profile.id, version: profile.version },
      degraded: null,
      included: included !== undefined,
    };
  }
  const { layout, degraded } = await proposeLayout(snapshot, {
    tenantId: tenant.id,
    ai: tenantAi(deps.ai, tenant),
    orchestrator: deps.ai.orchestrator,
    ...(signal && { signal }),
  });
  return { layout, profile: null, degraded, included: included !== undefined };
}

const sourceIs = (tenantId: string, workbookId: string, sheet: string) =>
  and(eq(sources.tenantId, tenantId), eq(sources.workbookId, workbookId), eq(sources.sheet, sheet));

/**
 * « Inclure cette feuille »: the company confirms what the sheet holds. Keeps the layout as a profile
 * (its version raised when it changed), records the consent, then reads the sheet a first time.
 */
export async function includeSource(
  deps: ApiDeps,
  tenant: TenantRow,
  principal: Principal,
  workbookId: string,
  input: z.infer<typeof ConfirmBody>,
) {
  const { layout, snapshot } = input;
  if (layout.sheet !== snapshot.sheet) {
    throw new ApiError(400, 'invalid_request', undefined, 'layout.sheet differs from the snapshot');
  }
  if (!isDocKind(layout.kind)) throw new ApiError(422, 'layout_kind_unsupported');
  const kind: DocKind = layout.kind;
  const signature = headerSignature(snapshot, layout.headerRow);
  const now = deps.now();
  const confirmed: LayoutMapping = {
    ...layout,
    kind,
    kindConfidence: 1,
    warnings: [],
    mapping: Object.fromEntries(
      Object.entries(layout.mapping).map(([f, m]) => [f, m && { ...m, needsConfirmation: false }]),
    ),
    source: 'user',
  };
  const by = who(principal);
  const fingerprint = signature ? fingerprintOf(signature) : null;
  const source = await deps.db.transaction(async (tx) => {
    let profileId: string | null = null;
    if (fingerprint) {
      const [before] = await tx
        .select()
        .from(layoutProfiles)
        .where(
          and(eq(layoutProfiles.tenantId, tenant.id), eq(layoutProfiles.fingerprint, fingerprint)),
        );
      // What the profile says is the kind and the columns; the sheet and its header row are each
      // sheet's own. jsonb keeps no key order: compare stable hashes.
      const identity = (l: LayoutMapping) => hashOf({ kind: l.kind, mapping: l.mapping });
      const same = before && identity(before.layout) === identity(confirmed);
      const [profile] = await tx
        .insert(layoutProfiles)
        .values({
          tenantId: tenant.id,
          fingerprint,
          kind,
          layout: confirmed,
          confirmedBy: by,
          confirmedAt: now,
        })
        .onConflictDoUpdate({
          target: [layoutProfiles.tenantId, layoutProfiles.fingerprint],
          set: {
            kind,
            layout: confirmed,
            confirmedBy: by,
            confirmedAt: now,
            version: same ? sql`${layoutProfiles.version}` : sql`${layoutProfiles.version} + 1`,
            updatedAt: now,
          },
        })
        .returning();
      if (!profile) throw new Error('upsert returned nothing');
      profileId = profile.id;
      if (!same) {
        await audit(tx, {
          tenantId: tenant.id,
          actor: 'user',
          action: 'layout_profile.confirm',
          objectType: 'layout_profile',
          objectId: profile.id,
          ...(before && { before: before.layout }),
          after: confirmed,
        });
      }
    }
    const [row] = await tx
      .insert(sources)
      .values({
        tenantId: tenant.id,
        workbookId,
        sheet: snapshot.sheet,
        profileId,
        kind,
        layout: confirmed,
        fingerprint,
        consentedAt: now,
        consentedBy: by,
      })
      .onConflictDoUpdate({
        target: [sources.tenantId, sources.workbookId, sources.sheet],
        // Another layout: everything is read again.
        set: { profileId, kind, layout: confirmed, fingerprint, etag: null, updatedAt: now },
      })
      .returning();
    if (!row) throw new Error('upsert returned nothing');
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'source.include',
      objectType: 'source',
      objectId: row.id,
      after: { workbookId, sheet: row.sheet, kind, layout: confirmed },
    });
    return row;
  });
  // A document's version holds its kind: another kind rewrites every one of them.
  return readSource(deps, tenant, source, snapshot);
}

/** « Retirer »: the sheet leaves the check; its documents leave the registry with it. */
export async function removeSource(
  deps: ApiDeps,
  tenant: TenantRow,
  workbookId: string,
  sheet: string,
) {
  const result = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .delete(sources)
      .where(sourceIs(tenant.id, workbookId, sheet))
      .returning();
    if (!row) throw new ApiError(404, 'source_not_found');
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'source.remove',
      objectType: 'source',
      objectId: row.id,
      before: { workbookId, sheet, kind: row.kind, stats: row.stats },
    });
    return { removed: true, sheet };
  });
  // Findings against its documents are resolved by the next check.
  await deps.jobs.enqueueRegistry(tenant.id);
  return result;
}

/** The sheets of a workbook the company included: the pane listens to each one. */
export async function listSources(deps: ApiDeps, tenant: TenantRow, workbookId: string) {
  const rows = await deps.db
    .select()
    .from(sources)
    .where(and(eq(sources.tenantId, tenant.id), eq(sources.workbookId, workbookId)))
    .orderBy(sources.sheet);
  return { sources: rows.map(sourceView) };
}

export async function syncSource(
  deps: ApiDeps,
  tenant: TenantRow,
  workbookId: string,
  sheet: string,
  snapshot: SheetSnapshot,
) {
  if (snapshot.sheet !== sheet) {
    throw new ApiError(400, 'invalid_request', undefined, 'snapshot.sheet differs from the path');
  }
  const [source] = await deps.db
    .select()
    .from(sources)
    .where(sourceIs(tenant.id, workbookId, sheet));
  if (!source) throw new ApiError(404, 'source_not_found');
  return readSource(deps, tenant, source, snapshot);
}

export function sourceView(row: SourceRow) {
  return {
    id: row.id,
    workbookId: row.workbookId,
    sheet: row.sheet,
    kind: row.kind,
    layout: row.layout,
    consentedAt: row.consentedAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
    changedAt: row.changedAt?.toISOString() ?? null,
    stats: row.stats ?? null,
  };
}

/**
 * The confirmed layout, its header row moved to where the confirmed headers are now: a row inserted
 * above them must not turn the headers into a document.
 */
function locateHeader(source: SourceRow, snapshot: SheetSnapshot) {
  const { layout, fingerprint } = source;
  if (!fingerprint) return { layout, headerFound: true };
  const at = (row: number) => {
    const signature = headerSignature(snapshot, row);
    return signature !== null && fingerprintOf(signature) === fingerprint;
  };
  if (at(layout.headerRow)) return { layout, headerFound: true };
  const found = headerSignatures(snapshot).find((h) => fingerprintOf(h.signature) === fingerprint);
  return found
    ? { layout: { ...layout, headerRow: found.row }, headerFound: true }
    : { layout, headerFound: false };
}

/** What a document of the sheet is projected from: a change anywhere in it rewrites it. */
const docVersion = (kind: DocKind, doc: LayoutDoc) => sha256(JSON.stringify([kind, doc]));

/**
 * Reads a snapshot of an included sheet into the registry. The same snapshot as last time: nothing
 * is written at all. Else only the documents whose content changed are written again, and those no
 * longer in the sheet are removed.
 */
async function readSource(
  deps: ApiDeps,
  tenant: TenantRow,
  source: SourceRow,
  snapshot: SheetSnapshot,
) {
  const etag = sha256(JSON.stringify(snapshot.rows));
  const view = (row: SourceRow, written: number, removed: number) => ({
    source: sourceView(row),
    written,
    removed,
  });
  if (source.etag === etag) return view(source, 0, 0);

  const kind = source.kind;
  const { layout, headerFound } = locateHeader(source, snapshot);
  const reading = readLayout(snapshot, layout);
  const stored = await deps.db
    .select({ id: docs.id, key: docs.sourceKey, version: docs.sourceVersion })
    .from(docs)
    .where(eq(docs.sourceId, source.id));
  const versionOf = new Map(stored.map((d) => [d.key, d.version]));
  const wanted = reading.docs.map((doc) => ({ doc, version: docVersion(kind, doc) }));
  const changed = wanted.filter((w) => versionOf.get(w.doc.key) !== w.version);
  const keys = new Set(reading.docs.map((d) => d.key));
  const gone = stored.filter((d) => d.key === null || !keys.has(d.key)).map((d) => d.id);
  const stats: SourceStats = {
    docs: reading.docs.length,
    lines: reading.docs.reduce((n, d) => n + d.lines.length, 0),
    rows: reading.rows,
    ignoredRows: reading.ignoredRows.length,
    unreadRows: reading.unreadRows.length,
    headerFound,
  };
  const now = deps.now();
  const touched = changed.length > 0 || gone.length > 0;

  const row = await deps.db.transaction(async (tx) => {
    if (gone.length) await tx.delete(docs).where(inArray(docs.id, gone));
    if (changed.length) await writeDocs(tx, tenant.id, source, changed, now);
    const [updated] = await tx
      .update(sources)
      .set({ etag, readAt: now, stats, ...(touched && { changedAt: now }), updatedAt: now })
      .where(eq(sources.id, source.id))
      .returning();
    if (!updated) throw new ApiError(404, 'source_not_found');
    // Only a read that changed the registry is an event worth keeping.
    if (touched) {
      await audit(tx, {
        tenantId: tenant.id,
        actor: 'user',
        action: 'source.read',
        objectType: 'source',
        objectId: source.id,
        after: { written: changed.length, removed: gone.length, stats },
      });
    }
    return updated;
  });
  // After the commit: the registry job checks the documents again (src/checks.ts).
  if (touched) await deps.jobs.enqueueRegistry(tenant.id);
  return view(row, changed.length, gone.length);
}

async function writeDocs(
  tx: Tx,
  tenantId: string,
  source: SourceRow,
  changed: readonly { doc: LayoutDoc; version: string }[],
  now: Date,
) {
  const kind = source.kind;
  const direction = DIRECTION[kind];
  const supplierOf = (doc: LayoutDoc) =>
    direction === 'in'
      ? (supplierKey(
          Party.parse({
            name: doc.partyName,
            ...(doc.partySiren && { legalId: { id: doc.partySiren, scheme: '0002' } }),
          }),
        ) ?? null)
      : null;
  const values = changed.map(({ doc, version }) => {
    const amounts = doc.lines.map((l) => l.netAmount);
    return {
      tenantId,
      direction,
      kind,
      sourceId: source.id,
      sourceKey: doc.key,
      isTest: false,
      number: doc.number ?? null,
      issueDate: isoDate(doc.date),
      partySiren: doc.partySiren ?? null,
      partyName: doc.partyName ?? null,
      orderRef: doc.orderRef ?? null,
      netTotal:
        amounts.length && amounts.every((a) => a !== null)
          ? amounts.reduce<number>((sum, a) => sum + (a ?? 0), 0)
          : null,
      sourceVersion: version,
      updatedAt: now,
    };
  });
  const written: { id: string; key: string | null }[] = [];
  for (let i = 0; i < values.length; i += 500) {
    written.push(
      ...(await tx
        .insert(docs)
        .values(values.slice(i, i + 500))
        .onConflictDoUpdate({
          target: [docs.sourceId, docs.sourceKey],
          set: {
            direction: sql`excluded.direction`,
            kind: sql`excluded.kind`,
            number: sql`excluded.number`,
            issueDate: sql`excluded.issue_date`,
            partySiren: sql`excluded.party_siren`,
            partyName: sql`excluded.party_name`,
            orderRef: sql`excluded.order_ref`,
            netTotal: sql`excluded.net_total`,
            sourceVersion: sql`excluded.source_version`,
            updatedAt: sql`excluded.updated_at`,
          },
        })
        .returning({ id: docs.id, key: docs.sourceKey })),
    );
  }
  const docOf = new Map(written.map((w) => [w.key, w.id]));
  const ids = written.map((w) => w.id);
  for (let i = 0; i < ids.length; i += 1_000) {
    await tx.delete(docLines).where(inArray(docLines.docId, ids.slice(i, i + 1_000)));
  }

  const lines = changed.flatMap(({ doc }) => {
    const supplier = supplierOf(doc);
    return doc.lines.map((line, position) => ({
      doc,
      line,
      position,
      key: itemKey(direction, { name: line.itemName, sellerId: line.itemRef }, supplier),
    }));
  });
  const itemOf = await ensureItems(
    tx,
    tenantId,
    lines.map((l) => ({ key: l.key, name: l.line.itemName })),
  );
  const lineRows = lines.map(({ doc, line, position, key }) => ({
    docId: docOf.get(doc.key) ?? '',
    tenantId,
    position,
    itemId: key ? (itemOf.get(key) ?? null) : null,
    name: line.itemName ?? null,
    sellerRef: line.itemRef ?? null,
    quantity: line.quantity ?? null,
    unitCode: line.unit ?? null,
    netPrice: line.unitPrice ?? null,
    netAmount: line.netAmount,
    vatRate: line.vatRate ?? null,
    cell: line.cell,
  }));
  for (let i = 0; i < lineRows.length; i += 1_000) {
    await tx.insert(docLines).values(lineRows.slice(i, i + 1_000));
  }
}

/**
 * The « Registre » screen: what each included sheet brought, the invoices, the latest documents with
 * the cell each one starts at.
 */
export async function registryView(deps: ApiDeps, tenant: TenantRow) {
  const included = await deps.db
    .select()
    .from(sources)
    .where(eq(sources.tenantId, tenant.id))
    .orderBy(sources.workbookId, sources.sheet);
  const invoiceCounts = await deps.db
    .select({ direction: docs.direction, n: count() })
    .from(docs)
    .where(and(eq(docs.tenantId, tenant.id), eq(docs.kind, 'invoice'), eq(docs.isTest, false)))
    .groupBy(docs.direction);
  const [suppliers] = await deps.db
    .select({ n: count() })
    .from(parties)
    .where(and(eq(parties.tenantId, tenant.id), eq(parties.kind, 'supplier')));
  const recent = await deps.db
    .select({
      id: docs.id,
      kind: docs.kind,
      direction: docs.direction,
      number: docs.number,
      issueDate: docs.issueDate,
      partyName: docs.partyName,
      netTotal: docs.netTotal,
      sourceId: docs.sourceId,
      updatedAt: docs.updatedAt,
    })
    .from(docs)
    .where(and(eq(docs.tenantId, tenant.id), isNotNull(docs.sourceId)))
    .orderBy(desc(docs.updatedAt), desc(docs.id))
    .limit(20);
  const sheetOf = new Map(included.map((s) => [s.id, s.sheet]));
  // Where each document starts in its sheet: a click on it in the pane selects that cell.
  const firstCells = recent.length
    ? await deps.db
        .select({ docId: docLines.docId, cell: docLines.cell })
        .from(docLines)
        .where(
          and(
            inArray(
              docLines.docId,
              recent.map((d) => d.id),
            ),
            eq(docLines.position, 0),
          ),
        )
    : [];
  const cellOf = new Map(firstCells.map((l) => [l.docId, l.cell]));
  return {
    sources: included.map(sourceView),
    invoices: {
      sent: invoiceCounts.find((c) => c.direction === 'out')?.n ?? 0,
      received: invoiceCounts.find((c) => c.direction === 'in')?.n ?? 0,
    },
    /** Recognised from the received invoices (R3). */
    suppliers: suppliers?.n ?? 0,
    recent: recent.map(({ sourceId, updatedAt, ...d }) => ({
      ...d,
      sheet: sourceId ? (sheetOf.get(sourceId) ?? null) : null,
      cell: cellOf.get(d.id) ?? null,
      updatedAt: updatedAt.toISOString(),
    })),
  };
}
