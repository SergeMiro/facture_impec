// BTP stage 4B (docs/plans/phase-4.md): invoices and payments from an ERP export, and the order of
// sources. Stage 4's definition of done: the same invoice from the PDP and from the ERP makes one
// deadline with the PDP's values, whichever arrived first (BTP plan §12). The labels are made up from
// common French usage, not a pilot's real export (TODO(verify), docs/TODO.md).
import { toCii } from '@fi/core';
import { computeGolden, golden } from '@fi/core/testing';
import {
  actions,
  and,
  auditEvents,
  blobs,
  chantiers,
  type Database,
  documents,
  eq,
  invoices,
  obligations,
  parties,
} from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { saveObligations } from './document-pipeline';
import { runErpSync } from './erp';
import { type DocumentDeps, runDocumentIngest, runDocumentValidate, storeDocument } from './ingest';
import {
  ADMIN_TOKEN,
  fakeAdapter,
  newTenant,
  recordedJobs,
  testApi,
  testDatabase,
} from './test-helpers';
import { draftDue } from './watchers';

let database: Database;
let api: ReturnType<typeof testApi>;
let worker: DocumentDeps;
const jobs = recordedJobs();

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: fakeAdapter() }, ADMIN_TOKEN);
  worker = { db: database.db, jobs, now: () => new Date() };
});
afterAll(() => database.close());

const csv = (lines: string[]) =>
  new Uint8Array(Buffer.from(lines.join('\r\n'), 'utf8')) as Uint8Array<ArrayBuffer>;

/** Golden invoice 01: Atelier Dupont (100000009, every test company) sells to Boulangerie Martin. */
const SALE = computeGolden(golden('01-services-standard-rate'));
const BAKERY = '200000008';

interface ImportView {
  status: 'running' | 'done' | 'failed';
  added: number;
  updated: number;
  unchanged: number;
  skipped: Record<string, number>;
  examples: { row: number; name: string | null; reason: string }[];
  withoutCustomer: number;
}

async function company() {
  const tenant = await newTenant(api.request);
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const res = await api.request(path, { method, token: tenant.apiKey, body });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const give = async (name: string, lines: string[]) => {
    const given = await call(`/erp/imports?name=${encodeURIComponent(name)}`, 'POST', csv(lines));
    for (const job of api.jobs.erp.splice(0)) {
      await runErpSync(api.deps, job.tenantId, job.connector);
    }
    return given;
  };
  const imported = async (list: 'invoices' | 'payments') =>
    ((await call('/erp')).body as Record<string, ImportView>)[list];
  const deadlines = () =>
    database.db
      .select()
      .from(obligations)
      .where(and(eq(obligations.tenantId, tenant.id), eq(obligations.kind, 'facture_echeance')))
      .orderBy(obligations.key);
  const deadline = async (number: string) =>
    (await deadlines()).find((o) => o.key === `facture_echeance:100000009:${number}`);
  const docsOf = () =>
    database.db
      .select()
      .from(documents)
      .where(eq(documents.tenantId, tenant.id))
      .orderBy(documents.name);
  const customer = async (values: { legalName: string; siren: string; erpRef?: string }) => {
    const [row] = await database.db
      .insert(parties)
      .values({ tenantId: tenant.id, kind: 'customer', source: 'sirene', ...values })
      .returning();
    if (!row) throw new Error('no customer');
    return row;
  };
  const chantier = async (erpRef: string, name: string) => {
    const [row] = await database.db
      .insert(chantiers)
      .values({ tenantId: tenant.id, erpRef, name })
      .returning();
    if (!row) throw new Error('no chantier');
    return row;
  };
  /** Golden invoice 01 as the platform delivers it: stored, read, checked, its deadline derived. */
  const fromPdp = async () => {
    const { document } = await database.db.transaction((tx) =>
      storeDocument(
        tx,
        { id: tenant.id },
        {
          source: 'pdp',
          sourceRef: 'pdp-sale-1',
          name: 'pdp-sale-1.xml',
          bytes: new TextEncoder().encode(toCii(SALE)),
          isTest: false,
          receivedAt: new Date(),
        },
        undefined,
        'pdp',
      ),
    );
    await runDocumentIngest(worker, document.id);
    await runDocumentValidate(worker, document.id);
    return document.id;
  };
  return {
    tenant,
    call,
    give,
    imported,
    deadlines,
    deadline,
    docsOf,
    customer,
    chantier,
    fromPdp,
  };
}

