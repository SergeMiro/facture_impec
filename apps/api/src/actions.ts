// The requests a person approves (BTP plan §7 ActionGraph, §10; docs/DECISIONS.md D8). The watchers
// (src/watchers.ts) draft them; a person answers from the pane or from the weekly e-mail's link
// (`ApprovalDecision`); an approved request is sent by the queue `action.send`, once, after checking
// that its deadline still needs it. Only a decision moves a draft (D2); every decision and every send
// writes an audit event. A Mode test request is never e-mailed to anyone.
import {
  type ActionRow,
  actions,
  and,
  asc,
  audit,
  type Db,
  desc,
  documents,
  eq,
  inArray,
  isNull,
  obligations,
  parties,
  sql,
  type TenantRow,
  type Tx,
} from '@fi/db';
import {
  ACTION_STATUSES,
  type ApprovalChannel,
  type ApprovalDecision,
  MAX_SNOOZE_DAYS,
} from '@fi/domain';
import { z } from 'zod';
import { type Principal, who } from './auth';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { DirectoryUnavailable } from './sirene';
import { ownerEmail } from './tenants';
import { draftDue, OPEN, withdrawDrafts } from './watchers';

/** A mail that fails this many times leaves the request `failed`. */
export const ACTION_SEND_TRIES = 3;

/** What a request will send (`payload_json` of every kind but `confirmer_tiers`). */
export const RequestPayload = z.object({
  to: z.string().nullable(),
  subject: z.string(),
  body: z.string(),
  /** The deadline's day it was written for: a deadline that moved withdraws it (src/watchers.ts). */
  dueOn: z.string(),
  /** Who answers: the address of the person who approved it, else the company's owner. */
  replyTo: z.string().nullable().optional(),
  /** Claimed by a send that has not finished; see ACTION_SENDING_STALE_MS (src/watchers.ts). */
  sendingAt: z.string().optional(),
  tries: z.number().int().optional(),
  /** Mode test: approved, nothing went out. */
  notSent: z.boolean().optional(),
});
export type RequestPayload = z.infer<typeof RequestPayload>;

/** « Is this unknown SIREN a supplier of yours? » (D7), from the document that named it. */
export const ConfirmPayload = z.object({ siren: z.string(), documentKind: z.string().nullable() });

const actorOf = (principal: Principal) =>
  principal.kind === 'session' ? `user:${principal.userId}` : 'api';

// ── What the pane lists ───────────────────────────────────────────────────────────────────────────

export const ActionsQuery = z.object({
  test: z.stringbool().default(false),
  status: z.enum(ACTION_STATUSES).default('draft'),
});
export type ActionsQuery = z.infer<typeof ActionsQuery>;

/** The company's actions in one status, the soonest deadline first, each with what it will send. */
export async function listActions(db: Db, tenant: Pick<TenantRow, 'id'>, q: ActionsQuery) {
  const rows = await db
    .select({
      action: actions,
      partyName: parties.legalName,
      obligationKind: obligations.kind,
      dueOn: obligations.dueOn,
      documentName: documents.name,
      documentKind: documents.kind,
    })
    .from(actions)
    .leftJoin(parties, eq(parties.id, actions.partyId))
    .leftJoin(obligations, eq(obligations.id, actions.obligationId))
    .leftJoin(documents, eq(documents.id, actions.documentId))
    .where(
      and(
        eq(actions.tenantId, tenant.id),
        eq(actions.isTest, q.test),
        eq(actions.status, q.status),
      ),
    )
    .orderBy(sql`${obligations.dueOn} asc nulls last`, asc(actions.createdAt), desc(actions.id))
    .limit(200);
  return {
    actions: rows.map((r) =>
      actionView(r.action, {
        party: r.action.partyId ? { id: r.action.partyId, name: r.partyName ?? '' } : null,
        obligation:
          r.action.obligationId && r.obligationKind && r.dueOn
            ? { id: r.action.obligationId, kind: r.obligationKind, dueOn: r.dueOn }
            : null,
        document: r.action.documentId
          ? { id: r.action.documentId, name: r.documentName ?? '', kind: r.documentKind }
          : null,
      }),
    ),
  };
}

