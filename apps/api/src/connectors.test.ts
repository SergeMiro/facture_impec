// OneDrive files read without Excel (R4), against the Microsoft stand-in of apps/mock-pdp: a personal
// account told of each change, a work account polled, the 300/400 example found from a file nobody
// opened, the calm side (deleted file, Microsoft asking to wait, a token refused, files we do not read),
// disconnecting that deletes what was read, and RGPD.

import { randomBytes } from 'node:crypto';
import { type XlsxCell, xlsxOf } from '@fi/core/testing/xlsx';
import type { Database } from '@fi/db';
import {
  auditEvents,
  connectedFiles,
  connections,
  docs,
  eq,
  findings,
  invoices,
  sources,
} from '@fi/db';
import { MICROSOFT_STAND_IN_APP, MicrosoftStandIn } from '@fi/mock-pdp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkNow } from './checks';
import { type Checks, companies, invoiceRow, invoiceSheet } from './checks.fixtures';
import {
  checkConnection,
  connectorsBehind,
  type MicrosoftConnector,
  POLL_EVERY_MS,
  servedByMicrosoft,
  WATCHED_POLL_EVERY_MS,
} from './connectors';
import { createMicrosoftClient } from './microsoft';
import {
  fakeAdapter,
  inProcess,
  newTenant,
  type RecordedJobs,
  signIn,
  testApi,
  testDatabase,
  today,
} from './test-helpers';
import { runSweep } from './workers';

const SEALING_KEY = Buffer.alloc(32, 7).toString('base64');
const PERSONAL = { account: 'msa-camille', driveId: 'b!personal-camille' };
const WORK = { account: 'aad-camille', driveId: 'b!work-camille' };

let database: Database;
let api: ReturnType<typeof testApi>;
let jobs: RecordedJobs;
let stand: MicrosoftStandIn;
let microsoft: MicrosoftConnector;
let clock = new Date(`${today()}T08:00:00Z`);

beforeAll(async () => {
  database = await testDatabase();
  stand = new MicrosoftStandIn({
    ...MICROSOFT_STAND_IN_APP,
    publicUrl: 'http://microsoft.test',
    // Notifications and the validation handshake reach the API in-process.
    fetcher: inProcess({ request: (path, init) => api.app.request(path, init) }),
    now: () => clock,
  });
  microsoft = {
    client: createMicrosoftClient({
      ...MICROSOFT_STAND_IN_APP,
      loginUrl: 'http://microsoft.test',
      graphUrl: 'http://microsoft.test/graph/v1.0',
      fetcher: inProcess(stand.app),
    }),
    clientId: MICROSOFT_STAND_IN_APP.clientId,
    sealingKey: SEALING_KEY,
    notificationUrl: 'http://api.test/webhooks/microsoft',
  };
  api = testApi(database, { mock: fakeAdapter() }, undefined, { now: () => clock, microsoft });
  ({ jobs } = api);
});
afterAll(async () => {
  await database.close();
});
beforeEach(() => {
  clock = new Date(`${today()}T08:00:00Z`);
});

const company = (workbook: string) => companies({ request: api.request, database })(workbook);

const SEP1 = { date: 46266 };
const ORDER_HEADER: XlsxCell[] = ['N° commande', 'Date', 'Client', 'Désignation', 'Qté', 'PU HT'];
/** « Commandes 2026.xlsx »: one order, the price as given; a second sheet nobody includes. */
const ordersFile = (price: number) =>
  xlsxOf({
    Commandes: [ORDER_HEADER, ['C-118', SEP1, 'Durand SARL', 'Chaise pliante', 10, price]],
    Notes: [['Pense-bête'], ['Relancer Durand en octobre']],
  });

interface View {
  microsoft: { clientId: string; scope: string } | null;
  connection: {
    label: string;
    accountKind: string;
    status: string;
    notified: boolean;
    checkedAt: string | null;
    files: {
      id: string;
      name: string;
      problem: string | null;
      sheets: { sheet: string; present: boolean; source: { id: string; kind: string } | null }[];
    }[];
  } | null;
}

