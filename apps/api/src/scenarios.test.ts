// Plan §9 scenarios, end to end over HTTP: the API with its pg-boss workers, the mock platform with its
// accelerated clock, webhooks between them. The same runs as `pnpm scenario all`.
import { describe, expect, it } from 'vitest';
import { loadScenario, runScenario, type ScenarioReport, startStack } from './scenarios';
import type { StackOptions } from './scenarios/stack';

async function run(name: string, options: StackOptions = {}): Promise<ScenarioReport> {
  const stack = await startStack(options);
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

describe('scenarios', () => {
  it('happy: 10 invoices reach paid in < 60 s at a day per second', async () => {
    const report = await run('happy');
    passes(report);
    expect(report.invoices).toHaveLength(10);
    expect(report.seconds).toBeLessThan(60);
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

  it('duplicate-send: double creation, five « Envoyer » and a lost answer deposit once', async () => {
    const report = await run('duplicate-send');
    passes(report);
    expect(report.invoices.every((i) => i.deposits === 1 && i.depositedTransitions === 1)).toBe(
      true,
    );
    // The first deposit's answer was lost: that invoice went back to ready_to_send and was retried.
    expect(report.invoices.some((i) => i.timeline.filter((s) => s === 'sending').length > 1)).toBe(
      true,
    );
  }, 60_000);

  it('network-flap: outages and failing webhooks still end in paid, deposited once', async () => {
    passes(await run('network-flap'));
  }, 60_000);

  it('pdp-reject: the platform rejection lands on the invoice', async () => {
    const report = await run('pdp-reject');
    passes(report);
    expect(report.invoices[0]?.timeline.at(-1)).toBe('rejected_by_pdp');
  }, 30_000);

  it('customer-refuse: the customer refusal lands on the invoice', async () => {
    passes(await run('customer-refuse'));
  }, 30_000);

  it('customer-refuse without webhooks: the sweep alone brings the news', async () => {
    passes(await run('customer-refuse', { webhooks: false }));
  }, 30_000);
});
