// Stage 2 of the BTP plan on texts as stage 1 leaves them (read, not classified): the kind, the
// stage, the review reason, the deadlines and the questions each document makes, once each; a
// newer attestation moves its renewal, an older one does not; Mode test stays apart; the model is
// asked only what the patterns cannot say, without an identifier; a person's review settles the
// rest. The golden documents run the same queue end to end (src/ingest.test.ts).
import { createHash } from 'node:crypto';
import type { ResolvedAi } from '@fi/agents';
import { handleFor, mockModel, textResult } from '@fi/agents/testing';
import {
  actions,
  and,
  auditEvents,
  type Database,
  type DocumentRow,
  documents,
  eq,
  obligations,
  parties,
} from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GOLDEN_COMPANIES } from '../scripts/golden/documents';
import { type ClassifyDeps, runDocumentClassify } from './document-pipeline';
import { checkBacklog, documentsBehind, INGEST_BACKLOG } from './ingest';
import { fakeAdapter, newTenant, testAi, testApi, testDatabase } from './test-helpers';

const OWN = GOLDEN_COMPANIES.buyer.siren;
const SOUS_TRAITANT = '100000009';
const OTHER = '300000007';
const INCLUDED: ResolvedAi = {
  settings: {
    mode: 'included',
    provider: 'mistral',
    models: { agent: 'mock-agent', classify: 'mock-classify' },
  },
  apiKey: 'test',
};

let database: Database;
let api: ReturnType<typeof testApi>;
let off: ClassifyDeps;
let on: ClassifyDeps;
let model = mockModel(textResult('{}'));

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: fakeAdapter() });
  off = { db: database.db, ai: testAi(database), now: () => new Date() };
  on = {
    db: database.db,
    ai: testAi(database, {
      included: INCLUDED,
      handle: (resolved) => (resolved ? handleFor(model, false) : null),
    }),
    now: () => new Date(),
  };
});
afterAll(async () => {
  await database.close();
});

async function company() {
  const { siren, name, vatId } = GOLDEN_COMPANIES.buyer;
  return newTenant(api.request, { siren, name, vatId });
}

let n = 0;
/** A document as stage 1 leaves a text: read, its kind still unknown. */
async function text(
  tenantId: string,
  body: string,
  options: { name?: string; subject?: string; isTest?: boolean } = {},
): Promise<DocumentRow> {
  n++;
  const [row] = await database.db
    .insert(documents)
    .values({
      tenantId,
      source: 'mail',
      sourceRef: `message-${n}`,
      name: options.name ?? `scan${n}.pdf`,
      mime: 'application/pdf',
      size: body.length,
      sha256: createHash('sha256').update(`${n}:${body}`).digest('hex'),
      storageKey: `key-${n}`,
      hints: options.subject ? { subject: options.subject } : {},
      isTest: options.isTest ?? false,
      receivedAt: new Date(),
      extracted: { text: body, ocr: false, pages: 1, truncated: false },
    })
    .returning();
  if (!row) throw new Error('no document');
  return row;
}

const vigilance = (siren: string, on: string) =>
  [
    'ATTESTATION DE VIGILANCE',
    'URSSAF de Bourgogne',
    `Délivrée le ${on} à : Atelier Dupont SARL, SIREN ${siren}`,
    "L'entreprise est à jour de ses obligations de déclaration et de paiement.",
  ].join('\n');
const kbis = (siren: string, on: string) =>
  [
    'Extrait Kbis',
    'Greffe du tribunal de commerce de Dijon',
    `Immatriculation au RCS : ${siren} R.C.S. Dijon`,
    `À jour au ${on}`,
  ].join('\n');
const LETTER =
  'Madame, Monsieur,\nSuite à notre rendez-vous sur le chantier de la rue des Tanneurs, veuillez trouver les éléments demandés.';

const doc = async (id: string) =>
  (await database.db.select().from(documents).where(eq(documents.id, id)))[0];
const deadlinesOf = (tenantId: string) =>
  database.db.select().from(obligations).where(eq(obligations.tenantId, tenantId));
const questionsOf = (tenantId: string) =>
  database.db.select().from(actions).where(eq(actions.tenantId, tenantId));

