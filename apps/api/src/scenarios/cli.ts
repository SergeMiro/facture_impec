// `pnpm scenario [--provider b2brouter] <name>…` (scripts/run-scenario.ts). Each scenario gets its
// own in-process stack.
import { PDP_PROVIDERS, type PdpProvider } from '@fi/db';
import { z } from 'zod';
import { runScenario, type ScenarioReport } from './runner';
import { loadScenario, scenarioNames } from './scenario';
import { stackFor, startStack } from './stack';

function print(report: ScenarioReport): void {
  const verdict = report.ok ? 'PASS' : 'FAIL';
  const time = Number.isNaN(report.seconds) ? 'did not finish' : `${report.seconds.toFixed(1)} s`;
  console.log(`\n${verdict} ${report.name} — ${time} (limit ${report.expected.withinSeconds} s)`);
  console.log(`  ${report.description}`);
  for (const i of report.invoices) {
    console.log(
      `  ${i.number.padEnd(12)} ${i.status.padEnd(20)} deposits at platform: ${i.deposits}  timeline: ${i.timeline.join(' → ')}`,
    );
  }
  for (const line of report.chase) console.log(`  ${line}`);
  for (const f of report.failures) console.log(`  ✗ ${f}`);
}

/** Returns the process exit code. `--provider b2brouter` goes through the B2Brouter adapter. */
export async function main(argv: string[]): Promise<number> {
  const args = [...argv];
  let provider: PdpProvider = 'mock';
  const flag = args.findIndex((a) => a === '--provider' || a.startsWith('--provider='));
  if (flag >= 0) {
    const [option = ''] = args.splice(flag, 1);
    const value = option.includes('=')
      ? option.slice(option.indexOf('=') + 1)
      : args.splice(flag, 1)[0];
    const parsed = z.enum(PDP_PROVIDERS).safeParse(value);
    if (!parsed.success) {
      console.error(`--provider takes one of: ${PDP_PROVIDERS.join(', ')}`);
      return 2;
    }
    provider = parsed.data;
  }
  const available = scenarioNames();
  const names = args.length === 0 ? ['happy'] : args.includes('all') ? available : args;
  const unknown = names.filter((n) => !available.includes(n));
  if (unknown.length > 0) {
    console.error(
      `unknown scenario(s): ${unknown.join(', ')}. Available: ${available.join(', ')}, all`,
    );
    return 2;
  }
  console.log(`platform adapter: ${provider}`);
  let failed = 0;
  for (const name of names) {
    const scenario = loadScenario(name);
    const stack = await startStack({ provider, ...stackFor(scenario) });
    try {
      const report = await runScenario(name, scenario, stack, (line) => console.log(line));
      print(report);
      if (!report.ok) failed++;
    } finally {
      await stack.close();
    }
  }
  console.log(`\n${names.length - failed}/${names.length} scenario(s) passed`);
  return failed === 0 ? 0 : 1;
}
