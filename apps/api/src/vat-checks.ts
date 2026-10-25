// PartyAgent `vies.check` (plan §6): the sweep asks VIES about the VAT numbers of EU customers named
// on invoices not yet sent, with an intra-EU supply (K) or a reverse charge (AE) — once per number and
// company a day, one question at a time. The answer is kept with VIES' consultation number as proof,
// written on each invoice's timeline when it is new, and those invoices are checked again: a number
// VIES says is not valid gives warning FF-VIES-01. VIES not answering changes nothing.
// « Vérifier dans VIES » on an invoice's fiche asks the same question now (checkBuyerVat).
import { parisToday, viesNumber } from '@fi/core';
import {
  and,
  audit,
  type Db,
  desc,
  eq,
  type InvoiceRow,
  inArray,
  invoiceEvents,
  invoices,
  isNull,
  or,
  sql,
  type TenantRow,
  tenants,
  vatChecks,
} from '@fi/db';
import { ApiError } from './errors';
import { EDITABLE, recheckBuyerVat } from './invoices';
import { MEMBER_STATE, type Vies, type ViesAnswer, ViesUnavailable } from './vies';

/** Questions per sweep (every PDP_SYNC_INTERVAL_SECONDS, 5 minutes by default). */
export const VAT_CHECKS_PER_SWEEP = 20;

/** Only this number cannot be asked about now. */
const THIS_NUMBER = new Set(['VAT_BLOCKED', 'INVALID_REQUESTER_INFO']);

export interface VatCheckDeps {
  db: Db;
  vies?: Vies | null;
  now: () => Date;
}

/** The company's own VAT number, as VIES takes a requester; null when it has none. */
function requesterOf(tenant: TenantRow): string | null {
  const v = tenant.vatId?.toUpperCase().replace(/[\s.-]/g, '') ?? '';
  return /^FR[0-9A-Z]{2}\d{9}$/.test(v) ? v : null;
}

/** Numbers to ask about today: [tenant, vatId] pairs without an answer from today. */
async function due(db: Db, today: string): Promise<{ tenant: TenantRow; vatId: string }[]> {
  const rows = await db
    .selectDistinct({
      tenantId: invoices.tenantId,
      vatId: sql<string>`${invoices.document}->'buyer'->>'vatId'`,
    })
    .from(invoices)
    .innerJoin(tenants, eq(tenants.id, invoices.tenantId))
    .where(
      and(
        isNull(tenants.deletedAt),
        eq(invoices.direction, 'out'),
        inArray(invoices.status, [...EDITABLE]),
        sql`${invoices.document}->'buyer'->>'vatId' is not null`,
        or(
          sql`${invoices.document}->'vatBreakdown' @> '[{"category":"K"}]'::jsonb`,
          sql`${invoices.document}->'vatBreakdown' @> '[{"category":"AE"}]'::jsonb`,
        ),
      ),
    );
  const pairs = new Map<string, { tenantId: string; vatId: string }>();
  for (const r of rows) {
    const vatId = viesNumber(r.vatId)?.vatId;
    if (vatId) pairs.set(`${r.tenantId} ${vatId}`, { tenantId: r.tenantId, vatId });
  }
  if (pairs.size === 0) return [];
  const asked = await db
    .select({ tenantId: vatChecks.tenantId, vatId: vatChecks.vatId })
    .from(vatChecks)
    .where(eq(vatChecks.checkedOn, today));
  for (const a of asked) pairs.delete(`${a.tenantId} ${a.vatId}`);
  const ids = [...new Set([...pairs.values()].map((p) => p.tenantId))];
  if (ids.length === 0) return [];
  const companies = new Map(
    (await db.select().from(tenants).where(inArray(tenants.id, ids))).map((t) => [t.id, t]),
  );
  return [...pairs.values()].flatMap(({ tenantId, vatId }) => {
    const tenant = companies.get(tenantId);
    return tenant ? [{ tenant, vatId }] : [];
  });
}

/**
 * Keeps one answer: the proof, its audit event, the timeline notes, the invoices checked again.
 * `actor`: the sweep, or the user who clicked « Vérifier dans VIES ».
 */
