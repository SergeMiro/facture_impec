import { describe, expect, it } from 'vitest';
import {
  InboxItem,
  newRunnerKey,
  RelayMessage,
  runnerKey,
  SKEW_MS,
  signRequest,
  verifyRequest,
} from './relay';

const request = { method: 'POST', path: '/messages', body: '{"chatId":"42","text":"Bonjour"}' };
const at = new Date('2026-10-26T09:00:00Z');

describe('a runner signature', () => {
  it('names the runner, for this request at this time only', () => {
    const key = runnerKey(newRunnerKey());
    const header = signRequest(key, request, at);
    expect(verifyRequest(header, request, at)).toEqual({
      publicKey: key.publicKey,
      signature: expect.any(String),
    });
    // Another body, path or method; a time too far off; another key's name on it.
    expect(verifyRequest(header, { ...request, body: '{"chatId":"43"}' }, at)).toBeNull();
    expect(verifyRequest(header, { ...request, path: '/messages?x=1' }, at)).toBeNull();
    expect(verifyRequest(header, { ...request, method: 'GET' }, at)).toBeNull();
    expect(verifyRequest(header, request, new Date(at.getTime() + SKEW_MS + 1))).toBeNull();
    expect(verifyRequest(header, request, new Date(at.getTime() - SKEW_MS + 1))).not.toBeNull();
    const other = runnerKey(newRunnerKey());
    const forged = header.replace(key.publicKey, other.publicKey);
    expect(verifyRequest(forged, request, at)).toBeNull();
    expect(verifyRequest(undefined, request, at)).toBeNull();
    expect(verifyRequest('key=x, at=y, n=w, sig=z', request, at)).toBeNull();
    // The nonce is signed: changed, the signature no longer holds.
    expect(verifyRequest(header.replace(/n=[\w-]+/, 'n=other'), request, at)).toBeNull();
  });

  it('differs between two requests alike at the same moment', () => {
    const key = runnerKey(newRunnerKey());
    const one = verifyRequest(signRequest(key, request, at), request, at);
    const two = verifyRequest(signRequest(key, request, at), request, at);
    expect(one?.signature).not.toBe(two?.signature);
  });

  it('is the same key every time the secret is read', () => {
    const secret = newRunnerKey();
    expect(runnerKey(secret).publicKey).toBe(runnerKey(secret).publicKey);
    expect(runnerKey(newRunnerKey()).publicKey).not.toBe(runnerKey(secret).publicKey);
  });
});

describe('the wire', () => {
  it('keeps a button within Telegram callback data, 1 to 64 bytes', () => {
    const message = (data: string) =>
      RelayMessage.safeParse({ chatId: '42', text: 'x', buttons: [[{ text: 'Envoyer', data }]] });
    expect(message('a'.repeat(64)).success).toBe(true);
    expect(message('a'.repeat(65)).success).toBe(false);
    expect(message('é').success).toBe(false);
    expect(message('').success).toBe(false);
    expect(RelayMessage.safeParse({ chatId: 'abc', text: 'x' }).success).toBe(false);
    expect(RelayMessage.safeParse({ chatId: '-1001234567890', text: 'x' }).success).toBe(true);
    expect(RelayMessage.safeParse({ chatId: '42', text: 'x'.repeat(4097) }).success).toBe(false);
  });

  it('tells a chat bound from a button pressed', () => {
    const base = { id: crypto.randomUUID(), at: at.toISOString(), chatId: '42' };
    expect(InboxItem.parse({ ...base, kind: 'bound', code: 'c'.repeat(22) }).kind).toBe('bound');
    expect(InboxItem.safeParse({ ...base, kind: 'bound', code: 'short' }).success).toBe(false);
    expect(InboxItem.parse({ ...base, kind: 'press', data: 't'.repeat(43) }).kind).toBe('press');
  });
});
