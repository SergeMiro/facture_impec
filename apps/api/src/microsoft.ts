// Microsoft's identity platform and Graph, as the OneDrive connector uses them (R4,
// docs/MICROSOFT365.md, read on Learn 2026-10-21): the on-behalf-of exchange of the pane's token for
// a Graph token and a refresh token, its refresh, the account, a picked file's metadata and content,
// a watched folder's files (BTP stage 1D), and change-notification subscriptions. Every answer is checked with Zod; every failure becomes a
// MicrosoftError whose kind says what the connector does next.

import { z } from 'zod';
import { DriveError, type DriveErrorKind, readCapped, retryAfterOf } from './drive';

/** The `tid` of every personal Microsoft account (Learn: ID token claims reference). */
export const MSA_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

/** What the connector asks, and nothing more: no Files.Read.All, no administrator. */
export const GRAPH_SCOPES = [
  'https://graph.microsoft.com/Files.Read',
  'https://graph.microsoft.com/User.Read',
  'offline_access',
].join(' ');

export const MICROSOFT_HOSTS = {
  login: 'https://login.microsoftonline.com',
  graph: 'https://graph.microsoft.com/v1.0',
};

export interface MicrosoftConfig {
  clientId: string;
  clientSecret: string;
  loginUrl: string;
  graphUrl: string;
  /** Default: global fetch. */
  fetcher?: typeof fetch;
}

/** A failure at Microsoft, of a kind the connector acts on (src/drive.ts). */
export class MicrosoftError extends DriveError {
  constructor(kind: DriveErrorKind, detail: string, retryAfter?: number) {
    super(kind, detail, retryAfter);
    this.name = 'MicrosoftError';
  }
}

const TokenAnswer = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().optional(),
});
const TokenFailure = z.object({ error: z.string(), error_description: z.string().optional() });

const Me = z.object({
  id: z.string().min(1),
  displayName: z.string().nullish(),
  mail: z.string().nullish(),
  userPrincipalName: z.string().nullish(),
});
const Drive = z.object({
  id: z.string(),
  driveType: z.string(),
  webUrl: z.string().nullish(),
});
export const DriveItem = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  size: z.number().int().nonnegative().optional(),
  eTag: z.string().nullish(),
  cTag: z.string().nullish(),
  file: z.object({}).loose().nullish(),
  folder: z.object({}).loose().nullish(),
  parentReference: z.object({ driveId: z.string().nullish() }).loose().nullish(),
});
export type DriveItem = z.infer<typeof DriveItem>;
const Children = z.object({
  value: z.array(DriveItem),
  '@odata.nextLink': z.string().optional(),
});
/** Learn (list children): 200 items a page by default; a folder longer than this waits a check. */
const CHILDREN_PAGES = 25;
const ITEM_FIELDS = 'id,name,size,eTag,cTag,file,folder,parentReference';
const Subscription = z.object({ id: z.string().min(1), expirationDateTime: z.string() });

