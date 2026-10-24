// The BTP back end's files, building sites, deadlines and actions (docs/DECISIONS.md D2): what the
// RGPD export gives of them and what a deletion leaves (docs/RGPD.md).
import {
  actions,
  blobs,
  chantiers,
  connectorSyncs,
  type Database,
  documents,
  eq,
  obligations,
  parties,
} from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN_TOKEN, fakeAdapter, newTenant, testApi, testDatabase } from './test-helpers';

let database: Database;
let api: ReturnType<typeof testApi>;

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: fakeAdapter() }, ADMIN_TOKEN);
});
afterAll(() => database.close());

/** A company with a sous-traitant, a chantier, four files, a deadline, an action and an ERP cursor. */
async function btpCompany() {
  const t = await newTenant(api.request);
  const db = database.db;
  const [sub] = await db
    .insert(parties)
    .values({
      tenantId: t.id,
      kind: 'supplier',
      legalName: 'Plâtrerie Dumas',
      siren: '200000009',
      siret: '20000000900017',
      subcontractor: true,
      source: 'invoice',
    })
    .returning();
  const [site] = await db
    .insert(chantiers)
    .values({ tenantId: t.id, name: 'Les Tilleuls', erpRef: 'CH-12', retenueBps: 500 })
    .returning();
  const file = async (
    sha: string,
    kind: (typeof documents.$inferInsert)['kind'],
    isTest = false,
  ) => {
    const sha256 = sha.repeat(64);
    const storageKey = `${t.id}/${sha256}`;
    await db.insert(blobs).values({
      key: storageKey,
      tenantId: t.id,
      sha256,
      size: 3,
      mime: 'application/pdf',
      bytes: new Uint8Array([1, 2, 3]),
    });
    const [row] = await db
      .insert(documents)
      .values({
        tenantId: t.id,
        source: 'mail',
        sourceRef: `<${sha}@platrerie-dumas.fr>`,
        name: `${kind ?? 'inconnu'}.pdf`,
        mime: 'application/pdf',
        size: 3,
        sha256,
        storageKey,
        kind,
        stage: kind ? 'done' : 'needs_review',
        partyId: sub?.id,
        chantierId: site?.id,
        hints: { senderEmail: 'jean.dumas@platrerie-dumas.fr', subject: 'Documents' },
        isTest,
        receivedAt: new Date('2026-10-24T08:00:00Z'),
      })
      .returning();
    if (!row) throw new Error('no document');
    return row;
  };
  const invoice = await file('a', 'facture_achat');
  const attestation = await file('b', 'attestation_vigilance');
  await file('c', 'facture_achat', true);
  await file('d', null);
  const [deadline] = await db
    .insert(obligations)
    .values({
      tenantId: t.id,
      kind: 'attestation_vigilance_renouvellement',
      dueOn: '2027-04-24',
      key: `attestation_vigilance_renouvellement:${sub?.id}`,
      partyId: sub?.id,
      sourceDocumentId: attestation.id,
      isTest: false,
    })
    .returning();
  await db.insert(actions).values({
    tenantId: t.id,
    kind: 'demande_attestation_vigilance',
    key: `demande_attestation_vigilance:${deadline?.id}`,
    obligationId: deadline?.id,
    partyId: sub?.id,
    payload: { to: 'jean.dumas@platrerie-dumas.fr', subject: 'Attestation de vigilance' },
    isTest: false,
  });
  await db
    .insert(connectorSyncs)
    .values({ tenantId: t.id, connector: 'erp-export', cursor: { file: 'clients.csv' } });
  return { t, invoice };
}

const documentsOf = (tenantId: string) =>
  database.db.select().from(documents).where(eq(documents.tenantId, tenantId));
const blobKeys = async (tenantId: string) =>
  (await database.db.select().from(blobs).where(eq(blobs.tenantId, tenantId))).map((b) => b.key);
const count = async (
  table: typeof chantiers | typeof obligations | typeof actions | typeof connectorSyncs,
  tenantId: string,
) =>
  (await database.db.select({ id: table.id }).from(table).where(eq(table.tenantId, tenantId)))
    .length;

describe('the BTP back end and RGPD', () => {
  it('exports the chantiers, the files without their bytes, the deadlines and the actions', async () => {
    const { t } = await btpCompany();
    const exported = (await (await api.request('/tenant/export', { token: t.apiKey })).json()) as {
      suppliers: { subcontractor: boolean; siret: string | null; id: string }[];
      chantiers: { name: string; erpRef: string; retenueBps: number }[];
      documents: Record<string, unknown>[];
      obligations: { kind: string; dueOn: string; documentId: string }[];
      actions: { kind: string; status: string; payload: { subject: string } }[];
      connectorSyncs: { connector: string; cursor: unknown }[];
    };
    expect(exported.suppliers).toEqual([
      expect.objectContaining({ subcontractor: true, siret: '20000000900017' }),
    ]);
    expect(exported.chantiers).toEqual([
      expect.objectContaining({ name: 'Les Tilleuls', erpRef: 'CH-12', retenueBps: 500 }),
    ]);
    expect(exported.documents.map((d) => String(d.kind)).sort()).toEqual([
      'attestation_vigilance',
      'facture_achat',
      'facture_achat',
      'null',
    ]);
    for (const d of exported.documents) {
      expect(d).toMatchObject({
        partyId: exported.suppliers[0]?.id,
        hints: { senderEmail: 'jean.dumas@platrerie-dumas.fr' },
      });
    }
    for (const d of exported.documents) {
      expect(d).not.toHaveProperty('bytes');
      expect(d).not.toHaveProperty('storageKey');
    }
    expect(exported.obligations).toEqual([
      expect.objectContaining({
        kind: 'attestation_vigilance_renouvellement',
        dueOn: '2027-04-24',
      }),
    ]);
    expect(exported.actions).toEqual([
      expect.objectContaining({
        kind: 'demande_attestation_vigilance',
        status: 'draft',
        payload: expect.objectContaining({ subject: 'Attestation de vigilance' }),
      }),
    ]);
    expect(exported.connectorSyncs).toEqual([
      expect.objectContaining({ connector: 'erp-export', cursor: { file: 'clients.csv' } }),
    ]);
  });

  it('keeps on deletion only the real invoices received, with their bytes and without the e-mail', async () => {
    const { t, invoice } = await btpCompany();
    const other = await btpCompany();
    const deleted = await api.request('/tenant', {
      method: 'DELETE',
      token: t.apiKey,
      body: { confirmSiren: '100000009' },
    });
    expect(deleted.status).toBe(200);
    expect(await documentsOf(t.id)).toEqual([
      expect.objectContaining({ id: invoice.id, hints: {}, partyId: null, chantierId: null }),
    ]);
    expect(await blobKeys(t.id)).toEqual([invoice.storageKey]);
    for (const table of [chantiers, obligations, actions, connectorSyncs]) {
      expect(await count(table, t.id)).toBe(0);
    }
    expect(await documentsOf(other.t.id)).toHaveLength(4);
    expect(await blobKeys(other.t.id)).toHaveLength(4);
    expect(await count(actions, other.t.id)).toBe(1);
  });
});
