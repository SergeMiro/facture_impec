// The relay (memory M4, docs/DECISIONS.md D12, docs/RUNBOOK.md § Relay): Telegram for runners that
// sit behind their companies' routers. It keeps a licence per company (its token as SHA-256) and the
// runner's public key, the chats bound to it, the binding codes it announced (minutes), and what waits
// for it while it is off: a chat that sent its code, a button pressed, 7 days at most. A message the
// runner asks for goes to Telegram and is not kept. The runner pulls; every request it makes is
// signed (@fi/shared/relay). A button carries the runner's one-time token: the relay forwards it and
// can neither make one up nor change what it decides.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  and,
  asc,
  type Db,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  relayChats,
  relayCodes,
  relayInbox,
  relayLicences,
  sha256,
} from '@fi/db';
import { t } from '@fi/shared';
import {
  BindingCode,
  INBOX_PAGE,
  InboxAck,
  RELAY_KEEP_DAYS,
  Registration,
  RelayCode,
  RelayMessage,
  SIGNATURE_HEADER,
  SKEW_MS,
  verifyRequest,
} from '@fi/shared/relay';
import { type Context, Hono } from 'hono';
import { z } from 'zod';
import type { TelegramApi } from './telegram';

export interface RelayOptions {
  db: Db;
  telegram: TelegramApi;
  /** RELAY_ADMIN_TOKEN: the operator's routes; unset, they answer 503. */
  adminToken?: string;
  /** TELEGRAM_WEBHOOK_SECRET: what Telegram puts in the header of every update. */
  webhookSecret: string;
  /** TELEGRAM_BOT_USERNAME: the runner builds the deep links with it. */
  botUsername: string;
  now?: () => Date;
  log?: (message: string) => void;
}

const DAY_MS = 86_400_000;
/** A binding code lives minutes on the runner; the relay keeps none longer than this. */
const CODE_MAX_MS = 60 * 60_000;
const START = /^\/start(?:@\w+)?\s+(\S+)\s*$/;

const sameText = (a: string, b: string) => {
  const x = createHash('sha256').update(a).digest();
  const y = createHash('sha256').update(b).digest();
  return timingSafeEqual(x, y);
};

const Chat = z.object({ id: z.number().int(), type: z.string() });
const Update = z.object({
  update_id: z.number().int(),
  message: z.object({ chat: Chat, text: z.string().optional() }).optional(),
  callback_query: z
    .object({
      id: z.string(),
      message: z.object({ chat: Chat }).optional(),
      data: z.string().optional(),
    })
    .optional(),
});

type Licence = typeof relayLicences.$inferSelect;
type RunnerEnv = { Variables: { licence: Licence | null; signer: string; raw: string } };

