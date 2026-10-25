// The weekly report (plan §6 ReportAgent, phase 9): the facts of the last 7 days counted here, worded
// by @fi/agents weeklyReport. The task pane shows it on demand (GET /report); every ISO week, from
// Monday 8:00 Paris, it is mailed once to the company's owners where the deployment can send mail.
// Test invoices never count; « Encaissé » is the money received in the week, a part payment included.
// R7: the money the checks found billed short in the week, still open.
// BTP stage 3C: the requests waiting in « À valider » are counted, and the e-mail lists them, each
// with its links for that owner (src/action-links.ts).
// Memory M5: what the rules raised in the week (src/rules.ts), and the completeness block once the
// company receives documents or keeps a memory.
import {
  approvalLines,
  CATALOGUE,
  type Completeness,
  type Found,
  type RuleRunner,
  type WeekFacts,
  type WeeklyReport,
  weeklyReport,
} from '@fi/agents';
import {
  addDays,
  type ChaseStep,
  type InvoiceState,
  isoWeek,
  isoWeekday,
  parisHour,
  parisToday,
} from '@fi/core';
import {
  actions,
  and,
  audit,
  between,
  chasePlans,
  count,
  countDistinct,
  desc,
  documents,
  eq,
  findings,
  gte,
  inArray,
  invoiceEvents,
  invoices,
  isNull,
  memoryFindings,
  memoryPages,
  ne,
  or,
  ruleHits,
  ruleRuns,
  sql,
  type TenantRow,
  tenants,
  users,
  weeklyReports,
} from '@fi/db';
import { approvalItems } from './action-links';
import { balanceOf } from './collect';
import type { ApiDeps } from './deps';
import { lastRun } from './schedules';

type Deps = Pick<ApiDeps, 'db' | 'mailer' | 'now' | 'memory'> & {
  env?: { API_PUBLIC_URL?: string };
};

const REPORT_HOUR = 8;

/** The invoice's amount, or what is left to pay on it after the payments received (`owed`). */
const AMOUNT = {
  payable: sql<string>`coalesce(sum(${invoices.payable}), 0)`,
  owed: sql<string>`coalesce(sum(${invoices.payable} - ${invoices.amountPaid}), 0)`,
};

/** The company's real business: its own invoices, not a test, not a credit note. */
const business = (tenantId: string) =>
  and(
    eq(invoices.tenantId, tenantId),
    eq(invoices.direction, 'out'),
    eq(invoices.isTest, false),
    // A credit note (381) is neither sent nor paid business: its amount would add, not subtract.
    sql`coalesce(${invoices.document}->>'typeCode', '380') <> '381'`,
  );

async function tally(
  deps: Deps,
  tenantId: string,
  where: ReturnType<typeof and>,
  amount: keyof typeof AMOUNT = 'payable',
): Promise<{ count: number; amount: number }> {
  const [row] = await deps.db
    .select({ count: count(), amount: AMOUNT[amount] })
    .from(invoices)
    .where(and(business(tenantId), where));
  return { count: row?.count ?? 0, amount: Number(row?.amount ?? 0) };
}

/** Invoices that reached `status` since `since` (each counted once). */
async function reached(deps: Deps, tenantId: string, status: string, since: Date) {
  const ids = deps.db
    .selectDistinct({ id: invoiceEvents.invoiceId })
    .from(invoiceEvents)
    .where(
      and(
        eq(invoiceEvents.type, 'transition'),
        eq(invoiceEvents.toStatus, status),
        gte(invoiceEvents.at, since),
      ),
    );
  return tally(deps, tenantId, inArray(invoices.id, ids));
}

/**
 * The money received since `since`, and on how many invoices: every payment the user recorded, a part
 * or the rest, and what was left on an invoice the platform reported paid (its event has no amount).
 */
async function received(deps: Deps, tenantId: string, since: Date) {
  const [row] = await deps.db
    .select({
      count: countDistinct(invoiceEvents.invoiceId),
      amount: sql<string>`coalesce(sum(coalesce((${invoiceEvents.payload}->>'amount')::bigint,
        ${invoices.payable} - ${invoices.amountPaid})), 0)`,
    })
    .from(invoiceEvents)
    .innerJoin(invoices, eq(invoices.id, invoiceEvents.invoiceId))
    .where(
      and(
        business(tenantId),
        gte(invoiceEvents.at, since),
        or(
          and(eq(invoiceEvents.type, 'note'), eq(invoiceEvents.event, 'payment_partial')),
          and(eq(invoiceEvents.type, 'transition'), eq(invoiceEvents.toStatus, 'paid')),
        ),
      ),
    );
  return { count: row?.count ?? 0, amount: Number(row?.amount ?? 0) };
}

