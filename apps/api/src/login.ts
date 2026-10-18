// Sign-in links (plan §5 Connexion). The task pane asks for a link and gets a request id it keeps;
// the e-mailed link opens a page whose button confirms (a mail scanner that opens the link confirms
// nothing); the task pane polls with its request id and collects a session token once.
import { randomBytes } from 'node:crypto';
import {
  and,
  asc,
  audit,
  count,
  eq,
  gte,
  isNull,
  magicLinks,
  sessions,
  sha256,
  tenants,
  users,
} from '@fi/db';
import { t } from '@fi/shared';
import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import { z } from 'zod';
import { newSessionToken, type TenantEnv, tenantAuth } from './auth';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { body, Email } from './http';
import { tenantView } from './views';

export const LINK_MINUTES = 15;
export const SESSION_DAYS = 30;
/** Links per address per hour. */
export const LINKS_PER_HOUR = 5;

const secret = () => randomBytes(32).toString('base64url');
const minutes = (n: number) => n * 60_000;

const page = (message: string, form?: { action: string; button: string }) =>
  html`<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${t('login.page.title')}</title>
    <style>
      body { font: 16px/1.5 'Segoe UI', system-ui, sans-serif; max-width: 32rem; margin: 4rem auto;
        padding: 0 1rem; color: #1b1b1b; background: #fff; }
      button { font: inherit; padding: .6rem 1.2rem; border: 0; border-radius: 4px;
        background: #0f6b3a; color: #fff; cursor: pointer; }
    </style>
  </head>
  <body>
    <h1>${t('login.page.title')}</h1>
    <p>${message}</p>
    ${form ? html`<form method="post" action="${form.action}"><button type="submit">${form.button}</button></form>` : raw('')}
  </body>
</html>`;

export function loginRoutes(deps: ApiDeps) {
  const app = new Hono<TenantEnv>();

  /** The Connexion screen offers the e-mail form only where links can be sent. */
  app.get('/options', (c) => c.json({ magicLink: deps.mailer !== null }));

  app.post('/magic-link', async (c) => {
    if (!deps.mailer) throw new ApiError(503, 'mail_disabled');
    const { email } = await body(c, z.object({ email: Email }));
    const now = deps.now();
    // The oldest account with this address; choosing among several companies comes later.
    const [user] = await deps.db
      .select({ id: users.id })
      .from(users)
      .innerJoin(tenants, eq(tenants.id, users.tenantId))
      .where(and(eq(users.email, email), isNull(tenants.deletedAt)))
      .orderBy(asc(users.createdAt))
      .limit(1);
    if (user) {
      const [recent] = await deps.db
        .select({ n: count() })
        .from(magicLinks)
        .where(
          and(
            eq(magicLinks.userId, user.id),
            gte(magicLinks.createdAt, new Date(+now - minutes(60))),
          ),
        );
      if ((recent?.n ?? 0) >= LINKS_PER_HOUR) throw new ApiError(429, 'too_many_links');
    }
    const link = secret();
    const poll = secret();
    const expiresAt = new Date(+now + minutes(LINK_MINUTES));
    await deps.db.insert(magicLinks).values({
      userId: user?.id ?? null,
      linkHash: sha256(link),
      pollHash: sha256(poll),
      expiresAt,
      createdAt: now,
    });
    // An unknown address gets the same answer and no mail: the form tells nobody who is a customer.
    if (user) {
      const url = new URL('/auth/magic-link/confirm', deps.env.API_PUBLIC_URL);
      url.searchParams.set('token', link);
      await deps.mailer.send({
        to: email,
        subject: t('login.mail.subject'),
        text: t('login.mail.text', { url: url.toString(), minutes: LINK_MINUTES }),
      });
    }
    return c.json({ requestId: poll, expiresAt: expiresAt.toISOString() }, 202);
  });

  const usable = async (token: string | undefined) => {
    if (!token) return undefined;
    const [row] = await deps.db
      .select()
      .from(magicLinks)
      .where(eq(magicLinks.linkHash, sha256(token)));
    if (!row?.userId || row.consumedAt || row.expiresAt <= deps.now()) return undefined;
    return row;
  };

  app.get('/magic-link/confirm', async (c) => {
    const token = c.req.query('token');
    const row = await usable(token);
    if (!row || !token) return c.html(page(t('login.page.expired')), 410);
    if (row.confirmedAt) return c.html(page(t('login.page.done')));
    const action = `/auth/magic-link/confirm?token=${encodeURIComponent(token)}`;
    return c.html(page(t('login.page.confirm'), { action, button: t('login.page.button') }));
  });

  app.post('/magic-link/confirm', async (c) => {
    const row = await usable(c.req.query('token'));
    if (!row) return c.html(page(t('login.page.expired')), 410);
    if (!row.confirmedAt) {
      await deps.db
        .update(magicLinks)
        .set({ confirmedAt: deps.now() })
        .where(eq(magicLinks.id, row.id));
    }
    return c.html(page(t('login.page.done')));
  });

  app.post('/magic-link/poll', async (c) => {
    const { requestId } = await body(c, z.object({ requestId: z.string().min(20).max(100) }));
    const now = deps.now();
    const [row] = await deps.db
      .select()
      .from(magicLinks)
      .where(eq(magicLinks.pollHash, sha256(requestId)));
    if (!row || row.consumedAt || row.expiresAt <= now) throw new ApiError(410, 'link_expired');
    if (!row.confirmedAt || !row.userId) return c.json({ status: 'pending' as const });
    const userId = row.userId;
    const result = await deps.db.transaction(async (tx) => {
      // Collected once: a second poll, even a simultaneous one, finds the link consumed.
      const [claimed] = await tx
        .update(magicLinks)
        .set({ consumedAt: now })
        .where(and(eq(magicLinks.id, row.id), isNull(magicLinks.consumedAt)))
        .returning({ id: magicLinks.id });
      if (!claimed) return null;
      const [found] = await tx
        .select({ user: users, tenant: tenants })
        .from(users)
        .innerJoin(tenants, eq(tenants.id, users.tenantId))
        .where(and(eq(users.id, userId), isNull(tenants.deletedAt)));
      if (!found) return null;
      const token = newSessionToken();
      const [session] = await tx
        .insert(sessions)
        .values({
          userId,
          tenantId: found.tenant.id,
          hash: sha256(token),
          expiresAt: new Date(+now + SESSION_DAYS * 86_400_000),
          createdAt: now,
        })
        .returning({ id: sessions.id });
      await audit(tx, {
        tenantId: found.tenant.id,
        actor: `user:${found.user.id}`,
        action: 'session.create',
        objectType: 'session',
        objectId: session?.id ?? '',
      });
      return { token, found };
    });
    if (!result) throw new ApiError(410, 'link_expired');
    return c.json({
      status: 'ok' as const,
      token: result.token,
      user: { email: result.found.user.email, role: result.found.user.role },
      tenant: tenantView(result.found.tenant),
    });
  });

  app.post('/logout', tenantAuth(deps), async (c) => {
    const principal = c.get('principal');
    if (principal.kind === 'session') {
      await deps.db
        .update(sessions)
        .set({ revokedAt: deps.now() })
        .where(eq(sessions.id, principal.sessionId));
    }
    return c.body(null, 204);
  });

  return app;
}
