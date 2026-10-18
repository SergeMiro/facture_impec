import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from './api';

describe('ApiClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('calls the global fetch unbound, as a browser requires', async () => {
    // A browser's fetch throws when called as a method of another object; Node's does not.
    vi.stubGlobal('fetch', function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(Response.json({ magicLink: true }));
    });
    expect(await new ApiClient('/api', () => null).options()).toEqual({ magicLink: true });
  });
});
