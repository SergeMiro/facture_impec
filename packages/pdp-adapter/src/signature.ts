// Webhook signatures in B2Brouter's scheme (docs/B2BROUTER.md §4): header `t=<unix s>,s=<hex>`,
// HMAC-SHA256 over "<t>.<raw body>", compared in constant time, `t` at most 5 minutes old. The mock
// PDP signs the same way, so the API checks both with this code.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const SIGNATURE_TOLERANCE_SECONDS = 300;

const hmac = (secret: string, t: number, body: string) =>
  createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');

export function signWebhook(secret: string, body: string, nowSeconds = Date.now() / 1000): string {
  const t = Math.floor(nowSeconds);
  return `t=${t},s=${hmac(secret, t, body)}`;
}

export function verifyWebhookSignature(
  secret: string,
  header: string | null | undefined,
  body: string,
  nowSeconds = Date.now() / 1000,
): boolean {
  const parts = new Map(
    (header ?? '').split(',').map((part) => {
      const at = part.indexOf('=');
      return [part.slice(0, at).trim(), part.slice(at + 1).trim()] as const;
    }),
  );
  const t = Number(parts.get('t'));
  const s = parts.get('s') ?? '';
  if (!Number.isInteger(t) || !/^[0-9a-f]{64}$/.test(s)) return false;
  if (Math.abs(nowSeconds - t) > SIGNATURE_TOLERANCE_SECONDS) return false;
  return timingSafeEqual(Buffer.from(hmac(secret, t, body), 'hex'), Buffer.from(s, 'hex'));
}
