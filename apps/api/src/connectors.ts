// Files the API reads without Excel: OneDrive (R4, docs/MICROSOFT365.md) and Google Drive (R5,
// docs/GOOGLE.md). The company connects one account per provider from the pane, picks the workbooks to
// follow, and includes their sheets as it would the open workbook's (src/sources.ts). Only picked files
// are ever read. A check compares each file's content tag (Graph's cTag, Google's version) with the
// provider and downloads only what changed; change notifications (a personal OneDrive, Google Drive)
// trigger a check, the others are polled. Disconnecting deletes the account's token, its files and
// everything read from them.
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { openSecret, sealSecret } from '@fi/agents';
import {
  FILE_LIMITS,
  fileFormat,
  readSheetFile,
  SheetFileError,
  type SheetSnapshot,
} from '@fi/core';
import {
  and,
  audit,
  type ConnectedFileRow,
  type ConnectionProvider,
  type ConnectionRow,
  connectedFiles,
  connections,
  count,
  type Db,
  eq,
  type FileProblem,
  inArray,
  sha256,
  sources,
  type TenantRow,
  type Tx,
  tenants,
} from '@fi/db';
import { z } from 'zod';
import { type Principal, who } from './auth';
import type { ApiDeps, Jobs } from './deps';
import { DriveError } from './drive';
import { ApiError } from './errors';
import { GOOGLE_SHEET, type GoogleClient, GoogleError, type GoogleFile } from './google';
import { type DriveItem, type MicrosoftClient, MicrosoftError } from './microsoft';
import { detectSource, includeSource, readSource, sourceView } from './sources';

/** The OneDrive connector this deployment offers (runtime.ts microsoftFromEnv). */
export interface MicrosoftConnector {
  client: MicrosoftClient;
  /** The owner's app registration: the pane asks MSAL for a token to `apiScope(clientId)`. */
  clientId: string;
  /** CONNECTOR_SEALING_KEY: refresh tokens are sealed with it at rest. */
  sealingKey: string;
  /** Where Graph posts change notifications (`/webhooks/microsoft`); null: files are only polled. */
  notificationUrl: string | null;
  /** MX hosts of a mail domain (runtime.ts mailExchangesFromDns); absent: the pane is not told. */
  mailExchanges?: (domain: string) => Promise<string[]>;
}

/** The Google Drive connector this deployment offers (runtime.ts googleFromEnv). */
export interface GoogleConnector {
  client: GoogleClient;
  /** CONNECTOR_SEALING_KEY: refresh tokens are sealed with it, the window's ticket signed with it. */
  sealingKey: string;
  /** `/connectors/google/callback` on the API's public address, as registered at Google. */
  redirectUrl: string;
  /** Where Google posts change notifications (`/webhooks/google`); null: files are only polled. */
  notificationUrl: string | null;
}

type ConnectorDeps = Pick<ApiDeps, 'db' | 'jobs' | 'now' | 'microsoft' | 'google'>;

/** Actor of what a check does without anybody in the pane. */
export const CONNECTOR_ACTOR = 'connector:microsoft';
export const GOOGLE_ACTOR = 'connector:google';
const ACTOR: Record<ConnectionProvider, string> = {
  microsoft: CONNECTOR_ACTOR,
  google: GOOGLE_ACTOR,
};
/** A company follows at most this many files per provider (more: docs/DEFERRED.md). */
export const MAX_FILES = 20;
/** A file without change notifications is checked this often… */
export const POLL_EVERY_MS = 2 * 60_000;
/** …and one with them, in case a notification is lost. */
export const WATCHED_POLL_EVERY_MS = 60 * 60_000;
/** Learn allows 42 300 minutes; a short one dies quickly with a connection nobody renews. */
const SUBSCRIPTION_MS = 3 * 24 * 3_600_000;
/** Google allows a week for `changes`; a new channel replaces it a day before it ends. */
const CHANNEL_MS = 6 * 24 * 3_600_000;
const RENEW_BEFORE_MS = 24 * 3_600_000;
/** Google keeps no drive id in a picked file's reference: one value for all. */
export const GOOGLE_DRIVE = 'google';

/**
 * The scope the pane asks for: our API, under the Application ID URI the owner sets (docs/RUNBOOK.md).
 * Learn (OBO, « .default and combined consent »): `.default` makes Microsoft's consent cover the Graph
 * permissions the registration lists too, which our side cannot ask for later (AADSTS70000 without it,
 * 2026-10-22). The token's scope is still `access_as_user`.
 */
export const apiScope = (clientId: string) => `api://${clientId}/.default`;

export const ConnectBody = z.object({ token: z.string().min(20).max(16_384) });
export const PickBody = z.object({
  files: z
    .array(z.object({ driveId: z.string().min(1).max(256), itemId: z.string().min(1).max(256) }))
    .min(1)
    .max(10),
});

/** How the person's messages name each provider (fr.json api.error.connector_*). */
const NAMES: Record<ConnectionProvider, { drive: string; company: string }> = {
  microsoft: { drive: 'OneDrive', company: 'Microsoft' },
  google: { drive: 'Google Drive', company: 'Google' },
};

function microsoftOf(deps: Pick<ApiDeps, 'microsoft'>): MicrosoftConnector {
  if (!deps.microsoft) throw new ApiError(503, 'connector_disabled', NAMES.microsoft);
  return deps.microsoft;
}

function googleOf(deps: Pick<ApiDeps, 'google'>): GoogleConnector {
  if (!deps.google) throw new ApiError(503, 'connector_disabled', NAMES.google);
  return deps.google;
}

