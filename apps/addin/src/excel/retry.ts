// Office.js is async and flaky on the web (plan §5): every Excel.run goes through `withRetry`, which
// gives up on a call that hangs and tries again when the error looks temporary.

export class ExcelTimeout extends Error {
  constructor(readonly ms: number) {
    super(`Excel did not answer within ${ms} ms`);
  }
}

/** OfficeExtension error codes that a second try will not fix. */
const PERMANENT = new Set([
  'AccessDenied',
  'InvalidArgument',
  'InvalidReference',
  'InvalidOperation',
  'ItemNotFound',
  'NotImplemented',
  'UnsupportedOperation',
  'ApiNotFound',
]);

export function isPermanent(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  return typeof code === 'string' && PERMANENT.has(code);
}

export interface RetryOptions {
  attempts: number;
  timeoutMs: number;
  /** Wait before try n+1; the last value repeats. */
  delaysMs: number[];
  sleep: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const EXCEL_RETRY: RetryOptions = {
  attempts: 3,
  timeoutMs: 15_000,
  delaysMs: [400, 1_500],
  sleep,
};

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ExcelTimeout(ms)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = EXCEL_RETRY,
): Promise<T> {
  let last: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      return await withTimeout(fn(), options.timeoutMs);
    } catch (e) {
      last = e;
      if (isPermanent(e) || attempt === options.attempts) break;
      const delay = options.delaysMs[Math.min(attempt - 1, options.delaysMs.length - 1)] ?? 0;
      await options.sleep(delay);
    }
  }
  throw last;
}
