// Plan §9 scenarios, end to end over HTTP: the API with its pg-boss workers, the mock platform with its
// accelerated clock, webhooks between them. The same runs as `pnpm scenario all`.
import { describe, expect, it } from 'vitest';
import { loadScenario, runScenario, type ScenarioReport, startStack } from './scenarios';
import { SCENARIO_SELLER, scenarioDraft } from './scenarios/invoice';
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

describe('Mode test on the mock platform', () => {
  it('« Simuler un rejet PDP » travels mock → webhook → sync to the test invoice', async () => {
    // Real time on the mock: its own timeline does not move while the scenario plays.
    const stack = await startStack({ speed: 1 });
    try {
      const call = async (path: string, token: string, body?: unknown) => {
        const res = await fetch(`${stack.apiUrl}${path}`, {
          method: body === undefined ? 'GET' : 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          ...(body !== undefined && { body: JSON.stringify(body) }),
        });
        return (await res.json()) as { id: string; status: string; apiKey: string; number: string };
      };
      const { apiKey } = await call('/admin/tenants', stack.adminToken, {
        ...SCENARIO_SELLER,
        pdpAccount: 'acct-mode-test',
      });
      const created = await call('/invoices', apiKey, { draft: scenarioDraft(1), test: true });
      expect(created.number).toMatch(/^TEST-/);
      await call(`/invoices/${created.id}/send`, apiKey, {});
      const until = async (status: string) => {
        for (let i = 0; i < 100; i++) {
          if ((await call(`/invoices/${created.id}`, apiKey)).status === status) return;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error(`never reached ${status}`);
      };
      await until('deposited');
      await call(`/invoices/${created.id}/scenario`, apiKey, { scenario: 'pdp_reject' });
      await until('rejected_by_pdp');
    } finally {
      await stack.close();
    }
  }, 30_000);
});
