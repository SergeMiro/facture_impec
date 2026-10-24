// The deadline watchers (BTP plan §7 WatcherGraph, docs/DECISIONS.md D8), on the chasing timer: an
// open deadline in its horizon gets one draft request, for a person to approve in « À valider ». A
// deadline that moved or closed withdraws its draft; a snoozed draft comes back on its day; a send
// that never finished goes back to a person. Nothing here sends: `action.send` does, once approved.
import { draftRequest, type RequestKind } from '@fi/agents';
import { addDays, type Invoice, parisToday } from '@fi/core';
import {
  actions,
  and,
  audit,
  type Db,
  documents,
  eq,
  inArray,
  isNull,
  lte,
  obligations,
  or,
  parties,
  type SQL,
  sql,
  type Tx,
  tenants,
} from '@fi/db';
import type { ObligationKind } from '@fi/domain';
import type { Jobs } from './deps';

/** A send claimed longer ago than this (real time) never finished: a person decides again. */
export const ACTION_SENDING_STALE_MS = 10 * 60_000;

/** The statuses a person can still answer. */
export const OPEN = ['draft', 'snoozed'] as const;

export interface WatchDeps {
  db: Db;
  jobs: Pick<Jobs, 'enqueueAction'>;
  now: () => Date;
}

/** Which request a deadline asks for, from whom, and how many days before its date. */
interface Watch {
  action: RequestKind;
  /** The company asked: a supplier for its own papers, a customer for what it owes. */
  party: 'supplier' | 'customer';
  /** Drafted this many days before the date; a negative number: only once it is past. */
  daysBefore: number;
}

export const WATCHED: Partial<Record<ObligationKind, Watch>> = {
  attestation_vigilance_renouvellement: {
    action: 'demande_attestation_vigilance',
    party: 'supplier',
    daysBefore: 30,
  },
  kbis_renouvellement: { action: 'demande_kbis', party: 'supplier', daysBefore: 30 },
  assurance_expiration: {
    action: 'demande_attestation_assurance',
    party: 'supplier',
    daysBefore: 30,
  },
  // The release is due on the day itself: asking earlier asks for what is not owed yet.
  retenue_garantie_liberation: {
    action: 'demande_liberation_retenue',
    party: 'customer',
    daysBefore: 0,
  },
  // One reminder once it is overdue; CollectAgent chases the invoices sent through Facture Impec.
  facture_echeance: { action: 'relance_facture', party: 'customer', daysBefore: -1 },
};

/** One run's counts, for the log and the tests. */
export interface WatchRun {
  woken: number;
  withdrawn: number;
  unclaimed: number;
  requeued: number;
  drafted: number;
}

const BATCH = 500;
const WATCHER = { actor: 'agent:watch', decidedBy: 'agent:watch' };

export async function runWatchers(
  deps: WatchDeps,
  log?: (message: string) => void,
): Promise<WatchRun> {
  const now = deps.now();
  const run: WatchRun = {
    woken: await wakeSnoozed(deps.db, now),
    withdrawn: await withdrawStale(deps.db, now),
    unclaimed: await unclaimStale(deps.db, now),
    requeued: 0,
    drafted: 0,
  };
  // Approved but not on its way (a restart lost the job): queued again; the queue keeps one per action.
  const approved = await deps.db
    .select({ id: actions.id })
    .from(actions)
    .where(
      and(
        eq(actions.status, 'approved'),
        sql`${actions.kind} <> 'confirmer_tiers'`,
        sql`${actions.payload}->>'sendingAt' is null`,
      ),
    )
    .limit(BATCH);
  for (const a of approved) await deps.jobs.enqueueAction(a.id);
  run.requeued = approved.length;
  run.drafted = await draftDue(deps.db, now);
  if (run.drafted || run.withdrawn || run.unclaimed) {
    log?.(
      `watchers: ${run.drafted} drafted, ${run.withdrawn} withdrawn, ${run.unclaimed} sends unclear`,
    );
  }
  return run;
}

