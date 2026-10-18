// Chasing (plan §6 CollectAgent, §11 M5). One run moves unpaid invoices past their due date to
// overdue, keeps each invoice's chasing plan in step with its status and the company's cadence, and
// acts on the step of the day: a draft for the user or, in Autopilot, an e-mail the agent sends itself,
// never a formal notice. It runs on a timer (startWorkers). Each invoice is locked while its plan is
// worked on, invoice first and plan second like the user's routes, so two API instances never act on
// the same step. The clock is deps.now(): business time, accelerated in the scenario stack.
import { autopilotDecision, draftChase } from '@fi/agents';
import {
  advance,
  CHASED_STATES,
  type ChaseStep,
  daysBetween,
  ENDED_STATES,
  endSteps,
  nextStepOn,
  PAUSED_STATES,
  parisToday,
  planSteps,
  reschedule,
} from '@fi/core';
import {
  and,
  applyTransition,
  audit,
  type ChasePlanRow,
  chasePlans,
  type Db,
  eq,
  gt,
  type InvoiceRow,
  inArray,
  invoiceEvents,
  invoices,
  isNotNull,
  isNull,
  lockInvoice,
  lt,
  sql,
  type TenantRow,
  type Tx,
  tenants,
} from '@fi/db';
import type { ApiDeps, Mail } from './deps';
import { ApiError } from './errors';

export type CollectDeps = Pick<ApiDeps, 'db' | 'mailer' | 'now'>;

/** A step left in « sending » longer than this (real time) was interrupted: it becomes a draft. */
export const SENDING_STALE_MS = 10 * 60_000;

const ACTOR = 'agent:collect';
const OPEN = ['pending', 'drafted', 'sending'] as const;

const isOpen = (steps: readonly ChaseStep[]) =>
  steps.some((s) => (OPEN as readonly string[]).includes(s.status));

/** The customer's e-mail address on the invoice (BT-58): the sheet's « E-mail client » column. */
export const recipientOf = (invoice: InvoiceRow) => invoice.document.buyer.contact?.email ?? null;

async function note(
  tx: Tx,
  invoiceId: string,
  at: Date,
  actor: string,
  event: string,
  payload: Record<string, unknown>,
) {
  await tx.insert(invoiceEvents).values({ invoiceId, type: 'note', actor, event, payload, at });
}

async function savePlan(
  tx: Tx,
  plan: ChasePlanRow,
  patch: Partial<Pick<ChasePlanRow, 'steps' | 'paused' | 'cadence' | 'dueDate' | 'promisedUntil'>>,
) {
  const steps = patch.steps ?? plan.steps;
  await tx
    .update(chasePlans)
    .set({ ...patch, nextStepOn: nextStepOn(steps), updatedAt: new Date() })
    .where(eq(chasePlans.id, plan.id));
}

// ── The run ───────────────────────────────────────────────────────────────────────────────────────

/** delivered/accepted, past the due date (Europe/Paris), something left to pay → overdue. */
async function markOverdue(deps: CollectDeps, now: Date, today: string): Promise<number> {
  const due = await deps.db
    .select({ id: invoices.id })
    .from(invoices)
    .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
    .where(
      and(
        eq(invoices.direction, 'out'),
        inArray(invoices.status, ['delivered', 'accepted']),
        lt(invoices.dueDate, today),
        gt(invoices.payable, 0),
        isNull(tenants.deletedAt),
      ),
    );
  let moved = 0;
  for (const { id } of due) {
    await deps.db.transaction(async (tx) => {
      const r = await applyTransition(tx, {
        invoiceId: id,
        event: 'overdue',
        actor: 'system',
        payload: { today },
        at: now,
      });
      if (r.ok) moved++;
    });
  }
  return moved;
}

