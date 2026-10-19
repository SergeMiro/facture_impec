// The registry (R0): every invoice of the company, sent or received, as a document and its lines,
// each line tied to the article it is about. The checks of documents together (an order against its
// invoice, what was bought against what was sold) read it; R0 fills it. It is derived data, rebuilt
// from its sources at any time: `invoices` (projected again when the fingerprint changes, removed when
// cancelled) and `inbound_queue` (once triaged and read). One job per company writes it
// (registry.refresh, src/jobs.ts), after a sync that changed something and after received invoices;
// the sweep queues it for a company left behind.
import type { Invoice, Line } from '@fi/core';
import {
  and,
  asc,
  type Db,
  docLines,
  docs,
  eq,
  gt,
  inArray,
  inboundQueue,
  invoices,
  isNotNull,
  isNull,
  items,
  ne,
  or,
  rows,
  sql,
  type Tx,
  tenants,
} from '@fi/db';

/** Lowercase, no accents, no punctuation, single spaces: « Journée  de conseil. » → journee de conseil. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const clean = (s: string | undefined) => s?.trim() || undefined;
const ref = (s: string | undefined) => clean(s)?.replace(/\s+/g, ' ').toUpperCase();

export type Direction = 'out' | 'in';

/** What names an article on a line: BT-153, BT-155, BT-156. */
export type ItemIdentity = Pick<Line['item'], 'name' | 'sellerId' | 'buyerId'>;

/**
 * The article a line is about. The company's own reference first: BT-155 on what it sells, BT-156
 * (the buyer's identifier) on what it buys, when the supplier writes it. Else its name, normalized.
 * A bought line without the company's reference stays the supplier's article: telling which of the
 * company's articles it is belongs to a later stage, not to a guess here.
 */
export function itemKey(
  direction: Direction,
  item: ItemIdentity,
  supplier: string | null,
): string | null {
  const name = clean(item.name);
  const byName = name ? normalizeName(name) : '';
  const own = ref(direction === 'out' ? item.sellerId : item.buyerId);
  if (own) return `ref:${own}`;
  if (direction === 'out') return byName ? `name:${byName}` : null;
  const scope = `supplier:${supplier ?? '?'}:`;
  const theirs = ref(item.sellerId);
  if (theirs) return `${scope}ref:${theirs}`;
  return byName ? `${scope}name:${byName}` : null;
}

/** A date column takes only a real date: a sheet may hold « 2026-13-45 » until the user fixes it. */
export function isoDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? null : value;
}

/**
 * What an outgoing document is projected from: the invoice's content, and its rows in the sheet (the
 * lines keep their cell). Computed by Postgres, so that finding what is behind is one query.
 */
const outVersion = sql<string>`${invoices.fingerprint} || ':' || md5(coalesce(${invoices.excelBinding}::text, ''))`;

interface Source {
  direction: Direction;
  invoiceId: string | null;
  inboundId: string | null;
  isTest: boolean;
  /** `outVersion`; a received invoice is read once. */
  version: string;
  document: Invoice;
  /** Model path → sheet cell, for an invoice made from a sheet. */
  cells: Record<string, string>;
  /** Who sold it, for a received invoice (inbound_queue.supplier_key). */
  supplier: string | null;
}

