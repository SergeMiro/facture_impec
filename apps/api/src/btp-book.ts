// What the BTP rules read besides the invoice (docs/research/BTP_RULES.md): the situations the company
// issued, per chantier, and the retenue each chantier's contract agreed, as its ERP said. A building
// firm only; for anyone else nothing is read and the rules stay silent.
import {
  type BtpContext,
  BtpFacts,
  chantierKey,
  type Invoice,
  SituationBook,
  type SituationEntry,
} from '@fi/core';
import {
  and,
  chantiers,
  type DbOrTx,
  eq,
  invoices,
  isNotNull,
  ne,
  sql,
  type TenantRow,
} from '@fi/db';

export interface BtpBook {
  situations: SituationBook;
  /** A chantier's key (its ERP code, or a name only one has) → its retenue in basis points. */
  retenues: ReadonlyMap<string, number>;
}

const Situation = BtpFacts.shape.situation.unwrap();

/** The company's situations in this mode, a cancelled one left out (its number is free again). */
export async function loadSituations(
  db: DbOrTx,
  tenant: TenantRow,
  isTest: boolean,
): Promise<SituationEntry[]> {
  const rows = await db
    .select({
      id: invoices.id,
      chantier: sql<string | null>`${invoices.document}->>'projectReference'`,
      situation: sql<unknown>`${invoices.document}->'btp'->'situation'`,
    })
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenant.id),
        eq(invoices.direction, 'out'),
        eq(invoices.isTest, isTest),
        ne(invoices.status, 'cancelled'),
        sql`${invoices.document}->'btp'->'situation' is not null`,
      ),
    );
  return rows.flatMap((r) => {
    const situation = Situation.safeParse(r.situation);
    return r.chantier && situation.success
      ? [{ id: r.id, chantier: r.chantier, ...situation.data }]
      : [];
  });
}

export async function loadBtpBook(
  db: DbOrTx,
  tenant: TenantRow,
  isTest: boolean,
): Promise<BtpBook | undefined> {
  if (!tenant.btp) return undefined;
  const situations = new SituationBook(await loadSituations(db, tenant, isTest));
  const sites = await db
    .select({ erpRef: chantiers.erpRef, name: chantiers.name, retenueBps: chantiers.retenueBps })
    .from(chantiers)
    .where(and(eq(chantiers.tenantId, tenant.id), isNotNull(chantiers.retenueBps)));
  return { situations, retenues: retenuesOf(sites) };
}

/** By ERP code first; a name counts only when one chantier has it. */
function retenuesOf(
  sites: readonly { erpRef: string | null; name: string; retenueBps: number | null }[],
): Map<string, number> {
  const retenues = new Map<string, number>();
  const names = new Map<string, number[]>();
  for (const s of sites) {
    if (s.retenueBps === null) continue;
    const key = chantierKey(s.name);
    names.set(key, [...(names.get(key) ?? []), s.retenueBps]);
  }
  for (const [key, rates] of names) {
    const [rate] = rates;
    if (rates.length === 1 && rate !== undefined) retenues.set(key, rate);
  }
  for (const s of sites) {
    if (s.erpRef && s.retenueBps !== null) retenues.set(chantierKey(s.erpRef), s.retenueBps);
  }
  return retenues;
}

/**
 * The BTP context of one invoice: the customer's sous-traitance, the retenue and the situation the
 * sheet gave, the chantier's agreed retenue, and the situation before this one. `self` is the invoice
 * in the book, never its own previous.
 */
export function btpContext(
  document: Invoice,
  subcontracting: boolean,
  book: BtpBook | undefined,
  self?: string,
): BtpContext {
  const { retenue, situation } = document.btp ?? {};
  const chantier = document.projectReference;
  const retenueBps = chantier ? book?.retenues.get(chantierKey(chantier)) : undefined;
  const previous = book?.situations.previous(document, self);
  return {
    subcontracting,
    ...(retenue && { retenue }),
    ...(retenueBps !== undefined && { chantier: { retenueBps } }),
    ...(situation && { situation: { ...situation, ...(previous && { previous }) } }),
  };
}