/** A plan for every invoice the customer has, with a due date and something to pay. */
async function createPlans(deps: CollectDeps): Promise<number> {
  const missing = await deps.db
    .select({
      invoiceId: invoices.id,
      tenantId: invoices.tenantId,
      dueDate: invoices.dueDate,
      cadence: tenants.chaseCadence,
    })
    .from(invoices)
    .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
    .leftJoin(chasePlans, eq(chasePlans.invoiceId, invoices.id))
    .where(
      and(
        eq(invoices.direction, 'out'),
        inArray(invoices.status, [...CHASED_STATES]),
        isNotNull(invoices.dueDate),
        gt(invoices.payable, 0),
        isNull(chasePlans.id),
        isNull(tenants.deletedAt),
      ),
    );
  let created = 0;
  for (const m of missing) {
    if (!m.dueDate) continue;
    const steps = planSteps(m.cadence, m.dueDate);
    await deps.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(chasePlans)
        .values({
          tenantId: m.tenantId,
          invoiceId: m.invoiceId,
          cadence: m.cadence,
          dueDate: m.dueDate ?? '',
          steps,
          nextStepOn: nextStepOn(steps),
        })
        .onConflictDoNothing()
        .returning({ id: chasePlans.id });
      if (!row) return;
      created++;
      await audit(tx, {
        tenantId: m.tenantId,
        actor: ACTOR,
        action: 'chase.plan',
        objectType: 'invoice',
        objectId: m.invoiceId,
        after: steps.map((s) => [s.offset, s.date]),
      });
    });
  }
  return created;
}

/**
 * Plans with something to do: a step whose day has come, a status that ended, paused or resumed the
 * plan, a new cadence or due date, or a send that never finished. The rest are not even locked.
 */
async function plansToWork(deps: CollectDeps, today: string) {
  const ended = inArray(invoices.status, [...ENDED_STATES]);
  const paused = inArray(invoices.status, [...PAUSED_STATES]);
  const chased = inArray(invoices.status, [...CHASED_STATES]);
  const open = sql`(${chasePlans.nextStepOn} is not null or ${chasePlans.steps} @> '[{"status":"drafted"}]' or ${chasePlans.steps} @> '[{"status":"sending"}]')`;
  return deps.db
    .select({ invoiceId: chasePlans.invoiceId })
    .from(chasePlans)
    .innerJoin(invoices, eq(invoices.id, chasePlans.invoiceId))
    .innerJoin(tenants, eq(tenants.id, chasePlans.tenantId))
    .where(
      and(
        isNull(tenants.deletedAt),
        sql`(
          (${ended} and ${open})
          or (${paused} and not ${chasePlans.paused})
          or (${chased} and ${chasePlans.paused})
          or (${chased} and ${chasePlans.nextStepOn} <= ${today}
              and (${chasePlans.promisedUntil} is null or ${chasePlans.promisedUntil} < ${today}))
          or (${chased} and ${chasePlans.nextStepOn} is not null
              and (${chasePlans.cadence} <> ${tenants.chaseCadence} or ${chasePlans.dueDate} <> ${invoices.dueDate}))
          or ${chasePlans.steps} @> '[{"status":"sending"}]'
        )`,
      ),
    );
}

interface Claimed {
  mail: Mail;
  invoiceId: string;
  offset: number;
}

/** Brings one plan up to date; returns the e-mail the autopilot must send, if any. */
async function workPlan(
  deps: CollectDeps,
  invoiceId: string,
  now: Date,
): Promise<{ acted: boolean; claimed: Claimed | null }> {
  return deps.db.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, invoiceId);
    const [plan] = await tx
      .select()
      .from(chasePlans)
      .where(eq(chasePlans.invoiceId, invoiceId))
      .for('update');
    if (!invoice || !plan) return { acted: false, claimed: null };
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, plan.tenantId));
    if (!tenant) return { acted: false, claimed: null };

    if (ENDED_STATES.includes(invoice.status)) {
      if (isOpen(plan.steps)) await savePlan(tx, plan, { steps: endSteps(plan.steps, now) });
      return { acted: false, claimed: null };
    }
    if (PAUSED_STATES.includes(invoice.status)) {
      if (!plan.paused) await savePlan(tx, plan, { paused: true });
      return { acted: false, claimed: null };
    }
    if (!CHASED_STATES.includes(invoice.status)) return { acted: false, claimed: null };

    const at = now.toISOString();
    const stale = Date.now() - plan.updatedAt.getTime() > SENDING_STALE_MS;
    let steps = plan.steps.map(
      (s): ChaseStep =>
        s.status === 'sending' && stale ? { ...s, status: 'drafted', reason: 'send_unknown' } : s,
    );
    const moved =
      invoice.dueDate !== null &&
      (invoice.dueDate !== plan.dueDate ||
        JSON.stringify(tenant.chaseCadence) !== JSON.stringify(plan.cadence));
    if (moved && invoice.dueDate) steps = reschedule(steps, tenant.chaseCadence, invoice.dueDate);

    const next = advance(steps, now, plan.promisedUntil);
    steps = next.steps;
    let claimed: Claimed | null = null;
    const step = next.act === null ? undefined : steps[next.act];
    if (next.act !== null && step) {
      const draft = chaseDraftFor(invoice, tenant, step, now);
      const decision = autopilotDecision(
        step.kind,
        { mode: tenant.mode, maxAmount: tenant.autopilotMaxAmount, mailer: Boolean(deps.mailer) },
        { payable: invoice.payable ?? 0, isTest: invoice.isTest, to: draft.to },
      );
      const done: ChaseStep = decision.send
        ? { ...step, status: 'sending', at, reason: null, draft }
        : { ...step, status: 'drafted', at, reason: decision.reason, draft };
      steps[next.act] = done;
      if (decision.send && draft.to) {
        claimed = {
          invoiceId,
          offset: step.offset,
          mail: { to: draft.to, subject: draft.subject, text: draft.body },
        };
      }
      if (step.offset > 0 && invoice.status === 'overdue') {
        await applyTransition(tx, {
          invoiceId,
          event: 'chase',
          actor: ACTOR,
          payload: { offset: step.offset },
          at: now,
        });
      }
      await note(tx, invoiceId, now, ACTOR, 'chase', stepNote(done));
      await audit(tx, {
        tenantId: tenant.id,
        actor: ACTOR,
        action: 'chase.step',
        objectType: 'invoice',
        objectId: invoiceId,
        after: stepNote(done),
      });
    }
    const patch = {
      steps,
      paused: false,
      ...(moved && { cadence: tenant.chaseCadence, dueDate: invoice.dueDate ?? plan.dueDate }),
    };
    if (JSON.stringify(patch.steps) !== JSON.stringify(plan.steps) || plan.paused || moved) {
      await savePlan(tx, plan, patch);
    }
    return { acted: next.act !== null, claimed };
  });
}