describe('a read text, classified and settled', () => {
  it("a known sous-traitant's attestation: its company, its renewal, nothing to ask", async () => {
    const c = await company();
    const [party] = await database.db
      .insert(parties)
      .values({
        tenantId: c.id,
        kind: 'supplier',
        legalName: 'Atelier Dupont SARL',
        siren: SOUS_TRAITANT,
        source: 'invoice',
        subcontracting: true,
      })
      .returning();
    const d = await text(c.id, vigilance(SOUS_TRAITANT, '31/08/2026'));
    await runDocumentClassify(off, d.id);
    const after = await doc(d.id);
    expect(after).toMatchObject({
      kind: 'attestation_vigilance',
      stage: 'done',
      reviewReason: null,
      partyId: party?.id,
    });
    expect(after?.extracted).toMatchObject({
      classification: { label: 'attestation_vigilance', source: 'rules', degraded: null },
      fields: { issuedOn: '2026-08-31', sirens: [SOUS_TRAITANT] },
      siren: SOUS_TRAITANT,
    });
    expect(await deadlinesOf(c.id)).toEqual([
      expect.objectContaining({
        kind: 'attestation_vigilance_renouvellement',
        key: `attestation_vigilance_renouvellement:${SOUS_TRAITANT}`,
        dueOn: '2027-02-28',
        status: 'open',
        partyId: party?.id,
        sourceDocumentId: d.id,
        isTest: false,
      }),
    ]);
    expect(await questionsOf(c.id)).toEqual([]);
  });

  it('makes a deadline once however often it runs; a newer copy moves it, an older one not', async () => {
    const c = await company();
    const first = await text(c.id, vigilance(SOUS_TRAITANT, '01/03/2026'));
    await runDocumentClassify(off, first.id);
    await runDocumentClassify(off, first.id);
    const audited = await database.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.objectId, first.id), eq(auditEvents.action, 'document.classify')));
    expect(audited).toHaveLength(1);

    const newer = await text(c.id, vigilance(SOUS_TRAITANT, '01/09/2026'));
    await runDocumentClassify(off, newer.id);
    let [deadline] = await deadlinesOf(c.id);
    expect(deadline).toMatchObject({ dueOn: '2027-03-01', sourceDocumentId: newer.id });

    const older = await text(c.id, vigilance(SOUS_TRAITANT, '15/06/2026'));
    await runDocumentClassify(off, older.id);
    expect(await doc(older.id)).toMatchObject({ stage: 'done' });
    [deadline] = await deadlinesOf(c.id);
    expect(deadline).toMatchObject({ dueOn: '2027-03-01', sourceDocumentId: newer.id });

    // A deadline the company dismissed moves with a newer attestation but stays dismissed.
    await database.db
      .update(obligations)
      .set({ status: 'dismissed', closedAt: new Date() })
      .where(eq(obligations.tenantId, c.id));
    const newest = await text(c.id, vigilance(SOUS_TRAITANT, '02/02/2027'));
    await runDocumentClassify(off, newest.id);
    const all = await deadlinesOf(c.id);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ dueOn: '2027-08-02', status: 'dismissed' });
  });

  it('an unknown company: its deadline still, and one question to confirm it', async () => {
    const c = await company();
    const a = await text(c.id, kbis(OTHER, '2 octobre 2026'));
    const b = await text(c.id, vigilance(OTHER, '05/10/2026'));
    await runDocumentClassify(off, a.id);
    await runDocumentClassify(off, b.id);
    expect(await doc(a.id)).toMatchObject({ kind: 'kbis', stage: 'done', partyId: null });
    expect((await deadlinesOf(c.id)).map((o) => [o.kind, o.dueOn]).sort()).toEqual([
      ['attestation_vigilance_renouvellement', '2027-04-05'],
      ['kbis_renouvellement', '2027-04-02'],
    ]);
    expect(await questionsOf(c.id)).toEqual([
      expect.objectContaining({
        kind: 'confirmer_tiers',
        key: `confirmer_tiers:${OTHER}`,
        status: 'draft',
        documentId: a.id,
        payload: { siren: OTHER, documentKind: 'kbis' },
        isTest: false,
      }),
    ]);
  });

  it("the company's own Kbis renews too, with nothing to ask", async () => {
    const c = await company();
    const d = await text(c.id, kbis(OWN, '01/10/2026'));
    await runDocumentClassify(off, d.id);
    expect((await deadlinesOf(c.id)).map((o) => o.key)).toEqual([`kbis_renouvellement:${OWN}`]);
    expect(await questionsOf(c.id)).toEqual([]);
  });

  it('keeps a Mode test document apart: its deadlines and questions are test ones', async () => {
    const c = await company();
    const d = await text(c.id, kbis(OTHER, '01/10/2026'), { isTest: true });
    await runDocumentClassify(off, d.id);
    const [deadline] = await deadlinesOf(c.id);
    expect(deadline).toMatchObject({ key: `test:kbis_renouvellement:${OTHER}`, isTest: true });
    const [question] = await questionsOf(c.id);
    expect(question).toMatchObject({ key: `test:confirmer_tiers:${OTHER}`, isTest: true });
  });

  it('gives what the patterns cannot settle to a person, with the reason', async () => {
    const c = await company();
    const cases: [string, Record<string, unknown>][] = [
      [LETTER, { kind: null, stage: 'needs_review', reviewReason: 'unclassified' }],
      [
        `FACTURE N° F-2026-311\nQuincaillerie du Centre - SIREN 732 829 320\nNet à payer : 495,00 €`,
        { kind: 'facture_achat', stage: 'needs_review', reviewReason: 'invoice_without_data' },
      ],
      [
        `ATTESTATION DE VIGILANCE\nSIREN ${SOUS_TRAITANT}\nÀ présenter à vos donneurs d'ordre.`,
        { kind: 'attestation_vigilance', stage: 'needs_review', reviewReason: 'dates_missing' },
      ],
      [
        `ATTESTATION DE VIGILANCE\nDélivrée le 01/10/2026\nSIREN ${SOUS_TRAITANT} et ${OTHER}`,
        { kind: 'attestation_vigilance', stage: 'needs_review', reviewReason: 'party_unclear' },
      ],
      [
        'PROCÈS-VERBAL DE RÉCEPTION\nChantier CH-12\nRéserves : reprise de l’enduit.',
        { kind: 'pv_reception', stage: 'needs_review', reviewReason: 'dates_missing' },
      ],
      [
        'DEVIS N° D-2026-014\nDémolition de la cloison : 1 850,00 € HT',
        { kind: 'devis', stage: 'done' },
      ],
      ['BON DE LIVRAISON N° BL-8841\n40 sacs de ciment', { kind: 'autre', stage: 'done' }],
      [
        'PROCÈS-VERBAL DE RÉCEPTION\nLa réception est prononcée sans réserve le 14/09/2026.',
        { kind: 'pv_reception', stage: 'done' },
      ],
    ];
    for (const [body, expected] of cases) {
      const d = await text(c.id, body);
      await runDocumentClassify(off, d.id);
      expect(await doc(d.id), body).toMatchObject(expected);
    }
    expect((await deadlinesOf(c.id)).map((o) => [o.kind, o.dueOn])).toEqual([
      ['retenue_garantie_liberation', '2027-09-14'],
    ]);
  });

  it('asks the model what the patterns cannot say, never with an identifier in the text', async () => {
    const c = await company();
    model = mockModel(textResult(JSON.stringify({ kind: 'devis', confidence: 0.88 })));
    const d = await text(
      c.id,
      `${LETTER}\nAtelier Dupont SARL, SIREN ${SOUS_TRAITANT}, compta@atelier-dupont.fr\nBoulangerie Martin SAS`,
      { subject: 'Proposition pour Boulangerie Martin SAS' },
    );
    await runDocumentClassify(on, d.id);
    expect(await doc(d.id)).toMatchObject({ kind: 'devis', stage: 'done' });
    expect((await doc(d.id))?.extracted).toMatchObject({
      classification: { label: 'devis', confidence: 0.88, source: 'agent' },
    });
    const sent = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    for (const secret of [SOUS_TRAITANT, 'compta@', 'Atelier Dupont', 'Boulangerie Martin']) {
      expect(sent).not.toContain(secret);
    }

    // Unsure, or not in the schema: a person says. The worker goes on either way.
    model = mockModel(textResult(JSON.stringify({ kind: 'devis', confidence: 0.4 })));
    const unsure = await text(c.id, LETTER);
    await runDocumentClassify(on, unsure.id);
    expect(await doc(unsure.id)).toMatchObject({
      stage: 'needs_review',
      reviewReason: 'unclassified',
    });
    model = mockModel(textResult('Ce document est un devis.'));
    const malformed = await text(c.id, LETTER);
    await runDocumentClassify(on, malformed.id);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(await doc(malformed.id)).toMatchObject({
      stage: 'needs_review',
      reviewReason: 'unclassified',
      extracted: expect.objectContaining({
        classification: expect.objectContaining({ degraded: 'error' }),
      }),
    });
  });
});

