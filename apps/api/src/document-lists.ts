// What the pane lists of the BTP back end (`docs/plans/phase-2.md` › 2B): the company's documents,
// newest first, and the deadlines they made, the soonest first. Mode test and real ones apart, as
// « Réception ».
import { addDays, parisToday } from '@fi/core';
import {
  and,
  asc,
  count,
  type Db,
  desc,
  documents,
  eq,
  lte,
  obligations,
  parties,
  sql,
  type TenantRow,
} from '@fi/db';
import { DocumentKind, DocumentStage } from '@fi/domain';
import { z } from 'zod';
import { documentView } from './ingest';

/** The start of a text in review: enough to say what it is without opening the file. */
export const EXCERPT_CHARS = 300;

export const DocumentsQuery = z.object({
  /** The pane follows « Mode test »: test documents with it on, real ones with it off. */
  test: z.stringbool().default(false),
  stage: DocumentStage.optional(),
  kind: DocumentKind.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type DocumentsQuery = z.infer<typeof DocumentsQuery>;

const text = (value: unknown) => (typeof value === 'string' ? value : null);

/** The dates and SIRENs read, as the review form starts from them. */
const ReadFields = z.object({
  issuedOn: z.string().nullable(),
  validTo: z.string().nullable(),
  receptionOn: z.string().nullable(),
  sirens: z.array(z.string()),
});

/**
 * The company's documents, newest first. What was read comes back trimmed by the database: a page
 * of fifty would otherwise carry fifty texts of up to 100 000 characters.
 */
export async function listDocuments(db: Db, tenant: Pick<TenantRow, 'id'>, q: DocumentsQuery) {
  const where = and(
    eq(documents.tenantId, tenant.id),
    eq(documents.isTest, q.test),
    q.stage ? eq(documents.stage, q.stage) : undefined,
    q.kind ? eq(documents.kind, q.kind) : undefined,
  );
  const x = documents.extracted;
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: documents.id,
        source: documents.source,
        name: documents.name,
        mime: documents.mime,
        size: documents.size,
        sha256: documents.sha256,
        kind: documents.kind,
        stage: documents.stage,
        reviewReason: documents.reviewReason,
        isTest: documents.isTest,
        validation: documents.validation,
        receivedAt: documents.receivedAt,
        partyId: documents.partyId,
        partyName: parties.legalName,
        extracted: sql<Record<string, unknown> | null>`case when ${x} is null then null else
          jsonb_build_object('format', ${x}->'format', 'ocr', ${x}->'ocr', 'pages', ${x}->'pages',
            'fields', ${x}->'fields', 'siren', ${x}->'siren',
            'excerpt', left(${x}->>'text', ${EXCERPT_CHARS})) end`,
      })
      .from(documents)
      .leftJoin(parties, eq(parties.id, documents.partyId))
      .where(where)
      .orderBy(desc(documents.receivedAt), desc(documents.id))
      .limit(q.limit)
      .offset(q.offset),
    db.select({ n: count() }).from(documents).where(where),
  ]);
  return {
    documents: rows.map((row) => {
      const read = row.extracted ?? {};
      const fields = ReadFields.safeParse(read.fields);
      return {
        ...documentView(row),
        party: row.partyId ? { id: row.partyId, name: row.partyName ?? '' } : null,
        /** Whose it is by SIREN, known to the company or not. */
        siren: text(read.siren),
        // What a person needs to answer: the start of the text, the dates and SIRENs read.
        review:
          row.stage === 'needs_review'
            ? {
                excerpt: text(read.excerpt)?.trim() || null,
                fields: fields.success ? fields.data : null,
              }
            : null,
      };
    }),
    total: total?.n ?? 0,
    limit: q.limit,
    offset: q.offset,
  };
}

export const ObligationsQuery = z.object({
  test: z.stringbool().default(false),
  /** Days ahead of today; what is overdue is always listed. */
  horizon: z.coerce.number().int().min(1).max(730).default(90),
});
export type ObligationsQuery = z.infer<typeof ObligationsQuery>;

/** The open deadlines due within the horizon, the overdue ones first, each with its source. */
export async function listObligations(
  db: Db,
  tenant: Pick<TenantRow, 'id'>,
  q: ObligationsQuery,
  now: Date,
) {
  const today = parisToday(now);
  const rows = await db
    .select({
      id: obligations.id,
      kind: obligations.kind,
      dueOn: obligations.dueOn,
      amount: obligations.amount,
      partyId: obligations.partyId,
      partyName: parties.legalName,
      documentId: obligations.sourceDocumentId,
      documentName: documents.name,
      documentKind: documents.kind,
      siren: sql<string | null>`${documents.extracted}->>'siren'`,
    })
    .from(obligations)
    .leftJoin(parties, eq(parties.id, obligations.partyId))
    .leftJoin(documents, eq(documents.id, obligations.sourceDocumentId))
    .where(
      and(
        eq(obligations.tenantId, tenant.id),
        eq(obligations.isTest, q.test),
        eq(obligations.status, 'open'),
        lte(obligations.dueOn, addDays(today, q.horizon)),
      ),
    )
    .orderBy(asc(obligations.dueOn), asc(obligations.id))
    .limit(500);
  return {
    today,
    horizon: q.horizon,
    obligations: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      dueOn: r.dueOn,
      overdue: r.dueOn < today,
      amount: r.amount,
      party: r.partyId ? { id: r.partyId, name: r.partyName ?? '' } : null,
      /** A company not confirmed yet is known by its SIREN only. */
      siren: r.partyId ? null : r.siren,
      document: r.documentId
        ? { id: r.documentId, name: r.documentName ?? '', kind: r.documentKind }
        : null,
    })),
  };
}
