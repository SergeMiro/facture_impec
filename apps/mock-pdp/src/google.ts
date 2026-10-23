// A stand-in for the part of Google that the Google Drive connector uses (R5, docs/GOOGLE.md), served
// at /google: the one-window sign-in with Google's picker (/accounts), the token and revoke endpoints
// (/oauth), and Drive's about, files, export, changes.watch and channels.stop (/api). Two accounts
// live here, a Gmail one and a Workspace one. Under `drive.file` the app sees only the files the
// person picked: any other answers 404, as Drive does. Tests and the E2E run choose what the window
// returns and change files through /google/control. Shapes follow developers.google.com as read on
// 2026-10-22; what the guides leave open is marked TODO(verify) in docs/GOOGLE.md §6, not decided here.
import { randomBytes } from 'node:crypto';
import { type Context, Hono } from 'hono';
import { html, raw } from 'hono/html';

export interface GoogleStandInOptions {
  /** The OAuth client our API is (GOOGLE_CLIENT_ID / _SECRET): the token endpoint checks both. */
  clientId: string;
  clientSecret: string;
  /** Default: global fetch (the scenario stack hands its own). */
  fetcher?: typeof fetch;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface GoogleStandInAccount {
  id: string;
  /** Drive's `permissionId`. */
  permissionId: string;
  displayName: string;
  address: string;
}

export interface GoogleStandInFile {
  id: string;
  account: string;
  name: string;
  mimeType: string;
  /** A Google Sheets file holds the .xlsx its export gives. */
  bytes: Uint8Array;
  version: number;
  trashed: boolean;
  deleted: boolean;
}

/** What the next window does: the account that signs in, the files it picks, or a cancel. */
export interface GoogleChoice {
  account: string;
  pick: string[];
  cancel?: boolean;
}

interface Channel {
  id: string;
  resourceId: string;
  account: string;
  address: string;
  token: string | undefined;
  expiration: number;
  messages: number;
}

const DRIVE_FILE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_SHEET_TYPE = 'application/vnd.google-apps.spreadsheet';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** The push guide: a week at most for `changes`. */
const MAX_CHANNEL_MS = 604_800_000;

const ACCOUNTS: GoogleStandInAccount[] = [
  {
    id: 'g-camille',
    permissionId: '09876543210987654321',
    displayName: 'Camille Martin',
    address: 'camille.martin@gmail.com',
  },
  {
    id: 'g-atelier',
    permissionId: '12345678901234567890',
    displayName: 'Camille Martin',
    address: 'camille@atelier-durand.fr',
  },
];

const token = (prefix: string) => `${prefix}.${randomBytes(18).toString('base64url')}`;

class DriveFailure extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 429,
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}

class OAuthFailure extends Error {
  constructor(
    readonly error: string,
    description: string,
  ) {
    super(description);
  }
}

export class GoogleStandIn {
  readonly app = new Hono();
  readonly accounts = new Map(ACCOUNTS.map((a) => [a.id, { ...a }]));
  readonly files = new Map<string, GoogleStandInFile>();
  readonly channels = new Map<string, Channel>();
  /** Every notification sent, and what the endpoint answered. */
  readonly delivered: { channelId: string; state: string; status: number | null }[] = [];
  /** Every Drive call, for tests that count them. */
  readonly calls: string[] = [];
  /** Files the app may read, per account (`drive.file`): those picked in a window. */
  #granted = new Map<string, Set<string>>();
  #codes = new Map<string, { account: string; redirectUri: string; offline: boolean }>();
  #refresh = new Map<string, string>();
  #access = new Map<string, string>();
  #choice: GoogleChoice | null = null;
  #changes = 1;
  #throttle = 0;
  #options: GoogleStandInOptions;

  constructor(options: GoogleStandInOptions) {
    this.#options = options;
    this.#routes();
  }

  #now = () => this.#options.now?.() ?? new Date();

  /** What the next window returns, as if the person signed in and picked these files. */
  choose(choice: GoogleChoice) {
    this.#account(choice.account);
    this.#choice = choice;
  }

