// Google's OAuth and Drive API, as the Google Drive connector uses them (R5, docs/GOOGLE.md, read on
// developers.google.com 2026-10-22): the one-window sign-in with Google's picker, the code exchange and
// refresh, revoking, the account, a picked file's metadata and content (a Google Sheets file exported
// as .xlsx), and change notifications on the files the app may read. Every answer is checked with Zod;
// every failure becomes a GoogleError whose kind says what the connector does next.

import { z } from 'zod';
import { DriveError, type DriveErrorKind, readCapped, retryAfterOf } from './drive';

export const GOOGLE_HOSTS = {
  accounts: 'https://accounts.google.com',
  oauth: 'https://oauth2.googleapis.com',
  api: 'https://www.googleapis.com',
};

/** The only scope: files the person picked for us (non-sensitive, docs/GOOGLE.md §2). */
export const DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

export const GOOGLE_SHEET = 'application/vnd.google-apps.spreadsheet';
export const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** What the picker shows: Google Sheets, Excel workbooks (with macros too) and CSV. TODO(verify) §6.3. */
export const PICKED_TYPES = [
  GOOGLE_SHEET,
  XLSX,
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'text/csv',
];

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  accountsUrl: string;
  oauthUrl: string;
  apiUrl: string;
  /** Default: global fetch. */
  fetcher?: typeof fetch;
}

/** A failure at Google, of a kind the connector acts on (src/drive.ts). */
export class GoogleError extends DriveError {
  constructor(kind: DriveErrorKind, detail: string, retryAfter?: number) {
    super(kind, detail, retryAfter);
    this.name = 'GoogleError';
  }
}

const TokenAnswer = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().optional(),
});
const TokenFailure = z.object({ error: z.string() });
const ApiFailure = z.object({
  error: z.object({
    code: z.number().optional(),
    errors: z.array(z.object({ reason: z.string().optional() }).loose()).optional(),
  }),
});
const About = z.object({
  user: z.object({
    displayName: z.string().nullish(),
    emailAddress: z.string().nullish(),
    permissionId: z.string().min(1),
  }),
});
export const GoogleFile = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  mimeType: z.string(),
  /** int64 as a string in Drive's JSON. */
  size: z.coerce.number().int().nonnegative().optional(),
  version: z.string().min(1),
  trashed: z.boolean().optional(),
});
export type GoogleFile = z.infer<typeof GoogleFile>;
const StartPageToken = z.object({ startPageToken: z.string().min(1) });
const Channel = z.object({
  id: z.string().min(1),
  resourceId: z.string().min(1),
  /** Milliseconds since 1970, as a string. */
  expiration: z.coerce.number().int().positive(),
});

/** Gmail addresses are personal accounts; any other domain is a Google Workspace one. */
export const googleAccountKind = (email: string | null | undefined): 'personal' | 'work' =>
  /@(gmail|googlemail)\.com$/i.test(email ?? '') ? 'personal' : 'work';

/** Asking to wait (Resolve errors): per user, per project, per day. */
const RATE_REASONS = ['rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded'];

