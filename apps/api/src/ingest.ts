// Every file the back end receives becomes one document (BTP plan §5, stage 1): its bytes say what it
// is (never its name or declared type), its SHA-256 makes the same file twice one document per
// company and mode, its bytes go to the FileStore and the queue `document.ingest` reads it. A company
// sending faster than the worker reads is asked to wait (429) before anything is stored.
import {
  type ContextInput,
  type Invoice,
  isCreditNote,
  parisToday,
  partySiren,
  validate,
} from '@fi/core';
import {
  and,
  asc,
  audit,
  count,
  type Db,
  type DbOrTx,
  type DocumentRow,
  documents,
  eq,
  inboundQueue,
  isNull,
  lt,
  type PartyRow,
  parties,
  type TenantRow,
  type Tx,
  tenants,
} from '@fi/db';
import {
  DocumentEnvelope,
  type DocumentKind,
  type DocumentSource,
  type EnvelopeHints,
  MAX_DOCUMENT_BYTES,
} from '@fi/domain';
import { z } from 'zod';
import type { ApiDeps, Jobs } from './deps';
import { ApiError } from './errors';
import { type FileStore, postgresFiles } from './files';
import { buyerSettings } from './invoices';
import { type Reading, readDocument } from './reading';

/** Documents of one company waiting to be read; past this, a new one waits (429). */
export const INGEST_BACKLOG = 200;
const RETRY_AFTER_SECONDS = 60;
/** Text kept from a document: the first pages of a long contract say what it is. */
export const MAX_TEXT = 100_000;
/** A document the worker has not finished after this long is queued again by the sweep. */
const STUCK_MS = 10 * 60_000;

const startsWith = (bytes: Uint8Array, signature: readonly number[]) =>
  signature.every((b, i) => bytes[i] === b);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** What the bytes are; null: nothing the worker reads. */
export function sniffMime(bytes: Uint8Array): DocumentEnvelope['mime'] | null {
  if (startsWith(bytes, ascii('%PDF-'))) return 'application/pdf';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, ...ascii('PNG\r\n'), 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, ascii('II*\0')) || startsWith(bytes, ascii('MM\0*'))) return 'image/tiff';
  const head = new TextDecoder().decode(bytes.subarray(0, 512)).replace(/^﻿/, '').trimStart();
  // A web page starts with a tag too; it is no invoice (an e-mail's body saved as a file).
  if (/^<(!doctype\s+html|html)[\s>]/i.test(head)) return null;
  if (/^<(\?xml|[A-Za-z])/.test(head)) return 'application/xml';
  return null;
}

/** The name as shown: without a path, trimmed, 255 characters at most. */
export function documentName(value: string | undefined): string {
  const name = (value ?? '').split(/[\\/]/).at(-1)?.trim() ?? '';
  if (!name) throw new ApiError(400, 'invalid_request', undefined, 'name');
  return name.slice(0, 255);
}

export interface IngestRequest {
  source: DocumentSource;
  /** The source's own id: an upload, a message, a drive item, a platform document. */
  sourceRef: string;
  name: string;
  bytes: Uint8Array;
  isTest: boolean;
  receivedAt: Date;
  hints?: EnvelopeHints;
}

export interface Ingested {
  document: DocumentRow;
  /** False: the same bytes were already a document of this company and mode; nothing was stored. */
  created: boolean;
}

/** Inside the caller's transaction: the bytes kept, the document made, or the one already there. */
export async function storeDocument(
  tx: Tx,
  tenant: Pick<TenantRow, 'id'>,
  request: IngestRequest,
  files: FileStore = postgresFiles,
  actor: 'user' | 'api' | 'pdp' = 'api',
): Promise<Ingested> {
  const { bytes } = request;
  if (bytes.byteLength === 0) throw new ApiError(422, 'ingest_empty');
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new ApiError(413, 'ingest_too_large');
  const mime = sniffMime(bytes);
  if (!mime) throw new ApiError(415, 'ingest_unsupported');
  const stored = await files.put(tx, { tenantId: tenant.id, bytes, mime });
  const envelope = DocumentEnvelope.parse({
    tenantId: tenant.id,
    source: request.source,
    sourceRef: request.sourceRef.slice(0, 500),
    receivedAt: request.receivedAt.toISOString(),
    name: request.name,
    mime,
    size: stored.size,
    storageKey: stored.key,
    sha256: stored.sha256,
    hints: request.hints ?? {},
    isTest: request.isTest,
  });
  const { structured: _structured, receivedAt: _receivedAt, ...row } = envelope;
  const [created] = await tx
    .insert(documents)
    .values({ ...row, receivedAt: request.receivedAt })
    .onConflictDoNothing()
    .returning();
  if (created) {
    await audit(tx, {
      tenantId: tenant.id,
      actor,
      action: 'document.ingest',
      objectType: 'document',
      objectId: created.id,
      after: { source: created.source, name: created.name, mime, size: created.size },
    });
    return { document: created, created: true };
  }
  const [existing] = await tx
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.tenantId, tenant.id),
        eq(documents.isTest, request.isTest),
        eq(documents.sha256, stored.sha256),
      ),
    );
  if (!existing) throw new Error(`document ${stored.sha256} neither inserted nor found`);
  return { document: existing, created: false };
}