/**
 * Withdraws the open drafts that `which` selects (a deadline that moved, closed or went away):
 * `rejected` by the actor, the reason in `comment`, the revision moved on so no link decides them.
 */
export async function withdrawDrafts(
  tx: Tx,
  tenantId: string,
  which: SQL,
  by: { actor: string; decidedBy: string; reason: string },
  now: Date,
): Promise<string[]> {
  const rows = await tx
    .update(actions)
    .set({
      status: 'rejected',
      decidedBy: by.decidedBy,
      decidedAt: now,
      comment: by.reason,
      snoozeUntil: null,
      revision: sql`${actions.revision} + 1`,
      updatedAt: now,
    })
    .where(and(eq(actions.tenantId, tenantId), inArray(actions.status, [...OPEN]), which))
    .returning({ id: actions.id });
  for (const row of rows) {
    await audit(tx, {
      tenantId,
      actor: by.actor,
      action: 'action.withdrawn',
      objectType: 'action',
      objectId: row.id,
      after: { reason: by.reason },
    });
  }
  return rows.map((r) => r.id);
}

/** A snoozed draft whose day came is a draft again. */
async function wakeSnoozed(db: Db, now: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(actions)
      .set({ status: 'draft', snoozeUntil: null, updatedAt: now })
      .where(and(eq(actions.status, 'snoozed'), lte(actions.snoozeUntil, now)))
      .returning({ id: actions.id, tenantId: actions.tenantId });
    for (const r of rows) {
      await audit(tx, {
        tenantId: r.tenantId,
        actor: WATCHER.actor,
        action: 'action.wake',
        objectType: 'action',
        objectId: r.id,
      });
    }
    return rows.length;
  });
}

/**
 * Drafts written for a deadline that is no longer the same: closed (« C'est fait », dismissed),
 * moved (a newer attestation came) or gone with its document. Withdrawn; the next step drafts
 * the request the moved deadline needs, if it is in its horizon.
 */
async function withdrawStale(db: Db, now: Date): Promise<number> {
  const stale = await db
    .select({
      id: actions.id,
      tenantId: actions.tenantId,
      status: obligations.status,
      dueOn: obligations.dueOn,
      written: sql<string | null>`${actions.payload}->>'dueOn'`,
    })
    .from(actions)
    .leftJoin(obligations, eq(obligations.id, actions.obligationId))
    .where(
      and(
        inArray(actions.status, [...OPEN]),
        sql`${actions.kind} <> 'confirmer_tiers'`,
        or(
          isNull(obligations.id),
          sql`${obligations.status} <> 'open'`,
          sql`${obligations.dueOn}::text is distinct from ${actions.payload}->>'dueOn'`,
        ),
      ),
    )
    .limit(BATCH);
  let withdrawn = 0;
  for (const s of stale) {
    const reason = !s.status
      ? 'deadline_gone'
      : s.status !== 'open'
        ? `deadline_${s.status}`
        : 'deadline_moved';
    await db.transaction(async (tx) => {
      const ids = await withdrawDrafts(
        tx,
        s.tenantId,
        eq(actions.id, s.id),
        { ...WATCHER, reason },
        now,
      );
      withdrawn += ids.length;
    });
  }
  return withdrawn;
}

/**
 * A send claimed and never finished (the process stopped between the claim and the result): nobody
 * knows whether the e-mail left. It goes back to a person as a draft, `send_unknown`, rather than
 * going out a second time.
 */
