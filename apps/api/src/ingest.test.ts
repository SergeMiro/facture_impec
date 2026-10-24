import { type Invoice, toCii } from '@fi/core';
import { computeGolden, golden } from '@fi/core/testing';
import {
  actions,
  and,
  auditEvents,
  type Database,
  type DocumentRow,
  documents,
  eq,
  inboundQueue,
  obligations,
  parties,
  tenants,
} from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  GOLDEN_COMPANIES,
  type GoldenDocument,
  goldenDocuments,
} from '../scripts/golden/documents';
import { type ClassifyDeps, runDocumentClassify } from './document-pipeline';
import {
  type DocumentDeps,
  documentsBehind,
  INGEST_BACKLOG,
  runDocumentIngest,
  runDocumentValidate,
  sniffMime,
} from './ingest';
import {
  fakeAdapter,
  newTenant,
  recordedJobs,
  testAi,
  testApi,
  testDatabase,
} from './test-helpers';
import { runInboundPoll } from './workers';

let database: Database;
let api: ReturnType<typeof testApi>;
const jobs = recordedJobs();
let worker: DocumentDeps & ClassifyDeps;
let set: GoldenDocument[];

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: fakeAdapter() });
  // The AI off: the classifier's patterns alone (its model has its own eval).
  worker = { db: database.db, jobs, ai: testAi(database), now: () => new Date() };
  set = await goldenDocuments();
}, 60_000);
afterAll(async () => {
  await database.close();
});

type View = Record<string, unknown> & { id: string; error?: { code: string } };

async function company(as: keyof typeof GOLDEN_COMPANIES) {
  const { siren, name, vatId } = GOLDEN_COMPANIES[as];
  const tenant = await newTenant(api.request, { siren, name, vatId });
  const send = async (file: string, bytes: Uint8Array, query = '') => {
    const res = await api.request(`/ingest?name=${encodeURIComponent(file)}${query}`, {
      method: 'POST',
      token: tenant.apiKey,
      body: bytes,
    });
    return { status: res.status, headers: res.headers, body: (await res.json()) as View };
  };
  return { ...tenant, send };
}

/** How long the classifier took on each text (the AI off: its patterns). */
const classified: number[] = [];

/** What the three queues do with a document, run here in place of pg-boss. */
async function work(id: string) {
  await runDocumentIngest(worker, id);
  if (jobs.validations.includes(id)) await runDocumentValidate(worker, id);
  if (jobs.classifies.includes(id)) {
    const started = performance.now();
    await runDocumentClassify(worker, id);
    classified.push(performance.now() - started);
  }
}

const row = async (id: string): Promise<DocumentRow | undefined> =>
  (await database.db.select().from(documents).where(eq(documents.id, id)))[0];
const words = (text: string) => text.replace(/\s+/g, ' ').toLowerCase();
const p95 = (ms: number[]) => [...ms].sort((a, b) => a - b)[Math.ceil(ms.length * 0.95) - 1] ?? 0;