/** The schedule that runs each chaser of the catalogue; the checks run with every document. */
const CHASER_SCHEDULE: Record<Exclude<RuleRunner, 'memory'>, string | null> = {
  collect: 'chasing',
  watchers: 'watchers',
  checks: null,
};

/**
 * Received and filed in the window; the rules that ran of those due (the memory's, where the company
 * keeps a memory; a chaser, when its schedule ran); the memory's questions; the fixes waiting.
 * Undefined for a company that neither receives documents nor keeps a memory.
 */
async function completenessOf(
  deps: Deps,
  tenantId: string,
  since: Date,
): Promise<Completeness | undefined> {
  const real = and(eq(documents.tenantId, tenantId), eq(documents.isTest, false));
  const [ever] = await deps.db.select({ n: count() }).from(documents).where(real);
  const [pages] = await deps.db
    .select({ n: count() })
    .from(memoryPages)
    .where(eq(memoryPages.tenantId, tenantId));
  // A runner keeps its company's memory from its first start, pages or not yet.
  const memory = (pages?.n ?? 0) > 0 || Boolean(deps.memory);
  if (!ever?.n && !memory) return undefined;
  const [week] = await deps.db
    .select({
      received: count(),
      filed: sql<number>`count(*) filter (where ${documents.stage} = 'done')::int`,
    })
    .from(documents)
    .where(and(real, gte(documents.receivedAt, since)));
  const ran = new Set(
    (
      await deps.db
        .selectDistinct({ rule: ruleRuns.rule })
        .from(ruleRuns)
        .where(
          and(eq(ruleRuns.tenantId, tenantId), gte(ruleRuns.ranAt, since), isNull(ruleRuns.error)),
        )
    ).map((r) => r.rule),
  );
  const due = CATALOGUE.filter((e) => e.runs !== 'memory' || memory);
  let rulesRun = 0;
  for (const entry of due) {
    if (entry.runs === 'memory') {
      if (ran.has(entry.id)) rulesRun++;
      continue;
    }
    const schedule = CHASER_SCHEDULE[entry.runs];
    const last = schedule && (await lastRun(deps.db, schedule))?.lastRunAt;
    if (!schedule || (last && last >= since)) rulesRun++;
  }
  const [fixes] = await deps.db
    .select({ n: count() })
    .from(memoryFindings)
    .where(
      and(
        eq(memoryFindings.tenantId, tenantId),
        eq(memoryFindings.status, 'open'),
        ne(memoryFindings.fix, 'question'),
      ),
    );
  return {
    received: week?.received ?? 0,
    filed: week?.filed ?? 0,
    rulesRun,
    rulesDue: due.length,
    questions: deps.memory ? await deps.memory.questions() : null,
    fixes: fixes?.n ?? 0,
  };
}

/** What the rules raised in the window and still stands, the latest first. */
async function spottedSince(deps: Deps, tenantId: string, since: Date) {
  const rows = await deps.db
    .select({ rule: ruleHits.rule, facts: ruleHits.facts })
    .from(ruleHits)
    .where(
      and(
        eq(ruleHits.tenantId, tenantId),
        eq(ruleHits.status, 'open'),
        gte(ruleHits.raisedAt, since),
      ),
    )
    .orderBy(desc(ruleHits.raisedAt));
  return rows.map((r) => ({ rule: r.rule, facts: r.facts as Found['facts'] }));
}

