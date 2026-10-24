// The ERP's lists brought in (BTP stage 4, docs/DECISIONS.md D9): a person gives an export of
// clients, suppliers, chantiers, invoices or payments from Batigest or EBP. It is read at once, so a missing column is
// said before anything is kept; then its bytes go to the FileStore and the queue `erp.sync` writes it
// batch by batch, each batch with its cursor in one transaction: a run stopped in the middle goes on
// from the row it reached. What a row changes is decided by `@fi/connectors`, one mapping for every
// connector; this file only writes it. An invoice becomes a document and its deadline, the same one
// the PDP and the mail make; a payment closes it (stage 4B).
import { deriveObligations, saleDeadlineKey } from '@fi/agents';
import {
  type ChantierFields,
  type ChantierRow,
  type Connector,
  type Cursor,
  canonical,
  chantierChange,
  chantierOf,
  customerOf,
  dataRows,
  type ErpAddress,
  EXPORT_LISTS,
  type ExportConfig,
  type ExportList,
  type ExportRow,
  exportConnector,
  type FactureRow,
  type PartyFields,
  type PartySide,
  partyChange,
  type ReglementRow,
  readExport,
  type Skipped,
  type TiersRow,
} from '@fi/connectors';
import { FILE_LIMITS } from '@fi/core';
import {
  actions,
  and,
  audit,
  blobs,
  type ConnectorSyncRow,
  chantiers,
  connectorSyncs,
  type Db,
  type DocumentRow,
  documents,
  eq,
  inArray,
  invoices,
  isNull,
  obligations,
  or,
  parties,
  type SyncResult,
  sql,
  type TenantRow,
  type Tx,
  tenants,
} from '@fi/db';
import { type FatalError, isFatal } from '@fi/domain';
import { isMessageKey, t } from '@fi/shared';
import { z } from 'zod';
import type { ApiDeps } from './deps';
import { saveObligations } from './document-pipeline';
import { ApiError } from './errors';
import { postgresFiles, sha256Of } from './files';
import { parse } from './http';
import { uploadName } from './uploads';
import { withdrawDrafts } from './watchers';

/** One sync row per list (D9): `export:customers`, `export:invoices`… */
export const syncKeyOf = (list: ExportList) => `export:${list}`;
const ERP_SYNCS = EXPORT_LISTS.map(syncKeyOf);

const listOf = (key: string): ExportList | undefined =>
  EXPORT_LISTS.find((list) => syncKeyOf(list) === key);

/** The examples of rows skipped kept for the pane: enough to see the pattern, not a second list. */
const EXAMPLES = 20;

const List = z.enum(EXPORT_LISTS);

const CursorJson = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

const mimeOf = (bytes: Uint8Array) =>
  bytes[0] === 0x50 && bytes[1] === 0x4b
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'text/csv';

const COLUMNS: Record<ExportList, string> = {
  customers: 'tiers',
  suppliers: 'tiers',
  chantiers: 'chantier',
  invoices: 'invoice',
  payments: 'payment',
};

/** « Il manque une colonne : « SIRET » ou « SIREN » » from the reader's `customers:siren|siret`. */
function columnOf(detail: string): string {
  const [list = '', fields = ''] = detail.split(':');
  const section = COLUMNS[list as ExportList] ?? 'tiers';
  const key = `erp.column.${section}.${fields.split('|')[0]}`;
  return isMessageKey(key) ? t(key) : fields;
}

/** The reader's refusal, as the person reads it: nothing was kept. */
function refusal(error: FatalError): ApiError {
  switch (error.code) {
    case 'export_too_large':
      return new ApiError(413, 'export_too_large');
    case 'export_too_many_rows':
      return new ApiError(422, 'export_too_many_rows');
    case 'export_unsupported':
      return new ApiError(415, 'export_unsupported');
    case 'export_no_header':
      return new ApiError(422, 'export_no_header');
    case 'export_list_unknown':
      return new ApiError(422, 'export_list_unknown', undefined, error.message);
    case 'export_column_missing':
      return new ApiError(422, 'export_column_missing', { column: columnOf(error.message) });
    default:
      return new ApiError(422, 'export_unreadable');
  }
}

