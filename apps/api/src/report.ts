// The weekly report (plan §6 ReportAgent, phase 9): the facts of the last 7 days counted here, worded
// by @fi/agents weeklyReport. The task pane shows it on demand (GET /report); every ISO week, from
// Monday 8:00 Paris, it is mailed once to the company's owners where the deployment can send mail.
// Test invoices never count. R7: the money the checks found billed short in the week, still open.
// BTP stage 3C: the requests waiting in « À valider » are counted, and the e-mail lists them, each
// with its links for that owner (src/action-links.ts).
import { approvalLines, type WeekFacts, type WeeklyReport, weeklyReport } from '@fi/agents';
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
  eq,
  findings,
  gte,
  inArray,
  invoiceEvents,
  invoices,
  isNull,
  sql,
  type TenantRow,
  tenants,
  users,
  weeklyReports,
} from '@fi/db';
import { approvalItems } from './action-links';
import { balanceOf } from './collect';
import type { ApiDeps } from './deps';

type Deps = Pick<ApiDeps, 'db' | 'mailer' | 'now'> & { env?: { API_PUBLIC_URL?: string } };

const REPORT_HOUR = 8;

/** The invoice's amount, or what is left to pay on it after the payments received (`owed`). */
const AMOUNT = {
  payable: sql<string>`coalesce(sum(${invoices.payable}), 0)`,
  owed: sql<string>`coalesce(sum(${invoices.payable} - ${invoices.amountPaid}), 0)`,
};

async function tally(
  deps: Deps,
  tenantId: string,
  where: ReturnType<typeof and>,
  amount: keyof typeof AMOUNT = 'payable',
): Promise<{ count: number; amount: number }> {
  const [row] = await deps.db
    .select({ count: count(), amount: AMOUNT[amount] })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        eq(invoices.direction, 'out'),
        eq(invoices.isTest, false),
        // A credit note (381) is neither sent nor paid business: its amount would add, not subtract.
        sql`coalesce(${invoices.document}->>'typeCode', '380') <> '381'`,
        where,
      ),
    );
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
  return {
    from: parisToday(since),
    to: today,
    currency: 'EUR',
    sent: await reached(deps, tenant.id, 'deposited', since),
    paid: await reached(deps, tenant.id, 'paid', since),
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
