// What the file connectors (R4 OneDrive, R5 Google Drive) share about the provider's side: the kinds of
// failure the connector acts on, and a download read up to a cap.

/**
 * - `reconnect`: the provider no longer honours the token (revoked, expired, consent withdrawn); only
 *   the person signing in again helps.
 * - `throttled`: wait `retryAfter` seconds.
 * - `missing` / `forbidden`: the file was deleted, moved or its sharing changed.
 * - `too_large`: over the connector's cap.
 * - `unavailable`: anything else (network, 5xx, an answer we do not read); the next check tries again.
 */
export class DriveError extends Error {
  constructor(
    readonly kind:
      | 'reconnect'
      | 'throttled'
      | 'missing'
      | 'forbidden'
      | 'too_large'
      | 'unavailable',
    detail: string,
    readonly retryAfter?: number,
  ) {
    super(detail);
    this.name = 'DriveError';
  }
}

export type DriveErrorKind = DriveError['kind'];

/** `Retry-After` in seconds, an hour at most; 30 s when absent or unreadable. */
export function retryAfterOf(res: Response): number {
  const value = Number(res.headers.get('retry-after'));
  return Number.isFinite(value) && value > 0 ? Math.min(value, 3600) : 30;
}

/** A download read up to `maxBytes`; past it, `tooLarge` is thrown and the body cancelled. */
export async function readCapped(
  res: Response,
  maxBytes: number,
  tooLarge: (detail: string) => Error,
): Promise<Uint8Array<ArrayBuffer>> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel();
    throw tooLarge(`${declared} bytes`);
  }
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw tooLarge(`over ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  return bytes;
}