/** A company with a Microsoft account connected and « Commandes 2026.xlsx » included. */
async function connected(workbook: string, who: typeof PERSONAL, item: string, price = 30) {
  const c = await company(workbook);
  await stand.putFile(who.account, item, 'Commandes 2026.xlsx', ordersFile(price));
  const view = (await c.call('/connectors/microsoft', 'POST', {
    token: stand.signIn(who.account),
  })) as View;
  const picked = (await c.call('/connectors/microsoft/files', 'POST', {
    files: [{ driveId: who.driveId, itemId: item }],
  })) as View;
  const file = picked.connection?.files.find((f) => f.name === 'Commandes 2026.xlsx');
  if (!file) throw new Error('not picked');
  const base = `/connectors/microsoft/files/${file.id}/sheets/Commandes`;
  const { layout } = (await c.call(`${base}/detect`, 'POST')) as { layout: { kind: string } };
  expect(layout.kind).toBe('order');
  const included = await c.call(base, 'PUT', { layout });
  const [conn] = await database.db.select().from(connections).where(eq(connections.tenantId, c.id));
  if (!conn) throw new Error('no connection');
  return { ...c, view, file, included, connectionId: conn.id };
}

const check = (connectionId: string) => checkConnection({ ...api.deps, microsoft }, connectionId);
const contentCalls = () => stand.calls.filter((call) => call.endsWith('/content')).length;

