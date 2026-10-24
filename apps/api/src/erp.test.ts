// BTP stage 4A (docs/plans/phase-4.md): the lists an ERP exports, given from the pane and written by
// the `erp.sync` job. Stage 4's definition of done: an export gives the companies and chantiers it
// lists, once (the same file twice changes nothing, a newer file updates what changed, another
// company's data is never touched); a run stopped in the middle ends as a run without a stop; a file
// without a required column says which and changes nothing. The labels are made up from common
// French usage, not a pilot's real export (TODO(verify), docs/TODO.md).
import { exportConnector } from '@fi/connectors';
import { luhn } from '@fi/core';
import { xlsxOf } from '@fi/core/testing/xlsx';
import {
  and,
  auditEvents,
  blobs,
  chantiers,
  connectorSyncs,
  type Database,
  eq,
  parties,
} from '@fi/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runErpSync } from './erp';
import { ADMIN_TOKEN, fakeAdapter, newTenant, testApi, testDatabase } from './test-helpers';

let database: Database;
let api: ReturnType<typeof testApi>;

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: fakeAdapter() }, ADMIN_TOKEN);
});
afterAll(() => database.close());

/** A SIREN with its check digit, from any number. */
function sirenOf(n: number): string {
  const body = String(70_000_000 + n);
  for (let d = 0; d < 10; d++) if (luhn(`${body}${d}`)) return `${body}${d}`;
  throw new Error('no check digit');
}
function siretOf(siren: string): string {
  for (let d = 0; d < 10; d++) if (luhn(`${siren}0001${d}`)) return `${siren}0001${d}`;
  throw new Error('no check digit');
}

const csv = (lines: string[]) =>
  new Uint8Array(Buffer.from(lines.join('\r\n'), 'utf8')) as Uint8Array<ArrayBuffer>;

interface ImportView {
  status: 'running' | 'done' | 'failed';
  file: { name: string; size: number } | null;
  added: number;
  updated: number;
  unchanged: number;
  skipped: Record<string, number>;
  examples: { row: number; name: string | null; reason: string }[];
  withoutCustomer: number;
  finishedAt: string | null;
  error: { code: string; message: string } | null;
}
type Imports = Record<'customers' | 'suppliers' | 'chantiers', ImportView | null>;