const INVOICES = [
  'Liste des factures',
  'N° facture;Type;Date;Échéance;Code client;Client;Chantier;Montant TTC;Reste à payer',
  'F2026-0101;Facture;02/09/2026;01/10/2026;C010;Boulangerie Martin;CH-01;1 200,00;1 200,00',
  'S2026-07;Situation de travaux;05/10/2026;04/11/2030;;Boulangerie Martin SAS;Les Tilleuls;9 500,00;3 000,00',
  'F2026-0102;Facture;06/10/2026;05/11/2030;C010;Boulangerie Martin;;480,00;0,00',
  'F2026-0103;Facture;07/10/2026;06/11/2030;C010;Boulangerie Martin;;100,00;100,00',
  'AV2026-01;Avoir;08/10/2026;08/10/2026;C010;Boulangerie Martin;;-120,00;-120,00',
  'F2026-0104;Facture;09/10/2026;01/01/2026;C999;Inconnu SARL;;250,00;250,00',
];

describe('invoices and payments from an ERP export', () => {
  it('make each owed invoice a document and its deadline, and say why the others are not', async () => {
    const c = await company();
    const bakery = await c.customer({
      legalName: 'Boulangerie Martin SAS',
      siren: BAKERY,
      erpRef: 'C010',
    });
    const tilleuls = await c.chantier('CH-01', 'Les Tilleuls');
    // F2026-0103 is an invoice of Facture Impec: CollectAgent chases it, not the ERP.
    await database.db.insert(invoices).values({
      tenantId: c.tenant.id,
      number: 'F2026-0103',
      draft: {} as never,
      document: {} as never,
      fingerprint: 'x',
    });

    expect((await c.give('factures.csv', INVOICES)).status).toBe(202);
    expect(await c.imported('invoices')).toMatchObject({
      status: 'done',
      added: 3,
      updated: 0,
      unchanged: 0,
      skipped: { paid: 1, sent_here: 1, credit_note: 1 },
      withoutCustomer: 1,
    });
    const docs = await c.docsOf();
    expect(
      docs.map((d) => [d.name, d.source, d.kind, d.stage, d.mime, d.partyId, d.chantierId]),
    ).toEqual([
      ['F2026-0101', 'erp', 'facture_vente', 'done', 'application/json', bakery.id, tilleuls.id],
      ['F2026-0104', 'erp', 'facture_vente', 'done', 'application/json', null, null],
      // The customer by a name only it has, the chantier by its name.
      ['S2026-07', 'erp', 'situation', 'done', 'application/json', bakery.id, tilleuls.id],
    ]);
    expect(docs[0]?.extracted).toMatchObject({
      format: 'erp-json',
      record: { number: 'F2026-0101', dueOn: '2026-10-01', total: 120_000, left: 120_000 },
    });
    // What is left to pay is what the deadline is about; a situation's is a sale's.
    expect(
      (await c.deadlines()).map((o) => [
        o.key,
        o.status,
        o.dueOn,
        o.amount,
        o.partyId,
        o.chantierId,
      ]),
    ).toEqual([
      [
        'facture_echeance:100000009:F2026-0101',
        'open',
        '2026-10-01',
        120_000,
        bakery.id,
        tilleuls.id,
      ],
      ['facture_echeance:100000009:F2026-0104', 'open', '2026-01-01', 25_000, null, null],
      [
        'facture_echeance:100000009:S2026-07',
        'open',
        '2030-11-04',
        300_000,
        bakery.id,
        tilleuls.id,
      ],
    ]);
    // The pane lists them with their chantier (stage 4C); the situation is due beyond two years.
    const listed = (await c.call('/obligations?test=false&horizon=730')).body.obligations as {
      document: { name: string } | null;
      chantier: { id: string; name: string } | null;
    }[];
    expect(listed.map((o) => [o.document?.name, o.chantier])).toEqual([
      ['F2026-0104', null],
      ['F2026-0101', { id: tilleuls.id, name: 'Les Tilleuls' }],
    ]);
    const received = (await c.call('/documents?test=false')).body.documents as {
      name: string;
      chantier: { name: string } | null;
    }[];
    expect(Object.fromEntries(received.map((d) => [d.name, d.chantier?.name ?? null]))).toEqual({
      'F2026-0101': 'Les Tilleuls',
      'F2026-0104': null,
      'S2026-07': 'Les Tilleuls',
    });

    // Watched as any sale: the overdue one with a customer is reminded, by its number; the one
    // without a customer cannot be.
    expect(await draftDue(database.db, new Date(), c.tenant.id)).toBe(1);
    const [reminder] = await database.db
      .select()
      .from(actions)
      .where(eq(actions.tenantId, c.tenant.id));
    expect(reminder?.kind).toBe('relance_facture');
    expect(JSON.stringify(reminder?.payload)).toContain('F2026-0101');

    // The same file again: nothing. The customers imported later: the next file links F2026-0104.
    expect((await c.give('factures.csv', INVOICES)).status).toBe(200);
    const later = await c.customer({
      legalName: 'Inconnu SARL',
      siren: '300000007',
      erpRef: 'C999',
    });

    // Payments: what is left paid closes the deadline and withdraws its reminder; less is counted.
    await c.give('reglements.csv', [
      'Date règlement;N° facture;Client;Mode de règlement;Montant;Référence',
      '15/10/2026;F2026-0101;Boulangerie Martin;Virement;1 200,00;VIR-881',
      '16/10/2026;S2026-07;Boulangerie Martin;Chèque;1 500,00;CHQ-12',
      '17/10/2026;F2026-0999;Boulangerie Martin;Virement;50,00;VIR-882',
      '17/10/2026;F2026-0103;Boulangerie Martin;Virement;100,00;VIR-883',
    ]);
    expect(await c.imported('payments')).toMatchObject({
      status: 'done',
      updated: 1,
      skipped: { partial_payment: 1, invoice_unknown: 1, sent_here: 1 },
    });
    expect((await c.deadline('F2026-0101'))?.status).toBe('done');
    expect((await c.deadline('S2026-07'))?.status).toBe('open');
    const [withdrawn] = await database.db
      .select()
      .from(actions)
      .where(eq(actions.tenantId, c.tenant.id));
    expect(withdrawn).toMatchObject({ status: 'rejected', comment: 'deadline_done' });

    // A newer export: the situation paid down, F2026-0104 now with a customer known, F2026-0101
    // paid and closed already, the paid F2026-0102 still nothing to follow.
    await c.give('factures-2.csv', [
      ...INVOICES.slice(0, 3),
      'S2026-07;Situation de travaux;05/10/2026;04/11/2030;;Boulangerie Martin SAS;Les Tilleuls;9 500,00;1 500,00',
      ...INVOICES.slice(4),
    ]);
    expect(await c.imported('invoices')).toMatchObject({
      added: 0,
      updated: 2,
      unchanged: 1,
      skipped: { paid: 1, sent_here: 1, credit_note: 1 },
      withoutCustomer: 0,
    });
    expect(await c.deadline('S2026-07')).toMatchObject({ status: 'open', amount: 150_000 });
    expect(await c.deadline('F2026-0104')).toMatchObject({ status: 'open', partyId: later.id });
    // Paid stays paid, whatever the ERP says of it later.
    expect((await c.deadline('F2026-0101'))?.status).toBe('done');

    // « Reste à payer » at 0 closes it as a payment does.
    await c.give('factures-3.csv', [
      INVOICES[1] ?? '',
      'S2026-07;Situation de travaux;05/10/2026;04/11/2030;;Boulangerie Martin SAS;Les Tilleuls;9 500,00;0,00',
    ]);
    expect((await c.deadline('S2026-07'))?.status).toBe('done');
    const closes = await database.db
      .select({ actor: auditEvents.actor, objectId: auditEvents.objectId })
      .from(auditEvents)
      .where(
        and(eq(auditEvents.tenantId, c.tenant.id), eq(auditEvents.action, 'obligation.close')),
      );
    expect(closes).toEqual([
      { actor: 'agent:erp', objectId: (await c.deadline('F2026-0101'))?.id },
      { actor: 'agent:erp', objectId: (await c.deadline('S2026-07'))?.id },
    ]);
  });

  it('go with the account: an ERP’s record is no invoice to keep ten years', async () => {
    const c = await company();
    await c.customer({ legalName: 'Boulangerie Martin SAS', siren: BAKERY, erpRef: 'C010' });
    const pdp = await c.fromPdp();
    await c.give('factures.csv', INVOICES);
    expect((await c.docsOf()).map((d) => d.source).sort()).toEqual([
      'erp',
      'erp',
      'erp',
      'erp',
      'pdp',
    ]);
    const deleted = await api.request('/tenant', {
      method: 'DELETE',
      token: c.tenant.apiKey,
      body: { confirmSiren: '100000009' },
    });
    expect(deleted.status).toBe(200);
    // The invoice the platform delivered stays with its bytes (10 years); the ERP's copies go.
    const kept = await c.docsOf();
    expect(kept.map((d) => [d.id, d.source])).toEqual([[pdp, 'pdp']]);
    const bytes = await database.db
      .select({ key: blobs.key })
      .from(blobs)
      .where(eq(blobs.tenantId, c.tenant.id));
    expect(bytes.map((b) => b.key)).toEqual(kept.map((d) => d.storageKey));
    expect(await c.deadlines()).toEqual([]);
  });

  it('keep the PDP’s values for the same invoice, whichever came first (§12)', async () => {
    // The ERP says another due date and amount for golden invoice 01, and knows its chantier.
    const erpSays = (due: string, left: string) => [
      'N° facture;Date;Échéance;Client;Chantier;Montant TTC;Reste à payer',
      `${SALE.number};15/10/2026;${due};Boulangerie Martin SAS;CH-01;1 620,00;${left}`,
    ];

    // The PDP first, then the ERP: one deadline, the PDP's date and amount, the ERP's chantier.
    const a = await company();
    const bakeryA = await a.customer({ legalName: 'Boulangerie Martin SAS', siren: BAKERY });
    const siteA = await a.chantier('CH-01', 'Les Tilleuls');
    const pdpA = await a.fromPdp();
    expect(await a.deadlines()).toHaveLength(1);
    await a.give('factures.csv', erpSays('31/12/2026', '1 000,00'));
    expect(await a.deadlines()).toEqual([
      expect.objectContaining({
        key: `facture_echeance:100000009:${SALE.number}`,
        dueOn: SALE.dueDate,
        amount: SALE.totals?.payable,
        sourceDocumentId: pdpA,
        partyId: bakeryA.id,
        chantierId: siteA.id,
        status: 'open',
      }),
    ]);
    // A newer ERP export moves nothing either.
    await a.give('factures-2.csv', erpSays('15/01/2027', '900,00'));
    expect(await a.deadlines()).toEqual([
      expect.objectContaining({ dueOn: SALE.dueDate, amount: SALE.totals?.payable }),
    ]);

    // The ERP first, then the PDP: the PDP's values replace the ERP's, the chantier stays.
    const b = await company();
    await b.customer({ legalName: 'Boulangerie Martin SAS', siren: BAKERY });
    const siteB = await b.chantier('CH-01', 'Les Tilleuls');
    await b.give('factures.csv', erpSays('31/12/2026', '1 000,00'));
    expect(await b.deadlines()).toEqual([
      expect.objectContaining({ dueOn: '2026-12-31', amount: 100_000, chantierId: siteB.id }),
    ]);
    // A worse source (a copy by e-mail) with a later date moves nothing.
    const erpDoc = (await b.docsOf())[0];
    const [mail] = await database.db
      .insert(documents)
      .values({
        tenantId: b.tenant.id,
        source: 'mail',
        sourceRef: 'msg-1',
        name: 'facture.pdf',
        mime: 'application/pdf',
        size: 1,
        sha256: 'f'.repeat(64),
        storageKey: 'none',
        kind: 'facture_vente',
        stage: 'done',
        isTest: false,
        receivedAt: new Date(),
      })
      .returning();
    if (!mail || !erpDoc) throw new Error('no documents');
    const later = [
      {
        kind: 'facture_echeance' as const,
        key: `facture_echeance:100000009:${SALE.number}`,
        dueOn: '2027-03-31',
        amount: 5_000,
        siren: BAKERY,
      },
    ];
    expect(
      await database.db.transaction((tx) => saveObligations(tx, mail, later, null, new Date())),
    ).toBe(0);
    const pdpB = await b.fromPdp();
    expect(await b.deadlines()).toEqual([
      expect.objectContaining({
        dueOn: SALE.dueDate,
        amount: SALE.totals?.payable,
        sourceDocumentId: pdpB,
        chantierId: siteB.id,
        status: 'open',
      }),
    ]);
    // The ERP read again does not take it back; its « payé » closes it all the same.
    await b.give('factures-2.csv', erpSays('15/01/2027', '900,00'));
    expect((await b.deadlines())[0]).toMatchObject({ sourceDocumentId: pdpB, amount: 162_000 });
    await b.give('factures-3.csv', erpSays('15/01/2027', '0,00'));
    expect(await b.deadlines()).toEqual([
      expect.objectContaining({ sourceDocumentId: pdpB, status: 'done' }),
    ]);
    // One document per source of the invoice, never two of one source.
    expect((await b.docsOf()).map((d) => d.source).sort()).toEqual(['erp', 'mail', 'pdp']);
  });
});
