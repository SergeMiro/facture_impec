// Google Drive files read without Excel (R5), against the Google stand-in of apps/mock-pdp: one window
// for sign-in, consent and picker, a Google Sheets file read through its .xlsx export, a change told
// by the channel, the calm side (a window not ours, a cancel, another account, a file in the bin,
// Google asking to wait, a token refused), and « Déconnecter » that revokes our token at Google.

import { type XlsxCell, xlsxOf } from '@fi/core/testing/xlsx';
import type { Database } from '@fi/db';
import { connectedFiles, connections, docs, eq, sources } from '@fi/db';
import { GOOGLE_SHEET_TYPE, GOOGLE_STAND_IN_APP, GoogleStandIn } from '@fi/mock-pdp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { checkNow } from './checks';
import { companies, invoiceRow, invoiceSheet } from './checks.fixtures';
import {
  checkConnection,
  connectorsBehind,
  GOOGLE_COOKIE,
  type GoogleConnector,
  type MicrosoftConnector,
  readTicket,
} from './connectors';
import { createGoogleClient } from './google';
import { googleFromEnv } from './runtime';
import {
  fakeAdapter,
  inProcess,
  type RecordedJobs,
  testApi,
  testDatabase,
  today,
} from './test-helpers';
import { runSweep } from './workers';

const SEALING_KEY = Buffer.alloc(32, 9).toString('base64');
const GMAIL = 'g-camille';
const WORKSPACE = 'g-atelier';

let database: Database;
let api: ReturnType<typeof testApi>;
let jobs: RecordedJobs;
let stand: GoogleStandIn;
let google: GoogleConnector;
let clock = new Date(`${today()}T08:00:00Z`);

beforeAll(async () => {
  database = await testDatabase();
  stand = new GoogleStandIn({
    ...GOOGLE_STAND_IN_APP,
    // Notifications reach the API in-process.
    fetcher: inProcess({ request: (path, init) => api.app.request(path, init) }),
    now: () => clock,
  });
  google = {
    client: createGoogleClient({
      ...GOOGLE_STAND_IN_APP,
      accountsUrl: 'http://google.test/accounts',
      oauthUrl: 'http://google.test/oauth',
      apiUrl: 'http://google.test/api',
      fetcher: inProcess(stand.app),
    }),
    sealingKey: SEALING_KEY,
    redirectUrl: 'http://api.test/connectors/google/callback',
    notificationUrl: 'http://api.test/webhooks/google',
  };
  api = testApi(database, { mock: fakeAdapter() }, undefined, { now: () => clock, google });
  ({ jobs } = api);
});
afterAll(async () => {
  await database.close();
});
beforeEach(() => {
  clock = new Date(`${today()}T08:00:00Z`);
});

const company = (workbook: string) => companies({ request: api.request, database })(workbook);
const path = (url: string) => {
  const u = new URL(url);
  return `${u.pathname}${u.search}`;
};

const SEP1 = { date: 46266 };
const ORDER_HEADER: XlsxCell[] = ['N° commande', 'Date', 'Client', 'Désignation', 'Qté', 'PU HT'];
const ordersFile = (price: number) =>
  xlsxOf({
    Commandes: [ORDER_HEADER, ['C-118', SEP1, 'Durand SARL', 'Chaise pliante', 10, price]],
  });

interface View {
  available: boolean;
  connection: {
    label: string;
    accountKind: string;
    status: string;
    notified: boolean;
    files: { id: string; name: string; problem: string | null; sheets: { sheet: string }[] }[];
  } | null;
}

/**
 * The window as the person goes through it: the pane asks for its address, the browser keeps the
 * ticket in a cookie and goes to Google, Google comes back. Returns the page shown at the end.
 */