describe("a person's review", () => {
  it('gives the date or the company the text lacked; the same deadline follows', async () => {
    const c = await company();
    const review = (id: string, body: unknown) =>
      api.request(`/documents/${id}/review`, { method: 'POST', token: c.apiKey, body });

    const unclear = await text(
      c.id,
      `ATTESTATION DE VIGILANCE\nDélivrée le 01/10/2026\nSIREN ${SOUS_TRAITANT} et ${OTHER}`,
    );
    await runDocumentClassify(off, unclear.id);
    const missing = await review(unclear.id, { kind: 'attestation_vigilance' });
    expect(missing.status).toBe(422);
    expect(await missing.json()).toMatchObject({
      error: { code: 'document_review_incomplete', details: 'siren' },
    });
    expect((await review(unclear.id, { kind: 'kbis', siren: '123456789' })).status).toBe(400);
    const done = await review(unclear.id, {
      kind: 'attestation_vigilance',
      siren: '100 000 009',
    });
    expect(done.status).toBe(200);
    expect(await done.json()).toMatchObject({ kind: 'attestation_vigilance', stage: 'done' });
    expect((await deadlinesOf(c.id)).map((o) => [o.key, o.dueOn])).toEqual([
      [`attestation_vigilance_renouvellement:${SOUS_TRAITANT}`, '2027-04-01'],
    ]);
    expect((await questionsOf(c.id)).map((a) => a.key)).toEqual([
      `confirmer_tiers:${SOUS_TRAITANT}`,
    ]);
    const [audited] = await database.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.objectId, unclear.id), eq(auditEvents.action, 'document.review')));
    expect(audited?.actor).toBe('user');

    // Already settled: nothing to review.
    const again = await review(unclear.id, { kind: 'kbis', issuedOn: '2026-10-01' });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: { code: 'document_not_in_review' } });

    // Not classified at all: the person gives the kind and the date.
    const letter = await text(c.id, `${LETTER}\nRCS ${OTHER}`);
    await runDocumentClassify(off, letter.id);
    const noDate = await review(letter.id, { kind: 'attestation_assurance_rc' });
    expect(await noDate.json()).toMatchObject({ error: { details: 'validTo' } });
    expect(
      (await review(letter.id, { kind: 'attestation_assurance_rc', validTo: '2026-12-31' })).status,
    ).toBe(200);
    expect(await doc(letter.id)).toMatchObject({ kind: 'attestation_assurance_rc', stage: 'done' });

    // An invoice without its data is taken as the person says; its amounts wait (D7).
    const invoice = await text(c.id, 'FACTURE N° 77\nNet à payer : 120,00 €');
    await runDocumentClassify(off, invoice.id);
    expect(await doc(invoice.id)).toMatchObject({ reviewReason: 'invoice_without_data' });
    expect((await review(invoice.id, { kind: 'facture_achat' })).status).toBe(200);
    expect(await doc(invoice.id)).toMatchObject({ kind: 'facture_achat', stage: 'done' });

    // Another company's document is not found.
    const stranger = await company();
    const res = await api.request(`/documents/${letter.id}/review`, {
      method: 'POST',
      token: stranger.apiKey,
      body: { kind: 'kbis' },
    });
    expect(res.status).toBe(404);
  });
});

describe('the queue', () => {
  it('finds the texts left unclassified, and counts them in the backlog', async () => {
    const c = await company();
    const d = await text(c.id, kbis(OTHER, '01/10/2026'));
    const later = new Date(Date.now() + 11 * 60_000);
    expect((await documentsBehind(database.db, later)).classify).toContain(d.id);
    await runDocumentClassify(off, d.id);
    expect((await documentsBehind(database.db, later)).classify).not.toContain(d.id);

    for (let i = 1; i < INGEST_BACKLOG; i++) await text(c.id, `${LETTER} ${i}`);
    await checkBacklog(database.db, c.id);
    await text(c.id, LETTER);
    await expect(checkBacklog(database.db, c.id)).rejects.toMatchObject({ code: 'ingest_busy' });
  });
});
