// The wire between a company's runner and the relay (memory M4, docs/DECISIONS.md D12). The runner
// signs every request with its Ed25519 key (RELAY_RUNNER_KEY); the relay knows the public half only,
// so whoever reads the relay's database cannot speak as a runner. The relay carries no business data:
// a message it forwards to Telegram is not stored, and what waits for a runner is a chat bound or a
// button pressed, 7 days at most. Node-only: import from '@fi/shared/relay', never from the add-in.
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
  randomBytes,
  sign,
  verify,
} from 'node:crypto';
import { z } from 'zod';

/** How long an answer waits on the relay for its runner; an action link lives as long. */
export const RELAY_KEEP_DAYS = 7;
/** The header that carries a runner's signature. */
export const SIGNATURE_HEADER = 'fi-runner-signature';
/** A signed request this far from the relay's clock is refused (a replay, or a clock far off). */
export const SKEW_MS = 5 * 60_000;

/** A new runner key: PKCS#8 DER in base64url, for RELAY_RUNNER_KEY (`pnpm runner:key`). */
export function newRunnerKey(): string {
  const { privateKey } = generateKeyPairSync('ed25519');
  return privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64url');
}

export interface RunnerKey {
  privateKey: KeyObject;
  /** SPKI DER in base64url: what the relay stores. */
  publicKey: string;
}

export function runnerKey(secret: string): RunnerKey {
  const privateKey = createPrivateKey({
    key: Buffer.from(secret, 'base64url'),
    format: 'der',
    type: 'pkcs8',
  });
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('RELAY_RUNNER_KEY: an Ed25519 key (pnpm runner:key)');
  }
  const publicKey = createPublicKey(privateKey)
    .export({ format: 'der', type: 'spki' })
    .toString('base64url');
  return { privateKey, publicKey };
}

interface Signed {
  method: string;
  path: string;
  body: string;
}

/**
 * What is signed: the method, the path with its query, the time, a nonce (two requests alike in the
 * same millisecond differ), the body's SHA-256.
 */
const signed = (request: Signed, at: string, nonce: string) =>
  Buffer.from(
    [
      `${request.method.toUpperCase()} ${request.path}`,
      at,
      nonce,
      createHash('sha256').update(request.body).digest('hex'),
    ].join('\n'),
  );

/** The signature header of a request (`path` with its query string). */
export function signRequest(key: RunnerKey, request: Signed, at: Date): string {
  const when = at.toISOString();
  const nonce = randomBytes(12).toString('base64url');
  const sig = sign(null, signed(request, when, nonce), key.privateKey);
  return `key=${key.publicKey}, at=${when}, n=${nonce}, sig=${sig.toString('base64url')}`;
}

export interface SignedBy {
  /** The runner's public key (SPKI base64url). */
  publicKey: string;
  /** The signature itself: the relay refuses one it has seen. */
  signature: string;
}

/** Who signed this request, if its signature is good and its time near `now`; null otherwise. */
export function verifyRequest(
  header: string | undefined,
  request: Signed,
  now: Date,
): SignedBy | null {
  const parts = new Map(
    (header ?? '').split(',').map((part) => {
      const at = part.indexOf('=');
      return [part.slice(0, at).trim(), part.slice(at + 1).trim()] as const;
    }),
  );
  const key = parts.get('key');
  const at = parts.get('at');
  const nonce = parts.get('n');
  const sig = parts.get('sig');
  if (!key || !at || !nonce || !sig) return null;
  const when = Date.parse(at);
  if (Number.isNaN(when) || Math.abs(now.getTime() - when) > SKEW_MS) return null;
  try {
    const publicKey = createPublicKey({
      key: Buffer.from(key, 'base64url'),
      format: 'der',
      type: 'spki',
    });
    if (publicKey.asymmetricKeyType !== 'ed25519') return null;
    const good = verify(null, signed(request, at, nonce), publicKey, Buffer.from(sig, 'base64url'));
    return good ? { publicKey: key, signature: sig } : null;
  } catch {
    return null;
  }
}

/** A Telegram chat id: up to 52 significant bits, kept as text (docs/TELEGRAM.md). */
export const ChatId = z.string().regex(/^-?\d{1,16}$/);

/** A binding code: what `/start <code>` carries (deep-link parameter: A-Z a-z 0-9 _ -, ≤ 64). */
export const BindingCode = z.string().regex(/^[\w-]{16,64}$/);

/** A button: `data` is `callback_data`, 1–64 bytes; printable ASCII keeps bytes and characters equal. */
export const RelayButton = z.object({
  text: z.string().min(1).max(64),
  data: z.string().regex(/^[\x21-\x7e]{1,64}$/),
});

/** A message the runner asks the relay to put in a chat bound to it. */
export const RelayMessage = z.object({
  chatId: ChatId,
  text: z.string().min(1).max(4096),
  buttons: z.array(z.array(RelayButton).min(1).max(4)).max(20).default([]),
});
export type RelayMessage = z.input<typeof RelayMessage>;

/** A binding code the runner gave a person, announced as its SHA-256 (hex). */
export const RelayCode = z.object({
  hash: z.string().regex(/^[0-9a-f]{64}$/),
  expiresAt: z.iso.datetime(),
});

export const Registration = z.object({ licence: z.string().min(24).max(200) });
export const Registered = z.object({ bot: z.string().min(1) });

/** What waits for a runner: a chat that sent its code, a button pressed. */
export const InboxItem = z.discriminatedUnion('kind', [
  z.object({
    id: z.uuid(),
    at: z.iso.datetime(),
    kind: z.literal('bound'),
    chatId: ChatId,
    code: BindingCode,
  }),
  z.object({
    id: z.uuid(),
    at: z.iso.datetime(),
    kind: z.literal('press'),
    chatId: ChatId,
    data: z.string().min(1).max(64),
  }),
]);
export type InboxItem = z.infer<typeof InboxItem>;
export const Inbox = z.object({ items: z.array(InboxItem) });
/** The items handled: the relay forgets them. */
export const InboxAck = z.object({ ids: z.array(z.uuid()).min(1).max(100) });
/** At most this many items per fetch; the runner fetches again until none is left. */
export const INBOX_PAGE = 100;
