// The PdpAdapter contract against B2Brouter's real sandbox (plan §9: nightly or by hand, never in
// `pnpm verify`). It runs only with the owner's sandbox key, the account it serves and a SIREN the
// sandbox directory knows (docs/RUNBOOK.md § B2Brouter sandbox); without them it is skipped.
import { readFileSync } from 'node:fs';
import { computeInvoice, frenchVatKey, type InvoiceDraft, toCii } from '@fi/core';
import { it, vi } from 'vitest';
import { pdpAdapterContract } from '../contract';
import { createB2BrouterAdapter } from './adapter';
import { environmentOfKey } from './protocol';

const key = process.env.FI_LIVE_B2BROUTER_KEY;
const account = process.env.FI_LIVE_B2BROUTER_ACCOUNT;
const siren = process.env.FI_LIVE_B2BROUTER_SIREN;

const golden = JSON.parse(
  readFileSync(
    new URL('../../../../fixtures/golden/01-services-standard-rate.json', import.meta.url),
    'utf8',
  ),
) as { draft: InvoiceDraft };

let sequence = 0;

/** Golden invoice 01 to the known customer, with a number the sandbox has never seen (≤ 20). */
function invoice(knownSiren: string, change: (d: InvoiceDraft) => void = () => {}): string {
  const d = structuredClone(golden.draft);
  d.number = `FI-${Date.now().toString(36).toUpperCase()}-${++sequence}`;
  d.buyer.legalId = { id: knownSiren, scheme: '0002' };
  d.buyer.electronicAddress = { id: knownSiren, scheme: '0225' };
  d.buyer.vatId = `FR${frenchVatKey(knownSiren)}${knownSiren}`;
  change(d);
  return toCii(computeInvoice(d));
}

if (key && account && siren) {
  // These tests send invoices: never with a key that reaches real customers.
  if (environmentOfKey(key) !== 'sandbox')
    throw new Error('FI_LIVE_B2BROUTER_KEY: sandbox keys only');
  vi.setConfig({ testTimeout: 180_000, hookTimeout: 60_000 });
  const adapter = createB2BrouterAdapter({ apiKey: key });
  pdpAdapterContract('B2Brouter sandbox (live)', async () => ({
    adapter,
    account,
    validInvoice: () => invoice(siren),
    invalidInvoice: () => invoice(siren, (d) => (d.buyer.name = '')),
    knownSiren: siren,
    // What the sandbox does after « sent », and how fast, is docs/B2BROUTER.md §11 T20: up to two
    // minutes for the last deposit to show a second event.
    settle: async () => {
      for (let i = 0; i < 24; i++) await new Promise((r) => setTimeout(r, 5_000));
    },
  }));
} else {
  it.skip('PdpAdapter contract: B2Brouter sandbox (live) — FI_LIVE_B2BROUTER_* unset', () => {});
}
