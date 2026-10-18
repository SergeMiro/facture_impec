// « Créer un compte » (plan §11 M7, docs/ONBOARDING.md): the person types a SIREN, the public directory
// prefills the company, the person confirms it, gives an e-mail address and accepts the terms. The
// e-mailed link proves the address; its button creates the company (30-day trial) and its owner, and
// the task pane, polling with its own secret as for a sign-in link, collects the session once.
import { randomBytes } from 'node:crypto';
import { Address, isValidSiren } from '@fi/core';
import {
  and,
  count,
  eq,
  gte,
  isNull,
  type SignupCompany,
  sha256,
  signupRequests,
  sql,
  tenants,
  users,
} from '@fi/db';
import { TERMS_VERSION, t } from '@fi/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { body, Email } from './http';
import { openSession } from './login';
import { page as htmlPage } from './page';
import { homeProvider } from './platform';
import { type DirectoryCompany, DirectoryUnavailable } from './sirene';
import { insertTenant } from './tenants';
import { tenantView } from './views';

export const SIGNUP_MINUTES = 60;
/** Sign-up requests per e-mail address, and per SIREN, per hour. */
export const SIGNUPS_PER_HOUR = 3;

const secret = () => randomBytes(32).toString('base64url');
const page = (message: string, form?: { action: string; button: string }) =>
  htmlPage(t('signup.page.title'), message, form);

/** Where sign-up is offered: links can be sent, a directory answers, the terms are published. */
export function signupOffered(deps: ApiDeps): boolean {
  return (
    deps.mailer !== null &&
    Boolean(deps.directory) &&
    (Boolean(deps.env.TERMS_URL) || deps.env.FI_ENV === 'local')
  );
}

const siren = (value: string) => {
  const s = value.replace(/\s/g, '');
  if (!isValidSiren(s)) throw new ApiError(400, 'siren_invalid');
  return s;
};

const SignupBody = z.object({
  siren: z.string().max(20),
  email: Email,
  company: z.object({
    name: z.string().trim().min(1).max(200),
    address: Address.nullable(),
    vatId: z
      .string()
      .trim()
      .toUpperCase()
      .transform((v) => v.replace(/\s/g, ''))
      .pipe(z.string().regex(/^FR[0-9A-Z]{2}\d{9}$/))
      .nullable(),
  }),
  acceptTerms: z.literal(true),
  termsVersion: z.string(),
});