describe('a personal OneDrive', () => {
  it('finds 100 € missing against an order changed in a file nobody opened', async () => {
    const c = await company('wb-ms-01');
    expect(await c.call('/connectors/microsoft')).toEqual({
      microsoft: {
        clientId: MICROSOFT_STAND_IN_APP.clientId,
        scope: `api://${MICROSOFT_STAND_IN_APP.clientId}/.default`,
      },
      mailOnMicrosoft: false,
      connection: null,
    });
    await stand.putFile(PERSONAL.account, 'cmd-01', 'Commandes 2026.xlsx', ordersFile(30));
    const view = (await c.call('/connectors/microsoft', 'POST', {
      token: stand.signIn(PERSONAL.account),
    })) as View;
    expect(view.connection).toMatchObject({
      label: 'camille.martin@outlook.fr',
      accountKind: 'personal',
      status: 'active',
      notified: true,
      picker: {
        baseUrl: 'https://onedrive.live.com/picker',
        scope: 'OneDrive.ReadOnly',
        authority: 'https://login.microsoftonline.com/consumers',
      },
      files: [],
    });
    // Graph checked our address with its handshake before it took the subscription.
    const [conn] = await database.db
      .select()
      .from(connections)
      .where(eq(connections.tenantId, c.id));
    const subscription = stand.subscriptions.get(conn?.subscriptionId ?? '');
    expect(subscription).toMatchObject({
      resource: '/me/drive/root',
      changeType: 'updated',
      notificationUrl: 'http://api.test/webhooks/microsoft',
    });
    // The token is sealed; its secret is not in the row.
    expect(conn?.refreshToken).toMatch(/^v1\./);
    expect(conn?.clientStateHash).not.toBe(subscription?.clientState);

    // Only the picked file is read, and only once it is picked.
    const picked = (await c.call('/connectors/microsoft/files', 'POST', {
      files: [{ driveId: PERSONAL.driveId, itemId: 'cmd-01' }],
    })) as View;
    const [file] = picked.connection?.files ?? [];
    expect(file).toMatchObject({
      name: 'Commandes 2026.xlsx',
      problem: null,
      sheets: [
        { sheet: 'Commandes', present: true, source: null },
        { sheet: 'Notes', present: true, source: null },
      ],
    });
    const base = `/connectors/microsoft/files/${file?.id}/sheets/Commandes`;
    const { layout, sample } = (await c.call(`${base}/detect`, 'POST')) as {
      layout: { kind: string };
      sample: { sheet: string; rows: { row: number; cells: { col: string; text: string }[] }[] };
    };
    expect(layout.kind).toBe('order');
    // The pane names the columns from these rows: it has no copy of the file.
    expect(sample.sheet).toBe('Commandes');
    expect(sample.rows[0]?.cells.map((cell) => cell.text)).toEqual(ORDER_HEADER);
    expect(await c.call(base, 'PUT', { layout })).toMatchObject({
      source: { type: 'file', fileId: file?.id, sheet: 'Commandes', kind: 'order' },
      written: 1,
    });

    // The invoice and the order agree: nothing to say.
    await c.syncInvoices(invoiceSheet(invoiceRow('F-2026-042', 'C-118', 'Chaise pliante', 10, 30)));
    await checkNow(database.db, c.id, clock);
    expect((await c.checks()).findings).toEqual([]);

    // Someone raises the order's price in OneDrive. Graph tells us; the check reads the file.
    const queued = jobs.connectors.length;
    await stand.putFile(PERSONAL.account, 'cmd-01', 'Commandes 2026.xlsx', ordersFile(40));
    expect(stand.delivered.at(-1)).toEqual({ subscriptionId: conn?.subscriptionId, status: 202 });
    expect(jobs.connectors.slice(queued)).toContain(conn?.id);
    expect(await check(conn?.id ?? '')).toEqual({ read: 1 });
    await checkNow(database.db, c.id, clock);
    const [b1] = (await c.checks()).findings;
    expect(b1).toMatchObject({ rule: 'B1', severity: 'blocking', amount: 10_000 });
    expect(b1?.message).toBe(
      'La facture F-2026-042 facture 10 « Chaise pliante » pour 300,00 €, alors que la commande C-118 prévoyait 400,00 € : il manque 100,00 €.',
    );
    expect(b1?.evidence).toContainEqual(
      expect.objectContaining({
        role: 'order',
        number: 'C-118',
        sheet: 'Commandes',
        workbookId: file?.id,
        cell: 'Commandes!D2',
      }),
    );
    // Read by the connector, not by a person: the audit says so.
    const reads = await c.audits('source.read');
    expect(reads.at(-1)?.actor).toBe('connector:microsoft');

    // Nothing changed since: one metadata call, no download, nothing written.
    const downloads = contentCalls();
    expect(await check(conn?.id ?? '')).toEqual({ read: 0 });
    expect(contentCalls()).toBe(downloads);
    expect(await c.audits('source.read')).toHaveLength(reads.length);
  });

  it('is checked hourly by the sweep in case a notification is lost; others every 2 minutes', async () => {
    const c = await connected('wb-ms-02', PERSONAL, 'cmd-02');
    expect(await connectorsBehind(database.db, clock)).toContain(c.connectionId);
    await check(c.connectionId);
    expect(await connectorsBehind(database.db, clock)).not.toContain(c.connectionId);
    const later = (ms: number) => new Date(+clock + ms);
    expect(await connectorsBehind(database.db, later(POLL_EVERY_MS))).not.toContain(c.connectionId);
    expect(await connectorsBehind(database.db, later(WATCHED_POLL_EVERY_MS))).toContain(
      c.connectionId,
    );
  });

  it('renews the subscription a day before it ends, and subscribes again when Graph lost it', async () => {
    const c = await connected('wb-ms-03', PERSONAL, 'cmd-03');
    const row = async () => {
      const [conn] = await database.db
        .select()
        .from(connections)
        .where(eq(connections.id, c.connectionId));
      return conn;
    };
    const first = await row();
    clock = new Date(+clock + 2.5 * 86_400_000);
    await check(c.connectionId);
    const renewed = await row();
    expect(renewed?.subscriptionId).toBe(first?.subscriptionId);
    expect(+(renewed?.subscriptionExpiresAt ?? 0)).toBeGreaterThan(
      +(first?.subscriptionExpiresAt ?? 0),
    );

    stand.subscriptions.delete(renewed?.subscriptionId ?? '');
    clock = new Date(+clock + 2.5 * 86_400_000);
    await check(c.connectionId);
    const again = await row();
    expect(again?.subscriptionId).not.toBe(renewed?.subscriptionId);
    expect(stand.subscriptions.has(again?.subscriptionId ?? '')).toBe(true);
    const log = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.objectId, c.connectionId))
      .orderBy(auditEvents.id);
    expect(log.map((e) => [e.actor, e.action])).toEqual([
      ['user', 'connection.connect'],
      ['connector:microsoft', 'connection.watch'],
      ['connector:microsoft', 'connection.renew'],
      ['connector:microsoft', 'connection.watch'],
    ]);
  });
});

