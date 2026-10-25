// Telegram for the company's people, through the relay (memory M4, docs/RUNBOOK.md § Relay). Only a
// runner speaks to a relay (RELAY_URL needs VAULT_DIR). It registers with its licence and its key,
// then at start and every RELAY_POLL_SECONDS fetches what waited for it while it was off: a chat that
// sent its code (bound to the person who asked for the code in the pane), a button pressed (a
// one-time link, src/action-links.ts, decided as that person). Then it puts each request waiting for
// a decision in each bound person's chat, once per revision. Every request to the relay is signed by
// the runner's key; the relay keeps no business data.
import { randomBytes } from 'node:crypto';
import {
  actionLinks,
  and,
  asc,
  audit,
  type Db,
  eq,
  gt,
  inArray,
  isNull,
  or,
  sha256,
  type TenantRow,
  telegramChats,
  telegramCodes,
  tenants,
} from '@fi/db';
import { t } from '@fi/shared';
import {
  INBOX_PAGE,
  Inbox,
  type InboxItem,
  Registered,
  type RelayMessage,
  runnerKey,
  SIGNATURE_HEADER,
  signRequest,
} from '@fi/shared/relay';
import { decideByLink, LISTED, type LinkOutcome, telegramRequest } from './action-links';
import { listActions } from './actions';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';

/** A binding code serves this long: the person opens the link right after asking for it. */
export const CODE_MINUTES = 15;

/** The relay answered other than 2XX. */
export class RelayError extends Error {
  constructor(
    readonly status: number,
    what: string,
  ) {
    super(`relay: ${what} answered ${status}`);
  }
}

export interface RelayClient {
  /** Presents the licence with this runner's key; returns the bot's username. */
  register(): Promise<string>;
  /** A binding code, as its SHA-256, until it expires. */
  announce(hash: string, expiresAt: Date): Promise<void>;
  /** A message in a chat bound to this runner; RelayError 404 when it is not (any more). */
  send(message: RelayMessage): Promise<void>;
  inbox(): Promise<InboxItem[]>;
  ack(ids: string[]): Promise<void>;
}