export function onboardingRoutes(deps: ApiDeps) {
  const app = new Hono();

  const assertNoAccount = async (s: string) => {
    const [row] = await deps.db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.siren, s), isNull(tenants.deletedAt)))
      .limit(1);
    if (row) throw new ApiError(409, 'company_exists');
  };

  /** The directory's answer, refusing what cannot become an account; null: it did not answer. */
  const look = async (s: string): Promise<DirectoryCompany | null> => {
    if (!deps.directory) throw new ApiError(503, 'signup_disabled');
    let found: DirectoryCompany | null;
    try {
      found = await deps.directory.lookup(s);
    } catch (e) {
      if (e instanceof DirectoryUnavailable) return null;
      throw e;
    }
    if (!found) throw new ApiError(404, 'company_not_found', { siren: s });
    if (found.closed) throw new ApiError(409, 'company_closed', { siren: s });
    if (found.keptSiren) throw new ApiError(409, 'company_duplicate', { siren: found.keptSiren });
    return found;
  };

  app.get('/company/:siren', async (c) => {
    if (!signupOffered(deps)) throw new ApiError(503, 'signup_disabled');
    const s = siren(c.req.param('siren'));
    await assertNoAccount(s);
    const found = await look(s);
    // The pane offers to type the company in when the directory is down.
    if (!found) throw new ApiError(503, 'directory_unavailable');
    return c.json(found);
  });

  app.post('/signup', async (c) => {
    if (!signupOffered(deps) || !deps.mailer) throw new ApiError(503, 'signup_disabled');
    const input = await body(c, SignupBody);
    const s = siren(input.siren);
    if (input.termsVersion !== TERMS_VERSION) throw new ApiError(409, 'terms_changed');
    if (input.company.vatId && !input.company.vatId.endsWith(s)) {
      throw new ApiError(400, 'vat_mismatch', { siren: s });
    }
    await assertNoAccount(s);
    // Checked again: the person may have typed the company while the directory was down.
    await look(s);
    const now = deps.now();
    const hourAgo = new Date(+now - 3_600_000);
    const [byEmail] = await deps.db
      .select({ n: count() })
      .from(signupRequests)
      .where(and(eq(signupRequests.email, input.email), gte(signupRequests.createdAt, hourAgo)));
    const [bySiren] = await deps.db
      .select({ n: count() })
      .from(signupRequests)
      .where(and(eq(signupRequests.siren, s), gte(signupRequests.createdAt, hourAgo)));
    if ((byEmail?.n ?? 0) >= SIGNUPS_PER_HOUR || (bySiren?.n ?? 0) >= SIGNUPS_PER_HOUR) {
      throw new ApiError(429, 'too_many_signups');
    }
    const link = secret();
    const poll = secret();
    const expiresAt = new Date(+now + SIGNUP_MINUTES * 60_000);
    const company: SignupCompany = {
      name: input.company.name,
      address: input.company.address,
      vatId: input.company.vatId,
    };
    await deps.db.insert(signupRequests).values({
      email: input.email,
      siren: s,
      company,
      termsVersion: input.termsVersion,
      linkHash: sha256(link),
      pollHash: sha256(poll),
      expiresAt,
      createdAt: now,
    });
    const url = new URL('/onboarding/confirm', deps.env.API_PUBLIC_URL);
    url.searchParams.set('token', link);
    await deps.mailer.send({
      to: input.email,
      subject: t('signup.mail.subject'),
      text: t('signup.mail.text', {
        company: company.name,
        url: url.toString(),
        minutes: SIGNUP_MINUTES,
      }),
    });
    return c.json({ requestId: poll, expiresAt: expiresAt.toISOString() }, 202);
  });

  const request = async (token: string | undefined) => {
    if (!token) return undefined;
    const [row] = await deps.db
      .select()
      .from(signupRequests)
      .where(eq(signupRequests.linkHash, sha256(token)));
    if (!row || row.expiresAt <= deps.now()) return undefined;
    return row;
  };

  app.get('/confirm', async (c) => {
    const token = c.req.query('token');
    const row = await request(token);
    if (!row || !token || (row.consumedAt && !row.tenantId)) {
      return c.html(page(t('signup.page.expired')), 410);
    }
    if (row.tenantId) return c.html(page(t('signup.page.done')));
    const action = `/onboarding/confirm?token=${encodeURIComponent(token)}`;
    return c.html(
      page(t('signup.page.confirm', { company: row.company.name, siren: row.siren }), {
        action,
        button: t('signup.page.button'),
      }),
    );
  });

  app.post('/confirm', async (c) => {
    const row = await request(c.req.query('token'));
    if (!row) return c.html(page(t('signup.page.expired')), 410);
    const provider = homeProvider(deps.pdp);
    if (!provider) return c.html(page(t('signup.page.unavailable')), 503);
    const now = deps.now();
    const outcome = await deps.db.transaction(async (tx) => {
      const [locked] = await tx
        .select()
        .from(signupRequests)
        .where(eq(signupRequests.id, row.id))
        .for('update');
      if (!locked || locked.tenantId) return 'done' as const;
      if (locked.consumedAt) return 'expired' as const;
      // Two requests for one SIREN confirmed together: one company, the second finds it.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`siren:${locked.siren}`}))`);
      const [existing] = await tx
        .select({ id: tenants.id })
        .from(tenants)
        .where(and(eq(tenants.siren, locked.siren), isNull(tenants.deletedAt)))
        .limit(1);
      if (existing) {
        await tx
          .update(signupRequests)
          .set({ consumedAt: now })
          .where(eq(signupRequests.id, locked.id));
        return 'exists' as const;
      }
      const { tenant } = await insertTenant(
        tx,
        {
          name: locked.company.name,
          siren: locked.siren,
          vatId: locked.company.vatId,
          address: locked.company.address,
          pdpProvider: provider,
          ownerEmail: locked.email,
          billing: 'trial',
          termsAcceptedAt: locked.createdAt,
        },
        'signup',
        now,
      );
      await tx
        .update(signupRequests)
        .set({ confirmedAt: now, tenantId: tenant.id })
        .where(eq(signupRequests.id, locked.id));
      return 'done' as const;
    });
    if (outcome === 'expired') return c.html(page(t('signup.page.expired')), 410);
    if (outcome === 'exists') return c.html(page(t('signup.page.exists')), 409);
    return c.html(page(t('signup.page.done')));
  });

  app.post('/poll', async (c) => {
    const { requestId } = await body(c, z.object({ requestId: z.string().min(20).max(100) }));
    const now = deps.now();
    const [row] = await deps.db
      .select()
      .from(signupRequests)
      .where(eq(signupRequests.pollHash, sha256(requestId)));
    if (!row || row.consumedAt || row.expiresAt <= now) throw new ApiError(410, 'signup_expired');
    if (!row.tenantId) return c.json({ status: 'pending' as const });
    const tenantId = row.tenantId;
    const result = await deps.db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(signupRequests)
        .set({ consumedAt: now })
        .where(and(eq(signupRequests.id, row.id), isNull(signupRequests.consumedAt)))
        .returning({ id: signupRequests.id });
      if (!claimed) return null;
      const [found] = await tx
        .select({ user: users, tenant: tenants })
        .from(users)
        .innerJoin(tenants, eq(tenants.id, users.tenantId))
        .where(
          and(eq(users.tenantId, tenantId), eq(users.email, row.email), isNull(tenants.deletedAt)),
        );
      if (!found) return null;
      return { token: await openSession(tx, found.user.id, tenantId, now), found };
    });
    if (!result) throw new ApiError(410, 'signup_expired');
    return c.json({
      status: 'ok' as const,
      token: result.token,
      user: { email: result.found.user.email, role: result.found.user.role },
      tenant: tenantView(result.found.tenant),
    });
  });

  return app;
}