async function keep(
  deps: VatCheckDeps,
  tenant: TenantRow,
  vatId: string,
  answer: ViesAnswer,
  actor: 'agent:party' | 'user' = 'agent:party',
) {
  const now = deps.now();
  const checkedOn = parisToday(now);
  await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(vatChecks)
      .values({
        tenantId: tenant.id,
        vatId,
        valid: answer.valid,
        name: answer.name,
        address: answer.address,
        requestIdentifier: answer.requestIdentifier,
        checkedOn,
        checkedAt: answer.requestDate,
      })
      .onConflictDoNothing()
      .returning({ id: vatChecks.id });
    // Another instance kept today's answer first.
    if (!row) return;
    await audit(tx, {
      tenantId: tenant.id,
      actor,
      action: 'vat.check',
      objectType: 'vat_check',
      objectId: row.id,
      after: { vatId, valid: answer.valid, requestIdentifier: answer.requestIdentifier },
    });
    const ids = await recheckBuyerVat(tx, tenant, vatId, now);
    if (ids.length === 0) return;
    const notes = await tx
      .selectDistinctOn([invoiceEvents.invoiceId], {
        invoiceId: invoiceEvents.invoiceId,
        payload: invoiceEvents.payload,
      })
      .from(invoiceEvents)
      .where(
        and(
          inArray(invoiceEvents.invoiceId, ids),
          eq(invoiceEvents.type, 'note'),
          eq(invoiceEvents.event, 'vat_check'),
        ),
      )
      .orderBy(invoiceEvents.invoiceId, desc(invoiceEvents.id));
    const told = new Map(notes.map((n) => [n.invoiceId, n.payload]));
    // On the timeline once, then again only when VIES changes its mind: not every day.
    const news = ids.filter((id) => {
      const last = told.get(id);
      return last?.vatId !== vatId || last.valid !== answer.valid;
    });
    if (news.length === 0) return;
    await tx.insert(invoiceEvents).values(
      news.map((invoiceId) => ({
        invoiceId,
        type: 'note' as const,
        actor,
        event: 'vat_check',
        at: now,
        payload: {
          vatId,
          valid: answer.valid,
          requestIdentifier: answer.requestIdentifier,
          checkedOn,
        },
      })),
    );
  });
}

/** One sweep's questions to VIES (src/workers.ts); returns how many answers were kept. */
export async function runVatChecks(
  deps: VatCheckDeps,
  log: (message: string) => void = () => {},
): Promise<number> {
  const vies = deps.vies;
  if (!vies) return 0;
  const pending = await due(deps.db, parisToday(deps.now()));
  const skipped = new Set<string>();
  let kept = 0;
  for (const { tenant, vatId } of pending.slice(0, VAT_CHECKS_PER_SWEEP)) {
    const number = viesNumber(vatId);
    if (!number || skipped.has(number.country)) continue;
    try {
      await keep(deps, tenant, vatId, await vies.check(number, requesterOf(tenant)));
      kept++;
    } catch (e) {
      if (!(e instanceof ViesUnavailable)) {
        log(`vat check ${vatId}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      log(`vat check ${vatId}: VIES did not answer (${e.code}), asked again next sweep`);
      // A member state down: its other numbers wait for the next sweep. VIES itself: the rest too.
      if (MEMBER_STATE.has(e.code)) skipped.add(number.country);
      else if (!THIS_NUMBER.has(e.code)) break;
    }
  }
  return kept;
}

/**
 * « Vérifier dans VIES » on an invoice's fiche: asks VIES now about its customer's number, unless it
 * answered today, and keeps the answer as the sweep does. The fiche then shows it.
 */
export async function checkBuyerVat(
  deps: VatCheckDeps,
  tenant: TenantRow,
  invoice: InvoiceRow,
): Promise<void> {
  const number = invoice.direction === 'out' ? viesNumber(invoice.document.buyer.vatId) : null;
  if (!number) throw new ApiError(400, 'vat_not_vies');
  const [today] = await deps.db
    .select({ id: vatChecks.id })
    .from(vatChecks)
    .where(
      and(
        eq(vatChecks.tenantId, tenant.id),
        eq(vatChecks.vatId, number.vatId),
        eq(vatChecks.checkedOn, parisToday(deps.now())),
      ),
    );
  if (today) return;
  if (!deps.vies) throw new ApiError(503, 'vies_off');
  let answer: ViesAnswer;
  try {
    answer = await deps.vies.check(number, requesterOf(tenant));
  } catch (e) {
    if (e instanceof ViesUnavailable) {
      throw new ApiError(503, 'vies_unavailable', undefined, e.code);
    }
    throw e;
  }
  await keep(deps, tenant, number.vatId, answer, 'user');
}