export function createRelay(options: RelayOptions) {
  const { db, telegram } = options;
  const now = options.now ?? (() => new Date());
  const log = options.log ?? ((message: string) => console.warn(message));
  /** Signatures seen in the last minutes: the same signed request twice is a replay. */
  const seen = new Map<string, number>();
  const forget = (at: number) => {
    for (const [sig, until] of seen) if (until <= at) seen.delete(sig);
  };

  const app = new Hono();
  app.get('/health', (c) => c.json({ ok: true, service: 'relay' }));

  // ── The operator: a licence per company ──────────────────────────────────────────────────────
  const admin = new Hono();
  admin.use(async (c, next) => {
    if (!options.adminToken) return c.json({ error: 'admin_disabled' }, 503);
    const token = /^Bearer\s+(\S+)$/i.exec(c.req.header('authorization') ?? '')?.[1];
    if (!token || !sameText(token, options.adminToken))
      return c.json({ error: 'unauthorized' }, 401);
    await next();
  });
  admin.post('/licences', async (c) => {
    const input = z.object({ label: z.string().min(1).max(200) }).safeParse(await json(c));
    if (!input.success) return c.json({ error: 'invalid' }, 400);
    const licence = randomBytes(32).toString('base64url');
    const [row] = await db
      .insert(relayLicences)
      .values({ label: input.data.label, tokenHash: sha256(licence), createdAt: now() })
      .returning({ id: relayLicences.id });
    // Shown once: the relay keeps its hash only.
    return c.json({ id: row?.id, label: input.data.label, licence }, 201);
  });
  admin.get('/licences', async (c) => {
    const rows = await db.select().from(relayLicences).orderBy(asc(relayLicences.createdAt));
    return c.json({
      licences: rows.map((l) => ({
        id: l.id,
        label: l.label,
        registered: l.publicKey !== null,
        lastSeenAt: l.lastSeenAt,
        revokedAt: l.revokedAt,
      })),
    });
  });
  admin.post('/licences/:id/revoke', async (c) => {
    const id = z.uuid().safeParse(c.req.param('id'));
    if (!id.success) return c.json({ error: 'not_found' }, 404);
    const [row] = await db
      .update(relayLicences)
      .set({ revokedAt: now() })
      .where(and(eq(relayLicences.id, id.data), isNull(relayLicences.revokedAt)))
      .returning({ id: relayLicences.id });
    if (!row) return c.json({ error: 'not_found' }, 404);
    // Its chats and what waited for it go now: nothing is kept for a runner that cannot come back.
    await db.delete(relayChats).where(eq(relayChats.licenceId, row.id));
    await db.delete(relayInbox).where(eq(relayInbox.licenceId, row.id));
    await db.delete(relayCodes).where(eq(relayCodes.licenceId, row.id));
    return c.json({ revoked: row.id });
  });
  app.route('/admin', admin);

  // ── The runners: every request signed by the runner's key ────────────────────────────────────
  const runner = new Hono<RunnerEnv>();
  runner.use('*', async (c, next) => {
    const raw = await c.req.text();
    const url = new URL(c.req.url);
    const at = now();
    const signed = verifyRequest(
      c.req.header(SIGNATURE_HEADER),
      { method: c.req.method, path: `${url.pathname}${url.search}`, body: raw },
      at,
    );
    if (!signed) return c.json({ error: 'bad_signature' }, 401);
    forget(at.getTime());
    if (seen.has(signed.signature)) return c.json({ error: 'replayed' }, 401);
    seen.set(signed.signature, at.getTime() + 2 * SKEW_MS);
    const [licence] = await db
      .select()
      .from(relayLicences)
      .where(eq(relayLicences.publicKey, signed.publicKey));
    if (licence?.revokedAt) return c.json({ error: 'licence_revoked' }, 403);
    if (licence) {
      await db
        .update(relayLicences)
        .set({ lastSeenAt: at })
        .where(eq(relayLicences.id, licence.id));
    }
    c.set('licence', licence ?? null);
    c.set('signer', signed.publicKey);
    c.set('raw', raw);
    await next();
  });
  const body = <T extends z.ZodType>(c: Context<RunnerEnv>, schema: T) => {
    try {
      const parsed = schema.safeParse(JSON.parse(c.get('raw')));
      return parsed.success ? (parsed.data as z.infer<T>) : null;
    } catch {
      return null;
    }
  };
  /** The licence this key holds; a key never registered is refused. */
  const holder = (c: Context<RunnerEnv>) => c.get('licence');

  // A runner presents its licence once with its key; on a new machine, a new key takes it over.
  runner.post('/register', async (c) => {
    const input = body(c, Registration);
    if (!input) return c.json({ error: 'invalid' }, 400);
    const [licence] = await db
      .select()
      .from(relayLicences)
      .where(eq(relayLicences.tokenHash, sha256(input.licence)));
    if (!licence || licence.revokedAt) return c.json({ error: 'unknown_licence' }, 403);
    const held = holder(c);
    if (held && held.id !== licence.id) return c.json({ error: 'key_holds_another_licence' }, 409);
    if (licence.publicKey !== c.get('signer')) {
      await db
        .update(relayLicences)
        .set({ publicKey: c.get('signer'), registeredAt: now(), lastSeenAt: now() })
        .where(eq(relayLicences.id, licence.id));
      log(`relay: licence ${licence.id} (${licence.label}) registered a runner key`);
    }
    return c.json({ bot: options.botUsername });
  });

  runner.post('/codes', async (c) => {
    const licence = holder(c);
    if (!licence) return c.json({ error: 'not_registered' }, 403);
    const input = body(c, RelayCode);
    if (!input) return c.json({ error: 'invalid' }, 400);
    const expiresAt = new Date(
      Math.min(Date.parse(input.expiresAt), now().getTime() + CODE_MAX_MS),
    );
    await db
      .insert(relayCodes)
      .values({ codeHash: input.hash, licenceId: licence.id, expiresAt })
      .onConflictDoNothing();
    return c.json({ ok: true });
  });

  runner.post('/messages', async (c) => {
    const licence = holder(c);
    if (!licence) return c.json({ error: 'not_registered' }, 403);
    const input = body(c, RelayMessage);
    if (!input) return c.json({ error: 'invalid' }, 400);
    const [chat] = await db.select().from(relayChats).where(eq(relayChats.chatId, input.chatId));
    if (chat?.licenceId !== licence.id) return c.json({ error: 'chat_not_bound' }, 404);
    try {
      await telegram.sendMessage(input.chatId, input.text, input.buttons);
    } catch (e) {
      log(`relay: sendMessage for licence ${licence.id}: ${message(e)}`);
      return c.json({ error: 'telegram_failed' }, 502);
    }
    return c.json({ ok: true });
  });

  runner.get('/inbox', async (c) => {
    const licence = holder(c);
    if (!licence) return c.json({ error: 'not_registered' }, 403);
    const since = new Date(now().getTime() - RELAY_KEEP_DAYS * DAY_MS);
    const rows = await db
      .select()
      .from(relayInbox)
      .where(and(eq(relayInbox.licenceId, licence.id), gt(relayInbox.createdAt, since)))
      .orderBy(asc(relayInbox.createdAt))
      .limit(INBOX_PAGE);
    return c.json({
      items: rows.map((r) => ({
        id: r.id,
        at: r.createdAt.toISOString(),
        kind: r.kind,
        chatId: r.chatId,
        ...(r.kind === 'bound' ? { code: r.data } : { data: r.data }),
      })),
    });
  });

  runner.post('/inbox/ack', async (c) => {
    const licence = holder(c);
    if (!licence) return c.json({ error: 'not_registered' }, 403);
    const input = body(c, InboxAck);
    if (!input) return c.json({ error: 'invalid' }, 400);
    const gone = await db
      .delete(relayInbox)
      .where(and(eq(relayInbox.licenceId, licence.id), inArray(relayInbox.id, input.ids)))
      .returning({ id: relayInbox.id });
    return c.json({ acked: gone.length });
  });
  app.route('/runner', runner);

  // ── Telegram's webhook ───────────────────────────────────────────────────────────────────────
  app.post('/telegram', async (c) => {
    const secret = c.req.header('x-telegram-bot-api-secret-token') ?? '';
    if (!sameText(secret, options.webhookSecret)) return c.json({ error: 'unauthorized' }, 401);
    const update = Update.safeParse(await json(c));
    // An update the relay does not read is answered 200 all the same: Telegram would send it again.
    if (!update.success) return c.json({ ok: true });
    const { message: sent, callback_query: press } = update.data;
    if (sent?.text !== undefined && sent.chat.type === 'private') {
      await started(String(sent.chat.id), sent.text);
    } else if (press?.message && press.data !== undefined) {
      await pressed(press.id, String(press.message.chat.id), press.data);
    }
    return c.json({ ok: true });
  });

  /** `/start <code>`: the chat is bound to the runner that announced the code. */
  async function started(chatId: string, text: string) {
    const code = BindingCode.safeParse(START.exec(text)?.[1]);
    const at = now();
    const bound =
      code.success &&
      (await db.transaction(async (tx) => {
        const [announced] = await tx
          .delete(relayCodes)
          .where(and(eq(relayCodes.codeHash, sha256(code.data)), gt(relayCodes.expiresAt, at)))
          .returning();
        if (!announced) return false;
        await tx
          .insert(relayChats)
          .values({ chatId, licenceId: announced.licenceId, boundAt: at })
          .onConflictDoUpdate({
            target: relayChats.chatId,
            set: { licenceId: announced.licenceId, boundAt: at },
          });
        await tx.insert(relayInbox).values({
          licenceId: announced.licenceId,
          kind: 'bound',
          chatId,
          data: code.data,
          createdAt: at,
        });
        return true;
      }));
    if (!bound) {
      await say(chatId, t(START.test(text) ? 'relay.start.unknown' : 'relay.start.howTo'));
      return;
    }
    await say(chatId, t('relay.start.received'));
  }

  /** A button: its data waits for the chat's runner, which alone knows what it decides. */
  async function pressed(queryId: string, chatId: string, data: string) {
    const [chat] = await db.select().from(relayChats).where(eq(relayChats.chatId, chatId));
    const good = chat && data.length >= 1 && data.length <= 64;
    if (good) {
      await db.insert(relayInbox).values({
        licenceId: chat.licenceId,
        kind: 'press',
        chatId,
        data,
        createdAt: now(),
      });
    }
    try {
      await telegram.answerCallbackQuery(
        queryId,
        t(good ? 'relay.press.received' : 'relay.press.unknownChat'),
      );
    } catch (e) {
      log(`relay: answerCallbackQuery: ${message(e)}`);
    }
  }

  async function say(chatId: string, text: string) {
    try {
      await telegram.sendMessage(chatId, text);
    } catch (e) {
      log(`relay: sendMessage: ${message(e)}`);
    }
  }

  /** What is past its time goes: answers older than 7 days, codes expired. Returns the answers gone. */
  async function purge(): Promise<number> {
    const at = now();
    const gone = await db
      .delete(relayInbox)
      .where(lt(relayInbox.createdAt, new Date(at.getTime() - RELAY_KEEP_DAYS * DAY_MS)))
      .returning({ id: relayInbox.id });
    await db.delete(relayCodes).where(lt(relayCodes.expiresAt, at));
    forget(at.getTime());
    return gone.length;
  }

  return { app, purge };
}

async function json(c: Context): Promise<unknown> {
  return c.req.json().catch(() => null);
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
