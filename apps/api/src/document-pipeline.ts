// What a read document is and the deadlines it makes (BTP plan §7 DocumentGraph, stage 2;
// `docs/DECISIONS.md` D7, `docs/plans/phase-2.md`). The queue `document.classify` takes a text
// document stage 1 read: its kind (patterns, then the model), its dates and companies (patterns),
// its company among the parties by SIREN, its deadlines. All of it lands in one transaction with the
// audit; a step that cannot say leaves the document `needs_review` with a reason, and a person's
// answer (`POST /documents/:id/review`) runs the same derivation.
import {
  type Classification,
  classifyDocument,
  type DocumentFields,
  type ObligationDraft,
  readFields,
  type Settled,
  settleDocument,
} from '@fi/agents';
import { isIsoDate, isValidSiren } from '@fi/core';
import {
  actions,
  and,
  audit,
  type Db,
  type DbOrTx,
  type DocumentRow,
  documents,
  eq,
  inArray,
  isNotNull,
  obligations,
  parties,
  sql,
  type TenantRow,
  type Tx,
  tenants,
} from '@fi/db';
import { DocumentKind } from '@fi/domain';
import { z } from 'zod';
import { tenantAi } from './ai';
import { type Principal, who } from './auth';
import type { AiDeps } from './deps';
import { ApiError } from './errors';

export interface ClassifyDeps {
  db: Db;
  ai: AiDeps;
  now: () => Date;
}

/** The company's parties among these SIRENs: a supplier first (whose attestation it would be). */
async function partiesOf(db: DbOrTx, tenantId: string, sirens: readonly string[]) {
  if (sirens.length === 0) return { ids: new Map<string, string>(), names: [] as string[] };
  const rows = await db
    .select({ id: parties.id, siren: parties.siren, kind: parties.kind, name: parties.legalName })
    .from(parties)
    .where(and(eq(parties.tenantId, tenantId), inArray(parties.siren, [...sirens])));
  const ids = new Map<string, string>();
  for (const r of rows.sort((a, b) =>
    a.kind === 'supplier' ? -1 : b.kind === 'supplier' ? 1 : 0,
  )) {
    if (!ids.has(r.siren)) ids.set(r.siren, r.id);
  }
  return { ids, names: rows.map((r) => r.name) };
}

const testKey = (isTest: boolean, key: string) => `${isTest ? 'test:' : ''}${key}`;

/**
 * The deadlines of one document, each kept once per company by its key: a newer document moves
 * its date forward (a new attestation, a new period, reminders again), an older or the same one
 * changes nothing. A deadline the company dismissed stays dismissed. Returns those written.
 */
export async function saveObligations(
  tx: Tx,
  doc: Pick<DocumentRow, 'id' | 'tenantId' | 'isTest'>,
  drafts: readonly ObligationDraft[],
  partyId: string | null,
  now: Date,
): Promise<number> {
  let written = 0;
  for (const o of drafts) {
    const rows = await tx
      .insert(obligations)
      .values({
        tenantId: doc.tenantId,
        kind: o.kind,
        dueOn: o.dueOn,
        key: o.key,
        partyId,
        sourceDocumentId: doc.id,
        amount: o.amount,
        isTest: doc.isTest,
      })
      .onConflictDoUpdate({
        target: [obligations.tenantId, obligations.key],
        set: {
          dueOn: sql`excluded.due_on`,
          sourceDocumentId: sql`excluded.source_document_id`,
          amount: sql`excluded.amount`,
          partyId: sql`coalesce(excluded.party_id, ${obligations.partyId})`,
          status: sql`case when ${obligations.status} = 'dismissed' then 'dismissed' else 'open' end`,
          closedAt: sql`case when ${obligations.status} = 'dismissed' then ${obligations.closedAt} end`,
          lastRemindedAt: null,
          updatedAt: now,
        },
        setWhere: sql`excluded.due_on > ${obligations.dueOn}`,
      })
      .returning({ id: obligations.id });
    written += rows.length;
  }
  return written;
}

/** What settling wrote besides the document: for its audit event. */
interface Written {
  deadlines: number;
  confirm: boolean;
}

/** The deadlines and the « confirm this company » draft a settled document makes. */
async function writeSettled(
  tx: Tx,
  doc: Pick<DocumentRow, 'id' | 'tenantId' | 'isTest'>,
  settled: Settled,
  now: Date,
): Promise<Written> {
  const deadlines = await saveObligations(tx, doc, settled.obligations, settled.partyId, now);
  if (!settled.confirm) return { deadlines, confirm: false };
  // One question per unknown company, whichever of its documents came first.
  const asked = await tx
    .insert(actions)
    .values({
      tenantId: doc.tenantId,
      kind: 'confirmer_tiers',
      key: testKey(doc.isTest, `confirmer_tiers:${settled.confirm}`),
      documentId: doc.id,
      payload: { siren: settled.confirm, documentKind: settled.kind },
      isTest: doc.isTest,
    })
    .onConflictDoNothing({ target: [actions.tenantId, actions.key] })
    .returning({ id: actions.id });
  return { deadlines, confirm: asked.length > 0 };
}

/** The document's columns once settled, or once nobody could say what it is. */
function settledColumns(
  extracted: Record<string, unknown>,
  fields: DocumentFields,
  settled: Settled | null,
  more: Record<string, unknown>,
) {
  return settled
    ? {
        kind: settled.kind,
        stage: settled.stage,
        reviewReason: settled.reviewReason,
        partyId: settled.partyId,
        extracted: { ...extracted, ...more, fields, siren: settled.siren },
      }
    : {
        kind: null,
        stage: 'needs_review' as const,
        reviewReason: 'unclassified',
        extracted: { ...extracted, ...more, fields },
      };
}

