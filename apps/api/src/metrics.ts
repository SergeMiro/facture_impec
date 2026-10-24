// `GET /metrics` in Prometheus' text format (BTP plan §11, docs/DECISIONS.md D10), written without a
// client library. What one process does is counted in it (requests, jobs, documents, model tokens);
// what every process shares is read from Postgres at each scrape (the queues, the ERP imports, the
// companies deciding), so two API processes never count it twice.
import { actions, and, connectorSyncs, type Db, gte, isNotNull, isNull, sql } from '@fi/db';
import { z } from 'zod';

type Labels = Record<string, string>;

/** Seconds; the budgets of BTP plan §11 (0.02, 0.2, 0.3, 2, 5, 8, 25, 30, 60) are bucket edges. */
export const BUCKETS = [
  0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.3, 0.5, 1, 2, 5, 8, 15, 25, 30, 60, 120, 300, 600,
];

const escapeLabel = (value: string) =>
  value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

const labelText = (labels: Labels) => {
  const pairs = Object.entries(labels).map(([k, v]) => `${k}="${escapeLabel(v)}"`);
  return pairs.length ? `{${pairs.join(',')}}` : '';
};

const keyOf = (labels: Labels) => JSON.stringify(Object.entries(labels).sort());

const head = (name: string, help: string, type: string) => [
  `# HELP ${name} ${help}`,
  `# TYPE ${name} ${type}`,
];

export class Histogram {
  /** Per label set: the cumulative count at each edge, the sum and the count of observations. */
  readonly #series = new Map<
    string,
    { labels: Labels; le: number[]; sum: number; count: number }
  >();

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  observe(labels: Labels, seconds: number): void {
    const key = keyOf(labels);
    let series = this.#series.get(key);
    if (!series) {
      series = { labels, le: BUCKETS.map(() => 0), sum: 0, count: 0 };
      this.#series.set(key, series);
    }
    const value = Math.max(0, seconds);
    BUCKETS.forEach((edge, i) => {
      if (value <= edge) series.le[i] = (series.le[i] ?? 0) + 1;
    });
    series.sum += value;
    series.count += 1;
  }

  /** How many were observed with these labels. */
  count(labels: Labels): number {
    return this.#series.get(keyOf(labels))?.count ?? 0;
  }

  render(): string[] {
    const lines = head(this.name, this.help, 'histogram');
    for (const { labels, le, sum, count } of this.#series.values()) {
      BUCKETS.forEach((edge, i) => {
        lines.push(`${this.name}_bucket${labelText({ ...labels, le: String(edge) })} ${le[i]}`);
      });
      lines.push(`${this.name}_bucket${labelText({ ...labels, le: '+Inf' })} ${count}`);
      lines.push(`${this.name}_sum${labelText(labels)} ${sum}`);
      lines.push(`${this.name}_count${labelText(labels)} ${count}`);
    }
    return lines;
  }
}

export class Counter {
  readonly #series = new Map<string, { labels: Labels; value: number }>();

  constructor(
    readonly name: string,
    readonly help: string,
  ) {}

  inc(labels: Labels, by = 1): void {
    const key = keyOf(labels);
    const series = this.#series.get(key) ?? { labels, value: 0 };
    series.value += by;
    this.#series.set(key, series);
  }

  value(labels: Labels): number {
    return this.#series.get(keyOf(labels))?.value ?? 0;
  }

  render(): string[] {
    const lines = head(this.name, this.help, 'counter');
    for (const { labels, value } of this.#series.values()) {
      lines.push(`${this.name}${labelText(labels)} ${value}`);
    }
    return lines;
  }
}

/** This process's counts. One per process: the workers and the routes add to the same. */
export const metrics = {
  requests: new Histogram(
    'fi_http_request_duration_seconds',
    'Time to answer a request, by method, route pattern and status class.',
  ),
  jobs: new Histogram(
    'fi_job_duration_seconds',
    'Time to run a job, by queue and outcome (ok or failed).',
  ),
  documentRead: new Histogram(
    'fi_document_read_seconds',
    'From a document’s arrival to its text or data read, by source and how it was read.',
  ),
  documentSettled: new Histogram(
    'fi_document_settled_seconds',
    'From a document’s arrival to done or needs_review, by source, how it was read and stage.',
  ),
  tokens: new Counter(
    'fi_llm_tokens_total',
    'Model tokens used, by agent, model and direction (input or output).',
  ),
  agentRuns: new Counter('fi_agent_runs_total', 'Model calls, by agent and status.'),
};

const gauge = (name: string, help: string, rows: { labels: Labels; value: number }[]) => [
  ...head(name, help, 'gauge'),
  ...rows.map((r) => `${name}${labelText(r.labels)} ${r.value}`),
];