const emptyResult = (file: SyncResult['file'], now: Date): SyncResult => ({
  file,
  startedAt: now.toISOString(),
  finishedAt: null,
  added: 0,
  updated: 0,
  unchanged: 0,
  skipped: {},
  examples: [],
  withoutCustomer: 0,
});

/** What the pane shows of a list's last import. */
export function syncView(row: ConnectorSyncRow | undefined) {
  const result = row?.result;
  if (!row || !result) return null;
  const code = row.lastError;
  const key = code ? `api.error.${code}` : null;
  return {
    status: code ? 'failed' : result.finishedAt ? 'done' : 'running',
    file: result.file && { name: result.file.name, size: result.file.size },
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    added: result.added,
    updated: result.updated,
    unchanged: result.unchanged,
    skipped: result.skipped,
    examples: result.examples,
    withoutCustomer: result.withoutCustomer,
    error:
      code && key
        ? { code, message: t(isMessageKey(key) ? key : 'api.error.erp_interrupted') }
        : null,
  } as const;
}

/** `GET /erp`: each list's last import, null for a list never given. */
export async function erpImports(deps: Pick<ApiDeps, 'db'>, tenant: TenantRow) {
  const rows = await deps.db
    .select()
    .from(connectorSyncs)
    .where(
      and(eq(connectorSyncs.tenantId, tenant.id), inArray(connectorSyncs.connector, ERP_SYNCS)),
    );
  return Object.fromEntries(
    EXPORT_LISTS.map((list) => [list, syncView(rows.find((r) => r.connector === syncKeyOf(list)))]),
  ) as Record<ExportList, ReturnType<typeof syncView>>;
}

/** Bytes nothing needs any more: no document keeps them, no import still reads them. */
async function dropFile(tx: Tx, tenantId: string, key: string) {
  await tx
    .delete(blobs)
    .where(
      and(
        eq(blobs.tenantId, tenantId),
        eq(blobs.key, key),
        sql`${blobs.key} not in (select ${documents.storageKey} from ${documents} where ${documents.tenantId} = ${tenantId})`,
        sql`${blobs.key} not in (select ${connectorSyncs.result}->'file'->>'key' from ${connectorSyncs} where ${connectorSyncs.tenantId} = ${tenantId} and ${connectorSyncs.result}->>'finishedAt' is null and ${connectorSyncs.result}->'file' is not null)`,
      ),
    );
}

/**
 * `POST /erp/imports?name=&list=`: the export read at once (a refusal keeps nothing), its bytes
 * kept, the list's sync row started over and its job queued. The same file again does nothing once
 * imported, and goes on from where it stopped if it did not finish.
 */
