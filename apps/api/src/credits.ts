// After a send (plan §4): the platform has the invoice, so it is never edited nor cancelled again.
// « Établir un avoir » prepares its full credit note (type 381, BG-3 naming it, series AV<year>-<n>):
// a new invoice that leaves only by « Envoyer », as any other (Review mode, plan §0.2). When the
// platform has the credit note (runSend), the invoice it cancels becomes « Annulée par un avoir » and
// its chasing ends. A refused invoice (« Refusée ») is not corrected under its number (AFNOR XP Z12-014
// use case 5, docs/ARCHITECTURE.md § Credit notes): credit note first, then a new invoice with a new
// number. « Abandonner la créance » gives up an unpaid invoice past its due date.
import {
  CREDIT_NOTE_TYPE,
  creditNoteDraft,
  type InvoiceState,
  nextCreditNumber,
  parisToday,
} from '@fi/core';
import {
  and,
  applyTransition,
  eq,
  type InvoiceRow,
  invoiceEvents,
  invoices,
  lockInvoice,
  ne,
  sql,
  type TenantRow,
  type Tx,
} from '@fi/db';
import { endPlan } from './collect';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { createInvoice, getInvoice, label, liveCreditNote, TEST_PREFIX } from './invoices';

/** The platform has it, it is not paid and not cancelled yet: a credit note can cancel it. */
export const CREDITABLE: readonly InvoiceState[] = [
  'deposited',
  'delivered',
  'accepted',
  'refused_by_customer',
  'disputed',
  'overdue',
  'chasing',
];
const NOT_SENT_YET: readonly InvoiceState[] = ['draft', 'needs_fix', 'validated', 'ready_to_send'];
const WRITABLE_OFF: readonly InvoiceState[] = ['overdue', 'chasing'];

/** Why this invoice cannot be credited, as the error the user reads. */
function refusal(row: InvoiceRow): ApiError | null {
  if (row.direction !== 'out') return new ApiError(404, 'not_found');
  if (row.document.typeCode === CREDIT_NOTE_TYPE) return new ApiError(409, 'credit_of_credit');
  if (NOT_SENT_YET.includes(row.status)) return new ApiError(409, 'credit_not_sent');
  if (row.status === 'sending') return new ApiError(409, 'credit_while_sending');
  if (row.status === 'rejected_by_pdp') return new ApiError(409, 'credit_rejected');
  if (row.status === 'paid') return new ApiError(409, 'credit_paid');
  if (!CREDITABLE.includes(row.status) || !row.number || !row.issueDate) {
    return new ApiError(409, 'not_creditable', { status: label(row.status) });
  }
  return null;
}

/** The credit-note numbers the company used in this mode (a test one without its TEST- prefix). */
async function creditNumbers(deps: ApiDeps, tenant: TenantRow, isTest: boolean) {
  const rows = await deps.db
    .select({ number: invoices.number })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenant.id),
        eq(invoices.direction, 'out'),
        eq(invoices.isTest, isTest),
        ne(invoices.status, 'cancelled'),
        sql`${invoices.number} like ${isTest ? `${TEST_PREFIX}AV%` : 'AV%'}`,
      ),
    );
  return rows.map((r) => (r.number ?? '').replace(TEST_PREFIX, ''));
}

/**
 * « Établir un avoir »: the full credit note of a sent invoice, as a draft of its own. Asking again
 * — double click, retried request — returns the same credit note. A refused invoice is « en litige »
 * from now on: the refusal is being handled.
 */