async function unclaimStale(db: Db, now: Date): Promise<number> {
  const cutoff = new Date(Date.now() - ACTION_SENDING_STALE_MS).toISOString();
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(actions)
      .set({
        status: 'draft',
        error: 'send_unknown',
        payload: sql`${actions.payload} - 'sendingAt'`,
        revision: sql`${actions.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(actions.status, 'approved'),
          sql`(${actions.payload}->>'sendingAt')::timestamptz < ${cutoff}::timestamptz`,
        ),
      )
      .returning({ id: actions.id, tenantId: actions.tenantId });
    for (const r of rows) {
      await audit(tx, {
        tenantId: r.tenantId,
        actor: WATCHER.actor,
        action: 'action.send_unknown',
        objectType: 'action',
        objectId: r.id,
      });
    }
    return rows.length;
  });
}

/**
 * The open deadlines in their horizon, without a request for their date yet: one draft each. One
 * company's only, when `tenantId` is given (a supplier just added).
 */
export async function draftDue(db: Db, now: Date, tenantId?: string): Promise<number> {
  const today = parisToday(now);
  const horizon = (kind: ObligationKind, w: Watch) =>
    and(
      eq(obligations.kind, kind),
      eq(parties.kind, w.party),
      w.daysBefore < 0
        ? sql`${obligations.dueOn} < ${today}`
        : lte(obligations.dueOn, addDays(today, w.daysBefore)),
    );
  const watched = Object.entries(WATCHED) as [ObligationKind, Watch][];
  const due = await db
    .select({
      obligation: obligations,
      partyName: parties.legalName,
      partyEmail: parties.email,
      company: tenants.name,
      extracted: documents.extracted,
    })
    .from(obligations)
    .innerJoin(parties, eq(parties.id, obligations.partyId))
    .innerJoin(tenants, eq(tenants.id, obligations.tenantId))
    .leftJoin(documents, eq(documents.id, obligations.sourceDocumentId))
    .where(
      and(
        eq(obligations.status, 'open'),
        tenantId ? eq(obligations.tenantId, tenantId) : undefined,
        isNull(tenants.deletedAt),
        // An invoice sent through Facture Impec has its own chasing (CollectAgent).
        or(sql`${obligations.kind} <> 'facture_echeance'`, isNull(obligations.invoiceId)),
        or(...watched.map(([kind, w]) => horizon(kind, w))),
        // Asked once per date: an action of any status keyed to it stops a second one.
        sql`not exists (select 1 from ${actions} a where a.tenant_id = ${obligations.tenantId}
          and a.obligation_id = ${obligations.id}
          and a.payload_json->>'dueOn' = ${obligations.dueOn}::text)`,
      ),
    )
    .orderBy(obligations.dueOn)
    .limit(BATCH);
  let drafted = 0;
  for (const d of due) {
    const o = d.obligation;
    const watch = WATCHED[o.kind];
    if (!watch) continue;
    const invoice = (d.extracted?.invoice ?? null) as Invoice | null;
    const draft = draftRequest({
      kind: watch.action,
      company: d.company,
      to: d.partyEmail ?? invoice?.buyer?.contact?.email ?? null,
      dueOn: o.dueOn,
      today,
      reference: invoice?.number ?? null,
      amount: o.amount,
      currency: invoice?.currency ?? 'EUR',
      insurance: o.key.endsWith(':rc') ? 'rc' : 'decennale',
      isTest: o.isTest,
    });
    const made = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(actions)
        .values({
          tenantId: o.tenantId,
          kind: watch.action,
          key: `${watch.action}:${o.id}:${o.dueOn}`,
          obligationId: o.id,
          documentId: o.sourceDocumentId,
          partyId: o.partyId,
          payload: { ...draft, dueOn: o.dueOn },
          isTest: o.isTest,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: [actions.tenantId, actions.key] })
        .returning({ id: actions.id });
      if (!row) return false;
      await audit(tx, {
        tenantId: o.tenantId,
        actor: WATCHER.actor,
        action: 'action.draft',
        objectType: 'action',
        objectId: row.id,
        after: {
          kind: watch.action,
          obligationId: o.id,
          dueOn: o.dueOn,
          recipient: Boolean(draft.to),
        },
      });
      return true;
    });
    if (made) drafted += 1;
  }
  return drafted;
}