/** What the person is told when the provider or the file says no. */
function calm(
  e: unknown,
  during: 'connect' | 'file',
  provider: ConnectionProvider = 'microsoft',
): never {
  const names = NAMES[provider];
  if (e instanceof SheetFileError) {
    throw new ApiError(422, `connector_file_${e.reason}`, undefined, e.message);
  }
  if (!(e instanceof DriveError)) throw e;
  switch (e.kind) {
    case 'reconnect':
      // Not 401: the pane reads that as its own session ending and signs the person out.
      throw during === 'connect'
        ? new ApiError(409, 'connector_sign_in', names, e.message)
        : new ApiError(409, 'connector_reconnect', names, e.message);
    case 'throttled':
      throw new ApiError(503, 'connector_busy', names, e.message);
    case 'missing':
      throw new ApiError(404, 'connector_file_missing', names, e.message);
    case 'forbidden':
      throw new ApiError(403, 'connector_file_forbidden', names, e.message);
    case 'too_large':
      throw new ApiError(422, 'connector_file_too_large', undefined, e.message);
    default:
      throw new ApiError(502, 'connector_unavailable', names, e.message);
  }
}

async function connectionOf(db: Db, tenantId: string, provider: ConnectionProvider = 'microsoft') {
  const [row] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.tenantId, tenantId), eq(connections.provider, provider)));
  return row;
}

/**
 * What a check needs from the provider, whichever it is: a fresh access token, a picked file's
 * metadata, its bytes, and the change notifications kept alive.
 */
interface Remote {
  access(conn: ConnectionRow): Promise<string>;
  look(access: string, file: { driveId: string; itemId: string }): Promise<Look>;
  bytes(access: string, look: Look): Promise<Uint8Array<ArrayBuffer>>;
  watch(conn: ConnectionRow, access: string, log?: (message: string) => void): Promise<void>;
}

/** A picked file as the provider describes it now. */
interface Look {
  itemId: string;
  driveId: string;
  name: string;
  size: number | null;
  /** Changes with the content (Graph's cTag, Google's version); null: unknown, always read. */
  tag: string | null;
  /** The name the reader goes by: a Google Sheets file is read as the .xlsx it is exported to. */
  readAs: string;
  /** False: a folder or anything without content. */
  isFile: boolean;
  /** The provider's own item, for its download. */
  raw: DriveItem | GoogleFile;
}

/** A Graph token for the connection; the refresh token it came with replaces the stored one. */
async function accessFor(deps: ConnectorDeps, conn: ConnectionRow) {
  const ms = microsoftOf(deps);
  const refreshed = await ms.client.refresh(
    openSecret(conn.refreshToken, ms.sealingKey),
    conn.directory,
  );
  await deps.db
    .update(connections)
    .set({ refreshToken: sealSecret(refreshed.refreshToken, ms.sealingKey), updatedAt: deps.now() })
    .where(eq(connections.id, conn.id));
  return refreshed.accessToken;
}

/** Graph's content tag: it changes with the content only (Learn: driveItem cTag). */
const tagOf = (item: DriveItem) => item.cTag ?? item.eTag ?? null;

function microsoftRemote(deps: ConnectorDeps): Remote {
  const ms = microsoftOf(deps);
  return {
    access: (conn) => accessFor(deps, conn),
    async look(access, file) {
      const item = await ms.client.item(access, file.driveId, file.itemId);
      return {
        itemId: item.id,
        driveId: item.parentReference?.driveId ?? file.driveId,
        name: item.name,
        size: item.size ?? null,
        tag: tagOf(item),
        readAs: item.name,
        isFile: Boolean(item.file),
        raw: item,
      };
    },
    bytes: (access, look) =>
      ms.client.content(access, look.driveId, look.itemId, FILE_LIMITS.maxBytes),
    watch: (conn, access, log) => watch(deps, conn, access, log),
  };
}

function googleRemote(deps: ConnectorDeps): Remote {
  const g = googleOf(deps);
  return {
    async access(conn) {
      return (await g.client.refresh(openSecret(conn.refreshToken, g.sealingKey))).accessToken;
    },
    async look(access, file) {
      const item = await g.client.file(access, file.itemId);
      // A file in the bin is not read; restored, it is read again.
      if (item.trashed) throw new GoogleError('missing', 'trashed');
      const sheet = item.mimeType === GOOGLE_SHEET;
      return {
        itemId: item.id,
        driveId: GOOGLE_DRIVE,
        name: item.name,
        size: item.size ?? null,
        tag: item.version,
        readAs: sheet ? `${item.name}.xlsx` : item.name,
        isFile: true,
        raw: item,
      };
    },
    bytes: (access, look) => g.client.content(access, look.raw as GoogleFile, FILE_LIMITS.maxBytes),
    watch: (conn, access, log) => watchGoogle(deps, conn, access, log),
  };
}

const remoteOf = (deps: ConnectorDeps, provider: ConnectionProvider): Remote =>
  provider === 'google' ? googleRemote(deps) : microsoftRemote(deps);

/**
 * Where the pane's file picker opens and the token it wants (Learn: File Picker v8, read 2026-10-21):
 * OneDrive's own for a personal account, from the `consumers` authority (its token is refused from
 * `common`, AADSTS70011, 2026-10-22), the SharePoint host's for a work one. Null: no https host to
 * open it on. TODO(verify): a work account (docs/MICROSOFT365.md).
 */
export function pickerFor(accountKind: 'personal' | 'work', driveUrl: string | null) {
  if (accountKind === 'personal') {
    return {
      baseUrl: 'https://onedrive.live.com/picker',
      scope: 'OneDrive.ReadOnly',
      authority: 'https://login.microsoftonline.com/consumers',
    };
  }
  let origin: string;
  try {
    const url = new URL(driveUrl ?? '');
    if (url.protocol !== 'https:') return null;
    origin = url.origin;
  } catch {
    return null;
  }
  return { baseUrl: `${origin}/_layouts/15/FilePicker.aspx`, scope: `${origin}/.default` };
}

/**
 * Mail served by Microsoft: Exchange Online's MX ends in `mail.protection.outlook.com` or, for domains
 * with DNSSEC, `mx.microsoft` (Learn: How SMTP DANE works, read 2026-10-21); Outlook.com's in
 * `olc.protection.outlook.com` (MX of hotmail.com, outlook.fr and live.fr, looked up the same day).
 */
export function servedByMicrosoft(exchanges: readonly string[]): boolean {
  return exchanges.some((host) => /\.(protection\.outlook\.com|mx\.microsoft)\.?$/i.test(host));
}

