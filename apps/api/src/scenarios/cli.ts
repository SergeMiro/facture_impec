// `pnpm scenario <name>…` (scripts/run-scenario.ts). Each scenario gets its own in-process stack.
import { runScenario, type ScenarioReport } from './runner';
import { loadScenario, scenarioNames } from './scenario';
import { startStack } from './stack';

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
  for (const f of report.failures) console.log(`  ✗ ${f}`);
}

/** Returns the process exit code. */
export async function main(args: string[]): Promise<number> {
  const available = scenarioNames();
  const names = args.length === 0 ? ['happy'] : args.includes('all') ? available : args;
  const unknown = names.filter((n) => !available.includes(n));
  if (unknown.length > 0) {
    console.error(
      `unknown scenario(s): ${unknown.join(', ')}. Available: ${available.join(', ')}, all`,
    );
    return 2;
  }
  let failed = 0;
  for (const name of names) {
    const stack = await startStack();
    try {
      const report = await runScenario(name, loadScenario(name), stack, (line) =>
        console.log(line),
      );
      print(report);
      if (!report.ok) failed++;
    } finally {
      await stack.close();
    }
  }
  console.log(`\n${names.length - failed}/${names.length} scenario(s) passed`);
  return failed === 0 ? 0 : 1;
}