/** pg-boss's own table, read as it answers (counts come back as text from node-postgres). */
const QueueCounts = z.object({
  rows: z.array(
    z.object({
      name: z.string(),
      waiting: z.coerce.number(),
      active: z.coerce.number(),
      failed: z.coerce.number(),
    }),
  ),
});

const QueueTable = z.object({ rows: z.array(z.object({ found: z.boolean() })) });

async function hasQueues(db: Db): Promise<boolean> {
  const answer = await db.execute(sql`select to_regclass('pgboss.queue') is not null as found`);
  return QueueTable.parse(answer).rows[0]?.found === true;
}

/** What Postgres says now, for every process: queues, ERP imports, companies deciding. */
async function shared(db: Db, now: Date): Promise<string[]> {
  // pg-boss creates its schema when the workers start; a database without them has no queue.
  const queues = (await hasQueues(db))
    ? await db.execute(
        // Every queue, with or without jobs; only the jobs that count are read.
        sql`select q.name,
          count(j.id) filter (where j.state in ('created', 'retry') and j.start_after <= now()) as waiting,
          count(j.id) filter (where j.state = 'active') as active,
          count(j.id) filter (where j.state = 'failed') as failed
        from pgboss.queue q
        left join pgboss.job j on j.name = q.name and (
          j.state in ('created', 'retry', 'active')
          or (j.state = 'failed' and j.completed_on > now() - interval '1 hour'))
        where not starts_with(q.name, '__pgboss__')
        group by q.name order by q.name`,
      )
    : { rows: [] };
  // An import runs until `finishedAt` is set; one that failed waits for its file again (src/erp.ts).
  const running = await db
    .select({
      connector: connectorSyncs.connector,
      since: sql<string | null>`min(${connectorSyncs.result}->>'startedAt')`,
    })
    .from(connectorSyncs)
    .where(
      and(
        isNull(connectorSyncs.lastError),
        sql`${connectorSyncs.result} is not null and ${connectorSyncs.result}->>'finishedAt' is null`,
      ),
    )
    .groupBy(connectorSyncs.connector);
  const [deciding] = await db
    .select({ count: sql<string>`count(distinct ${actions.tenantId})` })
    .from(actions)
    .where(
      and(isNotNull(actions.decidedAt), gte(actions.decidedAt, new Date(+now - 7 * 86_400_000))),
    );
  const { rows } = QueueCounts.parse(queues);
  return [
    ...gauge(
      'fi_jobs_waiting',
      'Jobs ready to run and not taken yet, by queue.',
      rows.map((r) => ({ labels: { queue: r.name }, value: r.waiting })),
    ),
    ...gauge(
      'fi_jobs_active',
      'Jobs running now, by queue.',
      rows.map((r) => ({ labels: { queue: r.name }, value: r.active })),
    ),
    ...gauge(
      'fi_jobs_failed_last_hour',
      'Jobs that used their retries and failed for good in the last hour, by queue.',
      rows.map((r) => ({ labels: { queue: r.name }, value: r.failed })),
    ),
    ...gauge(
      'fi_erp_import_running_seconds',
      'Age of the oldest ERP import still running, by list (export:customers…).',
      running.map((r) => ({
        labels: { connector: r.connector },
        value: r.since ? Math.max(0, secondsBetween(new Date(r.since), now)) : 0,
      })),
    ),
    ...gauge('fi_tenants_deciding_7d', 'Companies that decided a request in the last 7 days.', [
      { labels: {}, value: Number(deciding?.count ?? 0) },
    ]),
  ];
}

export async function renderMetrics(db: Db, now: Date): Promise<string> {
  const own = Object.values(metrics).flatMap((m) => m.render());
  return `${[...own, ...(await shared(db, now))].join('\n')}\n`;
}

const Extracted = z.object({
  format: z.string().optional(),
  ocr: z.boolean().optional(),
  text: z.string().optional(),
});

/**
 * How a document was read, the line between §11's budgets: its e-invoice data (`xml`, 8 s to
 * settle), its text layer (`text`, 5 s to read), OCR (`ocr`, 30 s), or nothing (`none`).
 */
export function readOf(extracted: unknown): 'xml' | 'ocr' | 'text' | 'none' {
  const found = Extracted.safeParse(extracted ?? {});
  if (!found.success) return 'none';
  if (found.data.format !== undefined) return 'xml';
  if (found.data.ocr === true) return 'ocr';
  return found.data.text !== undefined ? 'text' : 'none';
}

/** Seconds between two instants. */
export const secondsBetween = (from: Date, to: Date): number => (+to - +from) / 1000;