  /** A person saves the file in Drive: new content, a new version, and each channel is told. */
  async putFile(
    accountId: string,
    id: string,
    name: string,
    bytes: Uint8Array,
    mimeType: string = XLSX,
  ) {
    this.#account(accountId);
    const before = this.files.get(id);
    this.files.set(id, {
      id,
      account: accountId,
      name,
      mimeType,
      bytes,
      version: (before?.version ?? 0) + 1,
      trashed: false,
      deleted: false,
    });
    await this.#notify(accountId, id);
  }

  async trashFile(accountId: string, id: string, trashed = true) {
    const file = this.files.get(id);
    if (file && file.account === accountId) {
      file.trashed = trashed;
      file.version++;
    }
    await this.#notify(accountId, id);
  }

  async deleteFile(accountId: string, id: string) {
    const file = this.files.get(id);
    if (file && file.account === accountId) file.deleted = true;
    await this.#notify(accountId, id);
  }

  /** The person removed the app's access in their Google account. */
  revoke(accountId: string) {
    for (const [t, a] of [...this.#refresh, ...this.#access]) {
      if (a === accountId) {
        this.#refresh.delete(t);
        this.#access.delete(t);
      }
    }
    this.#granted.delete(accountId);
  }

  /** The next `calls` Drive calls answer 403 userRateLimitExceeded. */
  throttle(calls: number) {
    this.#throttle = calls;
  }

  /** Whether the app still holds a token for the account (revoked by « Déconnecter »). */
  connected(accountId: string) {
    return [...this.#refresh.values()].includes(accountId);
  }

  reset() {
    this.files.clear();
    this.channels.clear();
    this.delivered.length = 0;
    this.calls.length = 0;
    this.#granted.clear();
    this.#codes.clear();
    this.#refresh.clear();
    this.#access.clear();
    this.#choice = null;
    this.#throttle = 0;
  }

  #account(id: string): GoogleStandInAccount {
    const account = this.accounts.get(id);
    if (!account) throw new DriveFailure(404, 'notFound', `No account ${id}`);
    return account;
  }

  #client(form: URLSearchParams) {
    if (
      form.get('client_id') !== this.#options.clientId ||
      form.get('client_secret') !== this.#options.clientSecret
    ) {
      throw new OAuthFailure('invalid_client', 'The OAuth client was not found.');
    }
  }

