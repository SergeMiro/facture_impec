// A stand-in for the part of Microsoft that the OneDrive connector uses (R4, docs/MICROSOFT365.md),
// served at /microsoft: the identity platform's token endpoint (on-behalf-of and refresh), Graph's
// /me, /me/drive, drive items and their content, a folder's children, and change-notification
// subscriptions with their validation handshake. Two accounts live here, a personal one and a work one; tests and the E2E run
// change a file through /microsoft/control, as a person would in OneDrive. Shapes follow Learn as read
// on 2026-10-21; what Learn leaves open is marked there TODO(verify), not decided here.
import { randomBytes } from 'node:crypto';
import { type Context, Hono } from 'hono';

/** The `tid` of every personal Microsoft account (Learn: ID token claims reference). */
export const MSA_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

export interface MicrosoftStandInOptions {
  /** The app our API is (MICROSOFT_CLIENT_ID / _SECRET): the token endpoint checks both. */
  clientId: string;
  clientSecret: string;
  /** This stand-in's address as our API sees it: download links point there. */
  publicUrl?: string;
  /** Default: global fetch (the scenario stack hands its own). */
  fetcher?: typeof fetch;
  now?: () => Date;
  log?: (message: string) => void;
}

export interface StandInAccount {
  id: string;
  kind: 'personal' | 'work';
  tenantId: string;
  displayName: string;
  address: string;
  driveId: string;
}

export interface StandInFile {
  driveId: string;
  itemId: string;
  name: string;
  bytes: Uint8Array;
  version: number;
  deleted: boolean;
  /** A folder: its children are the items whose `parentId` is its id. */
  folder?: boolean;
  parentId?: string;
}

interface Subscription {
  id: string;
  account: string;
  resource: string;
  changeType: string;
  notificationUrl: string;
  clientState: string | undefined;
  expirationDateTime: string;
}

/** Learn (subscription resource type): 42 300 minutes for a driveItem. */
const MAX_SUBSCRIPTION_MINUTES = 42_300;
const GRAPH_SCOPES = [
  'https://graph.microsoft.com/Files.Read',
  'https://graph.microsoft.com/User.Read',
];

const ACCOUNTS: StandInAccount[] = [
  {
    id: 'msa-camille',
    kind: 'personal',
    tenantId: MSA_TENANT,
    displayName: 'Camille Martin',
    address: 'camille.martin@outlook.fr',
    driveId: 'b!personal-camille',
  },
  {
    id: 'aad-camille',
    kind: 'work',
    tenantId: '5f2b3c1a-0000-4000-8000-0000000000a1',
    displayName: 'Camille Martin',
    address: 'camille@atelier-durand.fr',
    driveId: 'b!work-camille',
  },
];

const token = (prefix: string) => `${prefix}.${randomBytes(18).toString('base64url')}`;
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

class GraphError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

class TokenError extends Error {
  constructor(
    readonly error: string,
    readonly codes: number[],
    description: string,
  ) {
    super(description);
  }
}

export class MicrosoftStandIn {
  readonly app = new Hono();
  readonly accounts = new Map(ACCOUNTS.map((a) => [a.id, { ...a }]));
  readonly files = new Map<string, StandInFile>();
  readonly subscriptions = new Map<string, Subscription>();
  /** Every notification sent, and what the endpoint answered. */
  readonly delivered: { subscriptionId: string; status: number | null }[] = [];
  /** Every Graph call, for tests that count them. */
  readonly calls: string[] = [];
  #assertions = new Map<string, string>();
  #refresh = new Map<string, string>();
  #access = new Map<string, string>();
  #downloads = new Map<string, string>();
  #throttle = 0;
  #options: MicrosoftStandInOptions;

  constructor(options: MicrosoftStandInOptions) {
    this.#options = options;
    this.#routes();
  }

  #now = () => this.#options.now?.() ?? new Date();
  #url = (path: string) =>
    `${(this.#options.publicUrl ?? 'http://localhost:4010/microsoft').replace(/\/$/, '')}${path}`;

