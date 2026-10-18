// Ten-year archive (plan §10): every invoice sent for real, as the XML the platform took plus our PDF,
// and every real supplier invoice as received. Rows are written once: a database trigger refuses any
// change, and any deletion before keep_until (packages/db/drizzle/0007_gaps.sql). Each row's chain
// hashes the company's previous chain with this row, so a row changed or removed behind the trigger's
// back breaks every chain after it; « vérifier l'archive » recomputes them (docs/RUNBOOK.md).
import { createHash } from 'node:crypto';
import { parseInvoiceXml } from '@fi/core';
import { bundledFonts } from '@fi/core/fonts';
import { type FacturXOptions, toFacturXPdf } from '@fi/core/pdf';
import {
  and,
  asc,
  type Db,
  type DbOrTx,
  desc,
  eq,
  type InvoiceRow,
  invoiceArchive,
  invoices,
  isNotNull,
  isNull,
  sha256,
  sql,
  type Tx,
} from '@fi/db';

export const KEEP_YEARS = 10;

/** Archived per sweep; the rest wait for the next one. */
const BATCH = 100;

const bytesSha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** The same calendar day KEEP_YEARS later (29 February gives 1 March). */
export function keepUntil(now: Date): string {
  const d = new Date(now);
  d.setUTCFullYear(d.getUTCFullYear() + KEEP_YEARS);
  return d.toISOString().slice(0, 10);
}

interface Entry {
  tenantId: string;
  direction: 'out' | 'in';
  invoiceId?: string;
  inboundId?: string;
  number: string | null;
  issueDate: string | null;
  xml: string;
  pdf?: Uint8Array;
}

interface Chained {
  tenantId: string;
  direction: string;
  invoiceId: string | null;
  inboundId: string | null;
  number: string | null;
  issueDate: string | null;
  xmlSha256: string;
  pdfSha256: string | null;
  keepUntil: string;
}

/** The previous chain (or the company's id for its first row) followed by this row's facts. */
export function chainOf(previous: string | null, row: Chained): string {
  return sha256(
    [
      previous ?? `genesis:${row.tenantId}`,
      row.direction,
      row.invoiceId ?? row.inboundId ?? '',
      row.number ?? '',
      row.issueDate ?? '',
      row.xmlSha256,
      row.pdfSha256 ?? '',
      row.keepUntil,
    ].join('\u0000'),
  );
}

/** Appends one row to the company's chain; an invoice already archived is left as it is. */
async function append(tx: Tx, entry: Entry, now: Date): Promise<boolean> {
  // One writer per company at a time, so each row chains the one before it.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${`invoice_archive:${entry.tenantId}`}))`,
  );
  const [previous] = await tx
    .select({ chain: invoiceArchive.chain })
    .from(invoiceArchive)
    .where(eq(invoiceArchive.tenantId, entry.tenantId))
    .orderBy(desc(invoiceArchive.id))
    .limit(1);
  const facts: Chained = {
    tenantId: entry.tenantId,
    direction: entry.direction,
    invoiceId: entry.invoiceId ?? null,
    inboundId: entry.inboundId ?? null,
    number: entry.number,
    issueDate: entry.issueDate,
    xmlSha256: sha256(entry.xml),
    pdfSha256: entry.pdf ? bytesSha256(entry.pdf) : null,
    keepUntil: keepUntil(now),
  };
  const [row] = await tx
    .insert(invoiceArchive)
    .values({
      ...facts,
      direction: entry.direction,
      xml: entry.xml,
      pdf: entry.pdf ? Buffer.from(entry.pdf).toString('base64') : null,
      chain: chainOf(previous?.chain ?? null, facts),
      archivedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: invoiceArchive.id });
  return Boolean(row);
}

/** Number and date for the register; a supplier XML we cannot read is archived without them. */
function headerOf(xml: string): { number: string | null; issueDate: string | null } {
  try {
    const { invoice } = parseInvoiceXml(xml);
    return { number: invoice.number ?? null, issueDate: invoice.issueDate ?? null };
  } catch {
    return { number: null, issueDate: null };
  }
}

/** A real supplier invoice, in the transaction that stores it (src/workers.ts pollOne). */
export async function archiveReceived(
  tx: Tx,
  received: { tenantId: string; inboundId: string; xml: string },
  now: Date,
): Promise<void> {
  await append(tx, { ...received, direction: 'in', ...headerOf(received.xml) }, now);
}

export interface ArchiveDeps {
  db: Db;
  /** Absent in workers built without them: the bundled fonts, read once. */
  fonts?: FacturXOptions['fonts'];
  now: () => Date;
}

let fonts: FacturXOptions['fonts'] | undefined;
function fontsOf(deps: ArchiveDeps): FacturXOptions['fonts'] {
  if (deps.fonts) return deps.fonts;
  fonts ??= bundledFonts();
  return fonts;
}

