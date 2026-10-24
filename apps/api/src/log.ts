// One JSON line per event on stderr (BTP plan §11, docs/DECISIONS.md D10). The ids on a line come
// from the context it is written in, a request or a job, kept by AsyncLocalStorage: no caller passes
// them, so none can forget them. Every line has `tenantId`, null when no company is concerned.
import { AsyncLocalStorage } from 'node:async_hooks';

export interface LogContext {
  tenantId: string | null;
  requestId?: string;
  method?: string;
  route?: string;
  queue?: string;
  jobId?: string;
  /** A job's attempt, 1 for its first run. */
  attempt?: number;
  documentId?: string;
  invoiceId?: string;
  actionId?: string;
}

export type Level = 'info' | 'warn' | 'error';

export interface LogLine extends LogContext {
  time: string;
  level: Level;
  msg: string;
  error?: string;
}

const context = new AsyncLocalStorage<LogContext>();

let write = (line: string) => {
  process.stderr.write(`${line}\n`);
};

/** Runs `fn` with these ids on every line it, and what it awaits, logs. */
export function withLogContext<T>(fields: LogContext, fn: () => T): T {
  return context.run({ ...fields }, fn);
}

/** The company of the request being served, once its key or session is known. */
export function setLogTenant(tenantId: string): void {
  const store = context.getStore();
  if (store) store.tenantId = tenantId;
}

export function logLine(
  level: Level,
  msg: string,
  more: Partial<LogContext> & { error?: unknown } = {},
): void {
  const { error, ...fields } = more;
  const line: LogLine = {
    time: new Date().toISOString(),
    level,
    msg,
    tenantId: null,
    ...context.getStore(),
    ...fields,
  };
  if (error !== undefined) {
    line.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
  }
  write(JSON.stringify(line));
}

/** What the modules that take a `log` callback are given by the running API. */
export const log = (message: string): void => logLine('warn', message);

/** Tests: the lines go to `fn` until the returned function is called. */
export function captureLogs(fn: (line: string) => void): () => void {
  const before = write;
  write = fn;
  return () => {
    write = before;
  };
}