  /**
   * What MSAL hands the pane after the person signs in: a token for our API, its `tid` and `oid`
   * readable like a real one's. The stand-in's tokens are not signed; only it accepts them.
   */
  signIn(accountId: string): string {
    const account = this.#account(accountId);
    const assertion = [
      b64({ alg: 'none', typ: 'JWT' }),
      b64({
        aud: this.#options.clientId,
        tid: account.tenantId,
        oid: account.id,
        preferred_username: account.address,
        scp: 'access_as_user',
      }),
      'stand-in',
    ].join('.');
    this.#assertions.set(assertion, account.id);
    return assertion;
  }

  /**
   * A person saves the file in OneDrive, in the folder `parentId` if given: new content, new tags,
   * and each subscription is told.
   */
  async putFile(
    accountId: string,
    itemId: string,
    name: string,
    bytes: Uint8Array,
    parentId?: string,
  ) {
    const account = this.#account(accountId);
    const key = `${account.driveId}/${itemId}`;
    const before = this.files.get(key);
    this.files.set(key, {
      driveId: account.driveId,
      itemId,
      name,
      bytes,
      version: (before?.version ?? 0) + 1,
      deleted: false,
      ...(parentId && { parentId }),
    });
    await this.#notify(account.id);
  }

  /** A person makes a folder in OneDrive. */
  putFolder(accountId: string, itemId: string, name: string) {
    const account = this.#account(accountId);
    this.files.set(`${account.driveId}/${itemId}`, {
      driveId: account.driveId,
      itemId,
      name,
      bytes: new Uint8Array(),
      version: 1,
      deleted: false,
      folder: true,
    });
  }

  async deleteFile(accountId: string, itemId: string) {
    const account = this.#account(accountId);
    const file = this.files.get(`${account.driveId}/${itemId}`);
    if (file) file.deleted = true;
    await this.#notify(account.id);
  }

  /** The person removed the app from their account, or an administrator revoked its sessions. */
  revoke(accountId: string) {
    for (const [t, a] of [...this.#refresh, ...this.#access]) {
      if (a === accountId) {
        this.#refresh.delete(t);
        this.#access.delete(t);
      }
    }
  }

  /** The next `calls` Graph calls answer 429 with Retry-After. */
  throttle(calls: number) {
    this.#throttle = calls;
  }

  reset() {
    this.files.clear();
    this.subscriptions.clear();
    this.delivered.length = 0;
    this.calls.length = 0;
    this.#assertions.clear();
    this.#refresh.clear();
    this.#access.clear();
    this.#downloads.clear();
    this.#throttle = 0;
  }

  #account(id: string): StandInAccount {
    const account = this.accounts.get(id);
    if (!account) throw new GraphError(404, 'itemNotFound', `No account ${id}`);
    return account;
  }

