// `pnpm perf` (BTP plan §11, docs/DECISIONS.md D10, docs/plans/phase-7.md › 7B): §11's latency
// budgets measured on the whole API in this process, as it runs in production but for the model (off)
// and the database (PGlite in memory, or the Postgres `databaseUrl` names): the workers poll every
// 2 s and the sweep runs every 5 minutes. N documents from the golden set (scripts/golden), each made
// unique, arrive at a steady pace through `POST /ingest`; meanwhile a company of 1 000 deadlines lists
// its requests and deadlines and decides some. An invoice is checked by the rules on its own. Each
// path's p95 is held to its budget.
import { createHash } from 'node:crypto';
import { parisToday, validate } from '@fi/core';
import { computeGolden, goldens } from '@fi/core/testing';
import {
  actions,
  and,
  auditEvents,
  blobs,
  documents,
  eq,
  inArray,
  obligations,
  parties,
  sql,
} from '@fi/db';
import {
  GOLDEN_COMPANIES,
  type GoldenDocument,
  goldenDocuments,
} from '../../scripts/golden/documents';
import { metrics, readOf } from '../metrics';
import { runWatchers } from '../watchers';
import { SCENARIO_SELLER } from './invoice';
import { type Stack, startStack } from './stack';

/** §11's paths and their p95 budgets, in seconds. */
export const BUDGETS = {
  ingest: { title: 'POST /ingest → its answer', seconds: 0.3 },
  read: { title: 'a document read without OCR (XML or text)', seconds: 5 },
  readOcr: { title: 'a document read by OCR', seconds: 30 },
  validate: { title: 'one invoice checked by the rules', seconds: 0.02 },
  settledXml: { title: 'an invoice with its XML, to done', seconds: 8 },
  settledPdf: { title: 'a document without XML, to done or review', seconds: 25 },
  decide: { title: 'POST /actions/:id/decide → the request sent', seconds: 2 },
  watchers: { title: 'the deadline watchers, a company of 1 000 deadlines', seconds: 60 },
  actions: { title: 'GET /actions', seconds: 0.2 },
  obligations: { title: 'GET /obligations', seconds: 0.2 },
} as const;

export type PerfPath = keyof typeof BUDGETS;

export interface PerfOptions {
  /** Documents through `POST /ingest`; default 1 000. */
  documents?: number;
  /** Documents arriving per second; default 4. */
  rate?: number;
  /** Deadlines of the watched company; default 1 000, a tenth of them due within 30 days. */
  deadlines?: number;
  /** Requests decided while the documents arrive; default 20. */
  decisions?: number;
  /** `GET /actions` and `GET /obligations` each, while the documents arrive; default 50. */
  reads?: number;
  /** Invoices checked by the rules; default 1 000. */
  validations?: number;
  /** A Postgres instead of PGlite in memory. */
  databaseUrl?: string;
  /** How long to wait for every document to settle and every request to be sent; default 600 s. */
  timeoutSeconds?: number;
  /** Progress lines. */
  log?: (line: string) => void;
}

export interface PathResult {
  path: PerfPath;
  title: string;
  budget: number;
  count: number;
  p50: number;
  p95: number;
  max: number;
  /** p95 within budget, with at least one measure. */
  pass: boolean;
}

export interface PerfReport {
  pass: boolean;
  results: PathResult[];
  /** Documents sent, by how they were read; those that never settled. */
  documents: { sent: number; read: Record<string, number>; unsettled: number };
  /** Drafts the watchers wrote; requests decided; those never sent. */
  requests: { drafted: number; decided: number; unsent: number };
  seconds: number;
}

/** Nearest-rank percentile of sorted values. */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  return sorted[Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)] ?? Number.NaN;
}

