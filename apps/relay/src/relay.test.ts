// The relay alone (memory M4): its operator's licences, the runners' signed requests, Telegram's
// webhook through the stand-in bot, and what it keeps (7 days at most). The runner's side is played
// here with its key; apps/api/src/telegram.test.ts runs a real runner against it.
import { type Database, openDatabase, relayInbox, sha256 } from '@fi/db';
import { TelegramStandIn } from '@fi/mock-pdp';
import { t } from '@fi/shared';
import {
  newRunnerKey,
  type RunnerKey,
  runnerKey,
  SIGNATURE_HEADER,
  signRequest,
} from '@fi/shared/relay';
import type { Hono } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { createRelay } from './app';
import { telegramApi } from './telegram';

const ADMIN = 'relay-admin-token-for-tests-0123456789';
const SECRET = 'relay-webhook-secret_0123';
const TOKEN = '123456:relay-test-bot';
const SLOW = { timeout: 60_000 };
const DAY = 86_400_000;

const via = (app: () => Hono) =>
  (async (input: string | URL | Request, init?: RequestInit) =>
    app().request(input, init)) as typeof fetch;

const open: Database[] = [];
afterEach(async () => {
  for (const database of open.splice(0)) await database.close();
});

async function setup() {
  const database = await openDatabase();
  await database.migrate();
  open.push(database);
  const clock = { now: new Date('2026-10-26T09:00:00Z') };
  const logs: string[] = [];
  const relay = createRelay({
    db: database.db,
    telegram: telegramApi({
      url: 'http://telegram.test',
      token: TOKEN,
      fetcher: via(() => bot.app),
    }),
    adminToken: ADMIN,
    webhookSecret: SECRET,
    botUsername: 'facture_impec_bot',
    now: () => clock.now,
    log: (m) => logs.push(m),
  });
  const bot = new TelegramStandIn({
    token: TOKEN,
    webhook: { url: 'http://relay.test/telegram', secret: SECRET },
    fetcher: via(() => relay.app),
  });
  const admin = (path: string, init: RequestInit = {}) =>
    relay.app.request(`http://relay.test/admin${path}`, {
      ...init,
      headers: { authorization: `Bearer ${ADMIN}`, 'content-type': 'application/json' },
    });
  const licence = async (label = 'Bâtiment Dupont') => {
    const res = await admin('/licences', { method: 'POST', body: JSON.stringify({ label }) });
    return (await res.json()) as { id: string; licence: string };
  };
  /** A runner: its key signs every request, at the relay's clock. */
  const runner = (key: RunnerKey = runnerKey(newRunnerKey())) => {
    const call = (method: 'GET' | 'POST', path: string, body?: unknown, header?: string) => {
      const text = body === undefined ? '' : JSON.stringify(body);
      return relay.app.request(`http://relay.test/runner${path}`, {
        method,
        headers: {
          [SIGNATURE_HEADER]:
            header ?? signRequest(key, { method, path: `/runner${path}`, body: text }, clock.now),
          'content-type': 'application/json',
        },
        ...(body !== undefined && { body: text }),
      });
    };
    return {
      key,
      call,
      register: (token: string) => call('POST', '/register', { licence: token }),
      announce: (code: string, minutes = 15) =>
        call('POST', '/codes', {
          hash: sha256(code),
          expiresAt: new Date(clock.now.getTime() + minutes * 60_000).toISOString(),
        }),
      inbox: async () =>
        ((await (await call('GET', '/inbox')).json()) as { items: Record<string, string>[] }).items,
    };
  };
  return { database, relay, bot, clock, logs, admin, licence, runner };
}

const CODE = 'code-for-a-chat-0123456';

describe('the operator', () => {
  it('gives a licence once, lists it without its token, and revokes it', SLOW, async () => {
    const { relay, admin, licence } = await setup();
    const anonymous = await relay.app.request('http://relay.test/admin/licences');
    expect(anonymous.status).toBe(401);
    const given = await licence();
    expect(given.licence).toMatch(/^[\w-]{43}$/);
    const list = (await (await admin('/licences')).json()) as { licences: object[] };
    expect(JSON.stringify(list)).not.toContain(given.licence);
    expect(list.licences).toEqual([expect.objectContaining({ id: given.id, registered: false })]);
    expect((await admin(`/licences/${given.id}/revoke`, { method: 'POST' })).status).toBe(200);
    expect((await admin(`/licences/${given.id}/revoke`, { method: 'POST' })).status).toBe(404);
  });

  it('has no admin routes without RELAY_ADMIN_TOKEN', SLOW, async () => {
    const { database } = await setup();
    const relay = createRelay({
      db: database.db,
      telegram: { sendMessage: async () => {}, answerCallbackQuery: async () => {} },
      webhookSecret: SECRET,
      botUsername: 'bot',
    });
    const res = await relay.app.request('http://relay.test/admin/licences', {
      headers: { authorization: 'Bearer anything-at-all-0123456789' },
    });
    expect(res.status).toBe(503);
  });
});