export async function importExport(
  deps: Pick<ApiDeps, 'db' | 'jobs' | 'now'>,
  tenant: TenantRow,
  query: { name?: string; list?: string },
  bytes: Uint8Array<ArrayBuffer>,
) {
  const name = uploadName(query.name);
  const said = query.list ? parse(List, query.list) : undefined;
  if (bytes.byteLength === 0) throw new ApiError(422, 'export_unreadable');
  if (bytes.byteLength > FILE_LIMITS.maxBytes) throw new ApiError(413, 'export_too_large');
  let sheet: Awaited<ReturnType<typeof readExport>>;
  try {
    sheet = await readExport({ name, bytes }, said);
  } catch (error) {
    if (isFatal(error)) throw refusal(error);
    throw error;
  }
  const { list } = sheet;
  const rows = dataRows(sheet.rows).length;
  const connector = syncKeyOf(list);
  const sha256 = sha256Of(bytes);
  const now = deps.now();

  const { row, again } = await deps.db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(connectorSyncs)
      .where(and(eq(connectorSyncs.tenantId, tenant.id), eq(connectorSyncs.connector, connector)))
      .for('update');
    const previous = before?.result;
    if (before && previous?.file?.sha256 === sha256) {
      if (previous.finishedAt && !before.lastError) return { row: before, again: true };
      // Not finished: the same bytes again (they may have gone with a failure), from the cursor.
      await postgresFiles.put(tx, { tenantId: tenant.id, bytes, mime: mimeOf(bytes) });
      const [resumed] = await tx
        .update(connectorSyncs)
        .set({ lastError: null, lastRunAt: now, updatedAt: now })
        .where(eq(connectorSyncs.id, before.id))
        .returning();
      return { row: resumed ?? before, again: true };
    }
    const stored = await postgresFiles.put(tx, {
      tenantId: tenant.id,
      bytes,
      mime: mimeOf(bytes),
    });
    const result = emptyResult({ name, sha256, key: stored.key, size: stored.size }, now);
    const [written] = await tx
      .insert(connectorSyncs)
      .values({ tenantId: tenant.id, connector, cursor: null, lastRunAt: now, result })
      .onConflictDoUpdate({
        target: [connectorSyncs.tenantId, connectorSyncs.connector],
        set: { cursor: null, lastRunAt: now, lastError: null, result, updatedAt: now },
      })
      .returning();
    if (!written) throw new ApiError(500, 'internal');
    // The file it replaces is read no more.
    if (previous?.file && previous.file.key !== stored.key) {
      await dropFile(tx, tenant.id, previous.file.key);
    }
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'erp.import',
      objectType: 'connector_sync',
      objectId: written.id,
      after: { list, name, sha256, size: stored.size, rows },
    });
    return { row: written, again: false };
  });
  const done = again && !!row.result?.finishedAt && !row.lastError;
  if (!done) await deps.jobs.enqueueErp(tenant.id, connector);
  return { status: done ? 200 : 202, body: { list, rows, again, import: syncView(row) } } as const;
}

// ── The job ───────────────────────────────────────────────────────────────────────────────────

type Counts = Pick<SyncResult, 'added' | 'updated' | 'unchanged' | 'withoutCustomer'> & {
  skipped: Skipped[];
};

const noCounts = (): Counts => ({
  added: 0,
  updated: 0,
  unchanged: 0,
  withoutCustomer: 0,
  skipped: [],
});

function added(result: SyncResult, counts: Counts): SyncResult {
  const skipped = { ...result.skipped };
  for (const s of counts.skipped) skipped[s.reason] = (skipped[s.reason] ?? 0) + 1;
  return {
    ...result,
    added: result.added + counts.added,
    updated: result.updated + counts.updated,
    unchanged: result.unchanged + counts.unchanged,
    withoutCustomer: result.withoutCustomer + counts.withoutCustomer,
    skipped,
    examples: [...result.examples, ...counts.skipped].slice(0, EXAMPLES),
  };
}

const isTiers = (r: ExportRow): r is { ok: true; value: TiersRow } => r.ok && 'siren' in r.value;
const isChantier = (r: ExportRow): r is { ok: true; value: ChantierRow } =>
  r.ok && 'code' in r.value && !('siren' in r.value);
const isFacture = (r: ExportRow): r is { ok: true; value: FactureRow } =>
  r.ok && 'number' in r.value;
const isReglement = (r: ExportRow): r is { ok: true; value: ReglementRow } =>
  r.ok && 'invoice' in r.value;

const partyFields = (p: typeof parties.$inferSelect): PartyFields => ({
  legalName: p.legalName,
  siren: p.siren,
  siret: p.siret,
  email: p.email,
  address: p.address as ErpAddress | null,
  erpRef: p.erpRef,
  subcontracting: p.subcontracting,
});