async function window(
  c: Awaited<ReturnType<typeof company>>,
  choice: Parameters<GoogleStandIn['choose']>[0],
) {
  const { url } = (await c.call('/connectors/google/start', 'POST')) as { url: string };
  stand.choose(choice);
  const begin = await api.app.request(path(url));
  expect(begin.status).toBe(302);
  const cookie = (begin.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
  const atGoogle = await stand.app.request(path(begin.headers.get('location') ?? ''));
  expect(atGoogle.status).toBe(302);
  const back = await api.app.request(path(atGoogle.headers.get('location') ?? ''), {
    headers: { cookie },
  });
  return { status: back.status, text: await back.text(), begin, back };
}

/** A company with a Gmail account connected and « Commandes 2026 » (a Google Sheets file) included. */
async function connected(workbook: string, item: string, price = 30) {
  const c = await company(workbook);
  await stand.putFile(GMAIL, item, 'Commandes 2026', ordersFile(price), GOOGLE_SHEET_TYPE);
  const page = await window(c, { account: GMAIL, pick: [item] });
  expect(page.text).toContain('1 fichier(s) de Google Drive ajouté(s)');
  const view = (await c.call('/connectors/google')) as View;
  const file = view.connection?.files[0];
  if (!file) throw new Error('not picked');
  const base = `/connectors/google/files/${file.id}/sheets/Commandes`;
  const { layout } = (await c.call(`${base}/detect`, 'POST')) as { layout: { kind: string } };
  expect(layout.kind).toBe('order');
  await c.call(base, 'PUT', { layout });
  const [conn] = await database.db.select().from(connections).where(eq(connections.tenantId, c.id));
  if (!conn) throw new Error('no connection');
  return { ...c, view, file, connectionId: conn.id };
}

const check = (connectionId: string) => checkConnection({ ...api.deps, google }, connectionId);
const exports = () => stand.calls.filter((call) => call.endsWith('/export')).length;

describe('the one Google window', () => {
  it('connects, reads the picked Google Sheets file, and finds 100 € missing after a change', async () => {
    const c = await company('wb-google-01');
    expect(await c.call('/connectors/google')).toEqual({ available: true, connection: null });
    await stand.putFile(GMAIL, 'gs-01', 'Commandes 2026', ordersFile(30), GOOGLE_SHEET_TYPE);

    const { url } = (await c.call('/connectors/google/start', 'POST')) as { url: string };
    expect(url).toMatch(/^http:\/\/api\.test\/connectors\/google\/begin\?ticket=/);
    stand.choose({ account: GMAIL, pick: ['gs-01'] });
    const begin = await api.app.request(path(url));
    // The ticket goes into a cookie of the API's own address, kept from scripts.
    const setCookie = begin.headers.get('set-cookie') ?? '';
    expect(setCookie).toMatch(new RegExp(`^${GOOGLE_COOKIE}=`));
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Path=\/connectors\/google/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    const authorize = new URL(begin.headers.get('location') ?? '');
    expect(authorize.origin + authorize.pathname).toBe(
      'http://google.test/accounts/o/oauth2/v2/auth',
    );
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      client_id: GOOGLE_STAND_IN_APP.clientId,
      redirect_uri: 'http://api.test/connectors/google/callback',
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/drive.file',
      access_type: 'offline',
      prompt: 'consent',
      trigger_onepick: 'true',
    });
    const cookie = setCookie.split(';')[0] ?? '';
    const ticket = readTicket(google, decodeURIComponent(cookie.split('=')[1] ?? ''), clock);
    expect(authorize.searchParams.get('state')).toBe(ticket?.n);

    const atGoogle = await stand.app.request(path(authorize.toString()));
    const back = await api.app.request(path(atGoogle.headers.get('location') ?? ''), {
      headers: { cookie },
    });
    expect(back.status).toBe(200);
    expect(back.headers.get('content-type')).toMatch(/^text\/html/);
    expect(await back.text()).toContain(
      '1 fichier(s) de Google Drive ajouté(s) (camille.martin@gmail.com)',
    );
    // The cookie served once.
    expect(back.headers.get('set-cookie')).toMatch(new RegExp(`^${GOOGLE_COOKIE}=;`));

    const view = (await c.call('/connectors/google')) as View;
    expect(view.connection).toMatchObject({
      label: 'camille.martin@gmail.com',
      accountKind: 'personal',
      status: 'active',
      notified: true,
      files: [{ name: 'Commandes 2026', problem: null, sheets: [{ sheet: 'Commandes' }] }],
    });
    const [conn] = await database.db
      .select()
      .from(connections)
      .where(eq(connections.tenantId, c.id));
    expect(conn).toMatchObject({ provider: 'google', directory: 'google', connectedBy: 'key' });
    expect(conn?.refreshToken).toMatch(/^v1\./);
    // A channel on the account's changes; its `sync` message was answered and ignored.
    const channel = stand.channels.get(conn?.subscriptionId ?? '');
    expect(channel).toMatchObject({ address: 'http://api.test/webhooks/google' });
    expect(conn?.subscriptionResource).toBe(channel?.resourceId);
    expect(stand.delivered).toContainEqual({ channelId: channel?.id, state: 'sync', status: 200 });
    expect(await c.audits('connection.connect')).toHaveLength(1);
    expect((await c.audits('connected_file.pick'))[0]?.actor).toBe('user');

    const file = view.connection?.files[0];
    const base = `/connectors/google/files/${file?.id}/sheets/Commandes`;
    const { layout } = (await c.call(`${base}/detect`, 'POST')) as { layout: { kind: string } };
    expect(await c.call(base, 'PUT', { layout })).toMatchObject({
      source: { type: 'file', fileId: file?.id, sheet: 'Commandes', kind: 'order' },
      written: 1,
    });
    await c.syncInvoices(invoiceSheet(invoiceRow('F-2026-051', 'C-118', 'Chaise pliante', 10, 30)));
    await checkNow(database.db, c.id, clock);
    expect((await c.checks()).findings).toEqual([]);

    // Someone raises the price in Google Sheets: the channel tells us, the check reads the export.
    const queued = jobs.connectors.length;
    await stand.putFile(GMAIL, 'gs-01', 'Commandes 2026', ordersFile(40), GOOGLE_SHEET_TYPE);
    expect(stand.delivered.at(-1)).toEqual({
      channelId: channel?.id,
      state: 'change',
      status: 200,
    });
    expect(jobs.connectors.slice(queued)).toContain(conn?.id);
    expect(await check(conn?.id ?? '')).toEqual({ read: 1 });
    await checkNow(database.db, c.id, clock);
    const [b1] = (await c.checks()).findings;
    expect(b1).toMatchObject({ rule: 'B1', amount: 10_000 });
    expect((await c.audits('source.read')).at(-1)?.actor).toBe('connector:google');

    // Same version: no export.
    const before = exports();
    expect(await check(conn?.id ?? '')).toEqual({ read: 0 });
    expect(exports()).toBe(before);
  });

  it('reads an .xlsx stored in Drive as it is, and adds files to the same connection', async () => {
    const c = await connected('wb-google-02', 'gs-02');
    await stand.putFile(GMAIL, 'x-02', 'Tarifs.xlsx', ordersFile(12));
    const page = await window(c, { account: GMAIL, pick: ['x-02'] });
    expect(page.text).toContain('1 fichier(s) de Google Drive ajouté(s)');
    const view = (await c.call('/connectors/google')) as View;
    expect(view.connection?.files.map((f) => f.name)).toEqual(['Commandes 2026', 'Tarifs.xlsx']);
    expect(stand.calls).toContain('GET /files/x-02');
    expect(await c.audits('connection.reconnect')).toHaveLength(1);
    expect(
      await database.db.select().from(connections).where(eq(connections.tenantId, c.id)),
    ).toHaveLength(1);
  });

  it('refuses a window that is not ours, says a cancel changed nothing, and refuses another account', async () => {
    const c = await company('wb-google-03');
    // No cookie: the callback came from somewhere else.
    stand.choose({ account: GMAIL, pick: [] });
    const { url } = (await c.call('/connectors/google/start', 'POST')) as { url: string };
    const begin = await api.app.request(path(url));
    const atGoogle = await stand.app.request(path(begin.headers.get('location') ?? ''));
    const stray = await api.app.request(path(atGoogle.headers.get('location') ?? ''));
    expect(await stray.text()).toContain('Ce lien a expiré');
    // A forged ticket never reaches Google.
    const forged = await api.app.request('/connectors/google/begin?ticket=abc.def');
    expect(forged.status).toBe(400);
    // An expired one neither.
    clock = new Date(+clock + 16 * 60_000);
    expect((await api.app.request(path(url))).status).toBe(400);
    clock = new Date(`${today()}T08:00:00Z`);

    const cancelled = await window(c, { account: GMAIL, pick: [], cancel: true });
    expect(cancelled.text).toContain('Vous avez annulé dans la fenêtre Google');
    expect(await c.call('/connectors/google')).toEqual({ available: true, connection: null });

    const none = await window(c, { account: GMAIL, pick: [] });
    expect(none.text).toContain('Google Drive est connecté (camille.martin@gmail.com)');
    const other = await window(c, { account: WORKSPACE, pick: [] });
    expect(other.text).toContain('Le compte Google camille.martin@gmail.com est déjà connecté');
    const view = (await c.call('/connectors/google')) as View;
    expect(view.connection?.label).toBe('camille.martin@gmail.com');
  });

  it('keeps nothing when a picked file cannot be read', async () => {
    const c = await company('wb-google-04');
    await stand.putFile(GMAIL, 'ok-04', 'Commandes.xlsx', ordersFile(30));
    await stand.putFile(
      GMAIL,
      'doc-04',
      'Notes.docx',
      new Uint8Array([1, 2, 3]),
      'application/msword',
    );
    const page = await window(c, { account: GMAIL, pick: ['ok-04', 'doc-04'] });
    expect(page.text).toContain('Seuls les classeurs Excel');
    const view = (await c.call('/connectors/google')) as View;
    expect(view.connection?.files).toEqual([]);
  });
});

