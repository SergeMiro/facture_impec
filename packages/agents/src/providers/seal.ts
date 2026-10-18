// BYOK keys at rest: AES-256-GCM under AI_KEY_SEALING_KEY (32 bytes, base64). Opened only in the API
// process for one call; never returned to the add-in, never logged.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

function keyFrom(base64: string): Buffer {
  const key = Buffer.from(base64, 'base64');
  if (key.length !== 32) throw new Error('AI_KEY_SEALING_KEY must be 32 bytes in base64');
  return key;
}

/** `v1.<iv>.<tag>.<ciphertext>`, each part base64url. */
export function sealSecret(plain: string, sealingKey: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(sealingKey), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

/** Throws if the value was tampered with or sealed under another key. */
export function openSecret(sealed: string, sealingKey: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || data === undefined)
    throw new Error('Unknown sealed format');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    keyFrom(sealingKey),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

/** What the UI shows of a key: its last four characters. */
export const keyHint = (key: string) => (key.length > 8 ? `…${key.slice(-4)}` : '…');