const chantierFields = (c: typeof chantiers.$inferSelect): ChantierFields & { id: string } => ({
  id: c.id,
  erpRef: c.erpRef ?? '',
  name: c.name,
  customerId: c.customerId,
  status: c.status,
  address: c.address as ErpAddress | null,
  receptionOn: c.receptionOn,
  reservesLiftedOn: c.reservesLiftedOn,
  retenueBps: c.retenueBps,
});

/** A batch of customers or suppliers: new ones added as the ERP writes them, known ones filled. */
async function applyParties(
  tx: Tx,
  tenantId: string,
  side: PartySide,
  rows: readonly ExportRow[],
  now: Date,
): Promise<Counts> {
  const counts = noCounts();
  const tiers = rows.filter(isTiers).map((r) => r.value);
  const known = tiers.length
    ? await tx
        .select()
        .from(parties)
        .where(
          and(
            eq(parties.tenantId, tenantId),
            eq(parties.kind, side),
            inArray(
              parties.siren,
              tiers.map((r) => r.siren),
            ),
          ),
        )
        .for('update')
    : [];
  const bySiren = new Map(known.map((p) => [p.siren, p]));
  const inserts: (typeof parties.$inferInsert)[] = [];
  for (const row of tiers) {
    const before = bySiren.get(row.siren);
    const change = partyChange(row, side, before && partyFields(before));
    if (change.kind === 'insert') {
      inserts.push({ tenantId, kind: side, ...change.values, source: 'erp', verifiedAt: null });
    } else if (change.kind === 'update' && before) {
      await tx
        .update(parties)
        .set({ ...change.values, updatedAt: now })
        .where(eq(parties.id, before.id));
      counts.updated++;
    } else {
      counts.unchanged++;
    }
  }
  if (inserts.length) {
    const written = await tx
      .insert(parties)
      .values(inserts)
      .onConflictDoNothing()
      .returning({ id: parties.id });
    counts.added += written.length;
    counts.unchanged += inserts.length - written.length;
  }
  for (const r of rows) if (!r.ok) counts.skipped.push(r.skipped);
  return counts;
}

/** A batch of chantiers: the ERP's, rewritten where it says something; its customer found. */
async function applyChantiers(
  tx: Tx,
  tenantId: string,
  rows: readonly ExportRow[],
  now: Date,
): Promise<Counts> {
  const counts = noCounts();
  const list = rows.filter(isChantier).map((r) => r.value);
  const customers = list.length
    ? await tx
        .select({
          id: parties.id,
          erpRef: parties.erpRef,
          siren: parties.siren,
          legalName: parties.legalName,
        })
        .from(parties)
        .where(and(eq(parties.tenantId, tenantId), eq(parties.kind, 'customer')))
    : [];
  const known = list.length
    ? await tx
        .select()
        .from(chantiers)
        .where(
          and(
            eq(chantiers.tenantId, tenantId),
            inArray(
              chantiers.erpRef,
              list.map((r) => r.code),
            ),
          ),
        )
        .for('update')
    : [];
  const byCode = new Map(known.map((c) => [c.erpRef, chantierFields(c)]));
  const inserts: (typeof chantiers.$inferInsert)[] = [];
  for (const row of list) {
    const before = byCode.get(row.code);
    const customerId = customerOf(row.customer, customers);
    if (!customerId && !before?.customerId) counts.withoutCustomer++;
    const change = chantierChange(row, customerId, before);
    if (change.kind === 'insert') {
      inserts.push({ tenantId, ...change.values });
    } else if (change.kind === 'update' && before) {
      await tx
        .update(chantiers)
        .set({ ...change.values, updatedAt: now })
        .where(eq(chantiers.id, before.id));
      counts.updated++;
    } else {
      counts.unchanged++;
    }
  }
  if (inserts.length) {
    const written = await tx
      .insert(chantiers)
      .values(inserts)
      .onConflictDoNothing()
      .returning({ id: chantiers.id });
    counts.added += written.length;
    counts.unchanged += inserts.length - written.length;
  }
  for (const r of rows) if (!r.ok) counts.skipped.push(r.skipped);
  return counts;
}

