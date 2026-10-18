import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('mock-pdp', () => {
  it('answers /health', async () => {
    const res = await createApp().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'mock-pdp' });
  });
});