export function createGoogleClient(config: GoogleConfig) {
  const fetcher = config.fetcher ?? fetch;
  const accounts = config.accountsUrl.replace(/\/$/, '');
  const oauth = config.oauthUrl.replace(/\/$/, '');
  const api = config.apiUrl.replace(/\/$/, '');

  async function token(form: Record<string, string>) {
    let res: Response;
    try {
      res = await fetcher(`${oauth}/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          ...form,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new GoogleError('unavailable', `token endpoint: ${String(e)}`);
    }
    const json: unknown = await res.json().catch(() => null);
    if (res.ok) {
      const answer = TokenAnswer.safeParse(json);
      if (answer.success) return answer.data;
      throw new GoogleError('unavailable', 'token endpoint: unreadable answer');
    }
    if (res.status === 429 || res.status === 503) {
      throw new GoogleError('throttled', `token endpoint ${res.status}`, retryAfterOf(res));
    }
    const failure = TokenFailure.safeParse(json);
    const code = failure.success ? failure.data.error : `http_${res.status}`;
    // The web-server guide: the grant expired or was revoked; the person consents again.
    if (code === 'invalid_grant') throw new GoogleError('reconnect', code);
    // invalid_client, redirect_uri_mismatch: our registration is wrong; nothing the person can do.
    throw new GoogleError('unavailable', `token endpoint: ${code}`);
  }

  async function call(
    accessToken: string,
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<Response> {
    let res: Response;
    try {
      res = await fetcher(`${api}${path}`, {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(init.body !== undefined && { 'content-type': 'application/json' }),
        },
        ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (e) {
      throw new GoogleError('unavailable', `drive ${path}: ${String(e)}`);
    }
    if (res.ok) return res;
    const where = path.split('?')[0] ?? path;
    if (res.status === 429) {
      throw new GoogleError('throttled', `drive ${res.status}`, retryAfterOf(res));
    }
    if (res.status === 401) throw new GoogleError('reconnect', `drive ${where}: 401`);
    if (res.status === 404) throw new GoogleError('missing', where);
    if (res.status === 403) {
      const failure = ApiFailure.safeParse(await res.json().catch(() => null));
      const reasons = failure.success ? (failure.data.error.errors ?? []).map((e) => e.reason) : [];
      if (reasons.some((r) => r && RATE_REASONS.includes(r))) {
        throw new GoogleError('throttled', `drive 403 ${reasons.join(',')}`, retryAfterOf(res));
      }
      throw new GoogleError('forbidden', `${where} ${reasons.join(',')}`.trim());
    }
    throw new GoogleError('unavailable', `drive ${where}: ${res.status}`);
  }

  async function json<T>(res: Response, schema: z.ZodType<T>, what: string): Promise<T> {
    const parsed = schema.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new GoogleError('unavailable', `${what}: unreadable answer`);
    return parsed.data;
  }

  const file = (id: string) => `/drive/v3/files/${encodeURIComponent(id)}`;

  return {
    /**
     * The one window (picker guide for desktop apps): Google's sign-in, consent to `drive.file`, then
     * its picker; Google comes back to `redirectUri` with the code and the picked files' ids.
     */
    authorizeUrl(input: { redirectUri: string; state: string; loginHint?: string }) {
      const query = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: input.redirectUri,
        response_type: 'code',
        scope: DRIVE_FILE_SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        trigger_onepick: 'true',
        allow_multiple: 'true',
        mimetypes: PICKED_TYPES.join(','),
        state: input.state,
        ...(input.loginHint && { login_hint: input.loginHint }),
      });
      return `${accounts}/o/oauth2/v2/auth?${query}`;
    },

    /** The code from the redirect → an access token and, with `access_type=offline`, a refresh token. */
    async exchange(code: string, redirectUri: string) {
      const answer = await token({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      });
      return { accessToken: answer.access_token, refreshToken: answer.refresh_token ?? null };
    },

    /** The documented answer carries no new refresh token: the stored one stays. */
    async refresh(refreshToken: string) {
      const answer = await token({ grant_type: 'refresh_token', refresh_token: refreshToken });
      return {
        accessToken: answer.access_token,
        refreshToken: answer.refresh_token ?? refreshToken,
      };
    },

    /** Revoking a refresh token removes what the person granted us (web-server guide). */
    async revoke(tokenValue: string) {
      let res: Response;
      try {
        res = await fetcher(`${oauth}/revoke`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ token: tokenValue }),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (e) {
        throw new GoogleError('unavailable', `revoke: ${String(e)}`);
      }
      // 400: already revoked or expired, which is what we wanted.
      if (!res.ok && res.status !== 400)
        throw new GoogleError('unavailable', `revoke ${res.status}`);
    },

    async about(accessToken: string) {
      const { user } = await json(
        await call(
          accessToken,
          '/drive/v3/about?fields=user(displayName,emailAddress,permissionId)',
        ),
        About,
        'about',
      );
      return {
        id: user.permissionId,
        label: user.emailAddress ?? user.displayName ?? user.permissionId,
        accountKind: googleAccountKind(user.emailAddress),
      };
    },

    async file(accessToken: string, id: string): Promise<GoogleFile> {
      return json(
        await call(accessToken, `${file(id)}?fields=id,name,mimeType,size,version,trashed`),
        GoogleFile,
        'file',
      );
    },

    /** Stored content (`alt=media`), or a Google Sheets file exported as .xlsx (10 MB at most). */
    async content(accessToken: string, item: GoogleFile, maxBytes: number) {
      const path =
        item.mimeType === GOOGLE_SHEET
          ? `${file(item.id)}/export?mimeType=${encodeURIComponent(XLSX)}`
          : `${file(item.id)}?alt=media`;
      const res = await call(accessToken, path);
      return readCapped(res, maxBytes, (detail) => new GoogleError('too_large', detail));
    },

    async startPageToken(accessToken: string) {
      return (
        await json(
          await call(accessToken, '/drive/v3/changes/startPageToken'),
          StartPageToken,
          'start page token',
        )
      ).startPageToken;
    },

    /** Notifications for changes from `pageToken` on (push guide): a week at most for `changes`. */
    async watch(
      accessToken: string,
      input: { id: string; address: string; token: string; expiresAt: Date; pageToken: string },
    ) {
      const channel = await json(
        await call(
          accessToken,
          `/drive/v3/changes/watch?pageToken=${encodeURIComponent(input.pageToken)}`,
          {
            method: 'POST',
            body: {
              id: input.id,
              type: 'web_hook',
              address: input.address,
              token: input.token,
              expiration: String(+input.expiresAt),
            },
          },
        ),
        Channel,
        'channel',
      );
      return {
        id: channel.id,
        resourceId: channel.resourceId,
        expiresAt: new Date(channel.expiration),
      };
    },

    async stop(accessToken: string, channel: { id: string; resourceId: string }) {
      await call(accessToken, '/drive/v3/channels/stop', { method: 'POST', body: channel });
    },
  };
}

export type GoogleClient = ReturnType<typeof createGoogleClient>;