/** Scout (plan §R4): the person's mail is with Microsoft, so their files may well be on OneDrive. */
async function mailOnMicrosoft(ms: MicrosoftConnector, principal: Principal | undefined) {
  if (!ms.mailExchanges || principal?.kind !== 'session') return false;
  const domain = principal.email.split('@')[1]?.toLowerCase();
  if (!domain) return false;
  try {
    return servedByMicrosoft(await ms.mailExchanges(domain));
  } catch {
    // No answer from DNS: the pane simply does not suggest it.
    return false;
  }
}

/** A connection's picked files and their sheets, as both sections of the pane show them. */
async function filesView(deps: ConnectorDeps, conn: ConnectionRow) {
  const files = await deps.db
    .select()
    .from(connectedFiles)
    .where(eq(connectedFiles.connectionId, conn.id))
    .orderBy(connectedFiles.name);
  const included = files.length
    ? await deps.db
        .select()
        .from(sources)
        .where(
          inArray(
            sources.fileId,
            files.map((f) => f.id),
          ),
        )
    : [];
  return files.map((f) => {
    const mine = included.filter((s) => s.fileId === f.id);
    const names = [...new Set([...f.sheets, ...mine.map((s) => s.sheet)])];
    return {
      id: f.id,
      name: f.name,
      problem: f.problem,
      pickedAt: f.pickedAt.toISOString(),
      checkedAt: f.checkedAt?.toISOString() ?? null,
      changedAt: f.changedAt?.toISOString() ?? null,
      sheets: names.map((sheet) => {
        const source = mine.find((s) => s.sheet === sheet);
        return {
          sheet,
          /** False: the sheet was renamed or deleted in the file; what it gave stays as it was. */
          present: f.sheets.includes(sheet),
          source: source ? sourceView(source) : null,
        };
      }),
    };
  });
}

/** Change notifications reach us: a change shows within minutes, else at the next poll. */
const notifiedNow = (conn: ConnectionRow, now: Date) =>
  conn.subscriptionId !== null && (conn.subscriptionExpiresAt ?? now) > now;

/** The pane's « Fichiers OneDrive » section; with `principal`, whether to suggest it (Scout). */
export async function connectorView(deps: ConnectorDeps, tenant: TenantRow, principal?: Principal) {
  const ms = deps.microsoft;
  const conn = await connectionOf(deps.db, tenant.id);
  if (!conn) {
    return {
      microsoft: ms ? { clientId: ms.clientId, scope: apiScope(ms.clientId) } : null,
      mailOnMicrosoft: ms ? await mailOnMicrosoft(ms, principal) : false,
      connection: null,
    };
  }
  return {
    microsoft: ms ? { clientId: ms.clientId, scope: apiScope(ms.clientId) } : null,
    mailOnMicrosoft: false,
    connection: {
      label: conn.label,
      accountKind: conn.accountKind,
      status: conn.status,
      picker: pickerFor(conn.accountKind, conn.driveUrl),
      notified: notifiedNow(conn, deps.now()),
      connectedAt: conn.connectedAt.toISOString(),
      checkedAt: conn.checkedAt?.toISOString() ?? null,
      files: await filesView(deps, conn),
    },
  };
}

/** The pane's « Fichiers Google Drive » section (R5). */
export async function googleView(deps: ConnectorDeps, tenant: TenantRow) {
  const conn = await connectionOf(deps.db, tenant.id, 'google');
  return {
    available: Boolean(deps.google),
    connection: conn
      ? {
          label: conn.label,
          accountKind: conn.accountKind,
          status: conn.status,
          notified: notifiedNow(conn, deps.now()),
          connectedAt: conn.connectedAt.toISOString(),
          checkedAt: conn.checkedAt?.toISOString() ?? null,
          files: await filesView(deps, conn),
        }
      : null,
  };
}

/** A provider's section of the pane, after something changed in it. */
const viewOf = (deps: ConnectorDeps, tenant: TenantRow, provider: ConnectionProvider) =>
  provider === 'google' ? googleView(deps, tenant) : connectorView(deps, tenant);

/**
 * « Connecter OneDrive »: the pane's token for our API, exchanged on behalf of the person for Graph
 * tokens. The same account again (« Reconnecter ») renews them; another one waits for a disconnect.
 */
export async function connect(
  deps: ConnectorDeps,
  tenant: TenantRow,
  principal: Principal,
  token: string,
  log?: (message: string) => void,
) {
  const ms = microsoftOf(deps);
  let account: Awaited<ReturnType<MicrosoftClient['me']>>;
  let drive: Awaited<ReturnType<MicrosoftClient['drive']>>;
  let exchanged: Awaited<ReturnType<MicrosoftClient['exchange']>>;
  try {
    exchanged = await ms.client.exchange(token);
    account = await ms.client.me(exchanged.accessToken);
    drive = await ms.client.drive(exchanged.accessToken);
  } catch (e) {
    calm(e, 'connect');
  }
  const before = await connectionOf(deps.db, tenant.id);
  if (before && before.accountId !== account.id) {
    throw new ApiError(409, 'connector_other_account', {
      ...NAMES.microsoft,
      account: before.label,
    });
  }
  const now = deps.now();
  const values = {
    accountId: account.id,
    label: account.label,
    accountKind: drive.driveType === 'personal' ? ('personal' as const) : ('work' as const),
    directory: exchanged.tid,
    driveUrl: drive.webUrl ?? null,
    refreshToken: sealSecret(exchanged.refreshToken, ms.sealingKey),
    status: 'active' as const,
    connectedBy: who(principal),
    connectedAt: now,
    waitUntil: null,
  };
  const conn = await saveConnection(deps, tenant.id, 'microsoft', values, Boolean(before));
  await watch(deps, conn, exchanged.accessToken, log);
  // A reconnect reads again what changed while the token was refused.
  if (before) await deps.jobs.enqueueConnector(conn.id);
  return connectorView(deps, tenant);
}