async function company() {
  const tenant = await newTenant(api.request);
  const call = async (path: string, method = 'GET', body?: unknown) => {
    const res = await api.request(path, { method, token: tenant.apiKey, body });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const give = (name: string, bytes: Uint8Array, list?: string) =>
    call(
      `/erp/imports?name=${encodeURIComponent(name)}${list ? `&list=${list}` : ''}`,
      'POST',
      bytes,
    );
  const imports = async () => (await call('/erp')).body as unknown as Imports;
  const partiesOf = (kind: 'customer' | 'supplier') =>
    database.db
      .select()
      .from(parties)
      .where(and(eq(parties.tenantId, tenant.id), eq(parties.kind, kind)))
      .orderBy(parties.siren);
  const chantiersOf = () =>
    database.db
      .select()
      .from(chantiers)
      .where(eq(chantiers.tenantId, tenant.id))
      .orderBy(chantiers.erpRef);
  const blobsOf = () =>
    database.db.select({ key: blobs.key }).from(blobs).where(eq(blobs.tenantId, tenant.id));
  return { tenant, call, give, imports, partiesOf, chantiersOf, blobsOf };
}

/** The jobs queued so far, run as the worker would. */
async function runQueued() {
  for (const job of api.jobs.erp.splice(0)) {
    await runErpSync(api.deps, job.tenantId, job.connector);
  }
}

const CUSTOMERS = [
  'Liste des clients',
  'Code client;Raison sociale;SIRET;E-mail;Adresse;CP;Ville',
  `C001;SARL Dupont Bâtiment;${siretOf(sirenOf(1))};compta@dupont.test;3 rue des Lilas;21000;Dijon`,
  `C002;Mairie de Talant;${sirenOf(2)};;;;`,
  'C003;Mme Durand;;durand@example.test;;;',
];

describe('the lists an ERP exports, imported once', () => {
  it('add what is new, fill what a known company lacks, and link the chantiers', async () => {
    const c = await company();
    // A customer a person looked up in the directory: its name and e-mail stay as they are.
    await database.db.insert(parties).values({
      tenantId: c.tenant.id,
      kind: 'customer',
      legalName: 'DUPONT BATIMENT',
      siren: sirenOf(1),
      email: 'factures@dupont.test',
      source: 'sirene',
      verifiedAt: new Date(),
    });

    const given = await c.give('clients.csv', csv(CUSTOMERS));
    expect(given.status).toBe(202);
    expect(given.body).toMatchObject({ list: 'customers', rows: 3, again: false });
    expect(api.jobs.erp).toEqual([{ tenantId: c.tenant.id, connector: 'export:customers' }]);
    expect((await c.imports()).customers?.status).toBe('running');
    await runQueued();

    const customers = await c.imports();
    expect(customers.customers).toMatchObject({
      status: 'done',
      file: { name: 'clients.csv' },
      added: 1,
      updated: 1,
      unchanged: 0,
      skipped: { no_siren: 1 },
      examples: [{ row: 5, name: 'Mme Durand', reason: 'no_siren' }],
      error: null,
    });
    expect(customers.suppliers).toBeNull();
    const [dupont, talant] = await c.partiesOf('customer');
    expect(dupont).toMatchObject({
      legalName: 'DUPONT BATIMENT',
      email: 'factures@dupont.test',
      siret: siretOf(sirenOf(1)),
      erpRef: 'C001',
      address: { line1: '3 rue des Lilas', postCode: '21000', city: 'Dijon' },
      source: 'sirene',
    });
    expect(talant).toMatchObject({
      legalName: 'Mairie de Talant',
      erpRef: 'C002',
      source: 'erp',
      verifiedAt: null,
      subcontracting: false,
    });
    // Its rows written, the file is kept no more.
    expect(await c.blobsOf()).toEqual([]);

    const suppliers = csv([
      'Code fournisseur;Nom;SIREN;Sous-traitant',
      `F01;Plâtrerie Roux;${sirenOf(3)};Oui`,
      `F02;Négoce Matériaux;${sirenOf(4)};Non`,
    ]);
    expect((await c.give('fournisseurs.csv', suppliers)).status).toBe(202);
    await runQueued();
    expect(
      (await c.partiesOf('supplier')).map((p) => [p.legalName, p.subcontracting, p.source]),
    ).toEqual([
      ['Plâtrerie Roux', true, 'erp'],
      ['Négoce Matériaux', false, 'erp'],
    ]);

    const sites = xlsxOf({
      Chantiers: [
        ['N° chantier', 'Libellé', 'Code client', 'Client', 'Ville', 'État', 'RG %'],
        ['CH-01', 'Les Tilleuls', 'C001', null, 'Dijon', 'En cours', 5],
        ['CH-02', 'École Jules Ferry', null, 'Mairie de Talant', 'Talant', 'Terminé', null],
        ['CH-03', 'Garage', 'C999', null, null, null, null],
      ],
    });
    expect((await c.give('chantiers.xlsx', sites)).status).toBe(202);
    await runQueued();
    expect((await c.imports()).chantiers).toMatchObject({ added: 3, withoutCustomer: 1 });
    const ids = Object.fromEntries((await c.partiesOf('customer')).map((p) => [p.erpRef, p.id]));
    expect(
      (await c.chantiersOf()).map((s) => [s.erpRef, s.name, s.customerId, s.status, s.retenueBps]),
    ).toEqual([
      ['CH-01', 'Les Tilleuls', ids.C001, 'open', 500],
      ['CH-02', 'École Jules Ferry', ids.C002, 'closed', null],
      ['CH-03', 'Garage', null, 'open', null],
    ]);

    // The same file again: nothing queued, nothing written.
    const before = await c.partiesOf('customer');
    const again = await c.give('clients (copie).csv', csv(CUSTOMERS));
    expect(again).toMatchObject({ status: 200, body: { again: true } });
    expect(api.jobs.erp).toEqual([]);
    expect(await c.partiesOf('customer')).toEqual(before);

    // A newer export: a new customer, an address the ERP now has, the rest as it was.
    const newerFile = csv([
      ...CUSTOMERS.slice(0, 3),
      `C002;Mairie de Talant;${sirenOf(2)};;1 place de la Mairie;21240;Talant`,
      'C003;Mme Durand;;durand@example.test;;;',
      `C004;Bouygues Habitat;${sirenOf(5)};;;;`,
    ]);
    expect((await c.give('clients.csv', newerFile)).status).toBe(202);
    await runQueued();
    expect((await c.imports()).customers).toMatchObject({
      added: 1,
      updated: 1,
      unchanged: 1,
      skipped: { no_siren: 1 },
    });
    const after = await c.partiesOf('customer');
    expect(after.find((p) => p.erpRef === 'C002')?.address).toEqual({
      line1: '1 place de la Mairie',
      postCode: '21240',
      city: 'Talant',
    });
    // The chantiers again: the database gives addresses back in its own key order, no change.
    expect((await c.give('chantiers.xlsx', sites)).status).toBe(200);
    const resites = xlsxOf({
      Chantiers: [
        ['N° chantier', 'Libellé', 'Code client', 'Ville', 'État', 'Date de réception'],
        ['CH-01', 'Les Tilleuls', 'C001', 'Dijon', 'Terminé', '15/10/2026'],
        ['CH-02', 'École Jules Ferry', null, 'Talant', 'Terminé', null],
      ],
    });
    expect((await c.give('chantiers.xlsx', resites)).status).toBe(202);
    await runQueued();
    expect((await c.imports()).chantiers).toMatchObject({ added: 0, updated: 1, unchanged: 1 });
    expect((await c.chantiersOf())[0]).toMatchObject({
      status: 'closed',
      receptionOn: '2026-10-15',
      retenueBps: 500,
    });

    const audited = await database.db
      .select({ action: auditEvents.action, actor: auditEvents.actor })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, c.tenant.id));
    expect(audited.filter((a) => a.action === 'erp.import')).toHaveLength(5);
    expect(audited.filter((a) => a.action === 'erp.sync')).toEqual(
      Array(5).fill({ action: 'erp.sync', actor: 'agent:erp' }),
    );
  });

  it('never touch another company’s data', async () => {
    const a = await company();
    const b = await company();
    await database.db.insert(parties).values({
      tenantId: b.tenant.id,
      kind: 'customer',
      legalName: 'Client de B',
      siren: sirenOf(1),
      source: 'sirene',
    });
    await a.give('clients.csv', csv(CUSTOMERS));
    await runQueued();
    expect(await b.partiesOf('customer')).toMatchObject([
      { legalName: 'Client de B', erpRef: null, siret: null },
    ]);
    expect(await b.imports()).toEqual({ customers: null, suppliers: null, chantiers: null });
    // B's own import of the same file is B's: A's « already imported » does not apply to it.
    expect((await b.give('clients.csv', csv(CUSTOMERS))).status).toBe(202);
    await runQueued();
    expect((await b.imports()).customers).toMatchObject({ added: 1, updated: 1 });
  });

  it('go on from the cursor after a stop, and end as a run without a stop', async () => {
    const lines = ['Code client;Raison sociale;SIREN'];
    for (let n = 1; n <= 1_201; n++) lines.push(`C${n};Client ${n};${sirenOf(1_000 + n)}`);
    lines.push('C0;Sans numéro;');
    const file = csv(lines);

    const whole = await company();
    await whole.give('clients.csv', file);
    await runQueued();

    const stopped = await company();
    await stopped.give('clients.csv', file);
    const [job] = api.jobs.erp.splice(0);
    if (!job) throw new Error('no job');
    // The process dies after the first batch is written.
    const crashing: typeof exportConnector = {
      ...exportConnector,
      async *pull(cfg, cursor) {
        for await (const batch of exportConnector.pull(cfg, cursor)) {
          yield batch;
          throw new Error('killed');
        }
      },
    };
    await expect(runErpSync(api.deps, job.tenantId, job.connector, crashing)).rejects.toThrow(
      'killed',
    );
    const halfway = (await stopped.imports()).customers;
    expect(halfway).toMatchObject({
      status: 'failed',
      added: 500,
      error: { code: 'erp_interrupted' },
    });
    expect(halfway?.error?.message).toContain('reprend tout seul');
    expect(await stopped.partiesOf('customer')).toHaveLength(500);
    const [sync] = await database.db
      .select({ cursor: connectorSyncs.cursor })
      .from(connectorSyncs)
      .where(eq(connectorSyncs.tenantId, stopped.tenant.id));
    expect(sync?.cursor).toMatchObject({ row: 501 });

    // The queue tries again: from row 502, to the end.
    await runErpSync(api.deps, job.tenantId, job.connector);
    const strip = (v: ImportView | null) => v && { ...v, finishedAt: null, startedAt: null };
    const resumed = strip((await stopped.imports()).customers);
    expect(resumed).toEqual(strip((await whole.imports()).customers));
    expect(resumed).toMatchObject({ status: 'done', added: 1_201, skipped: { no_siren: 1 } });
    expect(await stopped.partiesOf('customer')).toHaveLength(1_201);
  });

  it('go on when the same file is given again after its bytes were lost', async () => {
    const c = await company();
    await c.give('clients.csv', csv(CUSTOMERS));
    await database.db.delete(blobs).where(eq(blobs.tenantId, c.tenant.id));
    await runQueued();
    expect((await c.imports()).customers).toMatchObject({
      status: 'failed',
      error: { code: 'export_missing' },
    });
    const again = await c.give('clients.csv', csv(CUSTOMERS));
    expect(again).toMatchObject({ status: 202, body: { again: true } });
    await runQueued();
    expect((await c.imports()).customers).toMatchObject({ status: 'done', added: 2 });
  });

  it('say what stops a file, in French, and keep nothing', async () => {
    const c = await company();
    const noSiren = await c.give(
      'clients.csv',
      csv(['Code client;Raison sociale;Ville', 'C1;X;Dijon']),
    );
    expect(noSiren.status).toBe(422);
    expect(noSiren.body.error).toMatchObject({
      code: 'export_column_missing',
      message: expect.stringContaining('« SIRET » ou « SIREN »'),
    });
    const noCode = await c.give('chantiers.csv', csv(['Libellé chantier;Ville;État', 'X;Y;Z']));
    expect(noCode.body.error).toMatchObject({
      message: expect.stringContaining('« Code chantier »'),
    });
    const unknown = csv(['Code;Raison sociale;SIREN', `X;Dupont;${sirenOf(9)}`]);
    expect((await c.give('liste.csv', unknown)).body.error).toMatchObject({
      code: 'export_list_unknown',
    });
    expect((await c.give('liste.csv', unknown, 'clients')).status).toBe(400);
    expect((await c.give('liste.pdf', new Uint8Array([37, 80, 68, 70]))).status).toBe(415);
    expect((await c.give('vide.csv', new Uint8Array())).status).toBe(422);
    expect(api.jobs.erp).toEqual([]);
    expect(await c.blobsOf()).toEqual([]);
    expect(await c.imports()).toEqual({ customers: null, suppliers: null, chantiers: null });
    // Said by the person, the same file goes.
    expect((await c.give('liste.csv', unknown, 'suppliers')).status).toBe(202);
    await runQueued();
    expect((await c.partiesOf('supplier')).map((p) => p.legalName)).toEqual(['Dupont']);
  });

  it('go with the account, the import and its file', async () => {
    const c = await company();
    await c.give('clients.csv', csv(CUSTOMERS));
    expect(await c.blobsOf()).toHaveLength(1);
    const deleted = await api.request('/tenant', {
      method: 'DELETE',
      token: c.tenant.apiKey,
      body: { confirmSiren: '100000009' },
    });
    expect(deleted.status).toBe(200);
    const syncs = await database.db
      .select()
      .from(connectorSyncs)
      .where(eq(connectorSyncs.tenantId, c.tenant.id));
    expect(syncs).toEqual([]);
    expect(await c.blobsOf()).toEqual([]);
    // The job queued before finds nothing to do.
    await runQueued();
  });
});
