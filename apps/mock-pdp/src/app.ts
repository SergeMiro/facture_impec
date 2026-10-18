import { Hono } from 'hono';

// M2 adds POST /invoices, the scripted lifecycle, /scenarios and /inbound (plan §3).
export function createApp() {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, service: 'mock-pdp' }));

  return app;
}