/** The connection row written (one per company and provider) and the connect audited. */
async function saveConnection(
  deps: ConnectorDeps,
  tenantId: string,
  provider: ConnectionProvider,
  values: Omit<typeof connections.$inferInsert, 'tenantId' | 'provider'>,
  again: boolean,
  actor = 'user',
) {
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(connections)
      .values({ tenantId, provider, ...values })
      .onConflictDoUpdate({
        target: [connections.tenantId, connections.provider],
        set: { ...values, updatedAt: now },
      })
      .returning();
    if (!row) throw new Error('upsert returned nothing');
    await audit(tx, {
      tenantId,
      actor,
      action: again ? 'connection.reconnect' : 'connection.connect',
      objectType: 'connection',
      objectId: row.id,
      after: { provider, account: row.label, accountKind: row.accountKind },
    });
    return row;
  });
}

/**
 * Asks the providers to stop notifying us, and Google to forget our token when `revoke`. Best effort:
 * an unrenewed subscription or channel ends by itself, and nothing it sends then finds a connection.
 */
export async function unwatch(
  deps: ConnectorDeps,
  tenantId: string,
  log?: (message: string) => void,
  only?: ConnectionProvider,
) {
  const ms = deps.microsoft;
  const conn = only === 'google' ? undefined : await connectionOf(deps.db, tenantId);
  if (ms && conn?.subscriptionId && conn.status === 'active') {
    try {
      await ms.client.unsubscribe(await accessFor(deps, conn), conn.subscriptionId);
    } catch (e) {
      log?.(`microsoft: subscription not deleted: ${String(e)}`);
    }
  }
  const g = deps.google;
  const gConn = only === 'microsoft' ? undefined : await connectionOf(deps.db, tenantId, 'google');
  if (!g || !gConn) return;
  const refreshToken = openSecret(gConn.refreshToken, g.sealingKey);
  if (gConn.subscriptionId && gConn.subscriptionResource && gConn.status === 'active') {
    try {
      const { accessToken } = await g.client.refresh(refreshToken);
      await g.client.stop(accessToken, {
        id: gConn.subscriptionId,
        resourceId: gConn.subscriptionResource,
      });
    } catch (e) {
      log?.(`google: channel not stopped: ${String(e)}`);
    }
  }
  try {
    await g.client.revoke(refreshToken);
  } catch (e) {
    log?.(`google: token not revoked: ${String(e)}`);
  }
}

/** « Déconnecter »: our copy of the token, the files and what was read from them go. */
export async function disconnect(
  deps: ConnectorDeps,
  tenant: TenantRow,
  log?: (message: string) => void,
  provider: ConnectionProvider = 'microsoft',
) {
  const conn = await connectionOf(deps.db, tenant.id, provider);
  if (!conn) throw new ApiError(404, 'connector_not_connected', NAMES[provider]);
  await unwatch(deps, tenant.id, log, provider);
  await deps.db.transaction(async (tx) => {
    const files = await tx
      .select({ name: connectedFiles.name })
      .from(connectedFiles)
      .where(eq(connectedFiles.connectionId, conn.id));
    // Files, then their sheets, documents, lines and findings go with it (foreign keys cascade).
    await tx.delete(connections).where(eq(connections.id, conn.id));
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'connection.disconnect',
      objectType: 'connection',
      objectId: conn.id,
      before: { provider, account: conn.label, files: files.map((f) => f.name) },
    });
  });
  await deps.jobs.enqueueRegistry(tenant.id);
  return viewOf(deps, tenant, provider);
}

async function activeConnection(
  deps: ConnectorDeps,
  tenantId: string,
  provider: ConnectionProvider = 'microsoft',
) {
  if (provider === 'google') googleOf(deps);
  else microsoftOf(deps);
  const conn = await connectionOf(deps.db, tenantId, provider);
  if (!conn) throw new ApiError(404, 'connector_not_connected', NAMES[provider]);
  if (conn.status === 'reconnect') throw new ApiError(409, 'connector_reconnect', NAMES[provider]);
  return conn;
}

/** A picked file downloaded and read; nothing is kept but what its included sheets give. */
async function download(remote: Remote, access: string, look: Look) {
  if (!fileFormat(look.readAs) || !look.isFile) throw new SheetFileError('unsupported', look.name);
  if ((look.size ?? 0) > FILE_LIMITS.maxBytes) throw new SheetFileError('too_large', look.name);
  return readSheetFile(await remote.bytes(access, look), look.readAs);
}

/**
 * Picked files read and recorded: all are read first; one fails, none is kept. OneDrive's picker
 * answers in the pane (« Choisir des fichiers »); Google's in the window's callback.
 */
async function recordPicked(
  deps: ConnectorDeps,
  tenantId: string,
  conn: ConnectionRow,
  by: string,
  picked: { driveId: string; itemId: string }[],
  actor = 'user',
) {
  const remote = remoteOf(deps, conn.provider);
  const [had] = await deps.db
    .select({ n: count() })
    .from(connectedFiles)
    .where(eq(connectedFiles.connectionId, conn.id));
  const read: { look: Look; sheets: string[] }[] = [];
  try {
    const access = await remote.access(conn);
    for (const p of picked) {
      const look = await remote.look(access, p);
      const file = await download(remote, access, look);
      read.push({ look, sheets: file.sheets.map((s) => s.sheet) });
    }
  } catch (e) {
    calm(e, 'file', conn.provider);
  }
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const known = await tx
      .select({ itemId: connectedFiles.itemId, driveId: connectedFiles.driveId })
      .from(connectedFiles)
      .where(eq(connectedFiles.connectionId, conn.id));
    const fresh = read.filter(
      (r) => !known.some((k) => k.driveId === r.look.driveId && k.itemId === r.look.itemId),
    );
    if ((had?.n ?? 0) + fresh.length > MAX_FILES) {
      throw new ApiError(422, 'connector_too_many_files', { max: MAX_FILES });
    }
    for (const r of read) {
      const values = {
        name: r.look.name,
        contentTag: r.look.tag,
        size: r.look.size,
        sheets: r.sheets,
        problem: null,
        checkedAt: now,
      };
      const [row] = await tx
        .insert(connectedFiles)
        .values({
          tenantId,
          connectionId: conn.id,
          driveId: r.look.driveId,
          itemId: r.look.itemId,
          pickedBy: by,
          pickedAt: now,
          changedAt: now,
          ...values,
        })
        .onConflictDoUpdate({
          target: [connectedFiles.tenantId, connectedFiles.driveId, connectedFiles.itemId],
          set: { ...values, updatedAt: now },
        })
        .returning();
      if (!row) throw new Error('upsert returned nothing');
      await audit(tx, {
        tenantId,
        actor,
        action: 'connected_file.pick',
        objectType: 'connected_file',
        objectId: row.id,
        after: { name: row.name, sheets: r.sheets },
      });
    }
  });
  return read.length;
}

