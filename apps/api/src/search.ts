// « Retrouver une facture » (GET /invoices): the company's invoices by a piece of their number or of
// the customer's name, a stage, a kind, a period on the issue date, sorted, one page at a time with
// the total. The open sheet lists only its own rows; this finds the others (another month's sheet, a
// row deleted since, a credit note made from a fiche). Supplier invoices have « Réception ».
import { type InvoiceState, isIsoDate, STATES } from '@fi/core';
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  invoices,
  lte,
  or,
  type SQL,
  sql,
  type TenantRow,
} from '@fi/db';
import { z } from 'zod';
import type { ApiDeps } from './deps';

/** The stages a user thinks in, as groups of statuses (every status is in one). */
export const STAGES = {
  to_send: ['draft', 'needs_fix', 'validated', 'ready_to_send', 'sending'],
  awaiting: ['deposited', 'delivered', 'accepted'],
  late: ['overdue', 'chasing'],
  paid: ['paid'],
  to_correct: ['rejected_by_pdp', 'refused_by_customer', 'disputed'],
  closed: ['credited', 'written_off', 'cancelled'],
} as const satisfies Record<string, readonly InvoiceState[]>;
export type Stage = keyof typeof STAGES;
const STAGE_NAMES = Object.keys(STAGES) as [Stage, ...Stage[]];

const day = z.string().refine(isIsoDate, 'YYYY-MM-DD');

export const ListQuery = z.object({
  status: z.enum(STATES).optional(),
  /** Comma-separated: the task pane asks only for the invoices its sheet is waiting on. */
  ids: z
    .string()
    .transform((s) => s.split(','))
    .pipe(z.array(z.uuid()).min(1).max(200))
    .optional(),
  /** A piece of the number or of the customer's name, whatever the case. */
  q: z.string().trim().max(100).optional(),
  stage: z.enum(STAGE_NAMES).optional(),
  /** `credit_note`: type 381; `invoice`: any other. */
  kind: z.enum(['invoice', 'credit_note']).optional(),
  /** Issue date, both ends included. */
  from: day.optional(),
  to: day.optional(),
  test: z.enum(['true', 'false']).optional(),
  /** `recent`: last created first; `issued`: last issued first; `due`: earliest due; `amount`. */
  sort: z.enum(['recent', 'issued', 'due', 'amount']).default('recent'),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListQuery = z.infer<typeof ListQuery>;

/** `%`, `_` and `\` typed by the user are plain characters in a LIKE pattern. */
const contains = (text: string) => `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const ORDER: Record<ListQuery['sort'], SQL[]> = {
  recent: [desc(invoices.createdAt), desc(invoices.id)],
  issued: [sql`${invoices.issueDate} desc nulls last`, desc(invoices.createdAt), desc(invoices.id)],
  due: [sql`${invoices.dueDate} asc nulls last`, desc(invoices.createdAt), desc(invoices.id)],
  amount: [sql`${invoices.payable} desc nulls last`, desc(invoices.createdAt), desc(invoices.id)],
};

const CREDIT_NOTE = sql`coalesce(${invoices.document}->>'typeCode', '380') = '381'`;

export async function listInvoices(deps: Pick<ApiDeps, 'db'>, tenant: TenantRow, q: ListQuery) {
  const text = q.q ? contains(q.q) : null;
  const where = and(
    eq(invoices.tenantId, tenant.id),
    q.status ? eq(invoices.status, q.status) : undefined,
    q.ids ? inArray(invoices.id, q.ids) : undefined,
    text
      ? or(sql`${invoices.number} ilike ${text}`, sql`${invoices.buyerName} ilike ${text}`)
      : undefined,
    q.stage ? inArray(invoices.status, [...STAGES[q.stage]]) : undefined,
    q.kind === 'credit_note' ? CREDIT_NOTE : undefined,
    q.kind === 'invoice' ? sql`not ${CREDIT_NOTE}` : undefined,
    q.from ? gte(invoices.issueDate, q.from) : undefined,
    q.to ? lte(invoices.issueDate, q.to) : undefined,
    q.test ? eq(invoices.isTest, q.test === 'true') : undefined,
  );
  const [rows, [total]] = await Promise.all([
    deps.db
      .select()
      .from(invoices)
      .where(where)
      .orderBy(...ORDER[q.sort])
      .limit(q.limit)
      .offset(q.offset),
    deps.db.select({ n: count() }).from(invoices).where(where),
  ]);
  return { rows, total: total?.n ?? 0 };
}
