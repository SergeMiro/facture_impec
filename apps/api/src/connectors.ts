// Files the API reads without Excel (R4, docs/MICROSOFT365.md): the company connects one Microsoft
// account from the pane, picks the workbooks to follow, and includes their sheets as it would the open
// workbook's (src/sources.ts). Only picked files are ever read. A check compares each file's content
// tag with Graph and downloads only what changed; a personal OneDrive also tells us through change
// notifications, a work one is polled (its subscriptions need Files.Read.All, which we do not ask).
// Disconnecting deletes the account's token, its files and everything read from them.
import { randomBytes } from 'node:crypto';
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
} from '@fi/db';
import { z } from 'zod';
import { type Principal, who } from './auth';
import type { ApiDeps, Jobs } from './deps';
import { ApiError } from './errors';
import { type DriveItem, type MicrosoftClient, MicrosoftError } from './microsoft';
import { detectSource, includeSource, readSource, sourceView } from './sources';

/** The connector this deployment offers (runtime.ts microsoftFromEnv). */
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

type ConnectorDeps = Pick<ApiDeps, 'db' | 'jobs' | 'now' | 'microsoft'>;

/** Actor of what a check does without anybody in the pane. */
export const CONNECTOR_ACTOR = 'connector:microsoft';
/** A company follows at most this many files (more: docs/DEFERRED.md). */
export const MAX_FILES = 20;
/** A file without change notifications is checked this often… */
export const POLL_EVERY_MS = 2 * 60_000;
/** …and one with them, in case a notification is lost. */
export const WATCHED_POLL_EVERY_MS = 60 * 60_000;
/** Learn allows 42 300 minutes; a short one dies quickly with a connection nobody renews. */
const SUBSCRIPTION_MS = 3 * 24 * 3_600_000;
const RENEW_BEFORE_MS = 24 * 3_600_000;

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

function connector(deps: Pick<ApiDeps, 'microsoft'>): MicrosoftConnector {
  if (!deps.microsoft) throw new ApiError(503, 'connector_disabled');
  return deps.microsoft;
}

/** What the person is told when Microsoft or the file says no. */
function calm(e: unknown, during: 'connect' | 'file'): never {
  if (e instanceof SheetFileError) {
    throw new ApiError(422, `connector_file_${e.reason}`, undefined, e.message);
  }
  if (!(e instanceof MicrosoftError)) throw e;
  switch (e.kind) {
    case 'reconnect':
      // Not 401: the pane reads that as its own session ending and signs the person out.
      throw during === 'connect'
        ? new ApiError(409, 'connector_sign_in', undefined, e.message)
        : new ApiError(409, 'connector_reconnect', undefined, e.message);
    case 'throttled':
      throw new ApiError(503, 'connector_busy', undefined, e.message);
    case 'missing':
      throw new ApiError(404, 'connector_file_missing', undefined, e.message);
    case 'forbidden':
      throw new ApiError(403, 'connector_file_forbidden', undefined, e.message);
    case 'too_large':
      throw new ApiError(422, 'connector_file_too_large', undefined, e.message);
    default:
      throw new ApiError(502, 'connector_unavailable', undefined, e.message);
  }
}

async function connectionOf(db: Db, tenantId: string) {
  const [row] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.tenantId, tenantId), eq(connections.provider, 'microsoft')));
  return row;
}