  /** The web-server guide: the code once, for the redirect it was given to; refresh keeps its token. */
  #token(form: URLSearchParams) {
    this.#client(form);
    const grant = form.get('grant_type');
    if (grant === 'authorization_code') {
      const code = this.#codes.get(form.get('code') ?? '');
      this.#codes.delete(form.get('code') ?? '');
      if (!code) throw new OAuthFailure('invalid_grant', 'Malformed auth code.');
      if (code.redirectUri !== form.get('redirect_uri')) {
        throw new OAuthFailure('redirect_uri_mismatch', 'Bad Request');
      }
      const access = token('ya29');
      this.#access.set(access, code.account);
      const answer: Record<string, string | number> = {
        access_token: access,
        expires_in: 3599,
        scope: DRIVE_FILE,
        token_type: 'Bearer',
      };
      if (code.offline) {
        const refresh = token('1//rt');
        this.#refresh.set(refresh, code.account);
        answer.refresh_token = refresh;
      }
      return answer;
    }
    if (grant === 'refresh_token') {
      const account = this.#refresh.get(form.get('refresh_token') ?? '');
      if (!account) throw new OAuthFailure('invalid_grant', 'Token has been expired or revoked.');
      const access = token('ya29');
      this.#access.set(access, account);
      return { access_token: access, expires_in: 3599, scope: DRIVE_FILE, token_type: 'Bearer' };
    }
    throw new OAuthFailure('unsupported_grant_type', `Invalid grant_type: ${grant}`);
  }

  #caller(c: Context): GoogleStandInAccount {
    const auth = c.req.header('authorization') ?? '';
    const accountId = this.#access.get(auth.replace(/^Bearer /, ''));
    if (!accountId) throw new DriveFailure(401, 'authError', 'Invalid Credentials');
    if (this.#throttle > 0) {
      this.#throttle--;
      throw new DriveFailure(403, 'userRateLimitExceeded', 'User Rate Limit Exceeded');
    }
    this.calls.push(`${c.req.method} ${new URL(c.req.url).pathname.replace(/^.*\/drive\/v3/, '')}`);
    return this.#account(accountId);
  }

  /** `drive.file`: a file the person did not pick for the app is not found. */
  #file(account: GoogleStandInAccount, id: string): GoogleStandInFile {
    const file = this.files.get(id);
    if (!file || file.deleted || !this.#granted.get(account.id)?.has(id)) {
      throw new DriveFailure(404, 'notFound', `File not found: ${id}.`);
    }
    return file;
  }

  #metadata(file: GoogleStandInFile) {
    return {
      id: file.id,
      name: file.name,
      mimeType: file.mimeType,
      size: String(file.bytes.byteLength),
      version: String(file.version),
      trashed: file.trashed,
    };
  }

  async #send(channel: Channel, state: 'sync' | 'change') {
    const headers: Record<string, string> = {
      'x-goog-channel-id': channel.id,
      'x-goog-channel-expiration': new Date(channel.expiration).toUTCString(),
      'x-goog-resource-state': state,
      'x-goog-resource-id': channel.resourceId,
      'x-goog-message-number': String(++channel.messages),
    };
    if (channel.token) headers['x-goog-channel-token'] = channel.token;
    try {
      const res = await (this.#options.fetcher ?? fetch)(channel.address, {
        method: 'POST',
        headers,
      });
      this.delivered.push({ channelId: channel.id, state, status: res.status });
    } catch (e) {
      this.delivered.push({ channelId: channel.id, state, status: null });
      this.#options.log?.(`google stand-in: notification failed: ${String(e)}`);
    }
  }

  /** Only files the app may see raise a change for it (`drive.file`). */
  async #notify(accountId: string, fileId: string) {
    this.#changes++;
    if (!this.#granted.get(accountId)?.has(fileId)) return;
    for (const channel of this.channels.values()) {
      if (channel.account !== accountId || channel.expiration <= +this.#now()) continue;
      await this.#send(channel, 'change');
    }
  }

  /**
   * The one window (picker guide for desktop apps): checks what the guide makes required, then either
   * answers as `choose` said or shows a small page to pick by hand (`pnpm dev`).
   */
  #authorize(c: Context) {
    const q = c.req.query();
    const problems = [
      q.client_id !== this.#options.clientId && 'client_id',
      q.response_type !== 'code' && 'response_type',
      q.scope !== DRIVE_FILE && 'scope (drive.file only)',
      q.prompt !== 'consent' && 'prompt=consent',
      q.trigger_onepick !== 'true' && 'trigger_onepick=true',
      !q.redirect_uri && 'redirect_uri',
    ].filter(Boolean);
    if (problems.length) return c.text(`Error 400: invalid_request (${problems.join(', ')})`, 400);
    const choice = this.#choice;
    this.#choice = null;
    if (choice) return c.redirect(this.#back(q, choice), 302);
    const account = ACCOUNTS[0] as GoogleStandInAccount;
    const mine = [...this.files.values()].filter(
      (f) => f.account === account.id && !f.deleted && !f.trashed,
    );
    return c.html(html`<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Google stand-in</title></head>
  <body>
    <h1>Google stand-in: ${account.address}</h1>
    <form method="post" action="consent">
      ${raw(
        Object.entries(q)
          .map(
            ([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}" />`,
          )
          .join(''),
      )}
      <input type="hidden" name="account" value="${account.id}" />
      ${mine.map((f) => html`<label><input type="checkbox" name="pick" value="${f.id}" /> ${f.name}</label><br />`)}
      <button type="submit" name="action" value="allow">Select</button>
      <button type="submit" name="action" value="cancel">Cancel</button>
    </form>
  </body>