/** « Choisir des fichiers »: what OneDrive's picker returned. */
export async function pickFiles(
  deps: ConnectorDeps,
  tenant: TenantRow,
  principal: Principal,
  picked: z.infer<typeof PickBody>['files'],
) {
  const conn = await activeConnection(deps, tenant.id);
  await recordPicked(deps, tenant.id, conn, who(principal), picked);
  return connectorView(deps, tenant);
}

async function fileOf(
  deps: ConnectorDeps,
  tenantId: string,
  fileId: string,
  provider: ConnectionProvider,
) {
  const [row] = await deps.db
    .select({ file: connectedFiles })
    .from(connectedFiles)
    .innerJoin(connections, eq(connections.id, connectedFiles.connectionId))
    .where(
      and(
        eq(connectedFiles.tenantId, tenantId),
        eq(connectedFiles.id, fileId),
        eq(connections.provider, provider),
      ),
    );
  if (!row) throw new ApiError(404, 'connector_file_not_found');
  return row.file;
}

/** One sheet of a picked file, downloaded now: what the pane proposes and includes comes from it. */
async function fileSheet(
  deps: ConnectorDeps,
  tenantId: string,
  fileId: string,
  sheet: string,
  provider: ConnectionProvider,
) {
  const file = await fileOf(deps, tenantId, fileId, provider);
  const conn = await activeConnection(deps, tenantId, provider);
  const remote = remoteOf(deps, provider);
  let snapshot: SheetSnapshot | undefined;
  try {
    const access = await remote.access(conn);
    const look = await remote.look(access, file);
    snapshot = (await download(remote, access, look)).sheets.find((s) => s.sheet === sheet);
  } catch (e) {
    calm(e, 'file', provider);
  }
  if (!snapshot) throw new ApiError(404, 'connector_sheet_missing', { sheet });
  return { file, snapshot };
}

/** What a sheet of a picked file holds (src/sources.ts detectSource), before « Inclure ». */
export async function detectFileSheet(
  deps: ApiDeps,
  tenant: TenantRow,
  fileId: string,
  sheet: string,
  signal?: AbortSignal,
  provider: ConnectionProvider = 'microsoft',
) {
  const { file, snapshot } = await fileSheet(deps, tenant.id, fileId, sheet, provider);
  const detection = await detectSource(deps, tenant, file.id, snapshot, signal);
  // The pane has no copy of the sheet: the rows its column pickers name come with the proposal.
  return { ...detection, sample: { sheet: snapshot.sheet, rows: snapshot.rows.slice(0, 50) } };
}

/** « Inclure cette feuille » for a picked file: the API reads the sheet itself, now and on change. */
export async function includeFileSheet(
  deps: ApiDeps,
  tenant: TenantRow,
  principal: Principal,
  fileId: string,
  layout: Parameters<typeof includeSource>[4]['layout'],
  provider: ConnectionProvider = 'microsoft',
) {
  const { file, snapshot } = await fileSheet(deps, tenant.id, fileId, layout.sheet, provider);
  return includeSource(deps, tenant, principal, file.id, { layout, snapshot }, { fileId: file.id });
}

/** A sheet of a picked file taken out (src/sources.ts removeSource), once the file is the provider's. */
export async function ownFile(
  deps: ConnectorDeps,
  tenant: TenantRow,
  fileId: string,
  provider: ConnectionProvider,
) {
  return (await fileOf(deps, tenant.id, fileId, provider)).id;
}

/** « Retirer le fichier »: it is no longer read; what its sheets gave leaves the registry. */
export async function removeFile(
  deps: ConnectorDeps,
  tenant: TenantRow,
  fileId: string,
  provider: ConnectionProvider = 'microsoft',
) {
  const file = await fileOf(deps, tenant.id, fileId, provider);
  await deps.db.transaction(async (tx) => {
    await tx.delete(connectedFiles).where(eq(connectedFiles.id, file.id));
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'connected_file.remove',
      objectType: 'connected_file',
      objectId: file.id,
      before: { name: file.name, sheets: file.sheets },
    });
  });
  await deps.jobs.enqueueRegistry(tenant.id);
  return viewOf(deps, tenant, provider);
}

/** Change notifications started or renewed: the background did it, the audit log says until when. */
function auditWatch(
  tx: Tx,
  conn: ConnectionRow,
  action: 'connection.watch' | 'connection.renew',
  until: Date,
) {
  return audit(tx, {
    tenantId: conn.tenantId,
    actor: ACTOR[conn.provider],
    action,
    objectType: 'connection',
    objectId: conn.id,
    after: { until: until.toISOString() },
  });
}

/**
 * Keeps change notifications on a personal OneDrive's root: created when there are none, renewed a
 * day before they end. A failure leaves the connection polled; the next check tries again.
 */