export function summarize(samples: Record<PerfPath, number[]>): PathResult[] {
  return (Object.keys(BUDGETS) as PerfPath[]).map((path) => {
    const sorted = [...samples[path]].sort((a, b) => a - b);
    const p95 = percentile(sorted, 95);
    return {
      path,
      title: BUDGETS[path].title,
      budget: BUDGETS[path].seconds,
      count: sorted.length,
      p50: percentile(sorted, 50),
      p95,
      max: sorted.at(-1) ?? Number.NaN,
      pass: sorted.length > 0 && p95 <= BUDGETS[path].seconds,
    };
  });
}

/** The audited steps of a document's way: read, then checked or classified (src/ingest.ts). */
const DOCUMENT_STEPS = ['document.read', 'document.validate', 'document.classify'];

type Kind = 'xml' | 'text' | 'ocr';

/** The golden documents a company of the buyer receives, by how they are read. */
async function pool(): Promise<Record<Kind, GoldenDocument[]>> {
  const set = (await goldenDocuments()).filter((d) => d.to === 'buyer' && 'stage' in d.expect);
  const pdf = (d: GoldenDocument) => Buffer.from(d.bytes.subarray(0, 5)).toString() === '%PDF-';
  const of = (kind: Kind) =>
    set.filter((d) => {
      if (!('stage' in d.expect)) return false;
      if (kind === 'xml') return d.expect.format !== undefined;
      if (kind === 'ocr') return d.expect.ocr === true && pdf(d);
      return d.expect.ocr === false;
    });
  return { xml: of('xml'), text: of('text'), ocr: of('ocr') };
}

/** 45 % e-invoices, 50 % text PDFs, 5 % scans: one in twenty is read by OCR. */
const kindOf = (i: number): Kind => (i % 20 === 19 ? 'ocr' : i % 20 < 9 ? 'xml' : 'text');

/** Bytes no earlier document has: a comment after the end, which every reader skips. */
function unique(doc: GoldenDocument, mark: string): Uint8Array {
  const xml = doc.name.endsWith('.xml');
  const tail = new TextEncoder().encode(xml ? `\n<!-- perf ${mark} -->\n` : `\n%perf ${mark}\n`);
  const bytes = new Uint8Array(doc.bytes.length + tail.length);
  bytes.set(doc.bytes);
  bytes.set(tail, doc.bytes.length);
  return bytes;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const seconds = (from: number) => (performance.now() - from) / 1000;

async function until(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return true;
    await sleep(250);
  }
  return false;
}