describe('a work OneDrive', () => {
  it('is polled: Graph gives no subscription without Files.Read.All, which we do not ask', async () => {
    const c = await connected('wb-ms-04', WORK, 'cmd-04');
    expect(c.view.connection).toMatchObject({
      label: 'camille@atelier-durand.fr',
      accountKind: 'work',
      status: 'active',
      notified: false,
      // The picker of a work account opens on its SharePoint host.
      picker: {
        baseUrl: 'https://atelierdurand-my.sharepoint.com/_layouts/15/FilePicker.aspx',
        scope: 'https://atelierdurand-my.sharepoint.com/.default',
      },
    });
    const [conn] = await database.db
      .select()
      .from(connections)
      .where(eq(connections.id, c.connectionId));
    expect(conn?.subscriptionId).toBeNull();

    // The sweep queues it every 2 minutes.
    await check(c.connectionId);
    const swept = await runSweep({
      ...api.deps,
      microsoft,
      now: () => new Date(+clock + POLL_EVERY_MS),
    });
    expect(swept.connectors).toBeGreaterThanOrEqual(1);
    expect(jobs.connectors).toContain(c.connectionId);

    await stand.putFile(WORK.account, 'cmd-04', 'Commandes 2026.xlsx', ordersFile(40));
    expect(await check(c.connectionId)).toEqual({ read: 1 });
    const [order] = await database.db
      .select({ netTotal: docs.netTotal })
      .from(docs)
      .innerJoin(sources, eq(sources.id, docs.sourceId))
      .where(eq(sources.fileId, c.file.id));
    expect(order?.netTotal).toBe(40_000);
  });
});