export function relayClient(options: {
  /** RELAY_URL; a path in it only behind a proxy that strips it (the relay signs its own paths). */
  url: string;
  licence: string;
  /** RELAY_RUNNER_KEY. */
  key: string;
  now: () => Date;
  fetcher?: typeof fetch;
}): RelayClient {
  const key = runnerKey(options.key);
  const base = options.url.replace(/\/+$/, '');
  const fetcher = options.fetcher ?? fetch;
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> => {
    const text = body === undefined ? '' : JSON.stringify(body);
    const response = await fetcher(`${base}${path}`, {
      method,
      headers: {
        [SIGNATURE_HEADER]: signRequest(key, { method, path, body: text }, options.now()),
        ...(body !== undefined && { 'content-type': 'application/json' }),
      },
      ...(body !== undefined && { body: text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new RelayError(response.status, `${method} ${path}`);
    return response.json();
  };
  return {
    register: async () =>
      Registered.parse(await call('POST', '/runner/register', { licence: options.licence })).bot,
    announce: async (hash, expiresAt) => {
      await call('POST', '/runner/codes', { hash, expiresAt: expiresAt.toISOString() });
    },
    send: async (message) => {
      await call('POST', '/runner/messages', message);
    },
    inbox: async () => Inbox.parse(await call('GET', '/runner/inbox')).items,
    ack: async (ids) => {
      await call('POST', '/runner/inbox/ack', { ids });
    },
  };
}

export interface Telegram {
  /** The bot's username once the relay answered; null before (the pane offers no link yet). */
  bot(): string | null;
  /** A one-time link that binds the person's Telegram chat, minutes long. */
  link(tenant: Pick<TenantRow, 'id'>, userId: string): Promise<{ link: string; expiresAt: string }>;
  /** Handles what waited on the relay, then puts the waiting requests in the bound chats. */
  poll(): Promise<void>;
  close(): Promise<void>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function startTelegram(options: {
  deps: ApiDeps;
  client: RelayClient;
  /** RELAY_POLL_SECONDS, in milliseconds. */
  everyMs: number;
  log: (message: string) => void;
}): Telegram {
  const { deps, client, log } = options;
  const db = deps.db;
  let bot: string | null = null;

  /** Never throws: a reply that does not arrive changes nothing already decided. */
  const say = async (chatId: string, text: string) => {
    try {
      await client.send({ chatId, text });
    } catch (e) {
      log(`telegram: a reply was not delivered: ${message(e)}`);
    }
  };
  /** When the relay received it: a press made while the runner was off counts from then. */
  const receivedAt = (item: InboxItem) => {
    const at = new Date(item.at);
    return at < deps.now() ? at : deps.now();
  };

  async function bound(item: Extract<InboxItem, { kind: 'bound' }>) {
    const now = deps.now();
    const company = await db.transaction(async (tx) => {
      const [code] = await tx
        .update(telegramCodes)
        .set({ usedAt: now })
        .where(
          and(
            eq(telegramCodes.codeHash, sha256(item.code)),
            isNull(telegramCodes.usedAt),
            gt(telegramCodes.expiresAt, receivedAt(item)),
          ),
        )
        .returning();
      if (!code) return null;
      // One chat per person and one person per chat: an older binding of either ends here.
      await tx
        .update(telegramChats)
        .set({ revokedAt: now })
        .where(
          and(
            isNull(telegramChats.revokedAt),
            or(
              eq(telegramChats.chatId, item.chatId),
              and(eq(telegramChats.tenantId, code.tenantId), eq(telegramChats.userId, code.userId)),
            ),
          ),
        );
      await tx.insert(telegramChats).values({
        tenantId: code.tenantId,
        userId: code.userId,
        chatId: item.chatId,
        boundAt: now,
      });
      await audit(tx, {
        tenantId: code.tenantId,
        actor: `user:${code.userId}`,
        action: 'telegram.bind',
        objectType: 'user',
        objectId: code.userId,
        after: { chatId: item.chatId },
      });
      const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, code.tenantId));
      return tenant?.name ?? '';
    });
    await say(
      item.chatId,
      company === null ? t('telegram.bindExpired') : t('telegram.bound', { company }),
    );
  }

  async function pressed(item: Extract<InboxItem, { kind: 'press' }>) {
    const [chat] = await db
      .select()
      .from(telegramChats)
      .where(and(eq(telegramChats.chatId, item.chatId), isNull(telegramChats.revokedAt)));
    // A chat no longer bound to anyone here: its buttons decide nothing, and nothing is said to it.
    if (!chat) return;
    const outcome = await decideByLink(deps, item.data, {
      channel: 'telegram',
      userId: chat.userId,
      at: receivedAt(item),
    });
    if (outcome.kind !== 'decided') log(`telegram: a press decided nothing (${outcome.kind})`);
    await say(chat.chatId, replyTo(outcome));
  }

  /** Each request waiting for a decision, in each bound person's chat, once per revision. */
  async function notify() {
    const chats = await db
      .select({ chat: telegramChats, tenant: tenants })
      .from(telegramChats)
      .innerJoin(tenants, eq(tenants.id, telegramChats.tenantId))
      .where(and(isNull(telegramChats.revokedAt), isNull(tenants.deletedAt)))
      .orderBy(asc(telegramChats.boundAt), asc(telegramChats.id));
    for (const { chat, tenant } of chats) {
      const { actions: waiting } = await listActions(db, tenant, { test: false, status: 'draft' });
      if (waiting.length === 0) continue;
      const given = await db
        .select({ actionId: actionLinks.actionId, revision: actionLinks.revision })
        .from(actionLinks)
        .where(
          and(
            eq(actionLinks.userId, chat.userId),
            eq(actionLinks.channel, 'telegram'),
            inArray(
              actionLinks.actionId,
              waiting.map((a) => a.id),
            ),
          ),
        );
      const shown = new Set(given.map((g) => `${g.actionId}:${g.revision}`));
      const fresh = waiting.filter((a) => !shown.has(`${a.id}:${a.revision}`)).slice(0, LISTED);
      for (const action of fresh) {
        const request = await telegramRequest(db, tenant, chat.userId, action, deps.now());
        try {
          await client.send({ chatId: chat.chatId, text: request.text, buttons: request.buttons });
        } catch (e) {
          // Not shown: the links go, and the request is tried again at the next round.
          await db.delete(actionLinks).where(inArray(actionLinks.id, request.linkIds));
          if (e instanceof RelayError && e.status === 404) {
            await unbind(db, tenant, chat.userId, 'relay', deps.now());
          } else {
            // This chat only (a bot blocked, Telegram down): the other people still hear.
            log(`telegram: a request was not shown: ${message(e)}`);
          }
          break;
        }
      }
    }
  }

  async function round() {
    bot ??= await client.register();
    for (;;) {
      const items = await client.inbox();
      const handled: string[] = [];
      for (const item of items) {
        try {
          if (item.kind === 'bound') await bound(item);
          else await pressed(item);
          handled.push(item.id);
        } catch (e) {
          // Left on the relay: tried again next round, for as long as the relay keeps it.
          log(`telegram: an answer from the relay was not handled: ${message(e)}`);
        }
      }
      if (handled.length > 0) await client.ack(handled);
      if (items.length < INBOX_PAGE || handled.length === 0) break;
    }
    await notify();
  }

  let running: Promise<void> | null = null;
  const poll = () => {
    running ??= round()
      .catch((e) => log(`telegram: ${message(e)}`))
      .finally(() => {
        running = null;
      });
    return running;
  };
  void poll();
  const timer = setInterval(poll, options.everyMs);
  timer.unref();

  return {
    bot: () => bot,
    async link(tenant, userId) {
      if (!bot) throw new ApiError(503, 'telegram_unavailable');
      const code = randomBytes(16).toString('base64url');
      const now = deps.now();
      const expiresAt = new Date(now.getTime() + CODE_MINUTES * 60_000);
      await db
        .insert(telegramCodes)
        .values({ codeHash: sha256(code), tenantId: tenant.id, userId, expiresAt, createdAt: now });
      try {
        await client.announce(sha256(code), expiresAt);
      } catch (e) {
        log(`telegram: a binding code was not announced: ${message(e)}`);
        await db.delete(telegramCodes).where(eq(telegramCodes.codeHash, sha256(code)));
        throw new ApiError(503, 'telegram_unavailable');
      }
      return { link: `https://t.me/${bot}?start=${code}`, expiresAt: expiresAt.toISOString() };
    },
    poll,
    async close() {
      clearInterval(timer);
      await running;
    },
  };
}

/** What the chat is told after a press. */
function replyTo(outcome: LinkOutcome): string {
  switch (outcome.kind) {
    case 'expired':
      return t('telegram.expired');
    case 'changed':
      return t('telegram.changed');
    case 'failed':
      return outcome.message;
    case 'decided':
      return outcome.decision === 'reject'
        ? t('telegram.done.rejected')
        : outcome.unknown
          ? t('telegram.done.added')
          : t('telegram.done.sent', { to: outcome.to });
  }
}

/** The person's chat as the pane shows it: whether Telegram is offered, and since when it is bound. */
export async function telegramStatus(
  deps: Pick<ApiDeps, 'db' | 'telegram'>,
  tenant: Pick<TenantRow, 'id'>,
  userId: string,
) {
  const [chat] = await deps.db
    .select({ boundAt: telegramChats.boundAt })
    .from(telegramChats)
    .where(
      and(
        eq(telegramChats.tenantId, tenant.id),
        eq(telegramChats.userId, userId),
        isNull(telegramChats.revokedAt),
      ),
    );
  return {
    available: Boolean(deps.telegram?.bot()),
    chat: chat ? { boundAt: chat.boundAt.toISOString() } : null,
  };
}

/**
 * Ends the person's binding: their chat receives nothing more and its buttons decide nothing. By the
 * person (the pane), or because the relay says the chat answers to another runner now.
 */
export async function unbind(
  db: Db,
  tenant: Pick<TenantRow, 'id'>,
  userId: string,
  by: 'person' | 'relay',
  now: Date,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const ended = await tx
      .update(telegramChats)
      .set({ revokedAt: now })
      .where(
        and(
          eq(telegramChats.tenantId, tenant.id),
          eq(telegramChats.userId, userId),
          isNull(telegramChats.revokedAt),
        ),
      )
      .returning({ id: telegramChats.id });
    if (ended.length === 0) return false;
    await audit(tx, {
      tenantId: tenant.id,
      actor: by === 'person' ? `user:${userId}` : 'agent:relay',
      action: 'telegram.unbind',
      objectType: 'user',
      objectId: userId,
      after: { by },
    });
    return true;
  });
}