describe('the 50 golden documents', () => {
  it('give what each must: kind, stage, findings, text; the same file twice is one document', async () => {
    expect(set).toHaveLength(50);
    const companies = { buyer: await company('buyer'), seller: await company('seller') };
    const ids = new Map<string, string>();
    const timings = { text: [] as number[], ocr: [] as number[] };
    for (const g of set) {
      const started = performance.now();
      const sent = await companies[g.to].send(g.name, g.bytes);
      const e = g.expect;
      if ('refused' in e) {
        expect([g.id, sent.status, sent.body.error?.code]).toEqual([
          g.id,
          e.refused.status,
          e.refused.code,
        ]);
        continue;
      }
      if ('duplicateOf' in e) {
        expect([g.id, sent.status, sent.body.id]).toEqual([g.id, 200, ids.get(e.duplicateOf)]);
        continue;
      }
      expect([g.id, sent.status]).toEqual([g.id, 201]);
      ids.set(g.id, sent.body.id);
      await work(sent.body.id);
      const ms = performance.now() - started;
      (e.ocr ? timings.ocr : timings.text).push(ms);

      const doc = await row(sent.body.id);
      const extracted = (doc?.extracted ?? {}) as {
        format?: string;
        text?: string;
        ocr?: boolean;
        invoice?: Invoice;
      };
      expect([g.id, doc?.kind, doc?.stage, doc?.reviewReason ?? undefined]).toEqual([
        g.id,
        e.kind,
        e.stage,
        e.reviewReason,
      ]);
      if (e.format) {
        expect([g.id, extracted.format]).toEqual([g.id, e.format]);
        // The goldens are valid invoices: checked, nothing blocking.
        expect([g.id, doc?.validation?.filter((i) => i.severity === 'error')]).toEqual([g.id, []]);
      }
      if (e.ocr !== undefined) expect([g.id, extracted.ocr]).toEqual([g.id, e.ocr]);
      for (const w of e.text ?? []) {
        expect(words(extracted.text ?? ''), `${g.id}: « ${w} »`).toContain(words(w));
      }
    }
    // BTP plan §12: p95 under 5 s without OCR, under 30 s with it, on this server.
    console.info(
      `ingest p95: ${Math.round(p95(timings.text))} ms without OCR (${timings.text.length}), ${Math.round(p95(timings.ocr))} ms with OCR (${timings.ocr.length})`,
    );
    expect(p95(timings.text)).toBeLessThan(5_000);
    expect(p95(timings.ocr)).toBeLessThan(30_000);
    // Stage 2's job on the same texts, its patterns alone: read, linked, derived, written.
    console.info(`classify p95: ${Math.round(p95(classified))} ms (${classified.length})`);
    expect(p95(classified)).toBeLessThan(1_000);

    // One document per file, company and mode; the second copies wrote nothing.
    const buyer = await database.db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.tenantId, companies.buyer.id));
    expect(buyer).toHaveLength(set.filter((g) => g.to === 'buyer').length - 4 - 2);
    const audited = await database.db
      .select()
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, companies.buyer.id),
          eq(auditEvents.action, 'document.ingest'),
        ),
      );
    expect(audited).toHaveLength(buyer.length);

    // The deadlines the documents made, once each: the scanned attestation, Kbis and insurance
    // repeat their text twins; each PV is its own réception until chantiers link them (stage 4).
    const deadlines = async (tenantId: string) =>
      (
        await database.db
          .select({ kind: obligations.kind, dueOn: obligations.dueOn, key: obligations.key })
          .from(obligations)
          .where(eq(obligations.tenantId, tenantId))
      )
        .map((o) => `${o.dueOn} ${o.kind} ${o.key.replace(/:[0-9a-f-]{36}$/, ':<document>')}`)
        .sort();
    expect(await deadlines(companies.buyer.id)).toEqual([
      '2026-12-31 assurance_expiration assurance_expiration:552100554:decennale',
      '2027-04-01 attestation_vigilance_renouvellement attestation_vigilance_renouvellement:552100554',
      '2027-04-02 kbis_renouvellement kbis_renouvellement:552100554',
      '2027-10-15 retenue_garantie_liberation retenue_garantie_liberation:<document>',
      '2027-10-15 retenue_garantie_liberation retenue_garantie_liberation:<document>',
    ]);
    const sale = computeGolden(golden('01-services-standard-rate'));
    const exportSale = computeGolden(golden('07-export-outside-eu'));
    expect(await deadlines(companies.seller.id)).toEqual(
      [sale, exportSale]
        .map(
          (i) =>
            `${i.dueDate} facture_echeance facture_echeance:${GOLDEN_COMPANIES.seller.siren}:${i.number}`,
        )
        .sort(),
    );
    // Maçonnerie Durand is no party of the company: one question, however many of its documents.
    const asked = await database.db
      .select({ key: actions.key, kind: actions.kind })
      .from(actions)
      .where(eq(actions.tenantId, companies.buyer.id));
    expect(asked).toEqual([{ key: 'confirmer_tiers:552100554', kind: 'confirmer_tiers' }]);
  }, 300_000);
});