const stepNote = (s: ChaseStep) => ({
  offset: s.offset,
  kind: s.kind,
  date: s.date,
  status: s.status,
  reason: s.reason,
  by: s.by,
});

export function chaseDraftFor(invoice: InvoiceRow, tenant: TenantRow, step: ChaseStep, now: Date) {
  return draftChase({
    kind: step.kind,
    number: invoice.number ?? '',
    issueDate: invoice.issueDate ?? '',
    dueDate: invoice.dueDate ?? step.date,
    today: parisToday(now),
    payable: invoice.payable ?? 0,
    currency: invoice.currency ?? 'EUR',
    seller: tenant.name,
    to: recipientOf(invoice),
    isTest: invoice.isTest,
  });
}

/** After the mail service answered: the step is sent, or back to a draft the user sends. */
async function finishSend(deps: CollectDeps, c: Claimed, error: unknown) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const invoice = await lockInvoice(tx, c.invoiceId);
    const [plan] = await tx
      .select()
      .from(chasePlans)
      .where(eq(chasePlans.invoiceId, c.invoiceId))
      .for('update');
    if (!invoice || !plan) return;
    const steps = plan.steps.map(
      (s): ChaseStep =>
        s.offset === c.offset && s.status === 'sending'
          ? error === null
            ? { ...s, status: 'sent', by: 'agent', at: now.toISOString() }
            : { ...s, status: 'drafted', reason: 'send_failed' }
          : s,
    );
    const done = steps.find((s) => s.offset === c.offset);
    if (!done) return;
    await savePlan(tx, plan, { steps });
    await note(tx, c.invoiceId, now, ACTOR, 'chase', stepNote(done));
    await audit(tx, {
      tenantId: plan.tenantId,
      actor: ACTOR,
      action: error === null ? 'chase.sent' : 'chase.send_failed',
      objectType: 'invoice',
      objectId: c.invoiceId,
      after: { offset: c.offset, to: c.mail.to, subject: c.mail.subject },
    });
  });
}

export interface CollectRun {
  overdue: number;
  planned: number;
  acted: number;
  sent: number;
  failed: number;
}

export async function runCollect(
  deps: CollectDeps,
  log: (message: string) => void = () => {},
): Promise<CollectRun> {
  const now = deps.now();
  const today = parisToday(now);
  const run: CollectRun = { overdue: 0, planned: 0, acted: 0, sent: 0, failed: 0 };
  run.overdue = await markOverdue(deps, now, today);
  run.planned = await createPlans(deps);
  for (const { invoiceId } of await plansToWork(deps, today)) {
    const { acted, claimed } = await workPlan(deps, invoiceId, now);
    if (acted) run.acted++;
    if (!claimed) continue;
    // Outside any transaction: the step is « sending » and committed, so a crash here leaves a
    // step that is never sent twice (it becomes a draft with send_unknown).
    let error: unknown = null;
    try {
      if (!deps.mailer) throw new Error('no mailer');
      await deps.mailer.send(claimed.mail);
      run.sent++;
    } catch (e) {
      error = e;
      run.failed++;
      log(`chase mail for ${invoiceId}: ${e instanceof Error ? e.message : String(e)}`);
    }
    await finishSend(deps, claimed, error);
  }
  return run;
}

