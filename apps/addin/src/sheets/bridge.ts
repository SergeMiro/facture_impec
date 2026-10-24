// A private, origin-pinned channel between our hosted pane and the Apps Script sidebar frame.
import { ResponseMessage, type SheetsRequest, type SheetsResult } from './protocol';

export interface BridgeEvent {
  source: unknown;
  origin: string;
  data: unknown;
}
export interface BridgePeer {
  postMessage(message: unknown, origin: string): void;
}
export interface BridgeOptions {
  parent: BridgePeer;
  origin: string;
  channel: string;
  listen(handler: (event: BridgeEvent) => void): () => void;
  timeoutMs?: number;
}
export function createSheetsBridge(options: BridgeOptions) {
  const pending = new Map<
    string,
    {
      resolve(value: SheetsResult): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const stop = options.listen((event) => {
    if (event.source !== options.parent || event.origin !== options.origin) return;
    const parsed = ResponseMessage.safeParse(event.data);
    if (!parsed.success || parsed.data.channel !== options.channel) return;
    const item = pending.get(parsed.data.id);
    if (!item) return;
    clearTimeout(item.timer);
    pending.delete(parsed.data.id);
    item.resolve(parsed.data.result);
  });
  let closed = false;
  return {
    call(request: SheetsRequest): Promise<SheetsResult> {
      if (closed) return Promise.resolve({ ok: false, code: 'Unavailable' });
      const id = crypto.randomUUID();
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, code: 'Unavailable' });
        }, options.timeoutMs ?? 30_000);
        pending.set(id, { resolve, timer });
        try {
          options.parent.postMessage(
            { type: 'fi.sheets.request', channel: options.channel, id, request },
            options.origin,
          );
        } catch {
          clearTimeout(timer);
          pending.delete(id);
          resolve({ ok: false, code: 'Unavailable' });
        }
      });
    },
    close() {
      closed = true;
      stop();
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.resolve({ ok: false, code: 'Unavailable' });
      }
      pending.clear();
    },
  };
}

export function allowedSheetsParent(origin: string, dev: boolean): boolean {
  try {
    const url = new URL(origin);
    if (url.origin !== origin || url.username || url.password) return false;
    if (
      dev &&
      ['http:', 'https:'].includes(url.protocol) &&
      ['localhost', '127.0.0.1'].includes(url.hostname)
    )
      return true;
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'script.google.com' || url.hostname.endsWith('.googleusercontent.com'))
    );
  } catch {
    return false;
  }
}