/** A Graph token for the connection; the refresh token it came with replaces the stored one. */
async function accessFor(deps: ConnectorDeps, conn: ConnectionRow) {
  const ms = connector(deps);
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
  const now = deps.now();
  return {
    microsoft: ms ? { clientId: ms.clientId, scope: apiScope(ms.clientId) } : null,
    mailOnMicrosoft: false,
    connection: {
      label: conn.label,
      accountKind: conn.accountKind,
      status: conn.status,
      picker: pickerFor(conn.accountKind, conn.driveUrl),
      /** Change notifications reach us: a change shows within minutes, else at the next poll. */
      notified: conn.subscriptionId !== null && (conn.subscriptionExpiresAt ?? now) > now,
      connectedAt: conn.connectedAt.toISOString(),
      checkedAt: conn.checkedAt?.toISOString() ?? null,
      files: files.map((f) => {
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
      }),
    },
  };
}

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
  const ms = connector(deps);
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
    throw new ApiError(409, 'connector_other_account', { account: before.label });
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
  const conn = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(connections)
      .values({ tenantId: tenant.id, provider: 'microsoft', ...values })
      .onConflictDoUpdate({
        target: [connections.tenantId, connections.provider],
        set: { ...values, updatedAt: now },
      })
      .returning();
    if (!row) throw new Error('upsert returned nothing');
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: before ? 'connection.reconnect' : 'connection.connect',
      objectType: 'connection',
      objectId: row.id,
      after: { provider: 'microsoft', account: row.label, accountKind: row.accountKind },
    });
    return row;
  });
  await watch(deps, conn, exchanged.accessToken, log);
  // A reconnect reads again what changed while the token was refused.
  if (before) await deps.jobs.enqueueConnector(conn.id);
  return connectorView(deps, tenant);
}

/**
 * Asks Graph to stop notifying us. Best effort: an unrenewed subscription ends by itself within
 * SUBSCRIPTION_MS, and nothing it sends then finds a connection.
 */
export async function unwatch(
  deps: ConnectorDeps,
  tenantId: string,
  log?: (message: string) => void,
) {
  const conn = await connectionOf(deps.db, tenantId);
  if (!conn?.subscriptionId || conn.status !== 'active' || !deps.microsoft) return;
  try {
    await deps.microsoft.client.unsubscribe(await accessFor(deps, conn), conn.subscriptionId);
  } catch (e) {
    log?.(`microsoft: subscription not deleted: ${String(e)}`);
  }
}

/** « Déconnecter OneDrive »: our copy of the token, the files and what was read from them go. */
export async function disconnect(
  deps: ConnectorDeps,
  tenant: TenantRow,
  log?: (message: string) => void,
) {
  const conn = await connectionOf(deps.db, tenant.id);
  if (!conn) throw new ApiError(404, 'connector_not_connected');
  await unwatch(deps, tenant.id, log);
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
      before: { provider: 'microsoft', account: conn.label, files: files.map((f) => f.name) },
    });
  });
  await deps.jobs.enqueueRegistry(tenant.id);
  return connectorView(deps, tenant);
}

async function activeConnection(deps: ConnectorDeps, tenantId: string) {
  connector(deps);
  const conn = await connectionOf(deps.db, tenantId);
  if (!conn) throw new ApiError(404, 'connector_not_connected');
  if (conn.status === 'reconnect') throw new ApiError(409, 'connector_reconnect');
  return conn;
}

/** Graph's content tag: it changes with the content only (Learn: driveItem cTag). */
const tagOf = (item: DriveItem) => item.cTag ?? item.eTag ?? null;

/** A picked file downloaded and read; nothing is kept but what its included sheets give. */
async function download(deps: ConnectorDeps, access: string, item: DriveItem, driveId: string) {
  if (!fileFormat(item.name) || !item.file) throw new SheetFileError('unsupported', item.name);
  if ((item.size ?? 0) > FILE_LIMITS.maxBytes) throw new SheetFileError('too_large', item.name);
  const bytes = await connector(deps).client.content(
    access,
    driveId,
    item.id,
    FILE_LIMITS.maxBytes,
  );
  return readSheetFile(bytes, item.name);
}