/** Writes the documents of `sources` and their lines again, in one transaction. */
async function project(tx: Tx, tenantId: string, sources: Source[], now: Date) {
  if (sources.length === 0) return;
  const values = sources.map((s) => {
    const d = s.document;
    const party = s.direction === 'out' ? d.buyer : d.seller;
    return {
      tenantId,
      direction: s.direction,
      invoiceId: s.invoiceId,
      inboundId: s.inboundId,
      isTest: s.isTest,
      typeCode: d.typeCode ?? null,
      number: d.number ?? null,
      issueDate: isoDate(d.issueDate),
      partySiren: party.legalId?.id ?? null,
      partyName: party.name ?? null,
      currency: d.currency ?? null,
      netTotal: d.totals.taxExclusive ?? null,
      sourceVersion: s.version,
      updatedAt: now,
    };
  });
  const direction = sources[0]?.direction;
  const fresh = {
    typeCode: sql`excluded.type_code`,
    number: sql`excluded.number`,
    issueDate: sql`excluded.issue_date`,
    partySiren: sql`excluded.party_siren`,
    partyName: sql`excluded.party_name`,
    currency: sql`excluded.currency`,
    netTotal: sql`excluded.net_total`,
    sourceVersion: sql`excluded.source_version`,
    updatedAt: sql`excluded.updated_at`,
  };
  const written = await tx
    .insert(docs)
    .values(values)
    .onConflictDoUpdate({
      target: direction === 'out' ? docs.invoiceId : docs.inboundId,
      set: fresh,
    })
    .returning({ id: docs.id, invoiceId: docs.invoiceId, inboundId: docs.inboundId });
  const docOf = new Map(written.map((w) => [w.invoiceId ?? w.inboundId, w.id]));
  await tx.delete(docLines).where(
    inArray(
      docLines.docId,
      written.map((w) => w.id),
    ),
  );

  // The articles: created on first sight, never renamed (the name they were first seen with).
  const lines = sources.flatMap((s) =>
    s.document.lines.map((line, position) => ({
      source: s,
      line,
      position,
      key: itemKey(s.direction, line.item, s.supplier),
    })),
  );
  const itemOf = await ensureItems(
    tx,
    tenantId,
    lines.map((l) => ({ key: l.key, name: l.line.item.name })),
  );

  const lineRows = lines.map(({ source, line, position, key }) => {
    const allowances = line.allowances.filter((a) => a.amount !== undefined);
    return {
      docId: docOf.get(source.invoiceId ?? source.inboundId) ?? '',
      tenantId,
      position,
      itemId: key ? (itemOf.get(key) ?? null) : null,
      lineId: line.id ?? null,
      name: line.item.name ?? null,
      sellerRef: line.item.sellerId ?? null,
      buyerRef: line.item.buyerId ?? null,
      standardId: line.item.standardId?.id ?? null,
      quantity: line.quantity ?? null,
      unitCode: line.unitCode ?? null,
      netPrice: line.price.net ?? null,
      discount: allowances.length ? allowances.reduce((sum, a) => sum + (a.amount ?? 0), 0) : null,
      netAmount: line.netAmount ?? null,
      vatCategory: line.vat.category ?? null,
      vatRate: line.vat.rate ?? null,
      orderLineRef: line.orderLineRef ?? null,
      cell: source.cells[`lines[${position}].item.name`] ?? null,
    };
  });
  for (let i = 0; i < lineRows.length; i += 1_000) {
    await tx.insert(docLines).values(lineRows.slice(i, i + 1_000));
  }
}

/**
 * The articles' ids, each created on first sight and never renamed (the name it was first seen with).
 * Shared with the sheets of the workbook (src/sources.ts).
 */
export async function ensureItems(
  tx: Tx,
  tenantId: string,
  seen: readonly { key: string | null; name: string | undefined }[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const s of seen) {
    if (s.key && !names.has(s.key)) {
      names.set(s.key, clean(s.name) ?? s.key.replace(/^.*?(ref|name):/, ''));
    }
  }
  const keys = [...names.keys()];
  const itemOf = new Map<string, string>();
  for (let i = 0; i < keys.length; i += 1_000) {
    const chunk = keys.slice(i, i + 1_000);
    await tx
      .insert(items)
      .values(chunk.map((key) => ({ tenantId, key, name: names.get(key) ?? key })))
      .onConflictDoNothing();
    const found = await tx
      .select({ id: items.id, key: items.key })
      .from(items)
      .where(and(eq(items.tenantId, tenantId), inArray(items.key, chunk)));
    for (const f of found) itemOf.set(f.key, f.id);
  }
  return itemOf;
}

const BATCH = 200;

/**
 * Brings one company's registry up to date: removes the documents of cancelled invoices, projects
 * the invoices whose document is missing or older than the invoice, then the received invoices read
 * since. Batches of 200, one transaction each, in id order: it always ends, and a failure keeps what
 * the batches before it wrote.
 */
