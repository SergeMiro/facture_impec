# BTP plan — stage 7: observability, performance, runbook, onboarding (2026-10-24)

BTP plan §11 and §12 stage 7, adapted by `docs/DECISIONS.md` D10. Stages 5 and 6 wait for access
(D3). Three series of commits, each with `pnpm verify` green:

## 7A — what runs, measured

| What | Where |
|---|---|
| JSON log lines with the request's or the job's context (`tenantId` always, `null` when no company); the request's id in a header `x-request-id`; a failed job and a 500 logged with their ids | `apps/api/src/log.ts` (new), `app.ts`, `auth.ts`, `runtime.ts`, `workers.ts` |
| `GET /metrics` behind `METRICS_TOKEN`: request and job durations, documents' times, jobs waiting and failed, tokens, ERP imports running, companies deciding | `apps/api/src/metrics.ts` (new), `app.ts`, `workers.ts`, `ingest.ts`, `document-pipeline.ts`, `@fi/shared` env, `.env.example` |
| Prometheus, Alertmanager and Grafana as a compose profile, the alert rules and their unit tests (`promtool`), a dashboard | `deploy/observability/`, `deploy/compose.yaml`, `docs/DEPLOY.md` |

## 7B — `pnpm perf`

| What | Where |
|---|---|
| §11's paths measured on N synthetic documents (1 000 by default), p95 against each budget, PASS or FAIL | `scripts/perf/run.ts`, `package.json` |
| A run of 20 in `pnpm test:scripts` so the script keeps working | `scripts/perf/perf.test.ts` |

## 7C — a company set up from the command line, and the runbook

| What | Where |
|---|---|
| `pnpm org create | show | pilot | platform` over the operator's routes | `scripts/org.ts`, `package.json` |
| The runbook: the metrics and what to do for each alert, `pnpm perf`, the ERP imports, a company set up with `pnpm org` | `docs/RUNBOOK.md` |

## Not in stage 7 (and where it goes)

- **Langfuse, OpenTelemetry**: D10, `docs/DEFERRED.md`.
- **The DoD's pilots**: the owner's (`docs/TODO.md`).

## Deviations found while building

7A:

- **Model tokens are a counter in the process** (`fi_llm_tokens_total`, `fi_agent_runs_total`), not
  the last 24 hours read from Postgres as D10 first said: a counter is what Prometheus sums over any
  window (`increase`, restarts included), and it is written where `agent_runs` is. D10 says so now.
- **Documents are timed by how they were read** (`read`: `xml`, `text`, `ocr`, `none`) besides their
  source: §11's budgets differ by it (5 s without OCR, 30 s with; 8 s with XML, 25 s without).
- **Every queue has its line**, from `pgboss.queue`, even one that never had a job; pg-boss's own
  (`__pgboss__…`) are left out; a database whose workers never started has none, and `/metrics` still
  answers.
- **An ERP import runs** while its result has no `finishedAt` and the row no `lastError`, as the pane
  says (`syncView`, `src/erp.ts`), timed from `startedAt`: `lastRunAt` moves with each batch.
- **Two alerts more than the plan**: `ApiDown` (a dead API silences every other alert) and
  `WatchersOverBudget` (§11's 60 s on 1 000 deadlines, on the chasing timer's own durations,
  `fi_periodic_run_seconds{task}`: the watchers run there, not in a queue; `pnpm perf` measures them
  on 1 000 deadlines). « decide → continued 2 s » is watched as
  `POST /actions/:id/decide`'s p95; the mail that follows is `action.send`'s time, on the dashboard.
- **Grafana on 3001**: 3000 is the add-in's dev server. **The API's log is rotated** by Docker
  (5 files of 10 MB): one JSON line per event would otherwise fill the disk.
- **Only a job's last attempt is an error.** One pg-boss will retry is a `warn` « job attempt failed »
  with its `attempt`; the one it will not (`retryCount` = `retryLimit`) is the `error` « job failed »:
  a platform's 503 that the second attempt gets past is not the operator's problem. The API's own
  tests drop the lines (`apps/api/src/test-setup.ts`; `FI_TEST_LOGS=1` shows them).

7B:

- **No k6 or autocannon**: the client is `fetch` in the API's own process (as `pnpm scenario`). The
  paths are timed on the server's side where they can be (the database's clock for documents, the
  send's `sent_at` for decisions), and a client's cost is far under the budgets. No Docker needed.
- **The 1 000 documents are the golden set made unique** (a comment after their end, which every
  reader skips), not a generator of their own: they are what stage 1 already proves is read right.
  45 % e-invoices, 50 % text PDFs, 5 % scans; 4 a second by default (§11 gives no pace), to
  companies of 100 (a company's backlog is 200, `src/ingest.ts`).
- **« WASM validation »** is the rules of `@fi/core` (TypeScript, D2), on one invoice at a time in
  the process, after a warm-up. **« decide → the graph continued »** is decide → the request sent
  (`action.send` through the outbox mailer): the step that follows, the queue's wait included.
- **Reads and decisions happen while the documents arrive**: a list is measured under load, as a
  person would see it on a busy morning.
- **A worker fetches again at once after a job** (found by the first full run): pg-boss waits its
  polling interval (2 s) after every fetch, busy or not, so the two `document.ingest` workers read
  at most one document a second and 4 a second piled up (read p95 606 s, 152 of 1 000 never
  settled). Now a worker that finishes a job wakes itself, and a job sent from the process wakes
  its queue's workers (`notifyWorker`, `src/jobs.ts`): they fetch until a fetch comes back empty,
  then poll again. pg-boss's own answers do not fit: `burstWhenReadyExceeds` reads queue counts
  cached for up to two minutes, `burstWhenBatchFull` needs batches, and LISTEN/NOTIFY wakes a
  worker for a new job but not through a backlog, and wants a session connection (no transaction
  pooler). A job sent from another process is still found by polling; LISTEN/NOTIFY is the step
  for several processes (`docs/DEFERRED.md`).
