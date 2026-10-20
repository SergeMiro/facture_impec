// Autopilot send (plan §0.2): in Autopilot mode, an invoice to a customer the user opted in leaves by
// itself, under the company's ceiling, once a first invoice to that customer was sent by hand and
// delivered. It waits AUTOPILOT_GRACE_MS after its last change (the sheet syncs while the user types),
// the sheet says when, and every check runs again when it is due: one fails, the send is cancelled
// with a line on the timeline and the invoice waits for « Envoyer ».
import { type InvoiceState, parisTime } from '@fi/core';
import {
  and,
  applyTransition,
  audit,
  type DbOrTx,
  desc,
  eq,
  findings,
  type InvoiceRow,
  inArray,
  invoiceEvents,
  invoices,
  isNotNull,
  isNull,
  lockInvoice,
  lte,
  ne,
  parties,
  sql,
  type TenantRow,
  type Tx,
  tenants,
  validationResults,
} from '@fi/db';
import { PdpUnavailableError } from '@fi/pdp-adapter';
import { t } from '@fi/shared';
import { assertMaySend } from './billing';
import { checkNow } from './checks';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { awaitsGoLive, routeFor } from './platform';

/** How long an invoice waits after its last change before it leaves by itself. */
export const AUTOPILOT_GRACE_MS = 15 * 60_000;

/** Due invoices one sweep handles; the rest wait for the next one. */
const BATCH = 200;

/** Delivered to the customer, or further on the happy path. */
const DELIVERED: readonly InvoiceState[] = ['delivered', 'accepted', 'overdue', 'chasing', 'paid'];

/** Why an invoice does not leave by itself (fr.json autopilot.reason.*). */
export type AutopilotBlocker =
  | 'mode'
  | 'status'
  | 'issues'
  | 'findings'
  | 'kind'
  | 'amount'
  | 'party'
  | 'partyOff'
  | 'trial'
  | 'noPlatform'
  | 'notLive'
  | 'notFound'
  | 'billing';

const buyerSiren = (row: InvoiceRow) => row.document.buyer.legalId?.id?.trim() || null;

/** A first invoice to this customer was sent on « Envoyer » and reached the customer. */
async function hadTrial(db: DbOrTx, row: InvoiceRow, siren: string): Promise<boolean> {
  const [found] = await db
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, row.tenantId),
        eq(invoices.direction, 'out'),
        eq(invoices.isTest, row.isTest),
        ne(invoices.id, row.id),
        inArray(invoices.status, DELIVERED),
        sql`${invoices.document}->'buyer'->'legalId'->>'id' = ${siren}`,
        sql`exists (select 1 from invoice_events e where e.invoice_id = ${invoices.id}
          and e.type = 'transition' and e.event = 'approve' and e.actor = 'user')`,
      ),
    )
    .limit(1);
  return Boolean(found);
}

/** What keeps this invoice from leaving by itself, among what the database knows; null: nothing. */
export async function autopilotBlocker(
  db: DbOrTx,
  tenant: TenantRow,
  row: InvoiceRow,
): Promise<AutopilotBlocker | null> {
  const ceiling = tenant.autopilotMaxAmount;
  if (tenant.mode !== 'autopilot' || ceiling === null) return 'mode';
  if (row.direction !== 'out' || row.status !== 'validated') return 'status';
  const [last] = await db
    .select({ severity: validationResults.severityMax })
    .from(validationResults)
    .where(eq(validationResults.invoiceId, row.id))
    .orderBy(desc(validationResults.runAt), desc(validationResults.id))
    .limit(1);
  // A warning is for a person to read: the autopilot does not send past one.
  if (last?.severity !== 'none') return 'issues';
  // A check across documents found money at stake (src/checks.ts): a person decides.
  const [held] = await db
    .select({ id: findings.id })
    .from(findings)
    .where(
      and(
        eq(findings.invoiceId, row.id),
        eq(findings.status, 'open'),
        eq(findings.severity, 'blocking'),
      ),
    )
    .limit(1);
  if (held) return 'findings';
  const typeCode = row.document.typeCode ?? '380';
  if (typeCode !== '380' || row.document.currency !== 'EUR') return 'kind';
  if (row.payable === null || row.payable <= 0 || row.payable > ceiling) return 'amount';
  if (!row.partyId) return 'party';
  const [party] = await db.select().from(parties).where(eq(parties.id, row.partyId));
  const siren = buyerSiren(row);
  if (!party || party.tenantId !== tenant.id || !siren || party.siren !== siren) return 'party';
  if (!party.autopilot) return 'partyOff';
  if (!(await hadTrial(db, row, siren))) return 'trial';
  return null;
}