// ── Invoices and payments (stage 4B) ──────────────────────────────────────────────────────────

/** An ERP invoice is kept as the record the ERP gave, as JSON. */
const ERP_MIME = 'application/json';
const ERP = { actor: 'agent:erp', decidedBy: 'agent:erp', reason: 'deadline_done' };

/** One document per invoice number: a newer export rewrites it. */
const refOf = (number: string) => `facture:${number}`;

/** What the ERP said of an invoice, without the file's row: the same invoice is the same bytes. */
function recordOf(row: FactureRow) {
  const { row: _row, ...record } = row;
  return record;
}

/** A paid invoice's deadline closed and its reminders withdrawn, audited by the ERP. */
async function closePaid(
  tx: Tx,
  tenantId: string,
  id: string,
  why: Record<string, unknown>,
  now: Date,
) {
  await tx
    .update(obligations)
    .set({ status: 'done', closedAt: now, updatedAt: now })
    .where(eq(obligations.id, id));
  const withdrawn = await withdrawDrafts(tx, tenantId, eq(actions.obligationId, id), ERP, now);
  await audit(tx, {
    tenantId,
    actor: ERP.actor,
    action: 'obligation.close',
    objectType: 'obligation',
    objectId: id,
    before: { status: 'open' },
    after: { status: 'done', withdrawn: withdrawn.length, ...why },
  });
}

/** The customer and chantier the ERP names, set where the document and its deadline have none. */
async function fillLinks(
  tx: Tx,
  tenantId: string,
  documentId: string,
  key: string,
  links: { partyId: string | null; chantierId: string | null },
  now: Date,
) {
  if (!links.partyId && !links.chantierId) return;
  const set = <T extends typeof documents | typeof obligations>(table: T) => ({
    partyId: sql`coalesce(${table.partyId}, ${links.partyId})`,
    chantierId: sql`coalesce(${table.chantierId}, ${links.chantierId})`,
    updatedAt: now,
  });
  await tx.update(documents).set(set(documents)).where(eq(documents.id, documentId));
  await tx
    .update(obligations)
    .set(set(obligations))
    .where(
      and(
        eq(obligations.tenantId, tenantId),
        eq(obligations.key, key),
        or(isNull(obligations.partyId), isNull(obligations.chantierId)),
      ),
    );
}

/** An invoice's document written: new, or the same one rewritten with what the ERP says now. */
async function keepInvoice(
  tx: Tx,
  tenantId: string,
  before: DocumentRow | undefined,
  row: FactureRow,
  links: { partyId: string | null; chantierId: string | null },
  now: Date,
): Promise<DocumentRow> {
  const record = recordOf(row);
  const bytes = new TextEncoder().encode(canonical(record));
  const stored = await postgresFiles.put(tx, { tenantId, bytes, mime: ERP_MIME });
  const values = {
    name: row.number,
    mime: ERP_MIME,
    size: stored.size,
    sha256: stored.sha256,
    storageKey: stored.key,
    kind: row.kind === 'situation' ? 'situation' : 'facture_vente',
    stage: 'done',
    partyId: links.partyId ?? before?.partyId ?? null,
    chantierId: links.chantierId ?? before?.chantierId ?? null,
    extracted: { format: 'erp-json', record },
    updatedAt: now,
  } as const;
  const [doc] = before
    ? await tx.update(documents).set(values).where(eq(documents.id, before.id)).returning()
    : await tx
        .insert(documents)
        .values({
          tenantId,
          source: 'erp',
          sourceRef: refOf(row.number),
          hints: {},
          isTest: false,
          receivedAt: now,
          ...values,
        })
        .returning();
  if (!doc) throw new Error(`document of invoice ${row.number} not written`);
  if (before && before.storageKey !== stored.key) await dropFile(tx, tenantId, before.storageKey);
  return doc;
}

