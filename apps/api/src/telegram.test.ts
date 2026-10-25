// Memory M4 (docs/plans/memory.md): Telegram through the relay, against the stand-in bot. A person
// binds their chat from the pane; a request waiting for a decision reaches it with its buttons, once
// per revision; a button pressed while the runner is off waits on the relay and decides when the
// runner comes back, once, as that person, on the Telegram channel. A forged token, a token pressed
// twice, another person's button or a chat no longer bound decides nothing.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  actions,
  auditEvents,
  blobs,
  type Database,
  documents,
  eq,
  obligations,
  openDatabase,
  parties,
  relayInbox,
  tenants,
  users,
} from '@fi/db';
import { TelegramStandIn } from '@fi/mock-pdp';
import { createRelay, telegramApi } from '@fi/relay';
import { t } from '@fi/shared';
import { ServerEnvSchema } from '@fi/shared/env';
import { newRunnerKey } from '@fi/shared/relay';
import type { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApi } from './runtime';
import { relayClient, startTelegram, type Telegram } from './telegram';
import { ADMIN_TOKEN, fakeAdapter, newTenant, signIn, testApi, testDatabase } from './test-helpers';
import { runWatchers } from './watchers';

const SECRET = 'relay-webhook-secret_0123';
const BOT_TOKEN = '123456:runner-test-bot';
const RELAY_ADMIN = 'relay-admin-token-for-tests-0123456789';
const DAY = 86_400_000;
const SLOW = { timeout: 60_000 };

const via = (app: () => Hono) =>
  (async (input: string | URL | Request, init?: RequestInit) =>
    app().request(input, init)) as typeof fetch;

let database: Database;
let relayDatabase: Database;
let api: ReturnType<typeof testApi>;
let relay: ReturnType<typeof createRelay>;
let bot: TelegramStandIn;
let licence: string;
const runnerSecret = newRunnerKey();
/** Saturday 24 October 2026, 10:00 in Paris. */
let clock = new Date('2026-10-24T08:00:00Z');
const logs: string[] = [];

/** The runner's Telegram, as it starts: it registers and fetches what waited at once. */
async function comeBack(): Promise<Telegram> {
  const telegram = startTelegram({
    deps: api.deps,
    client: relayClient({
      url: 'http://relay.test',
      licence,
      key: runnerSecret,
      now: () => clock,
      fetcher: via(() => relay.app),
    }),
    everyMs: 3_600_000,
    log: (m) => logs.push(m),
  });
  api.deps.telegram = telegram;
  await telegram.poll();
  return telegram;
}

