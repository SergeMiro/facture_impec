// The same scenarios through the real B2Brouter adapter (plan §11 M4), against the stand-in the mock
// serves at /b2brouter: B2Brouter's protocol, the mock's engine and accelerated clock. The same runs
// as `pnpm scenario --provider b2brouter all`; docs/RUNBOOK.md has the run against the real sandbox.
import { describe, expect, it } from 'vitest';
import { loadScenario, runScenario, type ScenarioReport, stackFor, startStack } from './scenarios';

async function run(name: string): Promise<ScenarioReport> {
  const stack = await startStack({ provider: 'b2brouter', ...stackFor(loadScenario(name)) });
  try {
    return await runScenario(name, loadScenario(name), stack);
  } finally {
    await stack.close();
  }
}

const passes = (report: ScenarioReport) => {
  expect(report.failures).toEqual([]);
  expect(report.ok).toBe(true);
};

describe('scenarios through the B2Brouter adapter', () => {
  it('happy: 10 invoices reach paid in < 60 s, each through every status', async () => {
    const report = await run('happy');
    passes(report);
    for (const i of report.invoices) {
      expect(i.timeline).toEqual([
        'validated',
        'ready_to_send',
        'sending',
        'deposited',
        'delivered',
        'accepted',
        'paid',
      ]);
    }
  }, 90_000);

  it('duplicate-send: no idempotency key at B2Brouter, still one invoice per number', async () => {
    const report = await run('duplicate-send');
    passes(report);
    expect(report.invoices.every((i) => i.deposits === 1 && i.depositedTransitions === 1)).toBe(
      true,
    );
  }, 60_000);

  it('network-flap: lost answers and failing webhooks still end in paid, deposited once', async () => {
    passes(await run('network-flap'));
  }, 60_000);

  it('pdp-reject and customer-refuse land on the invoice', async () => {
    passes(await run('pdp-reject'));
    passes(await run('customer-refuse'));
  }, 60_000);

  it('late-payment: the chasing steps on their days, the payment from B2Brouter ends the plan', async () => {
    const report = await run('late-payment');
    passes(report);
    expect(report.chase).toHaveLength(5);
  }, 60_000);
});