/** Real invoices the platform took (they have its reference) and that are not archived yet. */
const unarchived = and(
  eq(invoices.direction, 'out'),
  eq(invoices.isTest, false),
  isNotNull(invoices.pdpRef),
  isNotNull(invoices.xmlCii),
);

async function archiveRow(deps: ArchiveDeps, row: InvoiceRow): Promise<boolean> {
  if (!row.xmlCii) return false;
  const now = deps.now();
  // The PDF is made once, here: made again later it would differ (its creation date).
  const pdf = await toFacturXPdf(row.document, { fonts: fontsOf(deps), now });
  const xml = row.xmlCii;
  return deps.db.transaction((tx) =>
    append(
      tx,
      {
        tenantId: row.tenantId,
        direction: 'out',
        invoiceId: row.id,
        number: row.number,
        issueDate: row.issueDate,
        xml,
        pdf,
      },
      now,
    ),
  );
}

/** After a real deposit (src/workers.ts runSend); the sweep catches up on any it missed. */
export async function archiveSent(deps: ArchiveDeps, invoiceId: string): Promise<boolean> {
  const [row] = await deps.db
    .select()
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), unarchived));
  return row ? archiveRow(deps, row) : false;
}

export async function runArchive(
  deps: ArchiveDeps,
  log: (message: string) => void = () => {},
): Promise<number> {
  const rows = await deps.db
    .select({ invoice: invoices })
    .from(invoices)
    .leftJoin(invoiceArchive, eq(invoiceArchive.invoiceId, invoices.id))
    .where(and(unarchived, isNull(invoiceArchive.id)))
    .limit(BATCH);
  let archived = 0;
  for (const { invoice } of rows) {
    try {
      if (await archiveRow(deps, invoice)) archived++;
    } catch (e) {
      log(`archive ${invoice.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return archived;
}

/** « Voir le PDF » of a sent invoice: the PDF archived with it, when there is one. */
export async function archivedPdf(
  db: DbOrTx,
  tenantId: string,
  invoiceId: string,
): Promise<Uint8Array | null> {
  const [row] = await db
    .select({ pdf: invoiceArchive.pdf })
    .from(invoiceArchive)
    .where(and(eq(invoiceArchive.tenantId, tenantId), eq(invoiceArchive.invoiceId, invoiceId)));
  return row?.pdf ? new Uint8Array(Buffer.from(row.pdf, 'base64')) : null;
}

export interface ArchiveCheck {
  rows: number;
  ok: boolean;
  /** The first row whose content or chain does not match, oldest first. */
  broken: { id: number; problem: 'xml' | 'pdf' | 'chain' } | null;
  lastChain: string | null;
}

/** Recomputes every hash and chain of one company, oldest first (GET /admin/tenants/:id/archive). */
export async function verifyArchive(db: DbOrTx, tenantId: string): Promise<ArchiveCheck> {
  const rows = await db
    .select()
    .from(invoiceArchive)
    .where(eq(invoiceArchive.tenantId, tenantId))
    .orderBy(asc(invoiceArchive.id));
  let previous: string | null = null;
  for (const row of rows) {
    const pdf = row.pdf ? Buffer.from(row.pdf, 'base64') : null;
    const problem =
      sha256(row.xml) !== row.xmlSha256
        ? 'xml'
        : (pdf ? bytesSha256(pdf) : null) !== row.pdfSha256
          ? 'pdf'
          : chainOf(previous, row) !== row.chain
            ? 'chain'
            : null;
    if (problem) {
      return { rows: rows.length, ok: false, broken: { id: row.id, problem }, lastChain: null };
    }
    previous = row.chain;
  }
  return { rows: rows.length, ok: true, broken: null, lastChain: previous };
}

/** What the RGPD export lists: the register, not the documents (they stay in the archive). */
export async function archiveRegister(db: DbOrTx, tenantId: string) {
  const rows = await db
    .select({
      direction: invoiceArchive.direction,
      invoiceId: invoiceArchive.invoiceId,
      inboundId: invoiceArchive.inboundId,
      number: invoiceArchive.number,
      issueDate: invoiceArchive.issueDate,
      xmlSha256: invoiceArchive.xmlSha256,
      pdfSha256: invoiceArchive.pdfSha256,
      archivedAt: invoiceArchive.archivedAt,
      keepUntil: invoiceArchive.keepUntil,
    })
    .from(invoiceArchive)
    .where(eq(invoiceArchive.tenantId, tenantId))
    .orderBy(asc(invoiceArchive.id));
  return rows.map((r) => ({ ...r, archivedAt: r.archivedAt.toISOString() }));
}