/** The invoices sent through Facture Impec among these numbers: CollectAgent chases those. */
async function sentHere(tx: Tx, tenantId: string, numbers: readonly string[]) {
  const rows = await tx
    .select({ number: invoices.number })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        eq(invoices.direction, 'out'),
        eq(invoices.isTest, false),
        inArray(invoices.number, [...numbers]),
      ),
    );
  return new Set(rows.map((r) => r.number));
}

/** The company's deadlines of these sales, locked: by key. */
async function salesDeadlines(tx: Tx, tenantId: string, keys: readonly string[]) {
  const rows = await tx
    .select({
      id: obligations.id,
      key: obligations.key,
      status: obligations.status,
      amount: obligations.amount,
    })
    .from(obligations)
    .where(and(eq(obligations.tenantId, tenantId), inArray(obligations.key, [...keys])))
    .for('update');
  return new Map(rows.map((o) => [o.key, o]));
}

/**
 * A batch of invoices: each owed one a document and its deadline (`facture_echeance`, the key the
 * PDP and the mail use, so a better source keeps its values); one with nothing left to pay closes
 * the deadline it has. An invoice sent through Facture Impec is left to CollectAgent.
 */
async function applyInvoices(
  tx: Tx,
  tenant: Pick<TenantRow, 'id' | 'siren'>,
  rows: readonly ExportRow[],
  now: Date,
): Promise<Counts> {
  const counts = noCounts();
  for (const r of rows) if (!r.ok) counts.skipped.push(r.skipped);
  const list = rows.filter(isFacture).map((r) => r.value);
  if (!list.length) return counts;
  const skip = (row: FactureRow, reason: Skipped['reason']) =>
    counts.skipped.push({ row: row.row, name: row.number, reason });
  const sent = await sentHere(
    tx,
    tenant.id,
    list.map((r) => r.number),
  );
  const docs = await tx
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenant.id),
        eq(documents.source, 'erp'),
        eq(documents.isTest, false),
        inArray(
          documents.sourceRef,
          list.map((r) => refOf(r.number)),
        ),
      ),
    )
    .for('update');
  const docOf = new Map(docs.map((d) => [d.sourceRef, d]));
  const deadlines = await salesDeadlines(
    tx,
    tenant.id,
    list.map((r) => saleDeadlineKey(tenant.siren, r.number, false)),
  );
  const customers = await tx
    .select({
      id: parties.id,
      erpRef: parties.erpRef,
      siren: parties.siren,
      legalName: parties.legalName,
    })
    .from(parties)
    .where(and(eq(parties.tenantId, tenant.id), eq(parties.kind, 'customer')));
  const known = await tx
    .select({ id: chantiers.id, erpRef: chantiers.erpRef, name: chantiers.name })
    .from(chantiers)
    .where(eq(chantiers.tenantId, tenant.id));

  for (const row of list) {
    if (sent.has(row.number)) {
      skip(row, 'sent_here');
      continue;
    }
    const key = saleDeadlineKey(tenant.siren, row.number, false);
    const payable = row.left ?? row.total ?? 0;
    const before = docOf.get(refOf(row.number));
    const changed = before?.sha256 !== sha256Of(new TextEncoder().encode(canonical(recordOf(row))));
    const partyId = customerOf(row.customer, customers);
    const links = { partyId, chantierId: chantierOf(row.chantier, known) };
    const deadline = deadlines.get(key);

    if (payable === 0) {
      // Paid: whichever source made the deadline, the ERP knows it is paid.
      const closing = deadline?.status === 'open';
      if (deadline && closing) {
        await closePaid(tx, tenant.id, deadline.id, { source: 'erp', number: row.number }, now);
        deadline.status = 'done';
      }
      if (before && changed) await keepInvoice(tx, tenant.id, before, row, links, now);
      if (closing || (before && changed)) counts.updated++;
      else if (before || deadline) counts.unchanged++;
      else skip(row, 'paid');
      continue;
    }
    // Owed to a customer nobody knows: no reminder can go (the customers' list is given next).
    if (!partyId && !before?.partyId) counts.withoutCustomer++;
    if (before && !changed) {
      const filling =
        (links.partyId && !before.partyId) || (links.chantierId && !before.chantierId);
      if (filling) await fillLinks(tx, tenant.id, before.id, key, links, now);
      if (filling) counts.updated++;
      else counts.unchanged++;
      continue;
    }
    const doc = await keepInvoice(tx, tenant.id, before, row, links, now);
    const drafts = deriveObligations({
      documentId: doc.id,
      kind: 'facture_vente',
      fields: { issuedOn: null, validTo: null, receptionOn: null },
      siren: customers.find((c) => c.id === partyId)?.siren ?? row.customer?.siren ?? null,
      invoice: { number: row.number, sellerSiren: tenant.siren, dueDate: row.dueOn, payable },
      isTest: false,
    });
    await saveObligations(tx, doc, drafts, doc.partyId, now);
    // A better source kept its values: the ERP still says whose and which chantier it is.
    await fillLinks(tx, tenant.id, doc.id, key, links, now);
    if (before) counts.updated++;
    else counts.added++;
  }
  return counts;
}

