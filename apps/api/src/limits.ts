// Limits for an API reachable from the internet (plan §10 « rate limit API per tenant »): a body size
// per route, and a fixed window of requests per client address on the routes that need no key, per
// company behind one. One process keeps its own counters, which is what the pilot runs (one API).
import { getConnInfo } from '@hono/node-server/conninfo';
import type { Context, MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { createMiddleware } from 'hono/factory';
import type { TenantEnv } from './auth';
import { ApiError } from './errors';

export const KB = 1024;
export const MB = 1024 * KB;

/** Requests per minute. A sign-in poll runs every 2 s while the pane waits for the link. */
export const LIMITS = {
  /** Sign-in and sign-up forms, confirmation pages, company lookup: per address. */
  public: 30,
  /** The pane polling a sign-in or sign-up request: per address. */
  poll: 120,
  /** Everything behind a company key or session: per company. */
  tenant: 600,
  /** The operator's routes: per address. */
  admin: 60,
} as const;
export type LimitName = keyof typeof LIMITS;

/** A fixed one-minute window per key; old windows are dropped as new ones start. */
export class RequestWindows {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    private readonly perMinute: Record<LimitName, number> = LIMITS,
    private readonly now: () => number = Date.now,
  ) {}

  /** False once `key` has used its share of the current minute under `name`. */
  take(name: LimitName, key: string): boolean {
    const now = this.now();
    const id = `${name}:${key}`;
    const window = this.windows.get(id);
    if (!window || now - window.start >= 60_000) {
      if (this.windows.size > 10_000) this.prune(now);
      this.windows.set(id, { start: now, count: 1 });
      return true;
    }
    window.count += 1;
    return window.count <= this.perMinute[name];
  }

  private prune(now: number) {
    for (const [id, w] of this.windows) if (now - w.start >= 60_000) this.windows.delete(id);
  }
}

/**
 * The client's address: the trusted proxy's header when one is configured (its last entry, the one
 * the proxy itself wrote), else the socket's. Requests made in memory (tests) have neither.
 */
export function clientAddress(c: Context, trustedHeader: string | undefined): string {
  if (trustedHeader) {
    const value = c.req.header(trustedHeader);
    const last = value?.split(',').at(-1)?.trim();
    if (last) return last;
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

export const limitByAddress = (
  windows: RequestWindows,
  name: LimitName,
  trustedHeader: string | undefined,
): MiddlewareHandler =>
  createMiddleware(async (c, next) => {
    if (!windows.take(name, clientAddress(c, trustedHeader))) {
      throw new ApiError(429, 'too_many_requests');
    }
    await next();
  });

/** After tenantAuth: the company's own share, whoever of its people calls. */
export const limitByTenant = (windows: RequestWindows) =>
  createMiddleware<TenantEnv>(async (c, next) => {
    if (!windows.take('tenant', c.get('tenant').id)) throw new ApiError(429, 'too_many_requests');
    await next();
  });

export const maxBody = (maxSize: number): MiddlewareHandler =>
  bodyLimit({
    maxSize,
    onError: () => {
      throw new ApiError(413, 'body_too_large');
    },
  });
