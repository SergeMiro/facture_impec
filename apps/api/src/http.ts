// Request reading shared by the routes: JSON bodies and query strings through Zod, ids as UUIDs.
import type { Context } from 'hono';
import { z } from 'zod';
import { ApiError } from './errors';

export async function body<T>(c: Context, schema: z.ZodType<T>): Promise<T> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw new ApiError(400, 'invalid_request', undefined, 'body is not JSON');
  }
  return parse(schema, raw);
}

export function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new ApiError(400, 'invalid_request', undefined, z.prettifyError(result.error));
  }
  return result.data;
}

/** A malformed id is an invoice we do not have. */
export function uuid(value: string): string {
  if (!z.uuid().safeParse(value).success) throw new ApiError(404, 'not_found');
  return value;
}

/** An e-mail address as people type it: surrounding spaces and capitals do not matter. */
export const Email = z.string().trim().toLowerCase().pipe(z.email().max(254));