describe('when something breaks', () => {
  it('says a file in the bin is gone, and reads it again once restored', async () => {
    const c = await connected('wb-google-05', 'gs-05');
    await stand.trashFile(GMAIL, 'gs-05');
    await check(c.connectionId);
    let view = (await c.call('/connectors/google')) as View;
    expect(view.connection?.files[0]?.problem).toBe('missing');
    const kept = await database.db.select().from(sources).where(eq(sources.fileId, c.file.id));
    expect(kept[0]?.stats?.docs).toBe(1);
    await stand.trashFile(GMAIL, 'gs-05', false);
    await check(c.connectionId);
    view = (await c.call('/connectors/google')) as View;
    expect(view.connection?.files[0]?.problem).toBeNull();
  });

  it('waits when Google asks to, and stops until the person reconnects when it refuses the token', async () => {
    const c = await connected('wb-google-06', 'gs-06');
    stand.throttle(1);
    expect(await check(c.connectionId)).toEqual({ read: 0 });
    const [waiting] = await database.db
      .select()
      .from(connections)
      .where(eq(connections.id, c.connectionId));
    expect(+(waiting?.waitUntil ?? 0)).toBe(+clock + 30_000);
    expect(await connectorsBehind(database.db, clock)).not.toContain(c.connectionId);

    clock = new Date(+clock + 31_000);
    stand.revoke(GMAIL);
    await check(c.connectionId);
    let view = (await c.call('/connectors/google')) as View;
    expect(view.connection?.status).toBe('reconnect');
    expect((await c.audits('connection.refused'))[0]?.actor).toBe('connector:google');
    const res = await api.request(`/connectors/google/files/${c.file.id}/sheets/Commandes/detect`, {
      method: 'POST',
      token: c.apiKey,
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { message: string } }).error.message).toBe(
      'Google ne reconnaît plus la connexion à Google Drive (mot de passe changé ou accès retiré). Les documents déjà lus restent dans le registre. Choisissez « Reconnecter Google Drive ».',
    );

    // The same window again: active, and checked straight away.
    const queued = jobs.connectors.length;
    await window(c, { account: GMAIL, pick: ['gs-06'] });
    view = (await c.call('/connectors/google')) as View;
    expect(view.connection?.status).toBe('active');
    expect(jobs.connectors.slice(queued)).toContain(c.connectionId);
  });

  it('ignores a notification without our secret, and `sync`', async () => {
    const c = await connected('wb-google-07', 'gs-07');
    const [conn] = await database.db
      .select()
      .from(connections)
      .where(eq(connections.id, c.connectionId));
    const queued = jobs.connectors.length;
    const send = (token: string, state: string) =>
      api.app.request('/webhooks/google', {
        method: 'POST',
        headers: {
          'x-goog-channel-id': conn?.subscriptionId ?? '',
          'x-goog-channel-token': token,
          'x-goog-resource-state': state,
        },
      });
    expect(await (await send('guessed', 'change')).json()).toEqual({ received: 0 });
    expect(jobs.connectors.length).toBe(queued);
  });

  it('replaces the channel a day before it ends, and stops the old one', async () => {
    const c = await connected('wb-google-08', 'gs-08');
    const row = async () => {
      const [conn] = await database.db
        .select()
        .from(connections)
        .where(eq(connections.id, c.connectionId));
      return conn;
    };
    const first = await row();
    clock = new Date(+clock + 5.5 * 86_400_000);
    await check(c.connectionId);
    const next = await row();
    expect(next?.subscriptionId).not.toBe(first?.subscriptionId);
    expect(stand.channels.has(first?.subscriptionId ?? '')).toBe(false);
    expect(stand.channels.has(next?.subscriptionId ?? '')).toBe(true);
    expect((await c.audits('connection.renew'))[0]?.actor).toBe('connector:google');
  });

  it('is swept only where Google is offered', async () => {
    const c = await connected('wb-google-09', 'gs-09');
    const later = new Date(+clock + 2 * 3_600_000);
    expect(await connectorsBehind(database.db, later, { microsoft: null, google })).toContain(
      c.connectionId,
    );
    const microsoft = {} as MicrosoftConnector;
    expect(await connectorsBehind(database.db, later, { microsoft, google: null })).not.toContain(
      c.connectionId,
    );
    const swept = await runSweep({ ...api.deps, google, now: () => later });
    expect(swept.connectors).toBeGreaterThanOrEqual(1);
  });
});

