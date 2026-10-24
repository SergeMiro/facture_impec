// API errors: a stable code for programs, a calm French message for people (CLAUDE.md rule 10:
// what happened, is my invoice safe, what do I click next).
import { type MessageKey, type MessageParams, t } from '@fi/shared';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

type CodeOf<K> = K extends `api.error.${infer C}` ? C : never;
export type ErrorCode = CodeOf<MessageKey>;

export class ApiError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: ErrorCode,
    readonly params?: MessageParams,
    /** For developers (Zod paths…); never shown as the message. */
    readonly details?: string,
    /** Sent with the answer, e.g. Retry-After on a 429. */
    readonly headers?: Record<string, string>,
  ) {
    super(code);
    this.name = 'ApiError';
  }

  get body() {
    return {
      error: {
        code: this.code,
        message: t(`api.error.${this.code}`, this.params),
        ...(this.details && { details: this.details }),
      },
    };
  }
}

/** Postgres unique_violation (23505), whichever driver wrapped it. */
export function isUniqueViolation(error: unknown): boolean {
  for (let e = error; e instanceof Object; e = (e as { cause?: unknown }).cause) {
    if ((e as { code?: unknown }).code === '23505') return true;
  }
  return false;
}
