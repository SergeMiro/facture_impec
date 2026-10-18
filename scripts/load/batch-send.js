// k6, plan §9 « 1 000 invoices / tenant batch send »: each iteration creates one invoice of the company
// and sends it, as « Envoyer » does. Started by scripts/load/run.ts, which hands it the API, the key and
// the drafts, then checks that every invoice reached the platform exactly once.
import { check } from 'k6';
import { SharedArray } from 'k6/data';
import exec from 'k6/execution';
import http from 'k6/http';

const drafts = new SharedArray('drafts', () => JSON.parse(open('/load/drafts.json')));
const API = __ENV.API;
const headers = { authorization: `Bearer ${__ENV.KEY}`, 'content-type': 'application/json' };

export const options = {
  scenarios: {
    batch: {
      executor: 'shared-iterations',
      vus: Number(__ENV.VUS || 20),
      iterations: drafts.length,
      maxDuration: '15m',
    },
  },
  thresholds: {
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
    // Listed so that the summary has the two requests apart.
    'http_req_duration{name:create}': ['max>=0'],
    'http_req_duration{name:send}': ['max>=0'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

export default function () {
  const draft = drafts[exec.scenario.iterationInTest];
  const created = http.post(`${API}/invoices`, JSON.stringify({ draft }), {
    headers,
    tags: { name: 'create' },
  });
  const valid = check(created, {
    'created and valid': (r) => r.status === 201 && r.json('status') === 'validated',
  });
  if (!valid) return;
  const sent = http.post(`${API}/invoices/${created.json('id')}/send`, null, {
    headers,
    tags: { name: 'send' },
  });
  check(sent, { 'send accepted': (r) => r.status === 202 && r.json('alreadySent') === false });
}

/** The numbers for run.ts, which prints them with what the platform received. */
export function handleSummary(data) {
  return { '/load/summary.json': JSON.stringify(data) };
}