async function watch(
  deps: ConnectorDeps,
  conn: ConnectionRow,
  access: string,
  log?: (message: string) => void,
) {
  const ms = microsoftOf(deps);
  if (!ms.notificationUrl || conn.accountKind !== 'personal') return;
  const now = deps.now();
  const expiresAt = new Date(+now + SUBSCRIPTION_MS);
  const ends = conn.subscriptionExpiresAt;
  if (conn.subscriptionId && ends && +ends - +now > RENEW_BEFORE_MS) return;
  try {
    if (conn.subscriptionId && ends && ends > now) {
      try {
        const renewed = await ms.client.renew(access, conn.subscriptionId, expiresAt);
        const until = new Date(renewed.expirationDateTime);
        await deps.db.transaction(async (tx) => {
          await tx
            .update(connections)
            .set({ subscriptionExpiresAt: until, updatedAt: now })
            .where(eq(connections.id, conn.id));
          await auditWatch(tx, conn, 'connection.renew', until);
        });
        return;
      } catch (e) {
        // Gone at Graph: a new one below.
        if (!(e instanceof MicrosoftError && e.kind === 'missing')) throw e;
      }
    }
    const clientState = randomBytes(32).toString('base64url');
    const created = await ms.client.subscribe(access, {
      notificationUrl: ms.notificationUrl,
      clientState,
      expiresAt,
    });
    const until = new Date(created.expirationDateTime);
    await deps.db.transaction(async (tx) => {
      await tx
        .update(connections)
        .set({
          subscriptionId: created.id,
          subscriptionExpiresAt: until,
          clientStateHash: sha256(clientState),
          updatedAt: now,
        })
        .where(eq(connections.id, conn.id));
      await auditWatch(tx, conn, 'connection.watch', until);
    });
  } catch (e) {
    log?.(`microsoft: no change notifications for ${conn.id}, polled instead: ${String(e)}`);
  }
}

/**
 * Keeps a Google channel on the account's changes (docs/GOOGLE.md §4): a channel cannot be renewed, so
 * a new one replaces it a day before it ends, and the old one is stopped. A failure leaves the
 * connection polled; the next check tries again.
 */
async function watchGoogle(
  deps: ConnectorDeps,
  conn: ConnectionRow,
  access: string,
  log?: (message: string) => void,
) {
  const g = googleOf(deps);
  if (!g.notificationUrl) return;
  const now = deps.now();
  const ends = conn.subscriptionExpiresAt;
  if (conn.subscriptionId && ends && +ends - +now > RENEW_BEFORE_MS) return;
  try {
    const secret = randomBytes(32).toString('base64url');
    const channel = await g.client.watch(access, {
      id: randomUUID(),
      address: g.notificationUrl,
      token: secret,
      expiresAt: new Date(+now + CHANNEL_MS),
      pageToken: await g.client.startPageToken(access),
    });
    await deps.db.transaction(async (tx) => {
      await tx
        .update(connections)
        .set({
          subscriptionId: channel.id,
          subscriptionResource: channel.resourceId,
          subscriptionExpiresAt: channel.expiresAt,
          clientStateHash: sha256(secret),
          updatedAt: now,
        })
        .where(eq(connections.id, conn.id));
      await auditWatch(
        tx,
        conn,
        conn.subscriptionId ? 'connection.renew' : 'connection.watch',
        channel.expiresAt,
      );
    });
    if (conn.subscriptionId && conn.subscriptionResource && ends && ends > now) {
      await g.client
        .stop(access, { id: conn.subscriptionId, resourceId: conn.subscriptionResource })
        .catch((e: unknown) => log?.(`google: old channel not stopped: ${String(e)}`));
    }
  } catch (e) {
    log?.(`google: no change notifications for ${conn.id}, polled instead: ${String(e)}`);
  }
}

async function setProblem(
  deps: ConnectorDeps,
  file: ConnectedFileRow,
  problem: FileProblem | null,
  actor: string,
  extra: Partial<typeof connectedFiles.$inferInsert> = {},
) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    await tx
      .update(connectedFiles)
      .set({ problem, checkedAt: now, updatedAt: now, ...extra })
      .where(eq(connectedFiles.id, file.id));
    if (problem !== file.problem) {
      await audit(tx, {
        tenantId: file.tenantId,
        actor,
        action: 'connected_file.problem',
        objectType: 'connected_file',
        objectId: file.id,
        before: { problem: file.problem },
        after: { problem },
      });
    }
  });
}

const PROBLEM_OF: Partial<Record<DriveError['kind'], FileProblem>> = {
  missing: 'missing',
  forbidden: 'forbidden',
  too_large: 'too_large',
};

/** One file: the same content tag, nothing is downloaded; else its included sheets are read again. */
async function checkFile(
  deps: ConnectorDeps,
  remote: Remote,
  actor: string,
  file: ConnectedFileRow,
  access: string,
): Promise<boolean> {
  let look: Look;
  let read: Awaited<ReturnType<typeof download>>;
  try {
    look = await remote.look(access, file);
    if (look.tag !== null && look.tag === file.contentTag && file.problem === null) {
      await deps.db
        .update(connectedFiles)
        .set({ name: look.name, checkedAt: deps.now() })
        .where(eq(connectedFiles.id, file.id));
      return false;
    }
    read = await download(remote, access, look);
  } catch (e) {
    const problem =
      e instanceof SheetFileError
        ? e.reason
        : e instanceof DriveError
          ? PROBLEM_OF[e.kind]
          : undefined;
    if (!problem) throw e;
    await setProblem(deps, file, problem, actor);
    return false;
  }
  const included = await deps.db.select().from(sources).where(eq(sources.fileId, file.id));
  for (const source of included) {
    const snapshot = read.sheets.find((s) => s.sheet === source.sheet);
    // A renamed or deleted sheet: what it gave stays, the pane says the sheet is gone.
    if (snapshot) await readSource(deps, file.tenantId, source, snapshot, actor);
  }
  await setProblem(deps, file, null, actor, {
    name: look.name,
    contentTag: look.tag,
    size: look.size,
    sheets: read.sheets.map((s) => s.sheet),
    changedAt: deps.now(),
  });
  return true;
}

/** The provider is offered by this deployment. */
const offered = (deps: Pick<ApiDeps, 'microsoft' | 'google'>, provider: ConnectionProvider) =>
  provider === 'google' ? Boolean(deps.google) : Boolean(deps.microsoft);

/**
 * The `connector.check` job: a fresh token, each picked file checked, notifications kept alive.
 * The provider refusing the token stops everything until the person reconnects; asking to wait stops
 * the check until then; a network failure on one file leaves it for the next check.
 */