/** Classifies one read text document; safe to run twice (a classified one is left as it is). */
export async function runDocumentClassify(deps: ClassifyDeps, documentId: string): Promise<void> {
  const [doc] = await deps.db.select().from(documents).where(eq(documents.id, documentId));
  const extracted = doc?.extracted ?? null;
  if (doc?.stage !== 'ingested' || typeof extracted?.text !== 'string') return;
  const [tenant] = await deps.db.select().from(tenants).where(eq(tenants.id, doc.tenantId));
  if (!tenant || tenant.deletedAt) return;

  const fields = readFields(extracted.text);
  const known = await partiesOf(deps.db, tenant.id, fields.sirens);
  const classification: Classification = await classifyDocument(
    { text: extracted.text, name: doc.name, subject: doc.hints.subject },
    {
      tenantId: tenant.id,
      ai: tenantAi(deps.ai, tenant),
      orchestrator: deps.ai.orchestrator,
      known: [tenant.name, ...known.names],
    },
  );
  const settled = classification.label
    ? settleDocument({
        documentId: doc.id,
        label: classification.label,
        fields,
        own: tenant.siren,
        parties: known.ids,
        isTest: doc.isTest,
      })
    : null;
  const { label, confidence, source, degraded } = classification;
  const columns = settledColumns(extracted, fields, settled, {
    classification: { label, confidence, source, degraded },
  });

  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(documents)
      .set({ ...columns, updatedAt: deps.now() })
      .where(
        and(
          eq(documents.id, doc.id),
          eq(documents.stage, 'ingested'),
          isNotNull(documents.extracted),
        ),
      )
      .returning({ id: documents.id });
    if (!row) return;
    const written = settled
      ? await writeSettled(tx, doc, settled, deps.now())
      : { deadlines: 0, confirm: false };
    await audit(tx, {
      tenantId: doc.tenantId,
      actor: 'agent:classify',
      action: 'document.classify',
      objectType: 'document',
      objectId: doc.id,
      after: {
        kind: columns.kind,
        stage: columns.stage,
        reviewReason: columns.reviewReason,
        source,
        confidence,
        degraded,
        ...written,
      },
    });
  });
}

// ── A person's answer ─────────────────────────────────────────────────────────────────────────────

const IsoDay = z.string().refine(isIsoDate, 'a day as YYYY-MM-DD');

export const ReviewBody = z.object({
  kind: DocumentKind,
  issuedOn: IsoDay.optional(),
  validTo: IsoDay.optional(),
  receptionOn: IsoDay.optional(),
  /** Whose document it is, when its text names several companies or none. */
  siren: z
    .string()
    .transform((s) => s.replace(/\s/g, ''))
    .refine(isValidSiren, 'a SIREN with a valid check digit')
    .optional(),
});
export type ReviewBody = z.infer<typeof ReviewBody>;

const NO_FIELDS: DocumentFields = {
  issuedOn: null,
  validFrom: null,
  validTo: null,
  receptionOn: null,
  sirens: [],
};

/** The field a person still has to give, by what the derivation lacked. */
function missingField(settled: Settled): string {
  if (settled.reviewReason === 'party_unclear') return 'siren';
  if (settled.kind === 'pv_reception') return 'receptionOn';
  return settled.kind === 'attestation_vigilance' || settled.kind === 'kbis'
    ? 'issuedOn'
    : 'validTo';
}

/**
 * A person says what a document in review is, and the dates or the company the text did not give;
 * the same derivation as the queue's then runs. An invoice without its data is taken as said: its
 * amounts wait for the owner's decision on reading them (D7).
 */
export async function reviewDocument(
  deps: Pick<ClassifyDeps, 'db' | 'now'>,
  tenant: TenantRow,
  principal: Principal,
  doc: DocumentRow,
  input: ReviewBody,
): Promise<DocumentRow> {
  if (doc.stage !== 'needs_review') throw new ApiError(409, 'document_not_in_review');
  const extracted = doc.extracted ?? {};
  const read = (extracted.fields as DocumentFields | undefined) ?? NO_FIELDS;
  const fields: DocumentFields = {
    ...read,
    issuedOn: input.issuedOn ?? read.issuedOn,
    validTo: input.validTo ?? read.validTo,
    receptionOn: input.receptionOn ?? read.receptionOn,
    sirens: input.siren ? [input.siren] : read.sirens,
  };
  const known = await partiesOf(deps.db, tenant.id, fields.sirens);
  let settled = settleDocument({
    documentId: doc.id,
    label: input.kind,
    fields,
    own: tenant.siren,
    parties: known.ids,
    isTest: doc.isTest,
  });
  if (settled.reviewReason === 'invoice_without_data') {
    settled = { ...settled, stage: 'done', reviewReason: null };
  }
  if (settled.stage !== 'done') {
    throw new ApiError(422, 'document_review_incomplete', undefined, missingField(settled));
  }
  const columns = settledColumns(extracted, fields, settled, { reviewedBy: who(principal) });
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .update(documents)
      .set({ ...columns, updatedAt: deps.now() })
      .where(and(eq(documents.id, doc.id), eq(documents.stage, 'needs_review')))
      .returning();
    if (!row) throw new ApiError(409, 'document_not_in_review');
    const written = await writeSettled(tx, doc, settled, deps.now());
    await audit(tx, {
      tenantId: doc.tenantId,
      actor: principal.kind === 'session' ? `user:${principal.userId}` : 'user',
      action: 'document.review',
      objectType: 'document',
      objectId: doc.id,
      before: { kind: doc.kind, reviewReason: doc.reviewReason },
      after: { kind: settled.kind, stage: settled.stage, ...written },
    });
    return row;
  });
}