/**
 * A batch of payments: one that pays what is left closes its invoice's deadline. A smaller one is
 * counted, not summed (docs/DEFERRED.md); a payment of an invoice not known is counted too.
 */
async function applyPayments(
  tx: Tx,
  tenant: Pick<TenantRow, 'id' | 'siren'>,
  rows: readonly ExportRow[],
  now: Date,
): Promise<Counts> {
  const counts = noCounts();
  for (const r of rows) if (!r.ok) counts.skipped.push(r.skipped);
  const list = rows.filter(isReglement).map((r) => r.value);
  if (!list.length) return counts;
  const skip = (p: ReglementRow, reason: Skipped['reason']) =>
    counts.skipped.push({ row: p.row, name: p.invoice, reason });
  const keyOf = (p: ReglementRow) => saleDeadlineKey(tenant.siren, p.invoice, false);
  const deadlines = await salesDeadlines(tx, tenant.id, list.map(keyOf));
  const sent = await sentHere(
    tx,
    tenant.id,
    list.map((p) => p.invoice),
  );
  for (const p of list) {
    const deadline = deadlines.get(keyOf(p));
    if (!deadline) skip(p, sent.has(p.invoice) ? 'sent_here' : 'invoice_unknown');
    else if (deadline.status !== 'open') counts.unchanged++;
    else if (deadline.amount !== null && p.amount < deadline.amount) skip(p, 'partial_payment');
    else {
      await closePaid(
        tx,
        tenant.id,
        deadline.id,
        { source: 'erp', number: p.invoice, paidOn: p.paidOn ?? null, amount: p.amount },
        now,
      );
      deadline.status = 'done';
      counts.updated++;
    }
  }
  return counts;
}

/** The sync row, locked, if it still reads this file and has not finished. */
async function stillReading(tx: Tx, id: string, sha256: string) {
  const [row] = await tx
    .select()
    .from(connectorSyncs)
    .where(eq(connectorSyncs.id, id))
    .for('update');
  const result = row?.result;
  return row && result?.file?.sha256 === sha256 && !result.finishedAt ? { row, result } : null;
}

async function failed(db: Db, id: string, sha256: string, code: string, now: Date) {
  await db.transaction(async (tx) => {
    if (!(await stillReading(tx, id, sha256))) return;
    await tx
      .update(connectorSyncs)
      .set({ lastError: code, lastRunAt: now, updatedAt: now })
      .where(eq(connectorSyncs.id, id));
  });
}