/** « Choisir des fichiers »: what the picker returned. All are read first; one fails, none is kept. */
export async function pickFiles(
  deps: ConnectorDeps,
  tenant: TenantRow,
  principal: Principal,
  picked: z.infer<typeof PickBody>['files'],
) {
  const ms = connector(deps);
  const conn = await activeConnection(deps, tenant.id);
  const [had] = await deps.db
    .select({ n: count() })
    .from(connectedFiles)
    .where(eq(connectedFiles.connectionId, conn.id));
  const read: { driveId: string; item: DriveItem; sheets: string[] }[] = [];
  try {
    const access = await accessFor(deps, conn);
    for (const p of picked) {
      const item = await ms.client.item(access, p.driveId, p.itemId);
      const driveId = item.parentReference?.driveId ?? p.driveId;
      const file = await download(deps, access, item, driveId);
      read.push({ driveId, item, sheets: file.sheets.map((s) => s.sheet) });
    }
  } catch (e) {
    calm(e, 'file');
  }
  const now = deps.now();
  const by = who(principal);
  await deps.db.transaction(async (tx) => {
    const known = await tx
      .select({ itemId: connectedFiles.itemId, driveId: connectedFiles.driveId })
      .from(connectedFiles)
      .where(eq(connectedFiles.connectionId, conn.id));
    const fresh = read.filter(
      (r) => !known.some((k) => k.driveId === r.driveId && k.itemId === r.item.id),
    );
    if ((had?.n ?? 0) + fresh.length > MAX_FILES) {
      throw new ApiError(422, 'connector_too_many_files', { max: MAX_FILES });
    }
    for (const r of read) {
      const values = {
        name: r.item.name,
        contentTag: tagOf(r.item),
        size: r.item.size ?? null,
        sheets: r.sheets,
        problem: null,
        checkedAt: now,
      };
      const [row] = await tx
        .insert(connectedFiles)
        .values({
          tenantId: tenant.id,
          connectionId: conn.id,
          driveId: r.driveId,
          itemId: r.item.id,
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
        tenantId: tenant.id,
        actor: 'user',
        action: 'connected_file.pick',
        objectType: 'connected_file',
        objectId: row.id,
        after: { name: row.name, sheets: r.sheets },
      });
    }
  });
  return connectorView(deps, tenant);
}

async function fileOf(deps: ConnectorDeps, tenantId: string, fileId: string) {
  const [file] = await deps.db
    .select()
    .from(connectedFiles)
    .where(and(eq(connectedFiles.tenantId, tenantId), eq(connectedFiles.id, fileId)));
  if (!file) throw new ApiError(404, 'connector_file_not_found');
  return file;
}

/** One sheet of a picked file, downloaded now: what the pane proposes and includes comes from it. */
async function fileSheet(deps: ConnectorDeps, tenantId: string, fileId: string, sheet: string) {
  const ms = connector(deps);
  const file = await fileOf(deps, tenantId, fileId);
  const conn = await activeConnection(deps, tenantId);
  let snapshot: SheetSnapshot | undefined;
  try {
    const access = await accessFor(deps, conn);
    const item = await ms.client.item(access, file.driveId, file.itemId);
    snapshot = (await download(deps, access, item, file.driveId)).sheets.find(
      (s) => s.sheet === sheet,
    );
  } catch (e) {
    calm(e, 'file');
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
) {
  const { file, snapshot } = await fileSheet(deps, tenant.id, fileId, sheet);
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
) {
  const { file, snapshot } = await fileSheet(deps, tenant.id, fileId, layout.sheet);
  return includeSource(deps, tenant, principal, file.id, { layout, snapshot }, file.id);
}

/** « Retirer le fichier »: it is no longer read; what its sheets gave leaves the registry. */
export async function removeFile(deps: ConnectorDeps, tenant: TenantRow, fileId: string) {
  const file = await fileOf(deps, tenant.id, fileId);
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
  return connectorView(deps, tenant);
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
    actor: CONNECTOR_ACTOR,
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
  const ms = connector(deps);
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

async function setProblem(
  deps: ConnectorDeps,
  file: ConnectedFileRow,
  problem: FileProblem | null,
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
        actor: CONNECTOR_ACTOR,
        action: 'connected_file.problem',
        objectType: 'connected_file',
        objectId: file.id,
        before: { problem: file.problem },
        after: { problem },
      });
    }
  });
}

const PROBLEM_OF: Partial<Record<MicrosoftError['kind'], FileProblem>> = {
  missing: 'missing',
  forbidden: 'forbidden',
  too_large: 'too_large',
};