async function call(
  stack: Stack,
  path: string,
  init: { token: string; method?: string; body?: Uint8Array; json?: unknown },
): Promise<{ status: number; body: unknown; seconds: number }> {
  const started = performance.now();
  const res = await fetch(`${stack.apiUrl}${path}`, {
    method: init.method ?? 'GET',
    headers: {
      authorization: `Bearer ${init.token}`,
      ...(init.json !== undefined && { 'content-type': 'application/json' }),
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : init.body,
  });
  const body: unknown = await res.json().catch(() => null);
  return { status: res.status, body, seconds: seconds(started) };
}

async function newCompany(
  stack: Stack,
  identity: { siren: string; name: string },
  account: string,
): Promise<{ id: string; apiKey: string }> {
  const res = await call(stack, '/admin/tenants', {
    token: stack.adminToken,
    method: 'POST',
    json: { ...identity, pdpAccount: account },
  });
  const body = res.body as { tenant?: { id: string }; apiKey?: string } | null;
  if (res.status !== 201 || !body?.tenant || !body.apiKey) {
    throw new Error(`company not created: ${res.status}`);
  }
  return { id: body.tenant.id, apiKey: body.apiKey };
}

/** A company with one sous-traitant and `count` attestations to renew, a tenth due within 30 days. */
async function watchedCompany(stack: Stack, count: number) {
  const company = await newCompany(stack, SCENARIO_SELLER, 'perf-deadlines');
  const db = stack.api.database.db;
  const [sub] = await db
    .insert(parties)
    .values({
      tenantId: company.id,
      kind: 'supplier',
      legalName: 'Plâtrerie Dumas',
      siren: '200000009',
      email: 'contact@platrerie-dumas.example',
      subcontracting: true,
      source: 'invoice',
    })
    .returning({ id: parties.id });
  if (!sub) throw new Error('no supplier');
  const today = Date.parse(`${parisToday()}T12:00:00Z`);
  const day = (n: number) => new Date(today + n * 86_400_000).toISOString().slice(0, 10);
  const receivedAt = new Date();
  // Each deadline comes from its attestation, as when they are received.
  const files = Array.from({ length: count }, (_, i) => {
    const sha256 = createHash('sha256').update(`perf-${company.id}-${i}`).digest('hex');
    return { sha256, storageKey: `${company.id}/${sha256}` };
  });
  const rows: (typeof obligations.$inferInsert)[] = [];
  for (let i = 0; i < count; i += 500) {
    const batch = files.slice(i, i + 500);
    await db.insert(blobs).values(
      batch.map((f) => ({
        key: f.storageKey,
        tenantId: company.id,
        sha256: f.sha256,
        size: 3,
        mime: 'application/pdf',
        bytes: new Uint8Array([1, 2, 3]),
      })),
    );
    const made = await db
      .insert(documents)
      .values(
        batch.map((f, j) => ({
          tenantId: company.id,
          source: 'mail' as const,
          sourceRef: `<perf-${i + j}@example>`,
          name: `attestation-${i + j}.pdf`,
          mime: 'application/pdf',
          size: 3,
          sha256: f.sha256,
          storageKey: f.storageKey,
          kind: 'attestation_vigilance' as const,
          stage: 'done' as const,
          partyId: sub.id,
          isTest: false,
          receivedAt,
        })),
      )
      .returning({ id: documents.id });
    made.forEach((d, j) => {
      const k = i + j;
      rows.push({
        tenantId: company.id,
        kind: 'attestation_vigilance_renouvellement',
        key: `attestation_vigilance_renouvellement:perf-${k}`,
        partyId: sub.id,
        sourceDocumentId: d.id,
        // One in ten within the watchers' 30 days; the others up to 400 days away.
        dueOn: k % 10 === 0 ? day(1 + (k % 29)) : day(31 + (k % 370)),
        isTest: false,
      });
    });
  }
  for (let i = 0; i < rows.length; i += 500) {
    await db.insert(obligations).values(rows.slice(i, i + 500));
  }
  return { ...company, due: rows.filter((_, i) => i % 10 === 0).length };
}

export async function runPerf(options: PerfOptions = {}): Promise<PerfReport> {
  const n = options.documents ?? 1000;
  const rate = options.rate ?? 4;
  const reads = options.reads ?? 50;
  const log = options.log ?? (() => {});
  const timeoutMs = (options.timeoutSeconds ?? 600) * 1000;
  const samples = Object.fromEntries(
    (Object.keys(BUDGETS) as PerfPath[]).map((p) => [p, [] as number[]]),
  ) as Record<PerfPath, number[]>;
  const started = performance.now();

  // The rules on one invoice, on their own: the goldens, after a warm-up.
  const invoices = goldens.map(computeGolden);
  for (const invoice of invoices.slice(0, 20)) validate(invoice);
  for (let i = 0; i < (options.validations ?? 1000); i++) {
    const invoice = invoices[i % invoices.length];
    if (!invoice) break;
    const at = performance.now();
    validate(invoice);
    samples.validate.push(seconds(at));
  }

  const documentPool = await pool();
  const stack = await startStack({
    sweepEverySeconds: 300,
    pollingIntervalSeconds: 2,
    // The chasing timer runs as the API starts; the watchers are timed here, alone.
    collectEverySeconds: 86_400,
    ...(options.databaseUrl && { databaseUrl: options.databaseUrl }),
  });
  try {
    const db = stack.api.database.db;
    if (
      !(await until(
        async () => metrics.periodic.count({ task: 'purge', outcome: 'ok' }) > 0,
        30_000,
      ))
    ) {
      throw new Error('the chasing timer did not run at start');
    }

    // The watchers on a company of `deadlines` deadlines.
    const watched = await watchedCompany(stack, options.deadlines ?? 1000);
    log(`${options.deadlines ?? 1000} deadlines written, ${watched.due} due within 30 days`);
    const at = performance.now();
    const run = await runWatchers({ db, jobs: stack.api.deps.jobs, now: () => new Date() });
    samples.watchers.push(seconds(at));
    log(`watchers: ${run.drafted} drafted in ${seconds(at).toFixed(1)} s`);
    const drafts = await db
      .select({ id: actions.id, revision: actions.revision })
      .from(actions)
      .where(and(eq(actions.tenantId, watched.id), eq(actions.status, 'draft')));
    const toDecide = drafts.slice(0, options.decisions ?? 20);

    // The documents, at a steady pace, to companies of 100 (a company's backlog is 200).
    const companies: { apiKey: string }[] = [];
    for (let c = 0; c < Math.ceil(n / 100); c++) {
      companies.push(await newCompany(stack, GOLDEN_COMPANIES.buyer, `perf-${c}`));
    }
    const ids: string[] = [];
    const pending: Promise<void>[] = [];
    const decidedAt = new Map<string, number>();
    const everyRead = reads > 0 ? Math.max(1, Math.floor(n / reads)) : Number.POSITIVE_INFINITY;
    const everyDecision = toDecide.length > 0 ? Math.max(1, Math.floor(n / toDecide.length)) : 0;
    const begin = performance.now();
    let readsDone = 0;
    let decided = 0;
    for (let i = 0; i < n; i++) {
      const wait = begin + (i * 1000) / rate - performance.now();
      if (wait > 0) await sleep(wait);
      const kind = kindOf(i);
      const from = documentPool[kind];
      const doc = from[i % from.length];
      if (!doc) throw new Error(`no golden document read by ${kind}`);
      const company = companies[Math.floor(i / 100)];
      if (!company) throw new Error('no company');
      pending.push(
        call(stack, `/ingest?name=${encodeURIComponent(doc.name)}`, {
          token: company.apiKey,
          method: 'POST',
          body: unique(doc, `${i}`),
        }).then((res) => {
          if (res.status !== 201) throw new Error(`POST /ingest: ${res.status}`);
          samples.ingest.push(res.seconds);
          ids.push((res.body as { id: string }).id);
        }),
      );
      if (i % everyRead === 0 && readsDone < reads) {
        readsDone++;
        pending.push(
          call(stack, '/actions', { token: watched.apiKey }).then((r) => {
            if (r.status !== 200) throw new Error(`GET /actions: ${r.status}`);
            samples.actions.push(r.seconds);
          }),
          call(stack, '/obligations', { token: watched.apiKey }).then((r) => {
            if (r.status !== 200) throw new Error(`GET /obligations: ${r.status}`);
            samples.obligations.push(r.seconds);
          }),
        );
      }
      const action = everyDecision && i % everyDecision === 0 ? toDecide[decided] : undefined;
      if (action) {
        decided++;
        const when = Date.now();
        pending.push(
          call(stack, `/actions/${action.id}/decide`, {
            token: watched.apiKey,
            method: 'POST',
            json: { decision: 'approve', revision: action.revision },
          }).then((r) => {
            if (r.status !== 200) throw new Error(`decide: ${r.status}`);
            decidedAt.set(action.id, when);
          }),
        );
      }
      if ((i + 1) % 100 === 0) log(`${i + 1}/${n} documents sent`);
    }
    await Promise.all(pending);

    // Every document settled, every approved request sent.
    const settled = async () => {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(documents)
        .where(and(inArray(documents.id, ids), inArray(documents.stage, ['done', 'needs_review'])));
      return (row?.n ?? 0) === ids.length;
    };
    const decidedIds = [...decidedAt.keys()];
    const sent = async () => {
      if (decidedIds.length === 0) return true;
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(actions)
        .where(and(inArray(actions.id, decidedIds), eq(actions.status, 'sent')));
      return (row?.n ?? 0) === decidedIds.length;
    };
    await until(async () => (await settled()) && (await sent()), timeoutMs);

    // On the database's clock: each document's arrival, its read, its last step.
    const rows = ids.length
      ? await db
          .select({
            id: documents.id,
            stage: documents.stage,
            extracted: documents.extracted,
            createdAt: documents.createdAt,
          })
          .from(documents)
          .where(inArray(documents.id, ids))
      : [];
    const steps = ids.length
      ? await db
          .select({
            id: auditEvents.objectId,
            read: sql<
              string | null
            >`min(${auditEvents.at}) filter (where ${auditEvents.action} = 'document.read')`,
            last: sql<string | null>`max(${auditEvents.at})`,
          })
          .from(auditEvents)
          .where(
            and(
              eq(auditEvents.objectType, 'document'),
              inArray(auditEvents.objectId, ids),
              inArray(auditEvents.action, DOCUMENT_STEPS),
            ),
          )
          .groupBy(auditEvents.objectId)
      : [];
    const stepsOf = new Map(steps.map((s) => [s.id, s]));
    const readBy: Record<string, number> = {};
    let unsettled = 0;
    for (const row of rows) {
      const read = readOf(row.extracted);
      readBy[read] = (readBy[read] ?? 0) + 1;
      const created = +new Date(row.createdAt);
      const step = stepsOf.get(row.id);
      if (step?.read) {
        const took = (+new Date(step.read) - created) / 1000;
        (read === 'ocr' ? samples.readOcr : samples.read).push(took);
      }
      if ((row.stage !== 'done' && row.stage !== 'needs_review') || !step?.last) {
        unsettled++;
        continue;
      }
      const took = (+new Date(step.last) - created) / 1000;
      (read === 'xml' ? samples.settledXml : samples.settledPdf).push(took);
    }
    const sentRows = decidedIds.length
      ? await db
          .select({ id: actions.id, sentAt: actions.sentAt })
          .from(actions)
          .where(inArray(actions.id, decidedIds))
      : [];
    let unsent = 0;
    for (const a of sentRows) {
      const when = decidedAt.get(a.id);
      if (!a.sentAt || when === undefined) unsent++;
      else samples.decide.push((+a.sentAt - when) / 1000);
    }

    const results = summarize(samples);
    return {
      pass: results.every((r) => r.pass) && unsettled === 0 && unsent === 0,
      results,
      documents: { sent: ids.length, read: readBy, unsettled },
      requests: { drafted: run.drafted, decided: decidedIds.length, unsent },
      seconds: seconds(started),
    };
  } finally {
    await stack.close();
  }
}

const time = (s: number) =>
  Number.isNaN(s)
    ? '—'
    : s < 1
      ? `${(s * 1000).toFixed(s < 0.01 ? 2 : 0)} ms`
      : `${s.toFixed(2)} s`;

/** The report as the command line prints it, one path a line. */
export function formatPerf(report: PerfReport): string[] {
  const lines = report.results.map(
    (r) =>
      `${r.pass ? 'PASS' : 'FAIL'}  ${r.title.padEnd(52)} n=${String(r.count).padStart(4)}` +
      `  p50 ${time(r.p50).padStart(9)}  p95 ${time(r.p95).padStart(9)}` +
      `  max ${time(r.max).padStart(9)}  budget ${time(r.budget)}`,
  );
  const read = Object.entries(report.documents.read)
    .map(([how, count]) => `${count} ${how}`)
    .join(', ');
  lines.push(
    `documents: ${report.documents.sent} sent (${read}), ${report.documents.unsettled} never settled`,
    `requests: ${report.requests.drafted} drafted, ${report.requests.decided} decided, ${report.requests.unsent} never sent`,
    `${report.pass ? 'PASS' : 'FAIL'} in ${report.seconds.toFixed(0)} s`,
  );
  return lines;
}
