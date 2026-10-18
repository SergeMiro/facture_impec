import type { Database } from '@fi/db';
import { auditEvents, eq, magicLinks, sessions, sha256 } from '@fi/db';
import { createMockPdpAdapter } from '@fi/pdp-adapter';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LINKS_PER_HOUR } from './login';
import type { OutboxMailer } from './mail';
import { linkToken, newTenant, signIn, testApi, testDatabase } from './test-helpers';

const mock = createMockPdpAdapter({ baseUrl: 'http://mock.invalid', webhookSecret: 'x' });

let database: Database;
let api: ReturnType<typeof testApi>;
let request: ReturnType<typeof testApi>['request'];
let mailer: OutboxMailer;
let n = 0;
const email = () => `owner${++n}@example.test`;

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock });
  ({ request, mailer } = api);
});
afterAll(async () => {
  await database.close();
});

interface ErrorBody {
  error: { code: string; message: string };
}

async function ask(address: string) {
  const res = await request('/auth/magic-link', { method: 'POST', body: { email: address } });
  return { status: res.status, body: (await res.json()) as { requestId: string } & ErrorBody };
}

const poll = async (requestId: string) => {
  const res = await request('/auth/magic-link/poll', { method: 'POST', body: { requestId } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> & ErrorBody };
};

describe('sign-in links', () => {
  it('signs the owner in: link, confirm button, one poll collects a session', async () => {
    const address = email();
    const tenant = await newTenant(request, { ownerEmail: address.toUpperCase() });
    const asked = await ask(` ${address} `);
    expect(asked.status).toBe(202);
    const mail = mailer.sent.at(-1);
    expect(mail?.to).toBe(address);
    expect(mail?.text).toContain('http://localhost:4000/auth/magic-link/confirm?token=');

    expect((await poll(asked.body.requestId)).body).toEqual({ status: 'pending' });

    // Opening the link (what a mail scanner does) confirms nothing; the button does.
    const token = linkToken(mailer, address);
    const page = await request(`/auth/magic-link/confirm?token=${token}`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<form method="post"');
    expect((await poll(asked.body.requestId)).body).toEqual({ status: 'pending' });
    const confirmed = await request(`/auth/magic-link/confirm?token=${token}`, { method: 'POST' });
    expect(await confirmed.text()).toContain('retournez dans Excel');

    const done = await poll(asked.body.requestId);
    expect(done.body).toMatchObject({
      status: 'ok',
      user: { email: address, role: 'owner' },
      tenant: { id: tenant.id },
    });
    const session = String(done.body.token);
    expect(session).toMatch(/^fis_[\w-]{43}$/);
    const [stored] = await database.db
      .select()
      .from(sessions)
      .where(eq(sessions.hash, sha256(session)));
    expect(stored?.tenantId).toBe(tenant.id);

    // Collected once.
    expect((await poll(asked.body.requestId)).body.error.code).toBe('link_expired');
    const me = await request('/me', { token: session });
    expect(await me.json()).toMatchObject({
      tenant: { id: tenant.id },
      user: { email: address, role: 'owner' },
      testMode: { enabled: true, available: true },
    });
    // The audit log names the user by id, never by e-mail.
    const log = await database.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, tenant.id));
    const created = log.find((a) => a.action === 'session.create');
    expect(created?.actor).toBe(`user:${stored?.userId}`);
    expect(JSON.stringify(log)).not.toContain(address);
  });

  it('answers an unknown address the same way and mails nothing', async () => {
    const before = mailer.sent.length;
    const asked = await ask('nobody@example.test');
    expect(asked.status).toBe(202);
    expect(asked.body.requestId).toBeTruthy();
    expect(mailer.sent.length).toBe(before);
    expect((await poll(asked.body.requestId)).body).toEqual({ status: 'pending' });
  });

  it('refuses an expired link, and a sixth link within the hour', async () => {
    const address = email();
    await newTenant(request, { ownerEmail: address });
    const asked = await ask(address);
    await database.db
      .update(magicLinks)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(magicLinks.pollHash, sha256(asked.body.requestId)));
    const page = await request(`/auth/magic-link/confirm?token=${linkToken(mailer, address)}`);
    expect(page.status).toBe(410);
    expect((await poll(asked.body.requestId)).status).toBe(410);

    for (let i = 1; i < LINKS_PER_HOUR; i++) expect((await ask(address)).status).toBe(202);
    const refused = await ask(address);
    expect(refused.status).toBe(429);
    expect(refused.body.error.code).toBe('too_many_links');
  });

  it('logs out, and an expired or revoked session is refused calmly', async () => {
    const address = email();
    await newTenant(request, { ownerEmail: address });
    const session = await signIn(request, mailer, address);
    expect((await request('/settings', { token: session })).status).toBe(200);
    expect((await request('/auth/logout', { method: 'POST', token: session })).status).toBe(204);
    const after = await request('/settings', { token: session });
    expect(after.status).toBe(401);
    expect(((await after.json()) as ErrorBody).error.code).toBe('session_expired');

    const other = await signIn(request, mailer, address);
    await database.db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.hash, sha256(other)));
    expect((await request('/me', { token: other })).status).toBe(401);
  });

  it('tells the task pane whether links exist, and refuses them without a mailer', async () => {
    expect(await (await request('/auth/options')).json()).toEqual({ magicLink: true });
    const noMail = testApi(database, { mock }, null, { mailer: null }).request;
    expect(await (await noMail('/auth/options')).json()).toEqual({ magicLink: false });
    const res = await noMail('/auth/magic-link', { method: 'POST', body: { email: email() } });
    expect(res.status).toBe(503);
    expect(((await res.json()) as ErrorBody).error.code).toBe('mail_disabled');
  });

  it('lets the browser task pane call from its own origin only', async () => {
    const allowed = await request('/me', {
      method: 'OPTIONS',
      headers: { origin: 'https://localhost:3000', 'access-control-request-method': 'GET' },
    });
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://localhost:3000');
    const other = await request('/me', {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    expect(other.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('shows the admin the outbox in local', async () => {
    const res = await request('/admin/outbox', { token: 'test-admin-token-0123456789abcdef' });
    expect(((await res.json()) as { mails: unknown[] }).mails.length).toBeGreaterThan(0);
  });
});