describe('when something breaks', () => {
  it('says a file is gone or out of reach, keeps what it gave, and reads it again when back', async () => {
    const c = await connected('wb-ms-05', PERSONAL, 'cmd-05');
    await stand.deleteFile(PERSONAL.account, 'cmd-05');
    await check(c.connectionId);
    let view = (await c.call('/connectors/microsoft')) as View;
    expect(view.connection?.files[0]?.problem).toBe('missing');
    expect(await c.audits('connected_file.problem')).toHaveLength(1);
    const kept = await database.db.select().from(sources).where(eq(sources.fileId, c.file.id));
    expect(kept[0]?.stats?.docs).toBe(1);

    await stand.putFile(PERSONAL.account, 'cmd-05', 'Commandes 2026.xlsx', ordersFile(30));
    await check(c.connectionId);
    view = (await c.call('/connectors/microsoft')) as View;
    expect(view.connection?.files[0]?.problem).toBeNull();

    // A sheet renamed in the file: what it gave stays, the pane says it is gone.
    await stand.putFile(
      PERSONAL.account,
      'cmd-05',
      'Commandes 2026.xlsx',
      xlsxOf({ 'Commandes 2027': [ORDER_HEADER] }),
    );
    await check(c.connectionId);
    view = (await c.call('/connectors/microsoft')) as View;
    expect(view.connection?.files[0]?.sheets).toEqual([
      { sheet: 'Commandes 2027', present: true, source: null },
      expect.objectContaining({ sheet: 'Commandes', present: false, source: expect.anything() }),
    ]);
  });

  it('waits when Microsoft asks to, and stops until the person reconnects when it refuses the token', async () => {
    const c = await connected('wb-ms-06', PERSONAL, 'cmd-06');
    stand.throttle(1);
    expect(await check(c.connectionId)).toEqual({ read: 0 });
    const [waiting] = await database.db
      .select()
      .from(connections)
      .where(eq(connections.id, c.connectionId));
    expect(+(waiting?.waitUntil ?? 0)).toBe(+clock + 2_000);
    expect(await check(c.connectionId)).toBeNull();
    expect(await connectorsBehind(database.db, clock)).not.toContain(c.connectionId);

    clock = new Date(+clock + 3_000);
    stand.revoke(PERSONAL.account);
    await check(c.connectionId);
    const view = (await c.call('/connectors/microsoft')) as View;
    expect(view.connection?.status).toBe('reconnect');
    expect(await c.audits('connection.refused')).toHaveLength(1);
    const res = await api.request('/connectors/microsoft/files', {
      method: 'POST',
      token: c.apiKey,
      body: { files: [{ driveId: PERSONAL.driveId, itemId: 'cmd-06' }] },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(
      /Reconnecter OneDrive/,
    );

    // « Reconnecter OneDrive »: the same account, active again, and checked straight away.
    const queued = jobs.connectors.length;
    const again = (await c.call('/connectors/microsoft', 'POST', {
      token: stand.signIn(PERSONAL.account),
    })) as View;
    expect(again.connection?.status).toBe('active');
    expect(jobs.connectors.slice(queued)).toContain(c.connectionId);
    expect(await c.audits('connection.reconnect')).toHaveLength(1);
  });

  it('refuses another account, a sign-in Microsoft rejects, and files it does not read', async () => {
    const c = await connected('wb-ms-07', PERSONAL, 'cmd-07');
    const call = (path: string, method: string, body?: unknown) =>
      api.request(path, { method, token: c.apiKey, ...(body !== undefined && { body }) });
    const other = await call('/connectors/microsoft', 'POST', {
      token: stand.signIn('aad-camille'),
    });
    expect(other.status).toBe(409);
    expect(((await other.json()) as { error: { message: string } }).error.message).toContain(
      'camille.martin@outlook.fr',
    );
    const forged = await call('/connectors/microsoft', 'POST', {
      token: 'x.eyJ0aWQiOiJ4In0.y-forged',
    });
    // 409, not 401: the person stays signed in to Facture Impec and is told to try again.
    expect(forged.status).toBe(409);
    expect(await forged.json()).toMatchObject({
      error: { code: 'connector_sign_in', details: 'invalid_grant AADSTS50173' },
    });

    await stand.putFile(PERSONAL.account, 'doc-07', 'Notes.docx', new Uint8Array([1, 2, 3]));
    await stand.putFile(PERSONAL.account, 'bad-07', 'Abîmé.xlsx', new Uint8Array([1, 2, 3]));
    const pick = (itemId: string) =>
      call('/connectors/microsoft/files', 'POST', {
        files: [{ driveId: PERSONAL.driveId, itemId }],
      });
    const docx = await pick('doc-07');
    expect(docx.status).toBe(422);
    expect(((await docx.json()) as { error: { code: string } }).error.code).toBe(
      'connector_file_unsupported',
    );
    const broken = await pick('bad-07');
    expect(((await broken.json()) as { error: { code: string } }).error.code).toBe(
      'connector_file_unreadable',
    );
    expect((await pick('nowhere')).status).toBe(404);
    const files = await database.db
      .select()
      .from(connectedFiles)
      .where(eq(connectedFiles.tenantId, c.id));
    expect(files.map((f) => f.name)).toEqual(['Commandes 2026.xlsx']);

    // A pane cannot send its own snapshot for a file's sheet.
    const sync = await call(`/workbooks/${c.file.id}/sources/Commandes/sync`, 'POST', {
      snapshot: { sheet: 'Commandes', rows: [] },
    });
    expect(sync.status).toBe(404);
  });

  it('answers Graph’s handshake, and ignores a notification without our secret', async () => {
    const c = await connected('wb-ms-08', PERSONAL, 'cmd-08');
    const handshake = await api.app.request(
      '/webhooks/microsoft?validationToken=Validation%3A%20abc',
      { method: 'POST' },
    );
    expect(handshake.status).toBe(200);
    expect(handshake.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await handshake.text()).toBe('Validation: abc');

    const [conn] = await database.db
      .select()
      .from(connections)
      .where(eq(connections.id, c.connectionId));
    const queued = jobs.connectors.length;
    const forged = await api.app.request('/webhooks/microsoft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        value: [{ subscriptionId: conn?.subscriptionId, clientState: 'guessed' }],
      }),
    });
    expect(forged.status).toBe(202);
    expect(await forged.json()).toEqual({ received: 0 });
    expect(jobs.connectors.length).toBe(queued);
  });
});