interface Links {
  party: { id: string; name: string } | null;
  obligation: { id: string; kind: string; dueOn: string } | null;
  document: { id: string; name: string; kind: string | null } | null;
}

export function actionView(row: ActionRow, links?: Links) {
  const request = RequestPayload.safeParse(row.payload);
  const confirm = ConfirmPayload.safeParse(row.payload);
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    revision: row.revision,
    isTest: row.isTest,
    createdAt: row.createdAt.toISOString(),
    snoozeUntil: row.snoozeUntil?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    channel: row.channel,
    sentAt: row.sentAt?.toISOString() ?? null,
    error: row.error,
    /** The e-mail it will send, as the person may edit it. */
    email:
      row.kind !== 'confirmer_tiers' && request.success
        ? {
            to: request.data.to,
            subject: request.data.subject,
            body: request.data.body,
            notSent: request.data.notSent ?? false,
          }
        : null,
    /** The SIREN a person is asked about (`confirmer_tiers`). */
    siren: row.kind === 'confirmer_tiers' && confirm.success ? confirm.data.siren : null,
    ...(links ?? { party: null, obligation: null, document: null }),
  };
}

// ── A person's answer ─────────────────────────────────────────────────────────────────────────────

async function lockAction(tx: Tx, tenantId: string, id: string): Promise<ActionRow> {
  const [row] = await tx
    .select()
    .from(actions)
    .where(and(eq(actions.id, id), eq(actions.tenantId, tenantId)))
    .for('update');
  if (!row) throw new ApiError(404, 'action_not_found');
  return row;
}

export async function getAction(db: Db, tenant: Pick<TenantRow, 'id'>, id: string) {
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, 'action_not_found');
  const [row] = await db
    .select()
    .from(actions)
    .where(and(eq(actions.id, id), eq(actions.tenantId, tenant.id)));
  if (!row) throw new ApiError(404, 'action_not_found');
  return row;
}

/** Who decided, as the action and its audit keep it. */
export interface Decider {
  /** `user:<id>`, `api`, or the e-mail link's person. */
  actor: string;
  /** Stored on the action (`decided_by`): the person's id, or `key`. */
  by: string;
  /** Where answers to the request go: the person's address, when known. */
  email: string | null;
  channel: ApprovalChannel;
}

export const deciderOf = (principal: Principal, channel: ApprovalChannel): Decider => ({
  actor: actorOf(principal),
  by: who(principal),
  email: principal.kind === 'session' ? principal.email : null,
  channel,
});

/**
 * Applies one decision. The revision the person saw must be the action's: an edit elsewhere, or an
 * answer from another channel, refuses this one. Every decision moves the revision on, so a link
 * e-mailed before it can no longer decide.
 */
