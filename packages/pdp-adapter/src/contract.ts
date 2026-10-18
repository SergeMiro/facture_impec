// PdpAdapter conformance suite (plan §9 "Contract"). Every implementation runs it: the mock in
// apps/mock-pdp tests, B2Brouter against its sandbox in M4. It checks what business code relies on,
// not how a provider does it. Imports vitest, so it has its own entry point: @fi/pdp-adapter/contract.
import { beforeAll, describe, expect, it } from 'vitest';
import { PDP_STATUSES, type PdpAdapter, PdpRequestError, type WebhookRequest } from './types';

export interface ContractHarness {
  adapter: PdpAdapter;
  account: string;
  /** A valid invoice (CII) with a number never used before. */
  validInvoice(): string;
  /** An invoice the platform must refuse: well-formed XML, a blocking EN 16931 error. */
  invalidInvoice(): string;
  /** A SIREN the platform's directory knows. */
  knownSiren: string;
  /** Waits until the platform has moved the invoice on (the mock advances its clock). */
  settle(): Promise<void>;
  /** A webhook the provider would send for this invoice, signed with the right secret. */
  signedWebhook?(pdpRef: string): WebhookRequest;
}

let sequence = 0;
const key = () => `contract-${Date.now()}-${++sequence}`;

export function pdpAdapterContract(name: string, setup: () => Promise<ContractHarness>): void {
  describe(`PdpAdapter contract: ${name}`, () => {
    let h: ContractHarness;
    beforeAll(async () => {
      h = await setup();
    });

    const deposit = async () => {
      const result = await h.adapter.sendInvoice({
        account: h.account,
        xml: h.validInvoice(),
        format: 'CII',
        idempotencyKey: key(),
      });
      if (result.outcome !== 'deposited') throw new Error(JSON.stringify(result.errors));
      return result.pdpRef;
    };

    it('deposits a valid invoice and returns its platform reference', async () => {
      expect(await deposit()).toMatch(/\S/);
    });

    it('deposits once for one idempotency key, however many times it is sent', async () => {
      const input = {
        account: h.account,
        xml: h.validInvoice(),
        format: 'CII' as const,
        idempotencyKey: key(),
      };
      const first = await h.adapter.sendInvoice(input);
      const second = await h.adapter.sendInvoice(input);
      expect(first.outcome).toBe('deposited');
      expect(second).toEqual(first);
    });

    it('refuses an invalid invoice with the rule and a message for each problem', async () => {
      const result = await h.adapter.sendInvoice({
        account: h.account,
        xml: h.invalidInvoice(),
        format: 'CII',
        idempotencyKey: key(),
      });
      expect(result.outcome).toBe('rejected');
      if (result.outcome !== 'rejected') return;
      expect(result.errors.length).toBeGreaterThan(0);
      for (const e of result.errors) {
        expect(e.rule).toMatch(/\S/);
        expect(e.message).toMatch(/\S/);
      }
    });

    it('gives the history oldest first, deposit first, one id per event', async () => {
      const pdpRef = await deposit();
      await h.settle();
      const events = await h.adapter.getStatus({ account: h.account, pdpRef });
      expect(events[0]?.status).toBe('deposited');
      expect(events.length).toBeGreaterThan(1);
      expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
      const times = events.map((e) => Date.parse(e.at));
      expect(times.every((t, i) => !Number.isNaN(t) && (i === 0 || t >= (times[i - 1] ?? 0)))).toBe(
        true,
      );
      for (const e of events) expect([...PDP_STATUSES, 'unknown']).toContain(e.status);
    });

    it('answers PdpRequestError for an invoice it does not have', async () => {
      await expect(
        h.adapter.getStatus({ account: h.account, pdpRef: 'no-such-invoice' }),
      ).rejects.toBeInstanceOf(PdpRequestError);
    });

    it('records a payment reported by the seller', async () => {
      const pdpRef = await deposit();
      await h.adapter.reportPayment({ account: h.account, pdpRef, amount: 12_000 });
      const events = await h.adapter.getStatus({ account: h.account, pdpRef });
      expect(events.map((e) => e.status)).toContain('payment_received');
    });

    it('finds a company the directory knows', async () => {
      const found = await h.adapter.lookupRecipient({ account: h.account, siren: h.knownSiren });
      expect(found?.siren).toBe(h.knownSiren);
    });

    it('lists inbound invoices as readable XML', async () => {
      const inbound = await h.adapter.listInbound({ account: h.account, since: new Date(0) });
      for (const i of inbound) {
        expect(i.pdpRef).toMatch(/\S/);
        expect(i.xml).toContain('<');
      }
    });

    it('refuses webhooks without a valid signature', async () => {
      const body = JSON.stringify({ hello: 'world' });
      expect(h.adapter.verifyWebhook({ headers: new Headers(), body })).toBe(false);
      if (!h.signedWebhook) return;
      const pdpRef = await deposit();
      const signed = h.signedWebhook(pdpRef);
      expect(h.adapter.verifyWebhook(signed)).toBe(true);
      expect(h.adapter.verifyWebhook({ ...signed, body: `${signed.body} ` })).toBe(false);
      expect(h.adapter.parseWebhook(signed.body)).toEqual([{ account: h.account, pdpRef }]);
    });

    it('answers PdpRequestError for a webhook body it cannot read', () => {
      expect(() => h.adapter.parseWebhook('not json')).toThrow(PdpRequestError);
      expect(() => h.adapter.parseWebhook('{"code":1}')).toThrow(PdpRequestError);
    });
  });
}