function applyBatch(
  tx: Tx,
  tenant: Pick<TenantRow, 'id' | 'siren'>,
  list: ExportList,
  rows: readonly ExportRow[],
  now: Date,
): Promise<Counts> {
  switch (list) {
    case 'customers':
    case 'suppliers':
      return applyParties(tx, tenant.id, list === 'suppliers' ? 'supplier' : 'customer', rows, now);
    case 'chantiers':
      return applyChantiers(tx, tenant.id, rows, now);
    case 'invoices':
      return applyInvoices(tx, tenant, rows, now);
    case 'payments':
      return applyPayments(tx, tenant, rows, now);
  }
}

/**
 * `erp.sync`: one list of one company, from its cursor to the end. A fatal error (the file gone, a
 * file that no longer reads) stops at once and says why; anything else is thrown for the queue to try
 * again, from the last batch written. A file replaced meanwhile stops the run: the new one has its
 * own job. `connector` is the export's unless a test stops it in the middle.
 */
export async function runErpSync(
  deps: { db: Db; now: () => Date },
  tenantId: string,
  key: string,
  connector: Connector<ExportConfig, ExportRow> = exportConnector,
): Promise<void> {
  const list = listOf(key);
  if (!list) return;
  const [row] = await deps.db
    .select()
    .from(connectorSyncs)
    .where(and(eq(connectorSyncs.tenantId, tenantId), eq(connectorSyncs.connector, key)));
  const file = row?.result?.file;
  if (!row || !file || row.result?.finishedAt) return;
  const [tenant] = await deps.db
    .select({ id: tenants.id, siren: tenants.siren })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)));
  if (!tenant) return;
  const stored = await postgresFiles.get(deps.db, tenantId, file.key);
  if (!stored) {
    await failed(deps.db, row.id, file.sha256, 'export_missing', deps.now());
    return;
  }
  const cfg: ExportConfig = {
    file: { name: file.name, bytes: new Uint8Array(stored) },
    sha256: file.sha256,
    list,
  };
  const cursor = row.cursor ? (CursorJson.safeParse(row.cursor).data ?? null) : null;
  try {
    for await (const batch of connector.pull(cfg, cursor as Cursor | null)) {
      const going = await deps.db.transaction(async (tx) => {
        const now = deps.now();
        const reading = await stillReading(tx, row.id, file.sha256);
        if (!reading) return false;
        const counts = await applyBatch(tx, tenant, list, batch.rows, now);
        await tx
          .update(connectorSyncs)
          .set({
            cursor: batch.nextCursor,
            result: added(reading.result, counts),
            lastRunAt: now,
            lastError: null,
            updatedAt: now,
          })
          .where(eq(connectorSyncs.id, row.id));
        return true;
      });
      if (!going) return;
    }
  } catch (error) {
    await failed(
      deps.db,
      row.id,
      file.sha256,
      isFatal(error) ? error.code : 'erp_interrupted',
      deps.now(),
    );
    if (isFatal(error)) return;
    throw error;
  }
  await deps.db.transaction(async (tx) => {
    const now = deps.now();
    const reading = await stillReading(tx, row.id, file.sha256);
    if (!reading) return;
    const result = { ...reading.result, finishedAt: now.toISOString() };
    await tx
      .update(connectorSyncs)
      .set({ result, lastOkAt: now, lastRunAt: now, lastError: null, updatedAt: now })
      .where(eq(connectorSyncs.id, row.id));
    // Its rows are written: the file is read no more.
    await dropFile(tx, tenantId, file.key);
    const skipped = Object.values(result.skipped).reduce((a, b) => a + b, 0);
    await audit(tx, {
      tenantId,
      actor: 'agent:erp',
      action: 'erp.sync',
      objectType: 'connector_sync',
      objectId: row.id,
      after: {
        list,
        sha256: file.sha256,
        added: result.added,
        updated: result.updated,
        unchanged: result.unchanged,
        skipped,
      },
    });
  });
}