export async function decideAction(
  deps: Pick<ApiDeps, 'db' | 'jobs' | 'now' | 'directory'>,
  tenant: TenantRow,
  decider: Decider,
  decision: ApprovalDecision,
) {
  const first = await getAction(deps.db, tenant, decision.actionId);
  // The directory answers before the transaction: a slow directory never holds the row.
  const company =
    first.kind === 'confirmer_tiers' && decision.decision === 'approve'
      ? await lookupSupplier(deps, first)
      : null;
  const now = deps.now();
  const row = await deps.db.transaction(async (tx) => {
    const action = await lockAction(tx, tenant.id, decision.actionId);
    if (!(OPEN as readonly string[]).includes(action.status)) {
      throw new ApiError(409, 'action_already_decided');
    }
    if (action.revision !== decision.revision) throw new ApiError(409, 'action_revision_changed');
    const decided = {
      decidedBy: decider.by,
      decidedAt: now,
      channel: decider.channel,
      comment: decision.comment ?? null,
      revision: action.revision + 1,
      updatedAt: now,
    };
    let patch: Partial<ActionRow>;
    let after: Record<string, unknown> = {};
    switch (decision.decision) {
      case 'approve': {
        if (action.kind === 'confirmer_tiers') {
          if (!company) throw new ApiError(500, 'internal');
          after = await confirmSupplier(tx, action, company, now);
          patch = { ...decided, status: 'approved', error: null };
          break;
        }
        const payload = RequestPayload.parse(action.payload);
        if (!payload.to) throw new ApiError(422, 'action_needs_recipient');
        const replyTo = decider.email ?? (await ownerEmail(tx, tenant.id));
        patch = {
          ...decided,
          status: 'approved',
          snoozeUntil: null,
          error: null,
          payload: { ...payload, replyTo, tries: 0 },
        };
        break;
      }
      case 'reject':
        patch = { ...decided, status: 'rejected', snoozeUntil: null };
        break;
      case 'edit': {
        if (action.kind === 'confirmer_tiers') throw new ApiError(422, 'action_not_editable');
        const payload = RequestPayload.parse(action.payload);
        const to = decision.to ?? payload.to;
        patch = {
          ...decided,
          status: 'draft',
          snoozeUntil: null,
          error: null,
          // The person's own words: the comment is the new text, not a note beside it.
          comment: null,
          payload: { ...payload, to, body: decision.comment ?? payload.body },
        };
        after = { recipientChanged: to !== payload.to };
        // An address the company did not have is kept for its next requests.
        if (decision.to && action.partyId) {
          await tx
            .update(parties)
            .set({ email: decision.to, updatedAt: now })
            .where(and(eq(parties.id, action.partyId), isNull(parties.email)));
        }
        break;
      }
      case 'snooze': {
        const until = new Date(decision.snoozeUntil ?? '');
        const latest = new Date(now.getTime() + MAX_SNOOZE_DAYS * 86_400_000);
        if (!(until > now) || until > latest) throw new ApiError(400, 'action_snooze_range');
        patch = { ...decided, status: 'snoozed', snoozeUntil: until };
        break;
      }
    }
    const [updated] = await tx
      .update(actions)
      .set(patch)
      .where(eq(actions.id, action.id))
      .returning();
    if (!updated) throw new ApiError(404, 'action_not_found');
    await audit(tx, {
      tenantId: tenant.id,
      actor: decider.actor,
      action: 'action.decide',
      objectType: 'action',
      objectId: action.id,
      before: { status: action.status, revision: action.revision },
      after: {
        status: updated.status,
        decision: decision.decision,
        channel: decider.channel,
        ...after,
      },
    });
    return updated;
  });
  if (row.status === 'approved' && row.kind !== 'confirmer_tiers') {
    await deps.jobs.enqueueAction(row.id);
  }
  // The new supplier's deadlines have a company to ask now: their requests appear at once rather
  // than at the watchers' next run.
  if (row.status === 'approved' && row.kind === 'confirmer_tiers') {
    await draftDue(deps.db, now, tenant.id);
  }
  return actionView(row);
}

/** The company of an unknown SIREN, as the directory describes it now. */
async function lookupSupplier(deps: Pick<ApiDeps, 'directory'>, action: ActionRow) {
  const { siren } = ConfirmPayload.parse(action.payload);
  if (!deps.directory) throw new ApiError(503, 'party_directory_unavailable');
  let company: Awaited<ReturnType<NonNullable<ApiDeps['directory']>['lookup']>>;
  try {
    company = await deps.directory.lookup(siren);
  } catch (e) {
    if (e instanceof DirectoryUnavailable) throw new ApiError(503, 'party_directory_unavailable');
    throw e;
  }
  if (!company) throw new ApiError(422, 'supplier_not_found', { siren });
  if (company.closed) throw new ApiError(409, 'supplier_closed', { siren });
  if (company.keptSiren && company.keptSiren !== siren) {
    throw new ApiError(409, 'supplier_duplicate', { siren: company.keptSiren });
  }
  if (!company.name) throw new ApiError(422, 'supplier_name_needed', { siren });
  return { ...company, name: company.name };
}

/**
 * « Ajouter comme fournisseur »: the supplier saved as the directory describes it (or found, if a
 * person added it meanwhile), then its documents and their deadlines linked to it. The next watcher
 * run drafts the requests those deadlines need.
 */
