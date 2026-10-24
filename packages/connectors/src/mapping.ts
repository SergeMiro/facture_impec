// The shared mapping (BTP plan §9 « маппинг … один на всех »): what an entity row changes in the
// company's data, decided without a database so every connector maps the same way (D9). A company
// keeps what a person or the directory set and only gets what it lacks; a chantier is the ERP's,
// rewritten by each import where the ERP says something.
import { partyKey } from '@fi/core';
import type { ChantierRow, ErpAddress, PartyRef, TiersRow } from './schemas';

export type PartySide = 'customer' | 'supplier';

/** The columns of a company the mapping reads and writes. */
export interface PartyFields {
  legalName: string;
  siren: string;
  siret: string | null;
  email: string | null;
  address: ErpAddress | null;
  erpRef: string | null;
  subcontracting: boolean;
}

/** The columns of a chantier the mapping reads and writes. */
export interface ChantierFields {
  erpRef: string;
  name: string;
  customerId: string | null;
  status: 'open' | 'closed';
  address: ErpAddress | null;
  receptionOn: string | null;
  reservesLiftedOn: string | null;
  retenueBps: number | null;
}

export type Change<T> =
  | { kind: 'insert'; values: T }
  | { kind: 'update'; values: Partial<T> }
  | { kind: 'unchanged' };

/** A value as JSON, keys sorted: Postgres gives a jsonb's keys back in its own order. */
export const canonical = (v: unknown): string =>
  v !== null && typeof v === 'object' && !Array.isArray(v)
    ? `{${Object.entries(v)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, x]) => `${JSON.stringify(k)}:${canonical(x)}`)
        .join(',')}}`
    : JSON.stringify(v ?? null);

const differs = (a: unknown, b: unknown) => canonical(a) !== canonical(b);

/** Only the fields whose value moves; `unchanged` when none does. */
function changed<T extends object>(before: T, wanted: Partial<T>): Change<T> {
  const values = Object.fromEntries(
    Object.entries(wanted).filter(([k, v]) => differs(before[k as keyof T], v)),
  ) as Partial<T>;
  return Object.keys(values).length ? { kind: 'update', values } : { kind: 'unchanged' };
}

/**
 * A customer or a supplier from the ERP. New: as the ERP writes it, sous-traitance included for a
 * supplier. Known (by SIREN): the ERP's code always, the e-mail, SIRET and address only where empty.
 */
export function partyChange(
  row: TiersRow,
  side: PartySide,
  known: PartyFields | undefined,
): Change<PartyFields> {
  if (!known) {
    return {
      kind: 'insert',
      values: {
        legalName: row.name,
        siren: row.siren,
        siret: row.siret ?? null,
        email: row.email ?? null,
        address: row.address ?? null,
        erpRef: row.code ?? null,
        // A « Sous-traitant » column says how a supplier works for the company; on a customer list
        // it would say the reverse of what the switch means (stage 1A), so it is left to the person.
        subcontracting: side === 'supplier' && row.subcontracting === true,
      },
    };
  }
  return changed(known, {
    ...(row.code !== undefined && { erpRef: row.code }),
    ...(!known.email && row.email && { email: row.email }),
    ...(!known.siret && row.siret && { siret: row.siret }),
    ...(!known.address && row.address && { address: row.address }),
  });
}

/** A chantier from the ERP: everything the row says replaces what was there; the rest stays. */
export function chantierChange(
  row: ChantierRow,
  customerId: string | null,
  known: ChantierFields | undefined,
): Change<ChantierFields> {
  const said: Partial<ChantierFields> = {
    name: row.name,
    ...(customerId && { customerId }),
    ...(row.status && { status: row.status }),
    ...(row.address && { address: row.address }),
    ...(row.receptionOn && { receptionOn: row.receptionOn }),
    ...(row.reservesLiftedOn && { reservesLiftedOn: row.reservesLiftedOn }),
    ...(row.retenueBps !== undefined && { retenueBps: row.retenueBps }),
  };
  if (!known) {
    return {
      kind: 'insert',
      values: {
        erpRef: row.code,
        name: row.name,
        customerId,
        status: row.status ?? 'open',
        address: row.address ?? null,
        receptionOn: row.receptionOn ?? null,
        reservesLiftedOn: row.reservesLiftedOn ?? null,
        retenueBps: row.retenueBps ?? null,
      },
    };
  }
  return changed(known, said);
}

/** The one item whose name is this one, case and accents aside; none when two share it. */
function onlyNamed<T>(items: readonly T[], nameOf: (t: T) => string, name: string): T | undefined {
  const key = partyKey(name);
  const named = items.filter((i) => partyKey(nameOf(i)) === key);
  return named.length === 1 ? named[0] : undefined;
}

/**
 * Which known customer a row names (a chantier's, an invoice's): its ERP code, else its SIREN, else
 * a name only one customer has.
 */
export function customerOf(
  ref: PartyRef | undefined,
  customers: readonly { id: string; erpRef: string | null; siren: string; legalName: string }[],
): string | null {
  if (!ref) return null;
  const byCode = ref.code ? customers.find((p) => p.erpRef === ref.code) : undefined;
  if (byCode) return byCode.id;
  const bySiren = ref.siren ? customers.find((p) => p.siren === ref.siren) : undefined;
  if (bySiren) return bySiren.id;
  if (!ref.name) return null;
  // Two customers of the same name: no guess.
  return onlyNamed(customers, (p) => p.legalName, ref.name)?.id ?? null;
}

/**
 * Which chantier an invoice row names: its ERP code, else a « Chantier » column holding a code or a
 * name only one chantier has.
 */
export function chantierOf(
  ref: { code?: string | undefined; name?: string | undefined } | undefined,
  known: readonly { id: string; erpRef: string | null; name: string }[],
): string | null {
  if (!ref) return null;
  for (const code of [ref.code, ref.name]) {
    const byCode = code ? known.find((c) => c.erpRef === code) : undefined;
    if (byCode) return byCode.id;
  }
  return ref.name ? (onlyNamed(known, (c) => c.name, ref.name)?.id ?? null) : null;
}