export async function createCreditNote(
  deps: ApiDeps,
  tenant: TenantRow,
  id: string,
): Promise<{ row: InvoiceRow; created: boolean }> {
  const original = await getInvoice(deps, tenant, id);
  const live = await liveCreditNote(deps.db, original.id);
  if (live) return { row: live, created: false };
  const refused = refusal(original);
  if (refused) throw refused;

  const issueDate = parisToday(deps.now());
  let made: InvoiceRow | undefined;
  let number = '';
  // Another credit note numbered meanwhile takes the number: the next one is taken, three times at most.
  for (let attempt = 0; !made && attempt < 3; attempt++) {
    number = nextCreditNumber(
      issueDate.slice(0, 4),
      await creditNumbers(deps, tenant, original.isTest),
    );
    const draft = creditNoteDraft(
      original.draft,
      { number: original.number ?? '', issueDate: original.issueDate ?? '' },
      { number, issueDate },
    );
    try {
      const { row, created } = await createInvoice(deps, tenant, {
        draft,
        isTest: original.isTest,
        creditOf: original.id,
      });
      // Same number, same content: another request made this very credit note first.
      if (!created) return { row, created: false };
      made = row;
    } catch (e) {
      // The same click twice at once: the other request made the credit note.
      const other = await liveCreditNote(deps.db, original.id);
      if (other) return { row: other, created: false };
      if (!(e instanceof ApiError && e.code === 'number_taken')) throw e;
    }
  }
  if (!made) throw new ApiError(409, 'number_taken', { number });

  const avoir = made;
  await deps.db.transaction(async (tx) => {
    const row = await lockInvoice(tx, original.id);
    if (row?.status === 'refused_by_customer') {
      await applyTransition(tx, {
        invoiceId: original.id,
        event: 'dispute',
        actor: 'user',
        payload: { creditNote: avoir.id, number: avoir.number },
      });
    }
    await tx.insert(invoiceEvents).values([
      {
        invoiceId: original.id,
        type: 'note',
        actor: 'user',
        event: 'credit_note_drafted',
        payload: { creditNote: avoir.id, number: avoir.number },
      },
      {
        invoiceId: avoir.id,
        type: 'note',
        actor: 'user',
        event: 'credit_note_of',
        payload: { invoice: original.id, number: original.number },
      },
    ]);
  });
  return { row: avoir, created: true };
}

/**
 * The platform has a credit note (src/workers.ts runSend, same transaction): the invoice it names is
 * cancelled by it. One paid meanwhile stays paid; its timeline says the credit note left.
 * TODO(verify) docs/B2BROUTER.md T24: that B2Brouter takes an imported 381 as the credit note of the
 * invoice it names (BG-3), and gives it the statuses of an invoice.
 */
export async function creditOriginal(tx: Tx, creditNoteId: string, now: Date): Promise<void> {
  const [note] = await tx
    .select({ creditOf: invoices.creditOf, number: invoices.number })
    .from(invoices)
    .where(eq(invoices.id, creditNoteId));
  if (!note?.creditOf) return;
  const original = await lockInvoice(tx, note.creditOf);
  if (!original) return;
  const payload = { creditNote: creditNoteId, number: note.number };
  if (original.status === 'refused_by_customer') {
    await applyTransition(tx, {
      invoiceId: original.id,
      event: 'dispute',
      actor: 'system',
      payload,
      at: now,
    });
  }
  const moved = await applyTransition(tx, {
    invoiceId: original.id,
    event: 'credit_note',
    actor: 'system',
    payload,
    at: now,
  });
  if (moved.ok) {
    await endPlan(tx, original.id, now);
    return;
  }
  await tx.insert(invoiceEvents).values({
    invoiceId: original.id,
    type: 'note',
    actor: 'system',
    event: 'credit_note_not_applied',
    at: now,
    payload: { ...payload, status: original.status },
  });
}

/** « Abandonner la créance »: an unpaid invoice past its due date is given up; its chasing ends. */
export async function writeOff(deps: ApiDeps, tenant: TenantRow, id: string): Promise<void> {
  const now = deps.now();
  await deps.db.transaction(async (tx) => {
    const row = await lockInvoice(tx, id);
    if (!row || row.tenantId !== tenant.id) throw new ApiError(404, 'not_found');
    if (row.status === 'written_off') return;
    if (!WRITABLE_OFF.includes(row.status)) {
      throw new ApiError(409, 'cannot_write_off', { status: label(row.status) });
    }
    await applyTransition(tx, {
      invoiceId: id,
      event: 'write_off',
      actor: 'user',
      payload: { amount: row.payable ?? 0 },
      at: now,
    });
    await endPlan(tx, id, now);
  });
}