export async function checkConnection(
  deps: ConnectorDeps,
  connectionId: string,
  log?: (message: string) => void,
): Promise<{ read: number } | null> {
  const [conn] = await deps.db.select().from(connections).where(eq(connections.id, connectionId));
  const now = deps.now();
  if (!conn || !offered(deps, conn.provider)) return null;
  if (conn.status !== 'active' || (conn.waitUntil && conn.waitUntil > now)) return null;
  const remote = remoteOf(deps, conn.provider);
  const actor = ACTOR[conn.provider];
  let readCount = 0;
  try {
    const access = await remote.access(conn);
    const files = await deps.db
      .select()
      .from(connectedFiles)
      .where(eq(connectedFiles.connectionId, conn.id));
    for (const file of files) {
      try {
        if (await checkFile(deps, remote, actor, file, access)) readCount++;
      } catch (e) {
        if (!(e instanceof DriveError && e.kind === 'unavailable')) throw e;
        log?.(`${conn.provider}: ${file.id} not checked: ${e.message}`);
      }
    }
    await remote.watch(conn, access, log);
  } catch (e) {
    if (!(e instanceof DriveError)) throw e;
    await stopped(deps, conn, e, log);
    return { read: readCount };
  }
  await deps.db
    .update(connections)
    .set({ checkedAt: deps.now(), waitUntil: null, updatedAt: deps.now() })
    .where(eq(connections.id, conn.id));
  return { read: readCount };
}

async function stopped(
  deps: ConnectorDeps,
  conn: ConnectionRow,
  e: DriveError,
  log?: (message: string) => void,
) {
  const now = deps.now();
  if (e.kind === 'throttled') {
    await deps.db
      .update(connections)
      .set({ waitUntil: new Date(+now + (e.retryAfter ?? 30) * 1000), updatedAt: now })
      .where(eq(connections.id, conn.id));
    return;
  }
  if (e.kind !== 'reconnect') {
    log?.(`${conn.provider}: check of ${conn.id} stopped: ${e.message}`);
    return;
  }
  await deps.db.transaction(async (tx) => {
    await tx
      .update(connections)
      .set({ status: 'reconnect', updatedAt: now })
      .where(eq(connections.id, conn.id));
    await audit(tx, {
      tenantId: conn.tenantId,
      actor: ACTOR[conn.provider],
      action: 'connection.refused',
      objectType: 'connection',
      objectId: conn.id,
      after: { status: 'reconnect', reason: e.message },
    });
  });
}

/**
 * Connections due a check (the sweep, src/workers.ts): notified ones hourly, the others often; only
 * those of a provider this deployment offers.
 */
export async function connectorsBehind(
  db: Db,
  now: Date,
  /** Absent: every provider. */
  offeredBy?: Pick<ApiDeps, 'microsoft' | 'google'>,
): Promise<string[]> {
  const rows = await db.select().from(connections).where(eq(connections.status, 'active'));
  return rows
    .filter((c) => {
      if (offeredBy && !offered(offeredBy, c.provider)) return false;
      if (c.waitUntil && c.waitUntil > now) return false;
      const every = notifiedNow(c, now) ? WATCHED_POLL_EVERY_MS : POLL_EVERY_MS;
      return !c.checkedAt || +now - +c.checkedAt >= every;
    })
    .map((c) => c.id);
}

/** Learn (change notifications): what Graph posts, without any data about the change. */
export const MicrosoftNotifications = z.object({
  value: z
    .array(
      z.object({
        subscriptionId: z.string().min(1).max(256),
        clientState: z.string().max(256).nullish(),
      }),
    )
    .max(1_000),
});

/**
 * A notification only says « something in this OneDrive changed »: the check asks what. One whose
 * secret does not match ours is not from our subscription and is ignored.
 */
export async function notified(
  deps: { db: Db; jobs: Pick<Jobs, 'enqueueConnector'> },
  notifications: z.infer<typeof MicrosoftNotifications>,
) {
  const ids = [...new Set(notifications.value.map((n) => n.subscriptionId))];
  if (!ids.length) return 0;
  const rows = await deps.db
    .select()
    .from(connections)
    .where(and(inArray(connections.subscriptionId, ids), eq(connections.provider, 'microsoft')));
  const due = rows.filter(
    (c) =>
      c.status === 'active' &&
      notifications.value.some(
        (n) =>
          n.subscriptionId === c.subscriptionId &&
          n.clientState != null &&
          sha256(n.clientState) === c.clientStateHash,
      ),
  );
  for (const c of due) await deps.jobs.enqueueConnector(c.id);
  return due.length;
}

/**
 * Google's notification (docs/GOOGLE.md §4): headers only, nothing about the change. `sync` follows
 * the channel's creation and is ignored; any other state from our channel with our secret queues the
 * connection's check.
 */
export async function googleNotified(
  deps: { db: Db; jobs: Pick<Jobs, 'enqueueConnector'> },
  input: { channelId: string | undefined; token: string | undefined; state: string | undefined },
) {
  if (!input.channelId || !input.token || input.state === 'sync') return 0;
  const [conn] = await deps.db
    .select()
    .from(connections)
    .where(
      and(eq(connections.subscriptionId, input.channelId), eq(connections.provider, 'google')),
    );
  if (conn?.status !== 'active' || sha256(input.token) !== conn.clientStateHash) return 0;
  await deps.jobs.enqueueConnector(conn.id);
  return 1;
}

// ── Google's one window (R5, docs/GOOGLE.md §1) ────────────────────────────────────────────────────
//
// The pane asks for a ticket (`start`) and opens `/connectors/google/begin?ticket=…` in a browser: the
// API keeps the ticket in a cookie of its own address and sends the browser to Google, which signs the
// person in, asks consent and shows its picker, then comes back to `/connectors/google/callback` with
// the code and the picked ids. The cookie says which company and person it is for: no token ever
// reaches the pane, and a callback without the cookie of the window that started it is refused.

/** A ticket lives 15 minutes: time to sign in and pick. */
const TICKET_MS = 15 * 60_000;
export const GOOGLE_COOKIE = 'fi_google';

