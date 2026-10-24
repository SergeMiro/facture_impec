import { afterEach, describe, expect, it, vi } from 'vitest';
import { allowedSheetsParent, type BridgeEvent, createSheetsBridge } from './bridge';
import { RequestMessage } from './protocol';

const setup = () => {
  let receive: (event: BridgeEvent) => void = () => {};
  const parent = { postMessage: vi.fn() };
  const channel = crypto.randomUUID();
  const origin = 'https://frame-script.googleusercontent.com';
  const stop = vi.fn();
  const bridge = createSheetsBridge({
    parent,
    origin,
    channel,
    timeoutMs: 100,
    listen(handler) {
      receive = handler;
      return stop;
    },
  });
  const reply = (
    at: number,
    override: Partial<BridgeEvent> = {},
    data: Record<string, unknown> = {},
  ) => {
    const request = RequestMessage.parse(parent.postMessage.mock.calls[at]?.[0]);
    receive({
      source: parent,
      origin,
      data: {
        type: 'fi.sheets.response',
        channel,
        id: request.id,
        result: { ok: true, value: 'Factures' },
        ...data,
      },
      ...override,
    });
  };
  return { bridge, parent, channel, origin, reply, stop };
};
afterEach(() => vi.useRealTimers());

describe('Google Sheets private browser bridge', () => {
  it('ignores another source, origin, channel and request id', async () => {
    const f = setup();
    const done = vi.fn();
    const result = f.bridge.call({ method: 'activeSheet' }).then(done);
    f.reply(0, { source: {} });
    f.reply(0, { origin: 'https://other.googleusercontent.com' });
    f.reply(0, {}, { channel: crypto.randomUUID() });
    f.reply(0, {}, { id: crypto.randomUUID() });
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    f.reply(0);
    await result;
    expect(done).toHaveBeenCalledWith({ ok: true, value: 'Factures' });
    expect(f.parent.postMessage.mock.calls[0]?.[1]).toBe(f.origin);
    f.bridge.close();
  });

  it('matches out-of-order responses to their own request', async () => {
    const f = setup();
    const one = f.bridge.call({ method: 'activeSheet' });
    const two = f.bridge.call({ method: 'sheetNames' });
    f.reply(1, {}, { result: { ok: true, value: ['Factures', 'Commandes'] } });
    f.reply(0);
    expect(await one).toEqual({ ok: true, value: 'Factures' });
    expect(await two).toEqual({ ok: true, value: ['Factures', 'Commandes'] });
    f.bridge.close();
  });

  it('times out without retrying a write, and releases pending work when closed', async () => {
    vi.useFakeTimers();
    const f = setup();
    const waiting = f.bridge.call({ method: 'setSetting', key: 'fi.testMode', value: 'on' });
    await vi.advanceTimersByTimeAsync(101);
    expect(await waiting).toEqual({ ok: false, code: 'Unavailable' });
    expect(f.parent.postMessage).toHaveBeenCalledTimes(1);
    const another = f.bridge.call({ method: 'activeSheet' });
    f.bridge.close();
    expect(await another).toEqual({ ok: false, code: 'Unavailable' });
    expect(f.stop).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('accepts HTTPS Google frame origins and local harnesses only in development', () => {
    expect(allowedSheetsParent('https://frame-script.googleusercontent.com', false)).toBe(true);
    expect(allowedSheetsParent('https://script.google.com', false)).toBe(true);
    for (const origin of [
      'https://evil.test',
      'https://googleusercontent.com.evil.test',
      'http://frame.googleusercontent.com',
      'null',
      'https://script.google.com/path',
    ]) {
      expect(allowedSheetsParent(origin, false)).toBe(false);
    }
    expect(allowedSheetsParent('https://localhost:3100', false)).toBe(false);
    expect(allowedSheetsParent('https://localhost:3100', true)).toBe(true);
  });
});
