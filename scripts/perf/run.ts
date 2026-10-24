// `pnpm perf`: BTP plan §11's latency budgets on the whole API in this process (the logic is in
// apps/api/src/scenarios/perf.ts; docs/RUNBOOK.md § Performance). Exit code 1 when a path is over.
//   pnpm perf                         pnpm perf --documents 200 --rate 8
//   pnpm perf --database-url postgres://fi:fi@127.0.0.1:5432/fi     (a throwaway database: it is written)
import { parseArgs } from 'node:util';
import { formatPerf, runPerf } from '@fi/api/scenarios';

const { values } = parseArgs({
  options: {
    documents: { type: 'string', default: '1000' },
    rate: { type: 'string', default: '4' },
    deadlines: { type: 'string', default: '1000' },
    decisions: { type: 'string', default: '20' },
    reads: { type: 'string', default: '50' },
    'database-url': { type: 'string' },
  },
});
const number = (name: keyof typeof values) => {
  const value = Number(values[name]);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} takes a positive number`);
  return value;
};

const report = await runPerf({
  documents: number('documents'),
  rate: number('rate'),
  deadlines: number('deadlines'),
  decisions: number('decisions'),
  reads: number('reads'),
  ...(values['database-url'] && { databaseUrl: values['database-url'] }),
  log: (line) => console.log(line),
});
for (const line of formatPerf(report)) console.log(line);
process.exitCode = report.pass ? 0 : 1;