export const IngestQuery = z.object({
  /** Sent in « Mode test »: a test document never makes a real deadline or action. */
  test: z.stringbool().default(false),
});

/** One document of the company; a malformed id is one it does not have. */
export async function getDocument(
  deps: Pick<ApiDeps, 'db'>,
  tenant: Pick<TenantRow, 'id'>,
  id: string,
): Promise<DocumentRow> {
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, 'document_not_found');
  const [row] = await deps.db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.tenantId, tenant.id)));
  if (!row) throw new ApiError(404, 'document_not_found');
  return row;
}

/** Not read yet: `ingested` with nothing extracted (a text document waits there for stage 2). */
const unread = (tenantId: string) =>
  and(
    eq(documents.tenantId, tenantId),
    eq(documents.stage, 'ingested'),
    isNull(documents.extracted),
  );

/** A company with too many documents waiting is asked to come back (429); nothing is stored. */
export async function checkBacklog(db: Db, tenantId: string): Promise<void> {
  const [waiting] = await db.select({ n: count() }).from(documents).where(unread(tenantId));
  if ((waiting?.n ?? 0) >= INGEST_BACKLOG) {
    throw new ApiError(429, 'ingest_busy', undefined, undefined, {
      'retry-after': String(RETRY_AFTER_SECONDS),
    });
  }
}

export async function ingestFile(
  deps: { db: Db; jobs: Pick<Jobs, 'enqueueIngest'>; files?: FileStore },
  tenant: Pick<TenantRow, 'id'>,
  request: IngestRequest,
  options: { actor?: 'user' | 'api' | 'pdp'; backpressure?: boolean } = {},
): Promise<Ingested> {
  if (options.backpressure) await checkBacklog(deps.db, tenant.id);
  const result = await deps.db.transaction((tx) =>
    storeDocument(tx, tenant, request, deps.files, options.actor),
  );
  if (result.created) await deps.jobs.enqueueIngest(result.document.id);
  return result;
}

/**
 * The `pdp` adapter (BTP plan §5): each supplier invoice the platforms delivered (src/workers.ts
 * runInboundPoll) is also a document, read and checked like any other. Runs after each poll, and
 * catches up on invoices received before stage 1.
 */
