// How a worker of the BTP back end says what went wrong (BTP plan §8). A retryable error goes back to
// its queue with backoff (a source or a model that did not answer); a fatal one stops at once and the
// document or action says why (a file that is not what it claims, a rule that refuses). Anything
// else thrown is a bug: it is retried like a retryable error, and logged as one.

export class RetryableError extends Error {
  override readonly name = 'RetryableError';
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export class FatalError extends Error {
  override readonly name = 'FatalError';
  constructor(
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export const isFatal = (e: unknown): e is FatalError => e instanceof FatalError;