/** One file: the same content tag, nothing is downloaded; else its included sheets are read again. */
async function checkFile(
  deps: ConnectorDeps,
  file: ConnectedFileRow,
  access: string,
): Promise<boolean> {
  const ms = connector(deps);
  let item: DriveItem;
  let read: Awaited<ReturnType<typeof download>>;
  try {
    item = await ms.client.item(access, file.driveId, file.itemId);
    const tag = tagOf(item);
    if (tag !== null && tag === file.contentTag && file.problem === null) {
      await deps.db
        .update(connectedFiles)
        .set({ name: item.name, checkedAt: deps.now() })
        .where(eq(connectedFiles.id, file.id));
      return false;
    }
    read = await download(deps, access, item, file.driveId);
  } catch (e) {
    const problem =
      e instanceof SheetFileError
        ? e.reason
        : e instanceof MicrosoftError
          ? PROBLEM_OF[e.kind]
          : undefined;
    if (!problem) throw e;
    await setProblem(deps, file, problem);
    return false;
  }
  const included = await deps.db.select().from(sources).where(eq(sources.fileId, file.id));
  for (const source of included) {
    const snapshot = read.sheets.find((s) => s.sheet === source.sheet);
    // A renamed or deleted sheet: what it gave stays, the pane says the sheet is gone.
    if (snapshot) await readSource(deps, file.tenantId, source, snapshot, CONNECTOR_ACTOR);
  }
  await setProblem(deps, file, null, {
    name: item.name,
    contentTag: tagOf(item),
    size: item.size ?? null,
    sheets: read.sheets.map((s) => s.sheet),
    changedAt: deps.now(),
  });
  return true;
}

/**
 * The `connector.check` job: a fresh token, each picked file checked, notifications kept alive.
 * Microsoft refusing the token stops everything until the person reconnects; asking to wait stops
 * the check until then; a network failure on one file leaves it for the next check.
 */
export async function checkConnection(
  deps: ConnectorDeps,
  connectionId: string,
  log?: (message: string) => void,
): Promise<{ read: number } | null> {
  if (!deps.microsoft) return null;
  const [conn] = await deps.db.select().from(connections).where(eq(connections.id, connectionId));
  const now = deps.now();
  if (conn?.status !== 'active' || (conn.waitUntil && conn.waitUntil > now)) return null;
  let readCount = 0;
  try {
    const access = await accessFor(deps, conn);
    const files = await deps.db
      .select()
      .from(connectedFiles)
      .where(eq(connectedFiles.connectionId, conn.id));
    for (const file of files) {
      try {
        if (await checkFile(deps, file, access)) readCount++;
      } catch (e) {
        if (!(e instanceof MicrosoftError && e.kind === 'unavailable')) throw e;
        log?.(`microsoft: ${file.id} not checked: ${e.message}`);
      }
    }
    await watch(deps, conn, access, log);
  } catch (e) {
    if (!(e instanceof MicrosoftError)) throw e;
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
  e: MicrosoftError,
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
    log?.(`microsoft: check of ${conn.id} stopped: ${e.message}`);
    return;
  }
  await deps.db.transaction(async (tx) => {
    await tx
      .update(connections)
      .set({ status: 'reconnect', updatedAt: now })
      .where(eq(connections.id, conn.id));
    await audit(tx, {
      tenantId: conn.tenantId,
      actor: CONNECTOR_ACTOR,
      action: 'connection.refused',
      objectType: 'connection',
      objectId: conn.id,
      after: { status: 'reconnect', reason: e.message },
    });
  });
}

/** Connections due a check (the sweep, src/workers.ts): notified ones hourly, the others often. */
export async function connectorsBehind(db: Db, now: Date): Promise<string[]> {
  const rows = await db.select().from(connections).where(eq(connections.status, 'active'));
  return rows
    .filter((c) => {
      if (c.waitUntil && c.waitUntil > now) return false;
      const notified = c.subscriptionId !== null && (c.subscriptionExpiresAt ?? now) > now;
      const every = notified ? WATCHED_POLL_EVERY_MS : POLL_EVERY_MS;
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
    .where(inArray(connections.subscriptionId, ids));
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