export async function inboundDocuments(
  deps: { db: Db; jobs: Pick<Jobs, 'enqueueIngest'>; files?: FileStore },
  log: (message: string) => void = () => {},
): Promise<number> {
  const waiting = await deps.db
    .select({
      id: inboundQueue.id,
      tenantId: inboundQueue.tenantId,
      pdpRef: inboundQueue.pdpRef,
      xml: inboundQueue.xml,
      isTest: inboundQueue.isTest,
      receivedAt: inboundQueue.receivedAt,
    })
    .from(inboundQueue)
    .innerJoin(tenants, and(eq(tenants.id, inboundQueue.tenantId), isNull(tenants.deletedAt)))
    .where(isNull(inboundQueue.documentId))
    .orderBy(asc(inboundQueue.receivedAt))
    .limit(200);
  let made = 0;
  for (const r of waiting) {
    try {
      const { document, created } = await deps.db.transaction(async (tx) => {
        const stored = await storeDocument(
          tx,
          { id: r.tenantId },
          {
            source: 'pdp',
            sourceRef: r.pdpRef,
            name: documentName(`${r.pdpRef.replace(/[\\/]/g, '-')}.xml`),
            bytes: new TextEncoder().encode(r.xml),
            isTest: r.isTest,
            receivedAt: r.receivedAt,
          },
          deps.files,
          'pdp',
        );
        await tx
          .update(inboundQueue)
          .set({ documentId: stored.document.id })
          .where(eq(inboundQueue.id, r.id));
        return stored;
      });
      if (created) await deps.jobs.enqueueIngest(document.id);
      made++;
    } catch (e) {
      log(`inbound ${r.id} as a document: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return made;
}

// ── The queue `document.ingest`: read, then sort what can be sorted without a model ─────────────────

/** What a document became once read, before stage 2's classifier. */
interface Outcome {
  kind: DocumentKind | null;
  stage: DocumentRow['stage'];
  reviewReason: string | null;
  extracted: Record<string, unknown>;
}

/** An invoice's own data says which side the company is on; its type code, a credit note. */
function sortInvoice(reading: Extract<Reading, { kind: 'invoice' }>, siren: string): Outcome {
  const seller = partySiren(reading.invoice.seller);
  const buyer = partySiren(reading.invoice.buyer);
  const direction = seller === siren ? 'out' : buyer === siren ? 'in' : null;
  const extracted = { format: reading.format, direction, invoice: reading.invoice };
  if (!direction)
    return { kind: null, stage: 'needs_review', reviewReason: 'other_company', extracted };
  const kind = isCreditNote(reading.invoice)
    ? 'avoir'
    : direction === 'out'
      ? 'facture_vente'
      : 'facture_achat';
  return { kind, stage: 'classified', reviewReason: null, extracted };
}

function outcomeOf(reading: Reading, siren: string): Outcome {
  if (reading.kind === 'invoice') return sortInvoice(reading, siren);
  if (reading.kind === 'unreadable') {
    return { kind: null, stage: 'needs_review', reviewReason: reading.reason, extracted: {} };
  }
  const long = reading.text.length > MAX_TEXT;
  return {
    kind: null,
    // Read; what it is waits for stage 2's classifier.
    stage: 'ingested',
    reviewReason: null,
    extracted: {
      text: long ? reading.text.slice(0, MAX_TEXT) : reading.text,
      ocr: reading.ocr,
      pages: reading.pages,
      truncated: reading.truncated || long,
    },
  };
}

export interface DocumentDeps {
  db: Db;
  jobs: Pick<Jobs, 'enqueueValidate'>;
  files?: FileStore;
  now: () => Date;
}

/** Reads one document; safe to run twice (a document read already is left as it is). */
export async function runDocumentIngest(deps: DocumentDeps, documentId: string): Promise<void> {
  const [doc] = await deps.db.select().from(documents).where(eq(documents.id, documentId));
  if (doc?.stage !== 'ingested' || doc.extracted !== null) return;
  const [tenant] = await deps.db
    .select({ siren: tenants.siren, deletedAt: tenants.deletedAt })
    .from(tenants)
    .where(eq(tenants.id, doc.tenantId));
  if (!tenant || tenant.deletedAt) return;
  const bytes = await (deps.files ?? postgresFiles).get(deps.db, doc.tenantId, doc.storageKey);
  const outcome: Outcome = bytes
    ? outcomeOf(await readDocument(bytes, doc.mime), tenant.siren)
    : { kind: null, stage: 'needs_review', reviewReason: 'missing_file', extracted: {} };
  const moved = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(documents)
      .set({ ...outcome, updatedAt: deps.now() })
      .where(
        and(eq(documents.id, doc.id), eq(documents.stage, 'ingested'), isNull(documents.extracted)),
      )
      .returning({ id: documents.id });
    if (!row) return false;
    await audit(tx, {
      tenantId: doc.tenantId,
      actor: 'agent:ingest',
      action: 'document.read',
      objectType: 'document',
      objectId: doc.id,
      after: {
        kind: outcome.kind,
        stage: outcome.stage,
        reviewReason: outcome.reviewReason,
        ...(typeof outcome.extracted.ocr === 'boolean' && { ocr: outcome.extracted.ocr }),
        ...(typeof outcome.extracted.format === 'string' && { format: outcome.extracted.format }),
      },
    });
    return true;
  });
  if (moved && outcome.stage === 'classified') await deps.jobs.enqueueValidate(doc.id);
}

// ── The queue `document.validate`: the invoice's rules, BTP included ───────────────────────────────

async function partyOf(db: DbOrTx, tenantId: string, kind: PartyRow['kind'], siren?: string) {
  if (!siren) return null;
  const [party] = await db
    .select()
    .from(parties)
    .where(and(eq(parties.tenantId, tenantId), eq(parties.kind, kind), eq(parties.siren, siren)));
  return party ?? null;
}

/**
 * The rules an invoice document answers to, with what the company said: of the customer (its fiche)
 * on a sale, of the supplier on a purchase, and the BTP context for a building firm.
 */
function contextOf(
  tenant: TenantRow,
  direction: 'in' | 'out',
  party: PartyRow | null,
  now: Date,
): ContextInput {
  return {
    today: parisToday(now),
    ...(direction === 'out' && {
      seller: { vatOnDebits: tenant.vatOnDebits },
      buyer: buyerSettings(party),
    }),
    ...(tenant.btp && { btp: { subcontracting: party?.subcontracting ?? false } }),
  };
}

export async function runDocumentValidate(deps: DocumentDeps, documentId: string): Promise<void> {
  const [doc] = await deps.db.select().from(documents).where(eq(documents.id, documentId));
  if (doc?.stage !== 'classified') return;
  const [tenant] = await deps.db.select().from(tenants).where(eq(tenants.id, doc.tenantId));
  if (!tenant || tenant.deletedAt) return;
  const extracted = doc.extracted as { direction?: 'in' | 'out'; invoice?: Invoice } | null;
  const invoice = extracted?.invoice;
  const direction = extracted?.direction;
  if (!invoice || !direction) return;
  const other = direction === 'out' ? invoice.buyer : invoice.seller;
  const party = await partyOf(
    deps.db,
    tenant.id,
    direction === 'out' ? 'customer' : 'supplier',
    partySiren(other),
  );
  const issues = validate(invoice, contextOf(tenant, direction, party, deps.now()));
  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(documents)
      .set({
        stage: 'validated',
        validation: issues,
        partyId: party?.id ?? null,
        updatedAt: deps.now(),
      })
      .where(and(eq(documents.id, doc.id), eq(documents.stage, 'classified')))
      .returning({ id: documents.id });
    if (!row) return;
    await audit(tx, {
      tenantId: doc.tenantId,
      actor: 'agent:ingest',
      action: 'document.validate',
      objectType: 'document',
      objectId: doc.id,
      after: {
        errors: issues.filter((i) => i.severity === 'error').map((i) => i.ruleId),
        warnings: issues.filter((i) => i.severity === 'warning').map((i) => i.ruleId),
      },
    });
  });
}

/** Documents a worker left half-way (a crash, a deploy): the sweep queues them again. */
export async function documentsBehind(
  db: Db,
  now: Date,
): Promise<{ read: string[]; validate: string[] }> {
  const before = new Date(now.getTime() - STUCK_MS);
  const stuck = (stage: 'ingested' | 'classified') =>
    db
      .select({ id: documents.id })
      .from(documents)
      .innerJoin(tenants, and(eq(tenants.id, documents.tenantId), isNull(tenants.deletedAt)))
      .where(
        and(
          eq(documents.stage, stage),
          stage === 'ingested' ? isNull(documents.extracted) : undefined,
          lt(documents.updatedAt, before),
        ),
      )
      .limit(500);
  const [read, check] = await Promise.all([stuck('ingested'), stuck('classified')]);
  return { read: read.map((r) => r.id), validate: check.map((r) => r.id) };
}

/** The pane's and the API's view: never the bytes, nor the text read (stage 2 shows what matters). */
export function documentView(row: DocumentRow) {
  const extracted = row.extracted ?? {};
  const issues = row.validation ?? [];
  return {
    id: row.id,
    source: row.source,
    name: row.name,
    mime: row.mime,
    size: row.size,
    sha256: row.sha256,
    kind: row.kind,
    stage: row.stage,
    reviewReason: row.reviewReason,
    isTest: row.isTest,
    read:
      row.extracted === null
        ? null
        : {
            format: typeof extracted.format === 'string' ? extracted.format : null,
            ocr: extracted.ocr === true,
            pages: typeof extracted.pages === 'number' ? extracted.pages : null,
          },
    findings: row.validation
      ? {
          errors: issues.filter((i) => i.severity === 'error').length,
          warnings: issues.filter((i) => i.severity === 'warning').length,
        }
      : null,
    receivedAt: row.receivedAt.toISOString(),
  };
}
