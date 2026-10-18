import { STATES, transition } from '@fi/core';
import { describe, expect, it } from 'vitest';
import {
  createMockPdpAdapter,
  DEFAULT_TIMELINE,
  eventFor,
  MOCK_HEADERS,
  PDP_STATUS_EVENTS,
  PDP_STATUSES,
  PdpRequestError,
  PdpUnavailableError,
  parseDuration,
  SIGNATURE_TOLERANCE_SECONDS,
  signWebhook,
  verifyWebhookSignature,
} from './index';

describe('status mapping', () => {
  it('maps every platform status to a state-machine event a PDP may trigger', () => {
    for (const status of PDP_STATUSES) {
      const event = PDP_STATUS_EVENTS[status];
      const allowedSomewhere = STATES.some((s) => transition(s, event, 'pdp').ok);
      expect(allowedSomewhere, `${status} → ${event}`).toBe(true);
    }
  });

  it('walks the default lifecycle from sending to paid', () => {
    let state = transition('sending', 'deposited', 'pdp');
    for (const step of DEFAULT_TIMELINE) {
      if (!state.ok) break;
      const event = eventFor(step.status);
      if (!event) throw new Error(step.status);
      // « Reçue » and « Mise à disposition » both mean delivered for us: the second one is a no-op.
      const next = transition(state.to, event, 'pdp');
      state = next.ok || state.to !== 'delivered' ? next : state;
    }
    expect(state.ok && state.to).toBe('paid');
  });

  it('has no event for a status it does not know', () => {
    expect(eventFor('unknown')).toBeNull();
  });
});

describe('webhook signature', () => {
  const secret = 'a-secret-of-sixteen+';
  const body = '{"code":"issued_invoice.state_change"}';
  const now = 1_790_000_000;

  it('accepts what it signed', () => {
    expect(verifyWebhookSignature(secret, signWebhook(secret, body, now), body, now + 10)).toBe(
      true,
    );
  });

  it('refuses another body, another secret, a stale or garbled header', () => {
    const header = signWebhook(secret, body, now);
    expect(verifyWebhookSignature(secret, header, `${body} `, now)).toBe(false);
    expect(verifyWebhookSignature('another-secret-16', header, body, now)).toBe(false);
    expect(
      verifyWebhookSignature(secret, header, body, now + SIGNATURE_TOLERANCE_SECONDS + 1),
    ).toBe(false);
    expect(verifyWebhookSignature(secret, null, body, now)).toBe(false);
    expect(verifyWebhookSignature(secret, 't=abc,s=00', body, now)).toBe(false);
    expect(verifyWebhookSignature(secret, `t=${now}`, body, now)).toBe(false);
  });
});

describe('parseDuration', () => {
  it('reads days and time parts', () => {
    expect(parseDuration('PT5M')).toBe(300);
    expect(parseDuration('P2D')).toBe(172_800);
    expect(parseDuration('P1DT1H30M15S')).toBe(91_815);
    expect(parseDuration('PT0.5S')).toBe(0.5);
  });

  it('refuses what is not a duration', () => {
    for (const bad of ['P', 'PT', '5M', 'P1W', 'P1Y', '']) {
      expect(() => parseDuration(bad), bad).toThrow();
    }
  });
});

describe('mock adapter errors', () => {
  const adapterAnswering = (respond: () => Response | Promise<Response>) =>
    createMockPdpAdapter({
      baseUrl: 'http://mock.test',
      webhookSecret: 'local-mock-pdp-webhook-secret',
      fetch: async () => respond(),
    });
  const status = (adapter: ReturnType<typeof adapterAnswering>) =>
    adapter.getStatus({ account: 'acc', pdpRef: 'ref' });

  it('is unavailable when the network fails, on 5xx and on 429', async () => {
    const down = adapterAnswering(() => {
      throw new TypeError('fetch failed');
    });
    await expect(status(down)).rejects.toBeInstanceOf(PdpUnavailableError);
    for (const code of [500, 503, 429]) {
      await expect(
        status(adapterAnswering(() => new Response('', { status: code }))),
      ).rejects.toBeInstanceOf(PdpUnavailableError);
    }
  });

  it('is a request error on another status or an unexpected body', async () => {
    await expect(
      status(adapterAnswering(() => new Response('{}', { status: 401 }))),
    ).rejects.toBeInstanceOf(PdpRequestError);
    await expect(status(adapterAnswering(() => Response.json({ id: 1 })))).rejects.toBeInstanceOf(
      PdpRequestError,
    );
  });

  it('sends the account and the idempotency key', async () => {
    const seen: Headers[] = [];
    const adapter = createMockPdpAdapter({
      baseUrl: 'http://mock.test',
      webhookSecret: 'local-mock-pdp-webhook-secret',
      fetch: async (_url, init) => {
        seen.push(new Headers(init?.headers));
        return Response.json({ status: 'deposited', id: 'inv_1' }, { status: 201 });
      },
    });
    const result = await adapter.sendInvoice({
      account: 'acc',
      xml: '<x/>',
      format: 'CII',
      idempotencyKey: 'k1',
    });
    expect(result).toEqual({ outcome: 'deposited', pdpRef: 'inv_1' });
    expect(seen[0]?.get(MOCK_HEADERS.account)).toBe('acc');
    expect(seen[0]?.get(MOCK_HEADERS.idempotencyKey)).toBe('k1');
  });
});
