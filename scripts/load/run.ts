// The k6 batch test (plan §9 « 1 000 invoices / tenant batch send », plan §11 M5): one company creates
// and sends N invoices through the HTTP API while k6 measures the answers; then every invoice must be
// at the platform exactly once and past « Envoi en cours ». The API and the mock platform run in this
// process on a throwaway Postgres; Postgres and k6 run in Docker (pinned images). docs/RUNBOOK.md § Load.
//   pnpm load                       pnpm load --invoices 200 --vus 10
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { SCENARIO_SELLER, scenarioDraft, startStack } from '@fi/api/scenarios';

const POSTGRES = 'postgres:17.11-alpine';
const K6 = 'grafana/k6:2.3.0';
/** Statuses an invoice of this run must have left once the platform took it. */
const NOT_THERE = ['validated', 'ready_to_send', 'sending'];

const { values } = parseArgs({
  options: {
    invoices: { type: 'string', default: '1000' },
    vus: { type: 'string', default: '20' },
  },
});
const total = Number(values.invoices);
const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim();

async function startPostgres(name: string): Promise<string> {
  docker(
    'run',
    '-d',
    '--rm',
    '--name',
    name,
    '-e',
    'POSTGRES_USER=fi',
    '-e',
    'POSTGRES_PASSWORD=fi',
    '-e',
    'POSTGRES_DB=fi',
    '-p',
    '127.0.0.1::5432',
    POSTGRES,
  );
  const port = docker('port', name, '5432/tcp').split(':').pop();
  // Over TCP: the image's first, setup-only server listens on its socket alone.
  for (let i = 0; i < 120; i++) {
    try {
      docker('exec', name, 'pg_isready', '-q', '-h', '127.0.0.1', '-U', 'fi');
      return `postgres://fi:fi@127.0.0.1:${port}/fi`;
    } catch {
      await sleep(500);
    }
  }
  throw new Error('Postgres did not start');
}

function k6(dir: string, env: Record<string, string>): Promise<number> {
  const args = [
    'run',
    '--rm',
    '--network',
    'host',
    '-v',
    `${here}:/scripts:ro`,
    '-v',
    `${dir}:/load`,
  ];
  for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
  args.push(K6, 'run', '--quiet', '/scripts/batch-send.js');
  return new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: 'inherit' });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const name = `fi-load-${process.pid}`;
const dir = mkdtempSync(join(tmpdir(), 'fi-load-'));
chmodSync(dir, 0o777); // k6's image runs as its own user and writes the summary here
let stack: Awaited<ReturnType<typeof startStack>> | undefined;
try {
  const databaseUrl = await startPostgres(name);
  stack = await startStack({ databaseUrl, sweepEverySeconds: 60 });
  const account = `${SCENARIO_SELLER.siren}-load`;
  const res = await fetch(`${stack.apiUrl}/admin/tenants`, {
    method: 'POST',
    headers: { authorization: `Bearer ${stack.adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ ...SCENARIO_SELLER, pdpProvider: 'mock', pdpAccount: account }),
  });
  if (res.status !== 201) throw new Error(`tenant: ${res.status} ${await res.text()}`);
  const { apiKey } = (await res.json()) as { apiKey: string };
  const drafts = Array.from({ length: total }, (_, i) => scenarioDraft(i + 1));
  writeFileSync(join(dir, 'drafts.json'), JSON.stringify(drafts));
  console.log(`${total} invoices, ${values.vus} VUs, ${POSTGRES}, ${K6}`);

  const mock = stack.mock;
  const statusesNow = async () => {
    const statuses = new Map<string, number>();
    for (let offset = 0; offset < total; offset += 200) {
      const page = await fetch(`${stack?.apiUrl}/invoices?limit=200&offset=${offset}`, {
        headers: { authorization: `Bearer ${apiKey}` },
      });
      const { invoices } = (await page.json()) as { invoices: { status: string }[] };
      for (const i of invoices) statuses.set(i.status, (statuses.get(i.status) ?? 0) + 1);
    }
    return statuses;
  };

  const started = performance.now();
  const code = await k6(dir, { API: stack.apiUrl, KEY: apiKey, VUS: String(values.vus) });
  const k6Seconds = (performance.now() - started) / 1000;

  // The API knows an invoice is at the platform once its send job has recorded the answer.
  const deadline = Date.now() + 10 * 60_000;
  let statuses = await statusesNow();
  let stuck = total;
  while (Date.now() < deadline) {
    statuses = await statusesNow();
    stuck = NOT_THERE.reduce((n, s) => n + (statuses.get(s) ?? 0), 0);
    if (stuck === 0) break;
    await sleep(250);
  }
  const settledSeconds = (performance.now() - started) / 1000;
  const atPlatform = mock.list(account);
  const numbers = new Set(atPlatform.map((i) => i.number));

  const summary = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')) as {
    metrics: Record<string, { values: Record<string, number> }>;
  };
  const trend = (metric: string) => summary.metrics[metric]?.values ?? {};
  const ms = (n: number | undefined) => `${Math.round(n ?? Number.NaN)} ms`;
  console.log(
    [
      '',
      `k6 exit ${code}, ${k6Seconds.toFixed(1)} s: ${trend('iterations').count} iterations, ${(trend('http_reqs').rate ?? 0).toFixed(1)} req/s`,
      `create: p95 ${ms(trend('http_req_duration{name:create}')['p(95)'])}  send: p95 ${ms(trend('http_req_duration{name:send}')['p(95)'])}  all: p95 ${ms(trend('http_req_duration')['p(95)'])}`,
      `at the platform: ${atPlatform.length} invoices, ${numbers.size} numbers, all recorded as there ${settledSeconds.toFixed(1)} s after the start (${(total / settledSeconds).toFixed(1)} invoices/s)`,
      `statuses: ${[...statuses].map(([s, n]) => `${s} ${n}`).join(', ')}`,
    ].join('\n'),
  );
  const ok = code === 0 && atPlatform.length === total && numbers.size === total && stuck === 0;
  console.log(ok ? 'PASS' : 'FAIL');
  process.exitCode = ok ? 0 : 1;
} finally {
  await stack?.close();
  try {
    docker('rm', '-f', name);
  } catch {
    // never started
  }
  rmSync(dir, { recursive: true, force: true });
}
