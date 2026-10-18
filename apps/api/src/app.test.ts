import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('api', () => {
  it('answers /health with its environment', async () => {
    const res = await createApp({ FI_ENV: 'local' }).request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, service: 'api', env: 'local' });
  });
});
