// Two ways in (plan §5 Connexion): tenant API keys (`Authorization: Bearer fik_…`) and task pane
// sessions from a sign-in link (`fis_…`, src/login.ts), both stored as SHA-256 and shown once. The
// admin token (ADMIN_TOKEN) creates tenants.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  and,
  apiKeys,
  eq,
  gt,
  isNull,
  sessions,
  sha256,
  type TenantRow,
  tenants,
  type UserRole,
  users,
} from '@fi/db';
import { createMiddleware } from 'hono/factory';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';

export const API_KEY_PREFIX = 'fik_';
export const SESSION_PREFIX = 'fis_';

export const newApiKey = () => `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
export const newSessionToken = () => `${SESSION_PREFIX}${randomBytes(32).toString('base64url')}`;

/** Who calls: the tenant's key (the owner's tool) or a person signed in through a link. */
export type Principal =
  | { kind: 'key' }
  | { kind: 'session'; sessionId: string; userId: string; email: string; role: UserRole };

export type TenantEnv = { Variables: { tenant: TenantRow; principal: Principal } };

function bearer(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match?.[1];
}

export const tenantAuth = (deps: ApiDeps) =>
  createMiddleware<TenantEnv>(async (c, next) => {
    const token = bearer(c.req.header('authorization'));
    if (token?.startsWith(API_KEY_PREFIX)) {
      const [found] = await deps.db
        .select({ tenant: tenants })
        .from(apiKeys)
        .innerJoin(tenants, eq(tenants.id, apiKeys.tenantId))
        .where(
          and(
            eq(apiKeys.hash, sha256(token)),
            isNull(apiKeys.revokedAt),
            isNull(tenants.deletedAt),
          ),
        );
      if (!found) throw new ApiError(401, 'unauthorized');
      c.set('tenant', found.tenant);
      c.set('principal', { kind: 'key' });
    } else if (token?.startsWith(SESSION_PREFIX)) {
      const [found] = await deps.db
        .select({ tenant: tenants, session: sessions, user: users })
        .from(sessions)
        .innerJoin(tenants, eq(tenants.id, sessions.tenantId))
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(
          and(
            eq(sessions.hash, sha256(token)),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, deps.now()),
            isNull(tenants.deletedAt),
          ),
        );
      if (!found) throw new ApiError(401, 'session_expired');
      c.set('tenant', found.tenant);
      c.set('principal', {
        kind: 'session',
        sessionId: found.session.id,
        userId: found.user.id,
        email: found.user.email,
        role: found.user.role,
      });
    } else {
      throw new ApiError(401, 'unauthorized');
    }
    await next();
  });

/** The tenant's key or its owner: what deleting the account takes. */
export const isOwner = (principal: Principal) =>
  principal.kind === 'key' || principal.role === 'owner';

export const adminAuth = (deps: ApiDeps) =>
  createMiddleware(async (c, next) => {
    const expected = deps.env.ADMIN_TOKEN;
    if (!expected) throw new ApiError(503, 'admin_disabled');
    const given = Buffer.from(bearer(c.req.header('authorization')) ?? '');
    const wanted = Buffer.from(expected);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      throw new ApiError(403, 'admin_forbidden');
    }
    await next();
  });
