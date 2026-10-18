import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryStore, tokenStore } from './storage';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('token store', () => {
  it('prefers OfficeRuntime.storage', async () => {
    const items = new Map<string, string>();
    vi.stubGlobal('OfficeRuntime', {
      storage: {
        getItem: async (k: string) => items.get(k) ?? null,
        setItem: async (k: string, v: string) => void items.set(k, v),
        removeItem: async (k: string) => void items.delete(k),
      },
    });
    const store = tokenStore();
    await store.set('token', 'fis_abc');
    expect(items.get('token')).toBe('fis_abc');
    expect(await store.get('token')).toBe('fis_abc');
  });

  it('falls back to localStorage under the partition key', async () => {
    const items = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => items.set(k, v),
      removeItem: (k: string) => items.delete(k),
    });
    vi.stubGlobal('Office', { context: { partitionKey: 'p1:' } });
    const store = tokenStore();
    await store.set('token', 'fis_abc');
    expect([...items.keys()]).toEqual(['p1:facture-impec:token']);
    await store.remove('token');
    expect(await store.get('token')).toBeNull();
  });

  it('keeps the token in memory when no storage is allowed', async () => {
    const store = memoryStore();
    await store.set('token', 'x');
    expect(await store.get('token')).toBe('x');
  });
});