describe('ingest at the door', () => {
  it('knows a file by its bytes, not its name', () => {
    const pdf = set.find((g) => g.id === 'text-kbis')?.bytes ?? new Uint8Array();
    expect(sniffMime(pdf)).toBe('application/pdf');
    expect(sniffMime(new TextEncoder().encode('﻿  <?xml version="1.0"?><a/>'))).toBe(
      'application/xml',
    );
    expect(sniffMime(new TextEncoder().encode('Nom;Montant\nA;1'))).toBeNull();
    expect(sniffMime(new TextEncoder().encode('<!DOCTYPE html><html><body>Bonjour'))).toBeNull();
    expect(sniffMime(new TextEncoder().encode('<html lang="fr">'))).toBeNull();
  });

  it('keeps a test file apart from a real one, and answers with the document', async () => {
    const c = await company('buyer');
    const bytes = set.find((g) => g.id === 'cii-13')?.bytes ?? new Uint8Array();
    const real = await c.send('a.xml', bytes);
    const test = await c.send('a.xml', bytes, '&test=true');
    expect(real.status).toBe(201);
    expect(test.status).toBe(201);
    expect(test.body).toMatchObject({ isTest: true, source: 'excel', stage: 'ingested' });
    expect(test.body.id).not.toBe(real.body.id);
    expect(api.jobs.ingests).toContain(test.body.id);

    const view = await api.request(`/documents/${real.body.id}`, { token: c.apiKey });
    expect(await view.json()).toMatchObject({ id: real.body.id, name: 'a.xml', kind: null });
    const other = await company('buyer');
    const hidden = await api.request(`/documents/${real.body.id}`, { token: other.apiKey });
    expect(hidden.status).toBe(404);
    expect((await api.request('/documents/nope', { token: c.apiKey })).status).toBe(404);
    expect((await c.send('', bytes)).status).toBe(400);
  });

  it('asks a company that sends faster than it is read to wait', async () => {
    const c = await company('buyer');
    await database.db.insert(documents).values(
      Array.from({ length: INGEST_BACKLOG }, (_, i) => ({
        tenantId: c.id,
        source: 'excel' as const,
        sourceRef: `waiting-${i}`,
        name: `waiting-${i}.pdf`,
        mime: 'application/pdf',
        size: 1,
        sha256: i.toString(16).padStart(64, '0'),
        storageKey: `waiting-${i}`,
        isTest: false,
        receivedAt: new Date(),
      })),
    );
    const busy = await c.send(
      'a.xml',
      set.find((g) => g.id === 'cii-11')?.bytes ?? new Uint8Array(),
    );
    expect(busy.status).toBe(429);
    expect(busy.body.error?.code).toBe('ingest_busy');
    expect(busy.headers.get('retry-after')).toBe('60');
  });
});

describe('the workers', () => {
  it('read a document once, however often they are asked', async () => {
    const c = await company('buyer');
    const sent = await c.send(
      'b.xml',
      set.find((g) => g.id === 'cii-15')?.bytes ?? new Uint8Array(),
    );
    await work(sent.body.id);
    await work(sent.body.id);
    const read = await database.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.objectId, sent.body.id), eq(auditEvents.action, 'document.read')));
    expect(read).toHaveLength(1);
    expect((await row(sent.body.id))?.stage).toBe('done');
  });

  it('give the BTP rules what the company said of the supplier', async () => {
    const c = await company('buyer');
    await database.db.update(tenants).set({ btp: true }).where(eq(tenants.id, c.id));
    const [supplier] = await database.db
      .insert(parties)
      .values({
        tenantId: c.id,
        kind: 'supplier',
        legalName: 'Atelier Dupont SARL',
        siren: '100000009',
        source: 'invoice',
        verifiedAt: null,
        subcontracting: true,
      })
      .returning();
    const xml = toCii(computeGolden(golden('01-services-standard-rate')));
    const sent = await c.send('st.xml', new TextEncoder().encode(xml));
    await work(sent.body.id);
    const doc = await row(sent.body.id);
    expect(doc?.partyId).toBe(supplier?.id);
    expect(doc?.validation?.map((i) => i.ruleId)).toContain('BTP-AUTOLIQ-01');
  });

  it('are given again what a crash left half-way', async () => {
    const c = await company('buyer');
    const sent = await c.send(
      'c.xml',
      set.find((g) => g.id === 'cii-16')?.bytes ?? new Uint8Array(),
    );
    const later = new Date(Date.now() + 11 * 60_000);
    const behind = await documentsBehind(database.db, later);
    expect(behind.read).toContain(sent.body.id);
    await runDocumentIngest(worker, sent.body.id);
    expect((await documentsBehind(database.db, later)).validate).toContain(sent.body.id);
  });

  it('make each supplier invoice the platform delivers a document too (adapter `pdp`)', async () => {
    const xml = toCii(computeGolden(golden('02-goods-two-rates')));
    const adapter = fakeAdapter({
      listInbound: async () => [{ pdpRef: 'pdp-doc-1', receivedAt: new Date().toISOString(), xml }],
    });
    const poller = testApi(database, { mock: adapter });
    const { siren, name, vatId } = GOLDEN_COMPANIES.buyer;
    const c = await newTenant(poller.request, { siren, name, vatId });
    await runInboundPoll({
      db: database.db,
      pdp: { mock: adapter },
      test: null,
      jobs: poller.jobs,
      ai: testAi(database),
      mailer: null,
      now: () => new Date(),
    });
    const [received] = await database.db
      .select()
      .from(inboundQueue)
      .where(eq(inboundQueue.tenantId, c.id));
    expect(received?.documentId).toBeTruthy();
    const doc = await row(received?.documentId ?? '');
    expect(doc).toMatchObject({ source: 'pdp', sourceRef: 'pdp-doc-1', name: 'pdp-doc-1.xml' });
    expect(poller.jobs.ingests).toContain(doc?.id);
  });
});