describe('« Déconnecter Google Drive »', () => {
  it('stops the channel, revokes our token at Google, and deletes the files and what they gave', async () => {
    const c = await connected('wb-google-10', 'gs-10');
    const [conn] = await database.db
      .select()
      .from(connections)
      .where(eq(connections.id, c.connectionId));
    expect(stand.connected(GMAIL)).toBe(true);
    const view = (await c.call('/connectors/google', 'DELETE')) as View;
    expect(view).toEqual({ available: true, connection: null });
    expect(stand.channels.has(conn?.subscriptionId ?? '')).toBe(false);
    expect(stand.connected(GMAIL)).toBe(false);
    expect(await c.audits('connection.watch')).toHaveLength(1);
    expect(await c.audits('connection.disconnect')).toHaveLength(1);
    for (const table of [connections, connectedFiles, sources]) {
      expect(await database.db.select().from(table).where(eq(table.tenantId, c.id))).toEqual([]);
    }
    const left = await database.db.select().from(docs).where(eq(docs.tenantId, c.id));
    expect(left.every((d) => d.sourceId === null)).toBe(true);
    expect(await check(c.connectionId)).toBeNull();
  });

  it('removes one file, and a file of one provider is not reached through the other', async () => {
    const c = await connected('wb-google-11', 'gs-11');
    const wrong = await api.request(`/connectors/microsoft/files/${c.file.id}`, {
      method: 'DELETE',
      token: c.apiKey,
    });
    expect(wrong.status).toBe(404);
    const unknown = await api.request(`/connectors/dropbox/files/${c.file.id}`, {
      method: 'DELETE',
      token: c.apiKey,
    });
    expect(unknown.status).toBe(400);
    const view = (await c.call(`/connectors/google/files/${c.file.id}`, 'DELETE')) as View;
    expect(view.connection?.files).toEqual([]);
    expect(await c.audits('connected_file.remove')).toHaveLength(1);
  });

  it('exports the account without its token, and revokes it when the company is deleted (RGPD)', async () => {
    const c = await connected('wb-google-12', 'gs-12');
    expect(stand.connected(GMAIL)).toBe(true);
    const data = (await c.call('/tenant/export')) as {
      connections: { provider: string; account: string }[];
      connectedFiles: { name: string }[];
    };
    expect(data.connections).toEqual([
      expect.objectContaining({ provider: 'google', account: 'camille.martin@gmail.com' }),
    ]);
    expect(data.connectedFiles).toHaveLength(1);
    expect(JSON.stringify(data.connections)).not.toMatch(/token/i);
    const tenant = (await c.call('/tenant')) as { siren: string };
    await c.call('/tenant', 'DELETE', { confirmSiren: tenant.siren });
    expect(stand.connected(GMAIL)).toBe(false);
  });
});

describe('googleFromEnv', () => {
  const env = {
    FI_ENV: 'prod',
    API_PUBLIC_URL: 'https://api.facture-impec.fr',
    GOOGLE_CLIENT_ID: 'x.apps.googleusercontent.com',
    GOOGLE_CLIENT_SECRET: 'secret',
    CONNECTOR_SEALING_KEY: SEALING_KEY,
  } as Parameters<typeof googleFromEnv>[0];

  it('is off without the OAuth client, and talks only to Google outside local', () => {
    expect(googleFromEnv({ ...env, GOOGLE_CLIENT_ID: undefined })).toBeNull();
    expect(googleFromEnv(env)).toMatchObject({
      redirectUrl: 'https://api.facture-impec.fr/connectors/google/callback',
      notificationUrl: 'https://api.facture-impec.fr/webhooks/google',
    });
    expect(() =>
      googleFromEnv({ ...env, GOOGLE_API_URL: 'http://localhost:4010/google/api' }),
    ).toThrow(/only local/);
    expect(() => googleFromEnv({ ...env, API_PUBLIC_URL: 'http://api.example' })).toThrow(/https/);
  });
});