</html>`);
  }

  /** Back to our redirect: `code`, `picked_file_ids` when files were picked, `scope`, `state`. */
  #back(q: Record<string, string>, choice: GoogleChoice) {
    const url = new URL(q.redirect_uri ?? '');
    if (q.state) url.searchParams.set('state', q.state);
    if (choice.cancel) {
      url.searchParams.set('error', 'access_denied');
      return url.toString();
    }
    const code = token('4/0A');
    this.#codes.set(code, {
      account: choice.account,
      redirectUri: q.redirect_uri ?? '',
      offline: q.access_type === 'offline',
    });
    const picked = choice.pick.filter((id) => {
      const f = this.files.get(id);
      return f && f.account === choice.account && !f.deleted;
    });
    const granted = this.#granted.get(choice.account) ?? new Set<string>();
    for (const id of picked) granted.add(id);
    this.#granted.set(choice.account, granted);
    url.searchParams.set('code', code);
    url.searchParams.set('scope', DRIVE_FILE);
    if (picked.length) url.searchParams.set('picked_file_ids', picked.join(','));
    return url.toString();
  }

  #routes() {
    const app = this.app;
    app.onError((err, c) => {
      if (err instanceof OAuthFailure) {
        return c.json(
          { error: err.error, error_description: err.message },
          err.error === 'invalid_client' ? 401 : 400,
        );
      }
      if (err instanceof DriveFailure) {
        return c.json(
          {
            error: {
              code: err.status,
              message: err.message,
              errors: [{ domain: 'global', reason: err.reason, message: err.message }],
            },
          },
          err.status,
        );
      }
      throw err;
    });

    app.get('/accounts/o/oauth2/v2/auth', (c) => this.#authorize(c));
    app.post('/accounts/o/oauth2/v2/consent', async (c) => {
      const form = new URLSearchParams(await c.req.text());
      const q = Object.fromEntries(
        [...form.entries()].filter(([k]) => !['pick', 'account', 'action'].includes(k)),
      );
      return c.redirect(
        this.#back(q, {
          account: form.get('account') ?? '',
          pick: form.getAll('pick'),
          cancel: form.get('action') === 'cancel',
        }),
        302,
      );
    });

    app.post('/oauth/token', async (c) =>
      c.json(this.#token(new URLSearchParams(await c.req.text()))),
    );
    app.post('/oauth/revoke', async (c) => {
      const value = new URLSearchParams(await c.req.text()).get('token') ?? '';
      const account = this.#refresh.get(value) ?? this.#access.get(value);
      if (!account)
        return c.json({ error: 'invalid_token', error_description: 'Bad Request' }, 400);
      this.revoke(account);
      return c.body(null, 200);
    });

    const drive = new Hono();
    drive.get('/about', (c) => {
      const a = this.#caller(c);
      if (!c.req.query('fields')) {
        throw new DriveFailure(400, 'required', 'The fields parameter is required.');
      }
      return c.json({
        user: {
          kind: 'drive#user',
          displayName: a.displayName,
          emailAddress: a.address,
          permissionId: a.permissionId,
          me: true,
        },
      });
    });
    drive.get('/files/:id', (c) => {
      const a = this.#caller(c);
      const file = this.#file(a, c.req.param('id'));
      if (c.req.query('alt') === 'media') {
        if (file.mimeType.startsWith('application/vnd.google-apps.')) {
          throw new DriveFailure(
            403,
            'fileNotDownloadable',
            'Only files with binary content can be downloaded. Use Export with Docs Editors files.',
          );
        }
        return c.body(new Uint8Array(file.bytes), 200, { 'content-type': file.mimeType });
      }
      return c.json(this.#metadata(file));
    });
    drive.get('/files/:id/export', (c) => {
      const a = this.#caller(c);
      const file = this.#file(a, c.req.param('id'));
      if (file.mimeType !== GOOGLE_SHEET_TYPE || c.req.query('mimeType') !== XLSX) {
        throw new DriveFailure(
          403,
          'fileNotExportable',
          'Export only supports Docs Editors files.',
        );
      }
      return c.body(new Uint8Array(file.bytes), 200, { 'content-type': XLSX });
    });
    drive.get('/changes/startPageToken', (c) => {
      this.#caller(c);
      return c.json({ kind: 'drive#startPageToken', startPageToken: String(this.#changes) });
    });
    drive.post('/changes/watch', async (c) => {
      const a = this.#caller(c);
      if (!c.req.query('pageToken')) {
        throw new DriveFailure(400, 'required', 'The pageToken parameter is required.');
      }
      const body = (await c.req.json()) as Partial<{
        id: string;
        type: string;
        address: string;
        token: string;
        expiration: string;
      }>;
      if (!body.id || body.type !== 'web_hook' || !body.address) {
        throw new DriveFailure(400, 'invalid', 'id, type web_hook and address are required.');
      }
      if ([...this.channels.values()].some((ch) => ch.id === body.id)) {
        throw new DriveFailure(400, 'channelIdNotUnique', 'Channel id not unique.');
      }
      const now = +this.#now();
      const asked = Number(body.expiration ?? now + 3_600_000);
      if (!(asked > now) || asked - now > MAX_CHANNEL_MS) {
        throw new DriveFailure(400, 'invalid', 'Invalid expiration.');
      }
      const channel: Channel = {
        id: body.id,
        resourceId: randomBytes(12).toString('base64url'),
        account: a.id,
        address: body.address,
        token: body.token,
        expiration: asked,
        messages: 0,
      };
      this.channels.set(channel.id, channel);
      // The push guide: a `sync` message follows the channel's creation.
      await this.#send(channel, 'sync');
      return c.json({
        kind: 'api#channel',
        id: channel.id,
        resourceId: channel.resourceId,
        resourceUri: `https://www.googleapis.com/drive/v3/changes?pageToken=${c.req.query('pageToken')}`,
        expiration: String(channel.expiration),
      });
    });
    drive.post('/channels/stop', async (c) => {
      const a = this.#caller(c);
      const { id, resourceId } = (await c.req.json()) as { id?: string; resourceId?: string };
      const channel = id ? this.channels.get(id) : undefined;
      if (!channel || channel.resourceId !== resourceId || channel.account !== a.id) {
        throw new DriveFailure(404, 'notFound', 'Channel not found.');
      }
      this.channels.delete(channel.id);
      return c.body(null, 204);
    });
    app.route('/api/drive/v3', drive);

    // What a person does in Google Drive and Google's window, for tests and the E2E run.
    app.post('/control/choose', async (c) => {
      this.choose((await c.req.json()) as GoogleChoice);
      return c.body(null, 204);
    });
    app.get('/control/files/:account', (c) =>
      c.json(
        [...this.files.values()]
          .filter((f) => f.account === c.req.param('account') && !f.deleted)
          .map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, trashed: f.trashed })),
      ),
    );
    app.put('/control/files/:account/:id', async (c) => {
      const name = c.req.query('name');
      if (!name) return c.json({ error: 'name is required' }, 400);
      await this.putFile(
        c.req.param('account'),
        c.req.param('id'),
        name,
        new Uint8Array(await c.req.arrayBuffer()),
        c.req.query('sheet') === '1' ? GOOGLE_SHEET_TYPE : (c.req.header('content-type') ?? XLSX),
      );
      return c.body(null, 204);
    });
    app.post('/control/files/:account/:id/trash', async (c) => {
      await this.trashFile(c.req.param('account'), c.req.param('id'));
      return c.body(null, 204);
    });
    app.delete('/control/files/:account/:id', async (c) => {
      await this.deleteFile(c.req.param('account'), c.req.param('id'));
      return c.body(null, 204);
    });
    app.post('/control/revoke/:account', (c) => {
      this.revoke(c.req.param('account'));
      return c.body(null, 204);
    });
    app.get('/control/channels', (c) =>
      c.json([...this.channels.values()].map(({ token: _t, ...ch }) => ch)),
    );
    app.post('/control/reset', (c) => {
      this.reset();
      return c.body(null, 204);
    });
  }
}

const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch,
  );