export async function refreshRegistry(
  db: Db,
  tenantId: string,
  now: Date,
): Promise<{ projected: number; removed: number }> {
  const [tenant] = await db
    .select({ deletedAt: tenants.deletedAt })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant || tenant.deletedAt) return { projected: 0, removed: 0 };

  const removed = await db
    .delete(docs)
    .where(
      and(
        eq(docs.tenantId, tenantId),
        sql`${docs.invoiceId} in (select ${invoices.id} from ${invoices} where ${invoices.tenantId} = ${tenantId} and ${invoices.status} = 'cancelled')`,
      ),
    )
    .returning({ id: docs.id });

  let projected = 0;
  for (let after = ''; ; ) {
    const stale = await db
      .select({
        id: invoices.id,
        isTest: invoices.isTest,
        version: outVersion,
        document: invoices.document,
        excelBinding: invoices.excelBinding,
      })
      .from(invoices)
      .leftJoin(docs, eq(docs.invoiceId, invoices.id))
      .where(
        and(
          eq(invoices.tenantId, tenantId),
          ne(invoices.status, 'cancelled'),
          or(isNull(docs.id), ne(docs.sourceVersion, outVersion)),
          after ? gt(invoices.id, after) : undefined,
        ),
      )
      .orderBy(asc(invoices.id))
      .limit(BATCH);
    if (stale.length === 0) break;
    after = stale.at(-1)?.id ?? after;
    await db.transaction((tx) =>
      project(
        tx,
        tenantId,
        stale.map((r) => ({
          direction: 'out',
          invoiceId: r.id,
          inboundId: null,
          isTest: r.isTest,
          version: r.version,
          document: r.document,
          cells: r.excelBinding?.cells ?? {},
          supplier: null,
        })),
        now,
      ),
    );
    projected += stale.length;
  }

  for (let after = ''; ; ) {
    const unread = await db
      .select({
        id: inboundQueue.id,
        isTest: inboundQueue.isTest,
        parsed: inboundQueue.parsed,
        supplierKey: inboundQueue.supplierKey,
      })
      .from(inboundQueue)
      .leftJoin(docs, eq(docs.inboundId, inboundQueue.id))
      .where(
        and(
          eq(inboundQueue.tenantId, tenantId),
          isNotNull(inboundQueue.triagedAt),
          isNotNull(inboundQueue.parsed),
          isNull(docs.id),
          after ? gt(inboundQueue.id, after) : undefined,
        ),
      )
      .orderBy(asc(inboundQueue.id))
      .limit(BATCH);
    if (unread.length === 0) break;
    after = unread.at(-1)?.id ?? after;
    await db.transaction((tx) =>
      project(
        tx,
        tenantId,
        unread.flatMap((r) =>
          r.parsed
            ? [
                {
                  direction: 'in' as const,
                  invoiceId: null,
                  inboundId: r.id,
                  isTest: r.isTest,
                  version: 'read',
                  document: r.parsed,
                  cells: {},
                  supplier: r.supplierKey,
                },
              ]
            : [],
        ),
        now,
      ),
    );
    projected += unread.length;
  }
  return { projected, removed: removed.length };
}

/** The companies whose registry is behind its invoices: the sweep queues a refresh for each. */
export async function registryBehind(db: Db): Promise<string[]> {
  const found = await rows<{ tenant_id: string }>(
    db,
    sql`
      select distinct i.tenant_id from ${invoices} i
        join ${tenants} t on t.id = i.tenant_id and t.deleted_at is null
        left join ${docs} d on d.invoice_id = i.id
       where (i.status <> 'cancelled' and (d.id is null
               or d.source_version <> i.fingerprint || ':' || md5(coalesce(i.excel_binding_json::text, ''))))
          or (i.status = 'cancelled' and d.id is not null)
      union
      select distinct q.tenant_id from ${inboundQueue} q
        join ${tenants} t on t.id = q.tenant_id and t.deleted_at is null
        left join ${docs} d on d.inbound_id = q.id
       where q.triaged_at is not null and q.parsed_json is not null and d.id is null`,
  );
  return found.map((r) => r.tenant_id);
}