export async function weekFacts(deps: Deps, tenant: TenantRow, now: Date): Promise<WeekFacts> {
  const today = parisToday(now);
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const ofTenant = (status: readonly InvoiceState[]) =>
    deps.db
      .select({ number: invoices.number, payable: invoices.payable, id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.tenantId, tenant.id),
          eq(invoices.direction, 'out'),
          eq(invoices.isTest, false),
          inArray(invoices.status, [...status]),
        ),
      );
  const plans = await deps.db
    .select({
      steps: chasePlans.steps,
      number: invoices.number,
      payable: invoices.payable,
      amountPaid: invoices.amountPaid,
    })
    .from(chasePlans)
    .innerJoin(invoices, eq(invoices.id, chasePlans.invoiceId))
    .where(
      and(
        eq(chasePlans.tenantId, tenant.id),
        eq(invoices.isTest, false),
        inArray(invoices.status, ['delivered', 'accepted', 'overdue', 'chasing']),
      ),
    );
  const [short] = await deps.db
    .select({ count: count(), amount: sql<string>`coalesce(sum(${findings.amount}), 0)` })
    .from(findings)
    .where(
      and(
        eq(findings.tenantId, tenant.id),
        eq(findings.status, 'open'),
        eq(findings.short, true),
        eq(findings.isTest, false),
        gte(findings.firstSeenAt, since),
      ),
    );
  const [waiting] = await deps.db
    .select({ count: count() })
    .from(actions)
    .where(
      and(eq(actions.tenantId, tenant.id), eq(actions.status, 'draft'), eq(actions.isTest, false)),
    );
  const drafted = (s: ChaseStep) => s.status === 'drafted';
  const completeness = await completenessOf(deps, tenant.id, since);
  return {
    from: parisToday(since),
    to: today,
    currency: 'EUR',
    sent: await reached(deps, tenant.id, 'deposited', since),
    paid: await received(deps, tenant.id, since),
    overdue: await tally(deps, tenant.id, inArray(invoices.status, ['overdue', 'chasing']), 'owed'),
    notInvoiced: { count: short?.count ?? 0, amount: Number(short?.amount ?? 0) },
    atRisk: await tally(
      deps,
      tenant.id,
      and(
        inArray(invoices.status, ['delivered', 'accepted']),
        between(invoices.dueDate, today, addDays(today, 7)),
      ),
      'owed',
    ),
    formalNotices: plans
      .filter((p) => p.steps.some((s) => drafted(s) && s.kind === 'formal_notice'))
      .map((p) => ({ number: p.number ?? '', payable: balanceOf(p) })),
    refusals: (await ofTenant(['refused_by_customer'])).map((r) => r.number ?? r.id),
    toFix: (await ofTenant(['needs_fix', 'rejected_by_pdp'])).length,
    drafts: plans.reduce(
      (n, p) => n + p.steps.filter((s) => drafted(s) && s.kind !== 'formal_notice').length,
      0,
    ),
    toSend: (await ofTenant(['validated'])).length,
    approvals: waiting?.count ?? 0,
    spotted: await spottedSince(deps, tenant.id, since),
    ...(completeness && { completeness }),
  };
}

export async function reportFor(deps: Deps, tenant: TenantRow): Promise<WeeklyReport> {
  return weeklyReport(await weekFacts(deps, tenant, deps.now()));
}

/**
 * Mails the week's report to each company's owners, once per ISO week, from Monday 8:00 Paris (a
 * server down on Monday sends it later in the week). Claimed before mailing: at most once.
 */
export async function runWeeklyReports(
  deps: Deps,
  log: (message: string) => void = () => {},
): Promise<number> {
  const { mailer } = deps;
  if (!mailer) return 0;
  const now = deps.now();
  const today = parisToday(now);
  if (isoWeekday(today) === 1 && parisHour(now) < REPORT_HOUR) return 0;
  const week = isoWeek(today);
  const due = await deps.db
    .select()
    .from(tenants)
    .leftJoin(
      weeklyReports,
      and(eq(weeklyReports.tenantId, tenants.id), eq(weeklyReports.week, week)),
    )
    .where(and(isNull(tenants.deletedAt), isNull(weeklyReports.id)));
  let sent = 0;
  for (const { tenants: tenant } of due) {
    const owners = await deps.db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.tenantId, tenant.id), eq(users.role, 'owner')));
    const claimed = await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(weeklyReports)
        .values({ tenantId: tenant.id, week, recipients: owners.length, sentAt: now })
        .onConflictDoNothing()
        .returning({ id: weeklyReports.id });
      if (row && owners.length > 0) {
        await audit(tx, {
          tenantId: tenant.id,
          actor: 'agent:report',
          action: 'report.weekly',
          objectType: 'tenant',
          objectId: tenant.id,
          after: { week, recipients: owners.length },
        });
      }
      return Boolean(row);
    });
    if (!claimed || owners.length === 0) continue;
    // An accounting firm's full white label: its name in the subject and as the sender.
    const firm = tenant.whiteLabel?.full ? tenant.whiteLabel.firmName : undefined;
    const report = weeklyReport(await weekFacts(deps, tenant, now), firm);
    for (const { id, email } of owners) {
      try {
        // Each owner's own links: one decides as the person it was mailed to.
        const base = deps.env?.API_PUBLIC_URL;
        const { items, more } = base
          ? await approvalItems({ db: deps.db, base }, tenant, id, now)
          : { items: [], more: 0 };
        await mailer.send({
          to: email,
          subject: report.subject,
          text: [report.text, ...approvalLines(items, more)].join('\n'),
          ...(firm && { fromName: firm }),
        });
        sent++;
      } catch (e) {
        log(`weekly report for ${tenant.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  return sent;
}