describe('« Déconnecter OneDrive »', () => {
  it('deletes the token, the files, their sheets, their documents and findings; invoices stay', async () => {
    const c = await connected('wb-ms-09', PERSONAL, 'cmd-09', 40);
    await c.syncInvoices(invoiceSheet(invoiceRow('F-2026-043', 'C-118', 'Chaise pliante', 10, 30)));
    await checkNow(database.db, c.id, clock);
    expect((await c.checks()).findings).toHaveLength(1);
    const [conn] = await database.db
      .select()
      .from(connections)
      .where(eq(connections.id, c.connectionId));

    const view = (await c.call('/connectors/microsoft', 'DELETE')) as View;
    expect(view.connection).toBeNull();
    expect(stand.subscriptions.has(conn?.subscriptionId ?? '')).toBe(false);
    for (const table of [connections, connectedFiles, sources]) {
      expect(await database.db.select().from(table).where(eq(table.tenantId, c.id))).toEqual([]);
    }
    const left = await database.db.select().from(docs).where(eq(docs.tenantId, c.id));
    expect(left.every((d) => d.sourceId === null)).toBe(true);
    await checkNow(database.db, c.id, clock);
    expect(((await c.checks()) as Checks).findings).toEqual([]);
    expect(
      await database.db.select().from(findings).where(eq(findings.tenantId, c.id)),
    ).toHaveLength(1);
    expect(
      await database.db.select().from(invoices).where(eq(invoices.tenantId, c.id)),
    ).toHaveLength(1);
    // The audit keeps a hash of what went (account, file names), never the names themselves.
    const [event] = await c.audits('connection.disconnect');
    expect(event?.beforeHash).toMatch(/^[0-9a-f]{64}$/);
    // Its notifications find nothing any more.
    expect(await check(c.connectionId)).toBeNull();
  });

  it('removes one file with what it gave, and leaves the others', async () => {
    const c = await connected('wb-ms-10', PERSONAL, 'cmd-10');
    const view = (await c.call(`/connectors/microsoft/files/${c.file.id}`, 'DELETE')) as View;
    expect(view.connection?.files).toEqual([]);
    expect(await database.db.select().from(sources).where(eq(sources.tenantId, c.id))).toEqual([]);
    expect(await c.audits('connected_file.remove')).toHaveLength(1);
  });
});