const Ticket = z.object({
  /** The company. */
  t: z.uuid(),
  /** Who started it (user id or « key »). */
  w: z.string().min(1).max(64),
  /** Nonce, sent to Google as `state`. */
  n: z.string().min(16).max(64),
  /** Ends at (ms). */
  e: z.number().int(),
});
type Ticket = z.infer<typeof Ticket>;

const ticketMac = (key: string, body: string) =>
  createHmac('sha256', Buffer.from(key, 'base64')).update(`google-window:${body}`).digest();

function signTicket(g: GoogleConnector, ticket: Ticket) {
  const body = Buffer.from(JSON.stringify(ticket)).toString('base64url');
  return `${body}.${ticketMac(g.sealingKey, body).toString('base64url')}`;
}

/** The ticket, if ours and still valid. */
export function readTicket(g: GoogleConnector, value: string | undefined, now: Date) {
  const [body, mac] = (value ?? '').split('.');
  if (!body || !mac) return null;
  const given = Buffer.from(mac, 'base64url');
  const expected = ticketMac(g.sealingKey, body);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const ticket = Ticket.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
    return ticket.e > +now ? ticket : null;
  } catch {
    return null;
  }
}

/** « Ajouter des fichiers Google Drive »: the address the pane opens in a browser. */
export function googleStart(deps: ConnectorDeps, tenant: TenantRow, principal: Principal) {
  const g = googleOf(deps);
  const ticket = signTicket(g, {
    t: tenant.id,
    w: who(principal),
    n: randomBytes(18).toString('base64url'),
    e: +deps.now() + TICKET_MS,
  });
  const begin = new URL('/connectors/google/begin', g.redirectUrl);
  begin.searchParams.set('ticket', ticket);
  return { url: begin.toString() };
}

/** The browser arrives with the ticket: it is kept in a cookie, and the browser sent on to Google. */
export function googleBegin(deps: ConnectorDeps, ticketValue: string | undefined) {
  const g = googleOf(deps);
  const ticket = readTicket(g, ticketValue, deps.now());
  if (!ticket || !ticketValue) return null;
  return {
    cookie: ticketValue,
    secure: g.redirectUrl.startsWith('https://'),
    location: g.client.authorizeUrl({ redirectUri: g.redirectUrl, state: ticket.n }),
  };
}

/** What the callback page says. */
export type GoogleOutcome =
  | { done: true; account: string; picked: number }
  | {
      done: false;
      reason: 'expired' | 'cancelled' | 'other_account' | 'refused' | 'file' | 'unavailable';
      account?: string;
      /** The calm message of what went wrong with a file (fr.json api.error.connector_*). */
      message?: string;
    };

const CallbackQuery = z.object({
  code: z.string().min(1).max(2048).optional(),
  picked_file_ids: z.string().max(8192).optional(),
  state: z.string().max(256).optional(),
  error: z.string().max(256).optional(),
});

/**
 * Google comes back: the window's ticket checked against `state`, the code exchanged, the account
 * connected (the same one again renews it; another one waits for « Déconnecter »), then the picked
 * files read and recorded. Each step audited; the page tells the person what happened.
 */
export async function googleCallback(
  deps: ConnectorDeps,
  cookie: string | undefined,
  query: Record<string, string>,
  log?: (message: string) => void,
): Promise<GoogleOutcome> {
  const g = googleOf(deps);
  const ticket = readTicket(g, cookie, deps.now());
  const q = CallbackQuery.safeParse(query);
  // TODO(verify) docs/GOOGLE.md §6.1: `state` comes back on the one-window flow.
  if (!ticket || !q.success || q.data.state !== ticket.n) return { done: false, reason: 'expired' };
  if (q.data.error || !q.data.code) return { done: false, reason: 'cancelled' };
  const [tenant] = await deps.db.select().from(tenants).where(eq(tenants.id, ticket.t));
  if (!tenant || tenant.deletedAt) return { done: false, reason: 'expired' };

  let exchanged: Awaited<ReturnType<GoogleClient['exchange']>>;
  let account: Awaited<ReturnType<GoogleClient['about']>>;
  try {
    exchanged = await g.client.exchange(q.data.code, g.redirectUrl);
    account = await g.client.about(exchanged.accessToken);
  } catch (e) {
    log?.(`google: callback: ${String(e)}`);
    return {
      done: false,
      reason: e instanceof DriveError && e.kind === 'reconnect' ? 'refused' : 'unavailable',
    };
  }
  const before = await connectionOf(deps.db, tenant.id, 'google');
  if (before && before.accountId !== account.id) {
    return { done: false, reason: 'other_account', account: before.label };
  }
  // With `prompt=consent` Google sends a refresh token each time; without one the stored token stays.
  const refreshToken = exchanged.refreshToken
    ? sealSecret(exchanged.refreshToken, g.sealingKey)
    : before?.refreshToken;
  if (!refreshToken) return { done: false, reason: 'unavailable' };
  const conn = await saveConnection(
    deps,
    tenant.id,
    'google',
    {
      accountId: account.id,
      label: account.label,
      accountKind: account.accountKind,
      directory: 'google',
      driveUrl: null,
      refreshToken,
      status: 'active',
      connectedBy: ticket.w,
      connectedAt: before?.connectedAt ?? deps.now(),
      waitUntil: null,
    },
    Boolean(before),
  );
  await watchGoogle(deps, conn, exchanged.accessToken, log);
  if (before?.status === 'reconnect') await deps.jobs.enqueueConnector(conn.id);

  const ids = [...new Set((q.data.picked_file_ids ?? '').split(',').filter(Boolean))];
  if (!ids.length) return { done: true, account: account.label, picked: 0 };
  try {
    const picked = await recordPicked(
      deps,
      tenant.id,
      conn,
      ticket.w,
      ids.map((itemId) => ({ driveId: GOOGLE_DRIVE, itemId })),
    );
    return { done: true, account: account.label, picked };
  } catch (e) {
    if (!(e instanceof ApiError)) throw e;
    log?.(`google: picked files not read: ${e.code} ${e.details ?? ''}`);
    return { done: false, reason: 'file', account: account.label, message: e.body.error.message };
  }
}