async function confirmSupplier(
  tx: Tx,
  action: ActionRow,
  company: Awaited<ReturnType<typeof lookupSupplier>>,
  now: Date,
) {
  const { siren } = ConfirmPayload.parse(action.payload);
  const [inserted] = await tx
    .insert(parties)
    .values({
      tenantId: action.tenantId,
      kind: 'supplier',
      legalName: company.name,
      siren,
      vatId: company.vatSource === 'dgfip' ? company.vatId : null,
      address: company.address,
      source: 'sirene',
      verifiedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: parties.id });
  let partyId = inserted?.id;
  if (!partyId) {
    const [known] = await tx
      .select({ id: parties.id })
      .from(parties)
      .where(
        and(
          eq(parties.tenantId, action.tenantId),
          eq(parties.kind, 'supplier'),
          eq(parties.siren, siren),
        ),
      );
    partyId = known?.id;
  }
  if (!partyId) throw new ApiError(500, 'internal');
  const linked = await tx
    .update(documents)
    .set({ partyId, updatedAt: now })
    .where(
      and(
        eq(documents.tenantId, action.tenantId),
        eq(documents.isTest, action.isTest),
        isNull(documents.partyId),
        sql`${documents.extracted}->>'siren' = ${siren}`,
      ),
    )
    .returning({ id: documents.id });
  const ids = linked.map((d) => d.id);
  const deadlines = ids.length
    ? await tx
        .update(obligations)
        .set({ partyId, updatedAt: now })
        .where(
          and(
            eq(obligations.tenantId, action.tenantId),
            isNull(obligations.partyId),
            inArray(obligations.sourceDocumentId, ids),
          ),
        )
        .returning({ id: obligations.id })
    : [];
  await tx.update(actions).set({ partyId }).where(eq(actions.id, action.id));
  return {
    partyId,
    created: Boolean(inserted),
    documents: ids.length,
    deadlines: deadlines.length,
  };
}

// ── Sending what was approved (queue `action.send`) ──────────────────────────────────────────────

export type SendDeps = Pick<ApiDeps, 'db' | 'mailer' | 'now'>;

type Claim =
  | { kind: 'none' }
  | { kind: 'mail'; tenantId: string; payload: RequestPayload; tries: number };

/** Why a request was not sent, as the pane words it (`addin.actions.error.*`). */
export type ActionError = 'no_longer_needed' | 'mail_unavailable' | 'mail_failed' | 'send_unknown';

/**
 * Sends one approved request, once: claimed in a transaction (`sendingAt`), checked, e-mailed, then
 * `sent`. A claim that never finished is given back to a person by the watchers (`send_unknown`):
 * never two e-mails, never one lost in silence.
 */