beforeAll(async () => {
  database = await testDatabase();
  relayDatabase = await openDatabase();
  await relayDatabase.migrate();
  api = testApi(database, { mock: fakeAdapter() }, ADMIN_TOKEN, { now: () => clock });
  relay = createRelay({
    db: relayDatabase.db,
    telegram: telegramApi({
      url: 'http://telegram.test',
      token: BOT_TOKEN,
      fetcher: via(() => bot.app),
    }),
    adminToken: RELAY_ADMIN,
    webhookSecret: SECRET,
    botUsername: 'facture_impec_bot',
    now: () => clock,
    log: (m) => logs.push(m),
  });
  bot = new TelegramStandIn({
    token: BOT_TOKEN,
    webhook: { url: 'http://relay.test/telegram', secret: SECRET },
    fetcher: via(() => relay.app),
  });
  const given = await relay.app.request('http://relay.test/admin/licences', {
    method: 'POST',
    headers: { authorization: `Bearer ${RELAY_ADMIN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ label: 'Bâtiment Dupont' }),
  });
  licence = ((await given.json()) as { licence: string }).licence;
}, 60_000);
afterAll(async () => {
  await api.deps.telegram?.close();
  await database.close();
  await relayDatabase.close();
});

let seq = 0;

/** A supplier whose attestation is due on 10 November: the watchers draft its request. */
async function supplier(tenantId: string, name: string, email: string | null) {
  const n = ++seq;
  const db = database.db;
  const [party] = await db
    .insert(parties)
    .values({
      tenantId,
      kind: 'supplier',
      legalName: name,
      siren: ['552100554', '732829320', '542107651', '404833048'][n - 1] ?? '552100554',
      email,
      source: 'invoice',
    })
    .returning();
  const sha256 = `${n}`.padStart(64, 'a');
  const storageKey = `${tenantId}/${sha256}`;
  await db.insert(blobs).values({
    key: storageKey,
    tenantId,
    sha256,
    size: 3,
    mime: 'application/pdf',
    bytes: new Uint8Array([1, 2, 3]),
  });
  const [doc] = await db
    .insert(documents)
    .values({
      tenantId,
      source: 'mail',
      sourceRef: `<${sha256}@example>`,
      name: `attestation-${n}.pdf`,
      mime: 'application/pdf',
      size: 3,
      sha256,
      storageKey,
      kind: 'attestation_vigilance',
      stage: 'done',
      partyId: party?.id ?? null,
      isTest: false,
      receivedAt: clock,
    })
    .returning();
  await db.insert(obligations).values({
    tenantId,
    kind: 'attestation_vigilance_renouvellement',
    key: `attestation_vigilance_renouvellement:${n}`,
    partyId: party?.id ?? null,
    sourceDocumentId: doc?.id ?? null,
    dueOn: '2026-11-10',
    isTest: false,
  });
  await runWatchers({ db, jobs: api.jobs, now: () => clock });
  const [draft] = await db
    .select()
    .from(actions)
    .where(eq(actions.partyId, party?.id ?? ''));
  if (!draft) throw new Error('no draft');
  return draft;
}

const actionRow = async (id: string) => {
  const [row] = await database.db.select().from(actions).where(eq(actions.id, id));
  return row;
};
const last = (chatId: string) => bot.inChat(chatId).at(-1);
const OWNER = 'gerante@telegram.test';
const OWNER_CHAT = '424242';
const MEMBER_CHAT = '515151';
// One company's story: each test starts where the one before left it (run the file whole).
let company: { id: string; apiKey: string };
let session: string;

describe('a person’s Telegram', () => {
  it('is bound from the pane by its person only, with a link that serves once', SLOW, async () => {
    const telegram = await comeBack();
    expect(telegram.bot()).toBe('facture_impec_bot');
    company = await newTenant(api.request, { ownerEmail: OWNER });
    session = await signIn(api.request, api.mailer, OWNER);
    const byKey = await api.request('/telegram/link', { method: 'POST', token: company.apiKey });
    expect(byKey.status).toBe(403);
    expect(((await byKey.json()) as { error: { message: string } }).error.message).toBe(
      t('api.error.telegram_person'),
    );
    expect(await (await api.request('/telegram', { token: session })).json()).toEqual({
      available: true,
      chat: null,
    });

    const asked = await api.request('/telegram/link', { method: 'POST', token: session });
    expect(asked.status).toBe(200);
    const { link } = (await asked.json()) as { link: string };
    const code = /^https:\/\/t\.me\/facture_impec_bot\?start=([\w-]{22})$/.exec(link)?.[1] ?? '';
    expect(code).not.toBe('');
    await bot.start(OWNER_CHAT, code);
    expect(last(OWNER_CHAT)?.text).toBe(t('relay.start.received'));
    await telegram.poll();
    const [tenant] = await database.db.select().from(tenants).where(eq(tenants.id, company.id));
    expect(last(OWNER_CHAT)?.text).toBe(t('telegram.bound', { company: tenant?.name ?? '' }));
    const status = (await (await api.request('/telegram', { token: session })).json()) as {
      chat: { boundAt: string } | null;
    };
    expect(status.chat?.boundAt).toBe(clock.toISOString());
    const binds = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, 'telegram.bind'));
    expect(binds).toHaveLength(1);
    // The same link in another chat binds nothing.
    await bot.start('999', code);
    expect(last('999')?.text).toBe(t('relay.start.unknown'));
  });

  it(
    'decides, once, a request pressed while the runner was off; a forged or replayed token decides nothing',
    SLOW,
    async () => {
      let telegram = api.deps.telegram;
      if (!telegram) throw new Error('no telegram');
      const draft = await supplier(company.id, 'Plâtrerie Dumas', 'contact@platrerie-dumas.test');
      await telegram.poll();
      const shown = last(OWNER_CHAT);
      expect(shown?.text).toContain(
        "Demander l'attestation de vigilance : Plâtrerie Dumas, échéance le 10/11/2026",
      );
      expect(shown?.text).toContain('À : contact@platrerie-dumas.test');
      expect(shown?.buttons).toEqual([
        [
          { text: t('decide.button.send'), data: expect.stringMatching(/^[\w-]{43}$/) },
          { text: t('decide.button.reject'), data: expect.stringMatching(/^[\w-]{43}$/) },
        ],
      ]);
      // Once per revision: the next round shows it again nowhere.
      const before = bot.sent.length;
      await telegram.poll();
      expect(bot.sent.length).toBe(before);
      if (!shown) throw new Error('no message');
      const [send, ignore] = shown.buttons[0] ?? [];

      // The runner stops; « Envoyer » is pressed, and a forger presses a made-up token.
      await telegram.close();
      await bot.press(shown, send?.data ?? '');
      expect(bot.answered.at(-1)?.text).toBe(t('relay.press.received'));
      await bot.press(shown, 'x'.repeat(43));
      expect((await actionRow(draft.id))?.status).toBe('draft');

      // Three days later the runner is back: the press decides, as the person, on Telegram.
      clock = new Date(clock.getTime() + 3 * DAY);
      telegram = await comeBack();
      const [owner] = await database.db.select().from(users).where(eq(users.email, OWNER));
      expect(await actionRow(draft.id)).toMatchObject({
        status: 'approved',
        channel: 'telegram',
        decidedBy: owner?.id,
        revision: 1,
      });
      expect(api.jobs.actions.filter((id) => id === draft.id)).toHaveLength(1);
      const replies = bot
        .inChat(OWNER_CHAT)
        .slice(-2)
        .map((m) => m.text);
      expect(replies).toEqual([
        t('telegram.done.sent', { to: 'contact@platrerie-dumas.test' }),
        t('telegram.expired'),
      ]);
      expect(await relayDatabase.db.select().from(relayInbox)).toEqual([]);

      // Pressed again (Telegram sent the update twice, or a replay): nothing more.
      await bot.press(shown, send?.data ?? '');
      await bot.press(shown, ignore?.data ?? '');
      await telegram.poll();
      expect(
        bot
          .inChat(OWNER_CHAT)
          .slice(-2)
          .map((m) => m.text),
      ).toEqual([t('telegram.expired'), t('telegram.changed')]);
      expect(await actionRow(draft.id)).toMatchObject({ status: 'approved', revision: 1 });
      const decided = await database.db
        .select()
        .from(auditEvents)
        .where(eq(auditEvents.objectId, draft.id));
      expect(decided.filter((e) => e.action === 'action.decide')).toHaveLength(1);
      expect(api.jobs.actions.filter((id) => id === draft.id)).toHaveLength(1);
    },
  );

  it(
    'gives each person their own buttons, and a chat no longer bound decides nothing',
    SLOW,
    async () => {
      const telegram = api.deps.telegram;
      if (!telegram) throw new Error('no telegram');
      const [member] = await database.db
        .insert(users)
        .values({ tenantId: company.id, email: 'chef@telegram.test', role: 'member' })
        .returning();
      if (!member) throw new Error('no member');
      const { link } = await telegram.link({ id: company.id }, member.id);
      await bot.start(MEMBER_CHAT, link.split('start=')[1] ?? '');
      const draft = await supplier(company.id, 'Menuiserie Roux', null);
      await telegram.poll();
      // No address: « Ignorer » only, for each of the two people.
      const mine = last(OWNER_CHAT);
      const theirs = last(MEMBER_CHAT);
      expect(mine?.buttons).toEqual([
        [{ text: t('decide.button.reject'), data: expect.any(String) }],
      ]);
      expect(theirs?.buttons[0]?.[0]?.data).not.toBe(mine?.buttons[0]?.[0]?.data);
      expect(theirs?.text).toContain('Adresse e-mail manquante');
      if (!mine || !theirs) throw new Error('no message');

      // The member presses the owner's button in their own chat: nothing, and the owner's still serves.
      await bot.press(theirs, mine.buttons[0]?.[0]?.data ?? '');
      await telegram.poll();
      expect(last(MEMBER_CHAT)?.text).toBe(t('telegram.expired'));
      expect((await actionRow(draft.id))?.status).toBe('draft');

      // The owner ends their binding from the pane: their chat's button decides nothing, says nothing.
      const ended = await api.request('/telegram', { method: 'DELETE', token: session });
      expect(await ended.json()).toEqual({ ended: true });
      const said = bot.inChat(OWNER_CHAT).length;
      await bot.press(mine, mine.buttons[0]?.[0]?.data ?? '');
      await telegram.poll();
      expect(bot.inChat(OWNER_CHAT)).toHaveLength(said);
      expect((await actionRow(draft.id))?.status).toBe('draft');

      // The member's own button decides.
      await bot.press(theirs, theirs.buttons[0]?.[0]?.data ?? '');
      await telegram.poll();
      expect(await actionRow(draft.id)).toMatchObject({
        status: 'rejected',
        channel: 'telegram',
        decidedBy: member.id,
      });
      expect(last(MEMBER_CHAT)?.text).toBe(t('telegram.done.rejected'));
      expect(logs.filter((l) => l.includes('decided nothing')).length).toBeGreaterThan(0);
    },
  );

  it('still reaches the others when one person has blocked the bot', SLOW, async () => {
    const telegram = api.deps.telegram;
    if (!telegram) throw new Error('no telegram');
    // The owner binds again an hour after the member: the member's chat comes first in a round.
    clock = new Date(clock.getTime() + 3_600_000);
    const asked = await api.request('/telegram/link', { method: 'POST', token: session });
    const { link } = (await asked.json()) as { link: string };
    await bot.start(OWNER_CHAT, link.split('start=')[1] ?? '');
    await telegram.poll();
    bot.block(MEMBER_CHAT);
    await supplier(company.id, 'Électricité Morel', 'contact@electricite-morel.test');
    await telegram.poll();
    expect(last(OWNER_CHAT)?.text).toContain('Électricité Morel');
    expect(last(MEMBER_CHAT)?.text).not.toContain('Électricité Morel');
    expect(logs.some((l) => l.includes('a request was not shown'))).toBe(true);
    // Unblocked: the request reaches them at the next round, the owner's not twice.
    bot.block(MEMBER_CHAT, false);
    const owners = bot.inChat(OWNER_CHAT).length;
    await telegram.poll();
    expect(last(MEMBER_CHAT)?.text).toContain('Électricité Morel');
    expect(bot.inChat(OWNER_CHAT)).toHaveLength(owners);
  });
});

describe('the runner', () => {
  it('starts its Telegram when RELAY_URL is set, and stops it with itself', {
    timeout: 120_000,
  }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'fi-telegram-'));
    try {
      const env = ServerEnvSchema.parse({
        VAULT_DIR: join(dir, 'vault'),
        PGLITE_DIR: join(dir, 'data'),
        ADMIN_TOKEN,
        PDP_SYNC_INTERVAL_SECONDS: '3600',
        RELAY_URL: 'http://relay.test',
        RELAY_LICENCE: licence,
        RELAY_RUNNER_KEY: newRunnerKey(),
      });
      const running = await startApi({
        env,
        port: 0,
        now: () => clock,
        collectEverySeconds: 3600,
        mailer: null,
        directory: null,
        vies: null,
        relayFetch: via(() => relay.app),
        log: (m) => logs.push(m),
      });
      expect(running.deps.telegram).toBe(running.telegram);
      await running.telegram?.poll();
      expect(running.telegram?.bot()).toBe('facture_impec_bot');
      // The pane, built with ADDIN_API_URL at the runner, is let in from its own origin only.
      expect(running.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
      const preflight = (origin: string) =>
        fetch(`${running.url}/telegram/link`, {
          method: 'OPTIONS',
          headers: {
            origin,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'authorization,content-type',
          },
        });
      const pane = await preflight('https://localhost:3000');
      expect(pane.headers.get('access-control-allow-origin')).toBe('https://localhost:3000');
      const other = await preflight('https://evil.example');
      expect(other.headers.get('access-control-allow-origin')).toBeNull();
      await running.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