  #tokens(accountId: string, scope: string) {
    const access = token('at');
    const refresh = token('rt');
    this.#access.set(access, accountId);
    this.#refresh.set(refresh, accountId);
    return {
      token_type: 'Bearer',
      scope,
      expires_in: 3600,
      ext_expires_in: 3600,
      access_token: access,
      refresh_token: refresh,
    };
  }

  /** Learn (on-behalf-of flow): the assertion, our app's secret, `requested_token_use`. */
  #token(form: URLSearchParams) {
    if (
      form.get('client_id') !== this.#options.clientId ||
      form.get('client_secret') !== this.#options.clientSecret
    ) {
      throw new TokenError('invalid_client', [7000215], 'AADSTS7000215: Invalid client secret.');
    }
    const scope = form.get('scope') ?? '';
    const scopes = scope.split(' ');
    if (!GRAPH_SCOPES.every((s) => scopes.includes(s))) {
      throw new TokenError('invalid_scope', [70011], 'AADSTS70011: The provided scope is invalid.');
    }
    const offline = scopes.includes('offline_access');
    const grant = form.get('grant_type');
    let accountId: string | undefined;
    if (grant === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
      if (form.get('requested_token_use') !== 'on_behalf_of') {
        throw new TokenError('invalid_request', [900144], 'AADSTS900144: requested_token_use.');
      }
      accountId = this.#assertions.get(form.get('assertion') ?? '');
    } else if (grant === 'refresh_token') {
      const old = form.get('refresh_token') ?? '';
      accountId = this.#refresh.get(old);
      // A refresh token replaces itself on every use (Learn: refresh tokens).
      this.#refresh.delete(old);
    } else {
      throw new TokenError('unsupported_grant_type', [70003], `AADSTS70003: ${grant}`);
    }
    if (!accountId) {
      throw new TokenError(
        'invalid_grant',
        [50173],
        'AADSTS50173: The provided grant has expired.',
      );
    }
    const tokens = this.#tokens(accountId, scope);
    if (!offline) delete (tokens as { refresh_token?: string }).refresh_token;
    return tokens;
  }

  #caller(c: Context): StandInAccount {
    if (this.#throttle > 0) {
      this.#throttle--;
      throw new GraphError(429, 'TooManyRequests', 'Too many requests');
    }
    const auth = c.req.header('authorization') ?? '';
    const accountId = this.#access.get(auth.replace(/^Bearer /, ''));
    if (!accountId)
      throw new GraphError(401, 'InvalidAuthenticationToken', 'Access token is empty or invalid.');
    this.calls.push(`${c.req.method} ${new URL(c.req.url).pathname.replace(/^.*\/v1\.0/, '')}`);
    return this.#account(accountId);
  }

  #file(account: StandInAccount, driveId: string, itemId: string): StandInFile {
    const file = this.files.get(`${driveId}/${itemId}`);
    if (!file || file.deleted)
      throw new GraphError(404, 'itemNotFound', 'The resource could not be found.');
    if (file.driveId !== account.driveId)
      throw new GraphError(403, 'accessDenied', 'Access denied');
    return file;
  }

  #children(folder: StandInFile) {
    return [...this.files.values()]
      .filter((f) => f.driveId === folder.driveId && f.parentId === folder.itemId && !f.deleted)
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  #item(account: StandInAccount, file: StandInFile) {
    return {
      id: file.itemId,
      name: file.name,
      size: file.folder ? 0 : file.bytes.byteLength,
      eTag: `"{${file.itemId}},${file.version}"`,
      cTag: `"c:{${file.itemId}},${file.version}"`,
      lastModifiedDateTime: this.#now().toISOString(),
      webUrl: this.#url(`/web/${file.driveId}/${file.itemId}`),
      ...(file.folder
        ? { folder: { childCount: this.#children(file).length } }
        : { file: { mimeType: 'application/octet-stream' } }),
      parentReference: {
        driveId: file.driveId,
        driveType: account.kind === 'personal' ? 'personal' : 'business',
        ...(file.parentId && { id: file.parentId }),
      },
    };
  }

  async #notify(accountId: string) {
    const fetcher = this.#options.fetcher ?? fetch;
    for (const s of this.subscriptions.values()) {
      if (s.account !== accountId) continue;
      const account = this.#account(accountId);
      const body = JSON.stringify({
        value: [
          {
            subscriptionId: s.id,
            subscriptionExpirationDateTime: s.expirationDateTime,
            clientState: s.clientState ?? null,
            changeType: 'updated',
            resource: s.resource,
            tenantId: account.tenantId,
          },
        ],
      });
      try {
        const res = await fetcher(s.notificationUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        });
        this.delivered.push({ subscriptionId: s.id, status: res.status });
      } catch (e) {
        this.delivered.push({ subscriptionId: s.id, status: null });
        this.#options.log?.(`microsoft stand-in: notification failed: ${String(e)}`);
      }
    }
  }

  /** Learn (webhooks): a POST with ?validationToken=…, answered 200 text/plain with it, within 10 s. */
  async #validate(notificationUrl: string): Promise<boolean> {
    const validationToken = `Validation: ${randomBytes(6).toString('hex')}`;
    const url = new URL(notificationUrl);
    url.searchParams.set('validationToken', validationToken);
    try {
      const res = await (this.#options.fetcher ?? fetch)(url, {
        method: 'POST',
        headers: { 'content-type': 'text/plain; charset=utf-8' },
        signal: AbortSignal.timeout(10_000),
      });
      return (
        res.status === 200 &&
        (res.headers.get('content-type') ?? '').startsWith('text/plain') &&
        (await res.text()) === validationToken
      );
    } catch {
      return false;
    }
  }

  #routes() {
    const app = this.app;
    app.onError((err, c) => {
      if (err instanceof TokenError) {
        return c.json(
          {
            error: err.error,
            error_description: err.message,
            error_codes: err.codes,
            timestamp: this.#now().toISOString(),
          },
          err.error === 'invalid_client' ? 401 : 400,
        );
      }
      if (err instanceof GraphError) {
        if (err.status === 429) c.header('Retry-After', '2');
        return c.json({ error: { code: err.code, message: err.message } }, err.status);
      }
      throw err;
    });

    app.post('/:tenant/oauth2/v2.0/token', async (c) =>
      c.json(this.#token(new URLSearchParams(await c.req.text()))),
    );

    const graph = new Hono();
    graph.get('/me', (c) => {
      const a = this.#caller(c);
      return c.json({
        id: a.id,
        displayName: a.displayName,
        // Learn: `mail` may be null for a personal account; userPrincipalName then holds the address.
        mail: a.kind === 'work' ? a.address : null,
        userPrincipalName: a.address,
      });
    });
    graph.get('/me/drive', (c) => {
      const a = this.#caller(c);
      return c.json({
        id: a.driveId,
        driveType: a.kind === 'personal' ? 'personal' : 'business',
        webUrl:
          a.kind === 'personal'
            ? `https://onedrive.live.com/?cid=${a.id}`
            : 'https://atelierdurand-my.sharepoint.com/personal/camille_atelier-durand_fr/Documents',
      });
    });
    graph.get('/drives/:drive/items/:item', (c) => {
      const a = this.#caller(c);
      return c.json(this.#item(a, this.#file(a, c.req.param('drive'), c.req.param('item'))));
    });
    // Learn (list children): `$top` items a page (200 by default), the rest behind `@odata.nextLink`.
    graph.get('/drives/:drive/items/:item/children', (c) => {
      const a = this.#caller(c);
      const folder = this.#file(a, c.req.param('drive'), c.req.param('item'));
      const top = Math.min(Number(c.req.query('$top') ?? 200) || 200, 999);
      const skip = Number(c.req.query('$skiptoken') ?? 0) || 0;
      const all = this.#children(folder);
      const next = skip + top < all.length;
      return c.json({
        value: all.slice(skip, skip + top).map((f) => this.#item(a, f)),
        ...(next && {
          '@odata.nextLink': this.#url(
            `/graph/v1.0/drives/${folder.driveId}/items/${folder.itemId}/children?$top=${top}&$skiptoken=${skip + top}`,
          ),
        }),
      });
    });
    graph.get('/drives/:drive/items/:item/content', (c) => {
      const a = this.#caller(c);
      const file = this.#file(a, c.req.param('drive'), c.req.param('item'));
      // Learn: 302 to a pre-authenticated URL that needs no Authorization header.
      const link = randomBytes(12).toString('hex');
      this.#downloads.set(link, `${file.driveId}/${file.itemId}`);
      return c.redirect(this.#url(`/download/${link}`), 302);
    });
    graph.post('/subscriptions', async (c) => {
      const a = this.#caller(c);
      const body = (await c.req.json()) as Partial<Subscription>;
      // Learn: on OneDrive for Business a subscription needs Files.Read.All, which we do not ask.
      if (a.kind === 'work') {
        throw new GraphError(
          403,
          'ExtensionError',
          'Operation: Create; Exception: [Status Code: Forbidden]',
        );
      }
      if (body.resource !== '/me/drive/root' || body.changeType !== 'updated') {
        throw new GraphError(400, 'InvalidRequest', 'Only updated on the drive root.');
      }
      const minutes = (Date.parse(body.expirationDateTime ?? '') - +this.#now()) / 60_000;
      if (!(minutes > 0 && minutes <= MAX_SUBSCRIPTION_MINUTES)) {
        throw new GraphError(400, 'InvalidRequest', 'Subscription expiration is out of range.');
      }
      if (!body.notificationUrl || !(await this.#validate(body.notificationUrl))) {
        throw new GraphError(400, 'ValidationError', 'Subscription validation request failed.');
      }
      const s: Subscription = {
        id: randomBytes(16).toString('hex'),
        account: a.id,
        resource: body.resource,
        changeType: body.changeType,
        notificationUrl: body.notificationUrl,
        clientState: body.clientState,
        expirationDateTime: new Date(Date.parse(body.expirationDateTime ?? '')).toISOString(),
      };
      this.subscriptions.set(s.id, s);
      const { account: _a, ...view } = s;
      return c.json(view, 201);
    });
    graph.patch('/subscriptions/:id', async (c) => {
      const a = this.#caller(c);
      const s = this.subscriptions.get(c.req.param('id'));
      if (!s || s.account !== a.id) throw new GraphError(404, 'ResourceNotFound', 'Not found');
      const { expirationDateTime } = (await c.req.json()) as { expirationDateTime?: string };
      const minutes = (Date.parse(expirationDateTime ?? '') - +this.#now()) / 60_000;
      if (!(minutes > 0 && minutes <= MAX_SUBSCRIPTION_MINUTES)) {
        throw new GraphError(400, 'InvalidRequest', 'Subscription expiration is out of range.');
      }
      s.expirationDateTime = new Date(Date.parse(expirationDateTime ?? '')).toISOString();
      const { account: _a, ...view } = s;
      return c.json(view);
    });
    graph.delete('/subscriptions/:id', (c) => {
      const a = this.#caller(c);
      const s = this.subscriptions.get(c.req.param('id'));
      if (!s || s.account !== a.id) throw new GraphError(404, 'ResourceNotFound', 'Not found');
      this.subscriptions.delete(s.id);
      return c.body(null, 204);
    });
    app.route('/graph/v1.0', graph);

    app.get('/download/:link', (c) => {
      const key = this.#downloads.get(c.req.param('link'));
      const file = key ? this.files.get(key) : undefined;
      if (!file || file.deleted) return c.body(null, 404);
      return c.body(new Uint8Array(file.bytes), 200, {
        'content-type': 'application/octet-stream',
      });
    });

    // What a person does in OneDrive and Microsoft's sign-in, for tests and the E2E run.
    app.post('/control/sign-in/:account', (c) =>
      c.json({ token: this.signIn(c.req.param('account')) }),
    );
    app.get('/control/files/:account', (c) => {
      const a = this.#account(c.req.param('account'));
      return c.json(
        [...this.files.values()]
          .filter((f) => f.driveId === a.driveId && !f.deleted)
          .map((f) => ({
            driveId: f.driveId,
            itemId: f.itemId,
            name: f.name,
            folder: Boolean(f.folder),
            ...(f.parentId && { parentId: f.parentId }),
          })),
      );
    });
    app.put('/control/files/:account/:item', async (c) => {
      const name = c.req.query('name');
      if (!name) return c.json({ error: 'name is required' }, 400);
      await this.putFile(
        c.req.param('account'),
        c.req.param('item'),
        name,
        new Uint8Array(await c.req.arrayBuffer()),
        c.req.query('parent'),
      );
      return c.body(null, 204);
    });
    app.put('/control/folders/:account/:item', (c) => {
      const name = c.req.query('name');
      if (!name) return c.json({ error: 'name is required' }, 400);
      this.putFolder(c.req.param('account'), c.req.param('item'), name);
      return c.body(null, 204);
    });
    app.delete('/control/files/:account/:item', async (c) => {
      await this.deleteFile(c.req.param('account'), c.req.param('item'));
      return c.body(null, 204);
    });
    app.post('/control/revoke/:account', (c) => {
      this.revoke(c.req.param('account'));
      return c.body(null, 204);
    });
    app.get('/control/subscriptions', (c) =>
      c.json([...this.subscriptions.values()].map(({ account: _a, ...s }) => s)),
    );
    app.post('/control/reset', (c) => {
      this.reset();
      return c.body(null, 204);
    });
  }
}