/**
 * After every change of the invoice: plans the send for its current content, keeps the planned time
 * when the content did not change, or clears it when the invoice may not leave by itself any more.
 */
export async function planAutopilot(tx: Tx, now: Date, tenant: TenantRow, invoiceId: string) {
  const [row] = await tx.select().from(invoices).where(eq(invoices.id, invoiceId));
  if (!row) return;
  const blocked = row.autopilotHeld || (await autopilotBlocker(tx, tenant, row)) !== null;
  if (blocked) {
    if (row.autopilotAt) {
      await tx
        .update(invoices)
        .set({ autopilotAt: null, autopilotFingerprint: null })
        .where(eq(invoices.id, row.id));
    }
    return;
  }
  if (row.autopilotAt && row.autopilotFingerprint === row.fingerprint) return;
  await tx
    .update(invoices)
    .set({
      autopilotAt: new Date(now.getTime() + AUTOPILOT_GRACE_MS),
      autopilotFingerprint: row.fingerprint,
    })
    .where(eq(invoices.id, row.id));
}

/** The company's validated invoices the autopilot may take, planned again (a switch was turned on). */
export async function planAll(tx: Tx, now: Date, tenant: TenantRow, partyId?: string) {
  const rows = await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenant.id),
        eq(invoices.status, 'validated'),
        eq(invoices.autopilotHeld, false),
        partyId ? eq(invoices.partyId, partyId) : isNotNull(invoices.partyId),
      ),
    );
  for (const r of rows) await planAutopilot(tx, now, tenant, r.id);
}

/** Nothing leaves by itself any more (Review mode, a customer opted out or forgotten). */
export async function unplanAll(tx: Tx, tenantId: string, partyId?: string) {
  await tx
    .update(invoices)
    .set({ autopilotAt: null, autopilotFingerprint: null })
    .where(
      and(
        eq(invoices.tenantId, tenantId),
        isNotNull(invoices.autopilotAt),
        partyId ? eq(invoices.partyId, partyId) : undefined,
      ),
    );
}

/** FI_Détail of a planned invoice: when it leaves. */
export function autopilotNote(row: Pick<InvoiceRow, 'status' | 'autopilotAt'>): string | null {
  if (row.status !== 'validated' || !row.autopilotAt) return null;
  return t('autopilot.sheet', { time: parisTime(row.autopilotAt) });
}

/** « Annuler l'envoi automatique »: this invoice leaves only on « Envoyer » from now on. */
export async function holdAutopilot(deps: ApiDeps, tenant: TenantRow, id: string) {
  await deps.db.transaction(async (tx) => {
    const row = await lockInvoice(tx, id);
    if (!row || row.tenantId !== tenant.id) throw new ApiError(404, 'not_found');
    if (row.autopilotHeld) return;
    await tx
      .update(invoices)
      .set({ autopilotHeld: true, autopilotAt: null, autopilotFingerprint: null })
      .where(eq(invoices.id, id));
    await tx.insert(invoiceEvents).values({
      invoiceId: id,
      type: 'note',
      actor: 'user',
      event: 'autopilot_held',
      payload: {},
    });
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'invoice.autopilot_hold',
      objectType: 'invoice',
      objectId: id,
      before: { autopilotAt: row.autopilotAt?.toISOString() ?? null },
    });
  });
}

export type AutopilotDeps = Pick<ApiDeps, 'db' | 'pdp' | 'test' | 'jobs' | 'billing' | 'now'> & {
  env?: Pick<ApiDeps['env'], 'FI_ENV'>;
};

type Outcome = 'sent' | 'cancelled' | 'later' | 'skipped';

/** Checks that need the platform: it must exist, be open, and know the customer. */
async function platformBlocker(
  deps: AutopilotDeps,
  tenant: TenantRow,
  row: InvoiceRow,
): Promise<AutopilotBlocker | 'later' | null> {
  const route = routeFor(deps, tenant, row.isTest);
  if (!route?.adapter) return 'noPlatform';
  if (!row.isTest && awaitsGoLive(deps, tenant)) return 'notLive';
  try {
    const found = await route.adapter.lookupRecipient({
      account: route.account,
      siren: buyerSiren(row) ?? '',
    });
    return found ? null : 'notFound';
  } catch (e) {
    // The platform is down: ask again at the next sweep rather than cancel.
    if (e instanceof PdpUnavailableError) return 'later';
    throw e;
  }
}