describe('a runner', () => {
  it(
    'registers its key with its licence, and a new machine takes the licence over',
    SLOW,
    async () => {
      const { licence, runner } = await setup();
      const { licence: token } = await licence();
      const first = runner();
      expect((await first.register('wrong-licence-0123456789abcdef')).status).toBe(403);
      const registered = await first.register(token);
      expect(await registered.json()).toEqual({ bot: 'facture_impec_bot' });
      expect(await first.inbox()).toEqual([]);

      const moved = runner();
      expect((await moved.register(token)).status).toBe(200);
      // The old key holds nothing any more.
      expect((await first.call('GET', '/inbox')).status).toBe(403);
      const { licence: other } = await licence('Autre entreprise');
      expect((await moved.register(other)).status).toBe(409);
    },
  );

  it('is refused unsigned, signed by someone else, replayed, late or revoked', SLOW, async () => {
    const { licence, runner, clock, admin } = await setup();
    const given = await licence();
    const one = runner();
    await one.register(given.licence);

    expect((await one.call('GET', '/inbox', undefined, '')).status).toBe(401);
    const stranger = runner();
    const borrowed = signRequest(
      stranger.key,
      { method: 'GET', path: '/runner/inbox', body: '' },
      clock.now,
    ).replace(stranger.key.publicKey, one.key.publicKey);
    expect((await one.call('GET', '/inbox', undefined, borrowed)).status).toBe(401);

    const header = signRequest(
      one.key,
      { method: 'GET', path: '/runner/inbox', body: '' },
      clock.now,
    );
    expect((await one.call('GET', '/inbox', undefined, header)).status).toBe(200);
    expect((await one.call('GET', '/inbox', undefined, header)).status).toBe(401);

    const old = signRequest(one.key, { method: 'GET', path: '/runner/inbox', body: '' }, clock.now);
    clock.now = new Date(clock.now.getTime() + 6 * 60_000);
    expect((await one.call('GET', '/inbox', undefined, old)).status).toBe(401);

    await admin(`/licences/${given.id}/revoke`, { method: 'POST' });
    expect((await one.call('GET', '/inbox')).status).toBe(403);
  });
});

describe('a chat', () => {
  it(
    'is bound by /start with a code its runner announced, once, in a private chat',
    SLOW,
    async () => {
      const { licence, runner, bot, clock, relay } = await setup();
      const one = runner();
      await one.register((await licence()).licence);
      await one.announce(CODE);

      // Telegram's header is checked first.
      const forged = await new TelegramStandIn({
        token: TOKEN,
        webhook: { url: 'http://relay.test/telegram', secret: 'not-the-secret-0123' },
        fetcher: via(() => relay.app),
      }).start('42', CODE);
      expect(forged.status).toBe(401);

      expect((await bot.start('77', CODE, 'group')).status).toBe(200);
      expect(bot.inChat('77')).toEqual([]);
      await bot.start('42', 'not-announced-01234567');
      expect(bot.inChat('42').at(-1)?.text).toBe(t('relay.start.unknown'));
      await bot.start('42', CODE);
      expect(bot.inChat('42').at(-1)?.text).toBe(t('relay.start.received'));
      expect(await one.inbox()).toEqual([
        {
          id: expect.any(String),
          at: clock.now.toISOString(),
          kind: 'bound',
          chatId: '42',
          code: CODE,
        },
      ]);
      // The code served: the same link again binds nothing.
      await bot.start('43', CODE);
      expect(bot.inChat('43').at(-1)?.text).toBe(t('relay.start.unknown'));
    },
  );

  it(
    'receives a runner’s message with its buttons, only from the runner it is bound to',
    SLOW,
    async () => {
      const { licence, runner, bot } = await setup();
      const one = runner();
      await one.register((await licence()).licence);
      const two = runner();
      await two.register((await licence('Autre')).licence);
      await one.announce(CODE);
      await bot.start('42', CODE);

      const message = {
        chatId: '42',
        text: 'Relance : Dupont SARL',
        buttons: [[{ text: 'Envoyer la demande', data: 't'.repeat(43) }]],
      };
      expect((await two.call('POST', '/messages', message)).status).toBe(404);
      expect((await one.call('POST', '/messages', { ...message, chatId: '43' })).status).toBe(404);
      expect((await one.call('POST', '/messages', message)).status).toBe(200);
      expect(bot.inChat('42').at(-1)).toMatchObject({
        text: 'Relance : Dupont SARL',
        buttons: [[{ text: 'Envoyer la demande', data: 't'.repeat(43) }]],
      });
      expect((await one.call('POST', '/messages', { ...message, text: '' })).status).toBe(400);
    },
  );

  it('keeps a press for its runner 7 days, then forgets it', SLOW, async () => {
    const { licence, runner, bot, clock, relay, database } = await setup();
    const one = runner();
    await one.register((await licence()).licence);
    await one.announce(CODE);
    await bot.start('42', CODE);
    const [bound] = await one.inbox();
    await one.call('POST', '/inbox/ack', { ids: [bound?.id] });

    await one.call('POST', '/messages', {
      chatId: '42',
      text: 'Relance',
      buttons: [[{ text: 'Envoyer', data: 'token-a' }]],
    });
    const shown = bot.inChat('42').at(-1);
    if (!shown) throw new Error('no message');
    await bot.press(shown, 'token-a');
    expect(bot.answered.at(-1)?.text).toBe(t('relay.press.received'));
    // A chat bound to nobody: answered, nothing kept.
    await bot.press({ ...shown, chatId: '99' }, 'token-b');
    expect(bot.answered.at(-1)?.text).toBe(t('relay.press.unknownChat'));

    const pressed = await one.inbox();
    expect(pressed).toEqual([
      expect.objectContaining({ kind: 'press', chatId: '42', data: 'token-a' }),
    ]);
    clock.now = new Date(clock.now.getTime() + 7 * DAY - 60_000);
    expect(await one.inbox()).toHaveLength(1);
    expect(await relay.purge()).toBe(0);
    clock.now = new Date(clock.now.getTime() + 2 * 60_000);
    expect(await one.inbox()).toEqual([]);
    expect(await relay.purge()).toBe(1);
    expect(await database.db.select().from(relayInbox)).toEqual([]);
  });
});