/** The token's claims, read without checking it: Microsoft checks it in the exchange. */
export function claimsOf(token: string): { tid?: string; oid?: string } {
  const payload = token.split('.')[1];
  if (!payload) return {};
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
    const parsed = z
      .object({ tid: z.string().optional(), oid: z.string().optional() })
      .safeParse(claims);
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * The token endpoint's tenant: the directory the person signed in from. Learn wants a tenant-specific
 * endpoint for on-behalf-of; for a personal account the documented one is `consumers`.
 * TODO(verify): on-behalf-of for a personal account with a real app registration (docs/MICROSOFT365.md).
 */
export const tokenTenant = (tid: string) => (tid === MSA_TENANT ? 'consumers' : tid);

export function createMicrosoftClient(config: MicrosoftConfig) {
  const fetcher = config.fetcher ?? fetch;
  const login = config.loginUrl.replace(/\/$/, '');
  const graphUrl = config.graphUrl.replace(/\/$/, '');

  async function token(tenant: string, form: Record<string, string>) {
    let res: Response;
    try {
      res = await fetcher(`${login}/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          scope: GRAPH_SCOPES,
          ...form,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new MicrosoftError('unavailable', `token endpoint: ${String(e)}`);
    }
    const json: unknown = await res.json().catch(() => null);
    if (res.ok) {
      const answer = TokenAnswer.safeParse(json);
      if (answer.success) return answer.data;
      throw new MicrosoftError('unavailable', 'token endpoint: unreadable answer');
    }
    if (res.status === 429 || res.status === 503) {
      throw new MicrosoftError('throttled', `token endpoint ${res.status}`, retryAfterOf(res));
    }
    const failure = TokenFailure.safeParse(json);
    const code = failure.success ? failure.data.error : `http_${res.status}`;
    // The AADSTS number says which consent or sign-in is missing; the rest of the text may name the
    // person, so it is dropped.
    const aadsts = failure.success ? failure.data.error_description?.match(/AADSTS\d+/)?.[0] : null;
    const detail = aadsts ? `${code} ${aadsts}` : code;
    // Learn (error codes): the grant is no good, or the person must act (consent, MFA).
    if (['invalid_grant', 'interaction_required', 'consent_required'].includes(code)) {
      throw new MicrosoftError('reconnect', detail);
    }
    // invalid_client: our app registration is wrong; nothing the person can do.
    throw new MicrosoftError('unavailable', `token endpoint: ${detail}`);
  }

  async function call(
    accessToken: string,
    path: string,
    init: { method?: string; body?: unknown; redirect?: 'follow' | 'manual' } = {},
  ): Promise<Response> {
    let res: Response;
    try {
      res = await fetcher(`${graphUrl}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(init.body !== undefined && { 'content-type': 'application/json' }),
        },
        ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
        redirect: init.redirect ?? 'follow',
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      throw new MicrosoftError('unavailable', `graph ${path}: ${String(e)}`);
    }
    if (res.ok || (res.status >= 300 && res.status < 400)) return res;
    if (res.status === 429 || res.status === 503) {
      throw new MicrosoftError('throttled', `graph ${res.status}`, retryAfterOf(res));
    }
    if (res.status === 401) throw new MicrosoftError('reconnect', `graph ${path}: 401`);
    if (res.status === 404 || res.status === 410) throw new MicrosoftError('missing', path);
    if (res.status === 403) throw new MicrosoftError('forbidden', path);
    throw new MicrosoftError('unavailable', `graph ${path}: ${res.status}`);
  }

  async function json<T>(res: Response, schema: z.ZodType<T>, what: string): Promise<T> {
    const parsed = schema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new MicrosoftError('unavailable', `${what}: unreadable answer`);
    return parsed.data;
  }

  const item = (driveId: string, itemId: string) =>
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`;

  return {
    /** Learn (on-behalf-of flow): the pane's token for our API → a Graph token and a refresh token. */
    async exchange(assertion: string) {
      const { tid } = claimsOf(assertion);
      if (!tid) throw new MicrosoftError('reconnect', 'token without tid');
      const answer = await token(tokenTenant(tid), {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
        requested_token_use: 'on_behalf_of',
      });
      if (!answer.refresh_token) throw new MicrosoftError('unavailable', 'no refresh token');
      return { accessToken: answer.access_token, refreshToken: answer.refresh_token, tid };
    },

    /** Learn (refresh tokens): each use gives a new one, which replaces it. */
    async refresh(refreshToken: string, tid: string) {
      const answer = await token(tokenTenant(tid), {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });
      return {
        accessToken: answer.access_token,
        refreshToken: answer.refresh_token ?? refreshToken,
      };
    },

    async me(accessToken: string) {
      const me = await json(
        await call(accessToken, '/me?$select=id,displayName,mail,userPrincipalName'),
        Me,
        '/me',
      );
      return { id: me.id, label: me.mail ?? me.userPrincipalName ?? me.displayName ?? me.id };
    },

    async drive(accessToken: string) {
      return json(
        await call(accessToken, '/me/drive?$select=id,driveType,webUrl'),
        Drive,
        '/me/drive',
      );
    },

    async item(accessToken: string, driveId: string, itemId: string): Promise<DriveItem> {
      return json(
        await call(accessToken, `${item(driveId, itemId)}?$select=${ITEM_FIELDS}`),
        DriveItem,
        'drive item',
      );
    },

    /**
     * Learn (list children, read 2026-10-24): a folder's own items, page by page through
     * `@odata.nextLink`. The link is followed only on our Graph address: the token goes nowhere else.
     */
    async children(accessToken: string, driveId: string, itemId: string): Promise<DriveItem[]> {
      const items: DriveItem[] = [];
      let path: string | undefined =
        `${item(driveId, itemId)}/children?$select=${ITEM_FIELDS}&$top=200`;
      for (let page = 0; path && page < CHILDREN_PAGES; page++) {
        const answer: z.infer<typeof Children> = await json(
          await call(accessToken, path),
          Children,
          'folder children',
        );
        items.push(...answer.value);
        const next: string | undefined = answer['@odata.nextLink'];
        if (next && !next.startsWith(`${graphUrl}/`)) {
          throw new MicrosoftError('unavailable', 'folder children: next page off Graph');
        }
        path = next?.slice(graphUrl.length);
      }
      return items;
    },

    /**
     * Learn (download content): a 302 to a pre-authenticated URL, fetched without our token. Read up
     * to `maxBytes`: a file larger than it stops there.
     */
    async content(accessToken: string, driveId: string, itemId: string, maxBytes: number) {
      const first = await call(accessToken, `${item(driveId, itemId)}/content`, {
        redirect: 'manual',
      });
      let res = first;
      const location = first.headers.get('location');
      if (first.status >= 300 && first.status < 400) {
        if (!location) throw new MicrosoftError('unavailable', 'download: no location');
        try {
          res = await fetcher(location, { signal: AbortSignal.timeout(60_000) });
        } catch (e) {
          throw new MicrosoftError('unavailable', `download: ${String(e)}`);
        }
        if (res.status === 404) throw new MicrosoftError('missing', 'download');
        if (!res.ok) throw new MicrosoftError('unavailable', `download: ${res.status}`);
      }
      return readCapped(res, maxBytes, (detail) => new MicrosoftError('too_large', detail));
    },

    /** Learn (subscription): `updated` on the drive's root; the address is checked by a handshake. */
    async subscribe(
      accessToken: string,
      input: { notificationUrl: string; clientState: string; expiresAt: Date },
    ) {
      return json(
        await call(accessToken, '/subscriptions', {
          method: 'POST',
          body: {
            changeType: 'updated',
            notificationUrl: input.notificationUrl,
            resource: '/me/drive/root',
            expirationDateTime: input.expiresAt.toISOString(),
            clientState: input.clientState,
          },
        }),
        Subscription,
        'subscription',
      );
    },

    async renew(accessToken: string, id: string, expiresAt: Date) {
      return json(
        await call(accessToken, `/subscriptions/${encodeURIComponent(id)}`, {
          method: 'PATCH',
          body: { expirationDateTime: expiresAt.toISOString() },
        }),
        Subscription,
        'subscription',
      );
    },

    async unsubscribe(accessToken: string, id: string) {
      await call(accessToken, `/subscriptions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };
}

export type MicrosoftClient = ReturnType<typeof createMicrosoftClient>;