describe('RGPD', () => {
  it('exports the account without its token and the files, and erases them with the account', async () => {
    const c = await connected('wb-ms-11', PERSONAL, 'cmd-11');
    const data = (await c.call('/tenant/export')) as Record<string, unknown>;
    expect(data.connections).toEqual([
      expect.objectContaining({ account: 'camille.martin@outlook.fr', accountKind: 'personal' }),
    ]);
    expect(JSON.stringify(data)).not.toContain('refreshToken');
    expect(data.connectedFiles).toEqual([
      expect.objectContaining({ name: 'Commandes 2026.xlsx', sheets: ['Commandes', 'Notes'] }),
    ]);
    expect(data.includedSheets).toContainEqual(
      expect.objectContaining({ type: 'file', fileId: c.file.id, sheet: 'Commandes' }),
    );
    const [conn] = await database.db
      .select()
      .from(connections)
      .where(eq(connections.tenantId, c.id));
    await c.call('/tenant', 'DELETE', { confirmSiren: '100000009' });
    expect(stand.subscriptions.has(conn?.subscriptionId ?? '')).toBe(false);
    for (const table of [connections, connectedFiles]) {
      expect(await database.db.select().from(table).where(eq(table.tenantId, c.id))).toEqual([]);
    }
  });
});

describe('without the owner’s app registration', () => {
  it('offers nothing and says so calmly', async () => {
    const bare = testApi(database, { mock: fakeAdapter() }, undefined, { now: () => clock });
    const c = await companies({ request: bare.request, database })('wb-ms-12');
    expect(await c.call('/connectors/microsoft')).toEqual({
      microsoft: null,
      mailOnMicrosoft: false,
      connection: null,
    });
    const res = await bare.request('/connectors/microsoft', {
      method: 'POST',
      token: c.apiKey,
      body: { token: stand.signIn(PERSONAL.account) },
    });
    expect(res.status).toBe(503);
    expect((await bare.app.request('/webhooks/microsoft', { method: 'POST' })).status).toBe(404);
  });
});

describe('Scout', () => {
  it('suggests OneDrive to a person whose mail is with Microsoft, never to a key', async () => {
    const asked: string[] = [];
    const scout = testApi(database, { mock: fakeAdapter() }, undefined, {
      now: () => clock,
      microsoft: {
        ...microsoft,
        mailExchanges: async (domain) => {
          asked.push(domain);
          return domain === 'atelier-durand.test'
            ? ['atelier-durand-test.mail.protection.outlook.com']
            : ['mx1.mail.ovh.net.'];
        },
      },
    });
    const view = async (token: string) =>
      (await scout.request('/connectors/microsoft', { token })).json();
    const tag = randomBytes(4).toString('hex');
    const camille = `camille.${tag}@atelier-durand.test`;
    const marc = `marc.${tag}@menuiserie-roux.test`;
    const durand = await newTenant(scout.request, { ownerEmail: camille });
    await newTenant(scout.request, { ownerEmail: marc });

    expect(await view(await signIn(scout.request, scout.mailer, camille))).toMatchObject({
      microsoft: { clientId: MICROSOFT_STAND_IN_APP.clientId },
      mailOnMicrosoft: true,
      connection: null,
    });
    expect(await view(durand.apiKey)).toMatchObject({ mailOnMicrosoft: false });
    expect(await view(await signIn(scout.request, scout.mailer, marc))).toMatchObject({
      mailOnMicrosoft: false,
    });
    expect(asked).toEqual(['atelier-durand.test', 'menuiserie-roux.test']);
  });

  it('knows Exchange Online’s two MX forms and Outlook.com’s, and nothing else', () => {
    expect(servedByMicrosoft(['microsoft-com.mail.protection.outlook.com.'])).toBe(true);
    expect(servedByMicrosoft(['contoso-com.a-v1.v1.mx.microsoft'])).toBe(true);
    expect(servedByMicrosoft(['eur.olc.protection.outlook.com.'])).toBe(true);
    expect(servedByMicrosoft(['gmail-smtp-in.l.google.com.', 'smtp-in.orange.fr.'])).toBe(false);
    expect(servedByMicrosoft(['protection.outlook.com.example.fr'])).toBe(false);
    expect(servedByMicrosoft([])).toBe(false);
  });
});
