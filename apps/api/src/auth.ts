// Tenant API keys (`Authorization: Bearer fik_…`), stored as SHA-256 and shown once; the admin token
// (ADMIN_TOKEN) creates tenants. The add-in's magic link arrives in M3 (docs/DEFERRED.md).
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { and, apiKeys, eq, isNull, sha256, type TenantRow, tenants } from '@fi/db';
import { createMiddleware } from 'hono/factory';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';

export const API_KEY_PREFIX = 'fik_';

export const newApiKey = () => `${API_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;

export type TenantEnv = { Variables: { tenant: TenantRow } };

function bearer(header: string | undefined): string | undefined {
  const match = /^Bearer\s+(\S+)$/i.exec(header ?? '');
  return match?.[1];
}

export const tenantAuth = (deps: ApiDeps) =>
  createMiddleware<TenantEnv>(async (c, next) => {
    const key = bearer(c.req.header('authorization'));
    if (!key?.startsWith(API_KEY_PREFIX)) throw new ApiError(401, 'unauthorized');
    const [found] = await deps.db
      .select({ tenant: tenants })
      .from(apiKeys)
      .innerJoin(tenants, eq(tenants.id, apiKeys.tenantId))
      .where(and(eq(apiKeys.hash, sha256(key)), isNull(apiKeys.revokedAt)));
    if (!found) throw new ApiError(401, 'unauthorized');
    c.set('tenant', found.tenant);
    await next();
  });

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