// ── What the user does on « Relancer » ────────────────────────────────────────────────────────────

/** The plan as the task pane shows it. */
export function chaseView(plan: ChasePlanRow | undefined) {
  if (!plan) return null;
  return {
    cadence: plan.cadence,
    dueDate: plan.dueDate,
    steps: plan.steps,
    nextStepOn: plan.nextStepOn,
    paused: plan.paused,
    promisedUntil: plan.promisedUntil,
  };
}

export async function chasePlanOf(db: Db | Tx, invoiceId: string) {
  const [plan] = await db.select().from(chasePlans).where(eq(chasePlans.invoiceId, invoiceId));
  return plan;
}

/** The tenant's invoice and its plan, both locked; 409 when the invoice has no plan. */
async function lockPlan(tx: Tx, tenant: TenantRow, invoiceId: string) {
  const invoice = await lockInvoice(tx, invoiceId);
  if (!invoice || invoice.tenantId !== tenant.id) throw new ApiError(404, 'not_found');
  const [plan] = await tx
    .select()
    .from(chasePlans)
    .where(eq(chasePlans.invoiceId, invoiceId))
    .for('update');
  if (!plan) throw new ApiError(409, 'chase_no_plan');
  return { invoice, plan };
}

/** « Marquer comme envoyée »: the user sent the drafted step from their own mailbox. */
export async function markStepSent(deps: ApiDeps, tenant: TenantRow, id: string, offset: number) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const { plan } = await lockPlan(tx, tenant, id);
    const step = plan.steps.find((s) => s.offset === offset);
    if (step?.status === 'sent') return;
    if (step?.status !== 'drafted') throw new ApiError(409, 'chase_step_not_drafted');
    const done: ChaseStep = { ...step, status: 'sent', by: 'user', at: now.toISOString() };
    await savePlan(tx, plan, { steps: plan.steps.map((s) => (s.offset === offset ? done : s)) });
    await note(tx, id, now, 'user', 'chase', stepNote(done));
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'chase.sent',
      objectType: 'invoice',
      objectId: id,
      after: stepNote(done),
    });
  });
}

/**
 * « Préparer une relance maintenant »: a draft in the tone of today's delay, now. It takes the
 * cadence step of the day when there is one, else it is added to the plan; later steps stay.
 */
export async function prepareChase(deps: ApiDeps, tenant: TenantRow, id: string) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const { invoice, plan } = await lockPlan(tx, tenant, id);
    if (!CHASED_STATES.includes(invoice.status)) throw new ApiError(409, 'chase_paused');
    const offset = daysBetween(plan.dueDate, parisToday(now));
    const existing = plan.steps.find((s) => s.offset === offset);
    if (existing && existing.status !== 'pending') return;
    const [base] = existing ? [existing] : planSteps([offset], plan.dueDate);
    if (!base) return;
    const done: ChaseStep = {
      ...base,
      status: 'drafted',
      at: now.toISOString(),
      reason: 'manual',
      draft: chaseDraftFor(invoice, tenant, base, now),
    };
    const steps = [...plan.steps.filter((s) => s.offset !== offset), done].sort(
      (a, b) => a.offset - b.offset,
    );
    await savePlan(tx, plan, { steps });
    await note(tx, id, now, 'user', 'chase', stepNote(done));
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'chase.prepare',
      objectType: 'invoice',
      objectId: id,
      after: stepNote(done),
    });
  });
}

/** « Promesse de paiement »: no step goes out until the day after `until`; null withdraws it. */
export async function recordPromise(
  deps: ApiDeps,
  tenant: TenantRow,
  id: string,
  until: string | null,
) {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const { plan } = await lockPlan(tx, tenant, id);
    if (until !== null && until < parisToday(now)) throw new ApiError(400, 'promise_in_past');
    await savePlan(tx, plan, { promisedUntil: until });
    await note(tx, id, now, 'user', 'promise', { until });
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'chase.promise',
      objectType: 'invoice',
      objectId: id,
      before: { until: plan.promisedUntil },
      after: { until },
    });
  });
}