export async function runActionSend(deps: SendDeps, actionId: string): Promise<void> {
  const now = deps.now();
  const claim = await deps.db.transaction(async (tx): Promise<Claim> => {
    const [action] = await tx.select().from(actions).where(eq(actions.id, actionId)).for('update');
    if (action?.status !== 'approved' || action.kind === 'confirmer_tiers') {
      return { kind: 'none' };
    }
    const payload = RequestPayload.parse(action.payload);
    if (payload.sendingAt) return { kind: 'none' };
    const fail = async (error: ActionError) => {
      await tx
        .update(actions)
        .set({ status: 'failed', error, updatedAt: now })
        .where(eq(actions.id, action.id));
      await audit(tx, {
        tenantId: action.tenantId,
        actor: 'agent:action',
        action: 'action.failed',
        objectType: 'action',
        objectId: action.id,
        after: { error },
      });
      return { kind: 'none' } as const;
    };
    // The check before sending (BTP plan §7 `preflight`): the deadline still open, on its date.
    if (action.obligationId) {
      const [due] = await tx
        .select({ status: obligations.status, dueOn: obligations.dueOn })
        .from(obligations)
        .where(eq(obligations.id, action.obligationId));
      if (due?.status !== 'open' || due.dueOn !== payload.dueOn) return fail('no_longer_needed');
    }
    if (action.isTest) {
      await tx
        .update(actions)
        .set({
          status: 'sent',
          sentAt: now,
          payload: { ...payload, notSent: true },
          updatedAt: now,
        })
        .where(eq(actions.id, action.id));
      await audit(tx, {
        tenantId: action.tenantId,
        actor: 'agent:action',
        action: 'action.sent',
        objectType: 'action',
        objectId: action.id,
        after: { test: true },
      });
      return { kind: 'none' };
    }
    if (!deps.mailer) return fail('mail_unavailable');
    if (!payload.to) return fail('mail_failed');
    const tries = (payload.tries ?? 0) + 1;
    await tx
      .update(actions)
      // Real time, not the business clock: an accelerated clock must not take a send in progress
      // for an interrupted one.
      .set({ payload: { ...payload, sendingAt: new Date().toISOString(), tries }, updatedAt: now })
      .where(eq(actions.id, action.id));
    return { kind: 'mail', tenantId: action.tenantId, payload, tries };
  });
  if (claim.kind === 'none' || !deps.mailer) return;

  // Outside any transaction: the claim is committed, so a crash here never sends twice.
  let failure: unknown = null;
  try {
    await deps.mailer.send({
      to: claim.payload.to ?? '',
      subject: claim.payload.subject,
      text: claim.payload.body,
      ...(claim.payload.replyTo && { replyTo: claim.payload.replyTo }),
    });
  } catch (e) {
    failure = e;
  }
  const done = deps.now();
  await deps.db.transaction(async (tx) => {
    const { sendingAt: _, ...payload } = claim.payload;
    const last = failure !== null && claim.tries >= ACTION_SEND_TRIES;
    const status = failure === null ? 'sent' : last ? 'failed' : 'approved';
    await tx
      .update(actions)
      .set({
        status,
        payload: { ...payload, tries: claim.tries },
        ...(failure === null && { sentAt: done }),
        error: failure === null ? null : 'mail_failed',
        updatedAt: done,
      })
      .where(eq(actions.id, actionId));
    if (failure === null) {
      const [row] = await tx
        .select({ obligationId: actions.obligationId })
        .from(actions)
        .where(eq(actions.id, actionId));
      if (row?.obligationId) {
        await tx
          .update(obligations)
          .set({ lastRemindedAt: done, updatedAt: done })
          .where(eq(obligations.id, row.obligationId));
      }
    }
    await audit(tx, {
      tenantId: claim.tenantId,
      actor: 'agent:action',
      action: failure === null ? 'action.sent' : 'action.failed',
      objectType: 'action',
      objectId: actionId,
      after: { tries: claim.tries, ...(failure !== null && { error: 'mail_failed', last }) },
    });
  });
  // Not the last try: the queue tries again later, with its backoff.
  if (failure !== null && claim.tries < ACTION_SEND_TRIES) throw failure;
}

// ── A deadline handled elsewhere ──────────────────────────────────────────────────────────────────

export const CloseObligationBody = z.object({ status: z.enum(['done', 'dismissed']) });

/** « C'est fait » or « Ignorer » on a deadline: closed, and its requests withdrawn. */
export async function closeObligation(
  deps: Pick<ApiDeps, 'db' | 'now'>,
  tenant: Pick<TenantRow, 'id'>,
  principal: Principal,
  id: string,
  input: z.infer<typeof CloseObligationBody>,
) {
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, 'obligation_not_found');
  const now = deps.now();
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(obligations)
      .where(and(eq(obligations.id, id), eq(obligations.tenantId, tenant.id)))
      .for('update');
    if (!row) throw new ApiError(404, 'obligation_not_found');
    if (row.status !== 'open') throw new ApiError(409, 'obligation_closed');
    await tx
      .update(obligations)
      .set({ status: input.status, closedAt: now, updatedAt: now })
      .where(eq(obligations.id, id));
    const withdrawn = await withdrawDrafts(
      tx,
      tenant.id,
      eq(actions.obligationId, id),
      { actor: actorOf(principal), decidedBy: who(principal), reason: `deadline_${input.status}` },
      now,
    );
    await audit(tx, {
      tenantId: tenant.id,
      actor: actorOf(principal),
      action: 'obligation.close',
      objectType: 'obligation',
      objectId: id,
      before: { status: row.status },
      after: { status: input.status, withdrawn: withdrawn.length },
    });
    return { id, status: input.status, withdrawn: withdrawn.length };
  });
}