async function fire(deps: AutopilotDeps, id: string): Promise<Outcome> {
  const now = deps.now();
  const [row] = await deps.db.select().from(invoices).where(eq(invoices.id, id));
  if (row?.status !== 'validated' || !row.autopilotAt || row.autopilotAt > now) {
    return 'skipped';
  }
  const [tenant] = await deps.db
    .select()
    .from(tenants)
    .where(and(eq(tenants.id, row.tenantId), isNull(tenants.deletedAt)));
  if (!tenant) return 'skipped';
  let blocker: AutopilotBlocker | 'later' | null = await autopilotBlocker(deps.db, tenant, row);
  if (!blocker && row.autopilotFingerprint === row.fingerprint) {
    blocker = await platformBlocker(deps, tenant, row);
  }
  if (blocker === 'later') return 'later';

  const outcome = await deps.db.transaction(async (tx): Promise<Outcome> => {
    const locked = await lockInvoice(tx, id);
    // Changed meanwhile: the change planned it again (or not); this run has nothing to say.
    if (
      locked?.status !== 'validated' ||
      locked.autopilotHeld ||
      !locked.autopilotAt ||
      locked.fingerprint !== row.fingerprint ||
      locked.autopilotFingerprint !== row.fingerprint
    ) {
      if (locked?.status === 'validated' && !locked.autopilotHeld) {
        await planAutopilot(tx, now, tenant, id);
      }
      return 'skipped';
    }
    let reason = blocker;
    if (!reason && !row.isTest) {
      try {
        await assertMaySend(deps, tx, tenant);
      } catch (e) {
        if (!(e instanceof ApiError)) throw e;
        reason = 'billing';
      }
    }
    await tx
      .update(invoices)
      .set({ autopilotAt: null, autopilotFingerprint: null })
      .where(eq(invoices.id, id));
    if (reason) {
      const payload = { reason: { code: reason, message: t(`autopilot.reason.${reason}`) } };
      await tx.insert(invoiceEvents).values({
        invoiceId: id,
        type: 'note',
        actor: 'system',
        event: 'autopilot_cancelled',
        payload,
      });
      await audit(tx, {
        tenantId: tenant.id,
        actor: 'system',
        action: 'invoice.autopilot_cancel',
        objectType: 'invoice',
        objectId: id,
        after: { reason, fingerprint: row.fingerprint },
      });
      return 'cancelled';
    }
    await applyTransition(tx, {
      invoiceId: id,
      event: 'approve',
      actor: 'system',
      payload: { autopilot: true },
    });
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'system',
      action: 'invoice.autopilot',
      objectType: 'invoice',
      objectId: id,
      after: { fingerprint: row.fingerprint, payable: row.payable, partyId: row.partyId },
    });
    return 'sent';
  });
  // After the commit, as « Envoyer » does: the sweep re-queues a ready_to_send left behind.
  if (outcome === 'sent') await deps.jobs.enqueueSend(id);
  return outcome;
}

/** The sweep's turn: every planned invoice that is due leaves, or is cancelled with its reason. */
export async function runAutopilot(
  deps: AutopilotDeps,
  log: (message: string) => void = () => {},
): Promise<{ sent: number; cancelled: number }> {
  const due = await deps.db
    .select({ id: invoices.id, tenantId: invoices.tenantId })
    .from(invoices)
    .where(
      and(
        isNotNull(invoices.autopilotAt),
        lte(invoices.autopilotAt, deps.now()),
        eq(invoices.status, 'validated'),
        eq(invoices.autopilotHeld, false),
      ),
    )
    .orderBy(invoices.autopilotAt)
    .limit(BATCH);
  // Today's findings first: an invoice one of them now holds is cancelled with its reason there. A
  // company whose check failed sends nothing this time, rather than past a finding nobody saw.
  const unchecked = new Set<string>();
  for (const tenantId of new Set(due.map((d) => d.tenantId))) {
    try {
      await checkNow(deps.db, tenantId, deps.now());
    } catch (e) {
      unchecked.add(tenantId);
      log(`checks ${tenantId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  let sent = 0;
  let cancelled = 0;
  for (const { id, tenantId } of due) {
    if (unchecked.has(tenantId)) continue;
    try {
      const outcome = await fire(deps, id);
      if (outcome === 'sent') sent++;
      if (outcome === 'cancelled') cancelled++;
    } catch (e) {
      log(`autopilot ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { sent, cancelled };
}
