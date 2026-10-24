// The customer directory (plan §4 `parties`, §6 phase 2 ENRICH): « Trouver ce client » searches the public
// company directory through the PartyAgent, the user confirms one company, and every sync then fills what
// the sheet leaves empty from that customer. A customer exists here only as the directory described it
// when the user confirmed it; nothing about it goes to a model.
import {
  confirmParty,
  findParty,
  type PartyCandidate,
  type PartyConfirmation,
  type PartyTools,
} from '@fi/agents';
import {
  buyerSirenOf,
  completeBuyer,
  type FilledField,
  type InvoiceDraft,
  partyKey,
} from '@fi/core';
import {
  and,
  asc,
  audit,
  type DbOrTx,
  desc,
  eq,
  inboundQueue,
  ne,
  type PartyRow,
  parties,
  sql,
  type TenantRow,
  type Tx,
} from '@fi/db';
import { t } from '@fi/shared';
import { z } from 'zod';
import { planAll, unplanAll } from './autopilot';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { Email } from './http';
import { recheckSubcontracting } from './inbound';
import { recheckParty } from './invoices';
import { awaitsGoLive, routeFor } from './platform';
import { DirectoryUnavailable } from './sirene';

export const PartySearch = z
  .object({
    name: z.string().trim().max(200).optional(),
    siren: z.string().trim().max(20).optional(),
    postCode: z.string().trim().max(10).optional(),
  })
  .refine((q) => q.name || q.siren, { message: 'name or siren' });

export const PartyConfirm = z.object({
  siren: z.string().trim().max(20),
  /** The name the sheet gives this customer, so the next syncs find it by that name too. */
  name: z.string().trim().max(200).optional(),
});

export const PartyPatch = z
  .object({
    email: Email.nullable(),
    autopilot: z.boolean(),
    requiresPurchaseOrder: z.boolean(),
    publicEntity: z.boolean(),
    /** BTP: the company works for this customer as its sous-traitant (no VAT, BTP-AUTOLIQ-01). */
    subcontracting: z.boolean(),
  })
  .partial()
  .refine((p) => Object.keys(p).length > 0, { message: 'nothing to change' });

/** BTP: the supplier works for the company as its sous-traitant (« Réception »). */
export const SupplierPatch = z.object({ subcontracting: z.boolean() }).strict();

/** A company's customers fit on one page; more is docs/DEFERRED.md. */
const LIST_LIMIT = 1_000;

export function partyView(row: PartyRow) {
  return {
    id: row.id,
    legalName: row.legalName,
    siren: row.siren,
    vatId: row.vatId,
    address: row.address,
    email: row.email,
    names: row.names,
    routing: row.routing,
    autopilot: row.autopilot,
    requiresPurchaseOrder: row.requiresPurchaseOrder,
    publicEntity: row.publicEntity,
    subcontracting: row.subcontracting,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Whose directory says whether a customer can receive: the company's platform once it sends for real,
 * else the test platform (in prod, before go-live, the company has no account to ask with).
 */
function directoryRoute(deps: ApiDeps, tenant: TenantRow) {
  const real = routeFor(deps, tenant, false);
  if (real?.adapter && !awaitsGoLive(deps, tenant)) return real;
  const test = routeFor(deps, tenant, true);
  return test?.adapter ? test : null;
}

function partyTools(deps: ApiDeps, tenant: TenantRow): PartyTools {
  const directory = deps.directory;
  if (!directory) throw new ApiError(503, 'party_directory_unavailable');
  return {
    lookup: (siren) => directory.lookup(siren),
    search: (query, limit) => directory.search(query, limit),
    routing: async (siren) => {
      const route = directoryRoute(deps, tenant);
      if (!route?.adapter) return null;
      return (await route.adapter.lookupRecipient({ account: route.account, siren })) !== null;
    },
  };
}

/** The agent run behind a search or a confirmation: deterministic, no tokens, no invoice. */
async function recordRun(deps: ApiDeps, tenant: TenantRow, startedAt: string, error?: string) {
  await deps.ai.store.record({
    tenantId: tenant.id,
    invoiceId: null,
    agent: 'party',
    provider: 'none',
    model: 'deterministic',
    promptHash: '-',
    status: error ? 'failed' : 'ok',
    reason: error ? 'error' : null,
    attempts: 1,
    inputTokens: 0,
    outputTokens: 0,
    error: error ?? null,
    startedAt,
    finishedAt: deps.now().toISOString(),
  });
}

/** Runs one PartyAgent step; a directory that cannot answer is a calm 503, never a guess. */
async function withDirectory<T>(
  deps: ApiDeps,
  tenant: TenantRow,
  step: (tools: PartyTools) => Promise<T>,
): Promise<T> {
  const tools = partyTools(deps, tenant);
  const startedAt = deps.now().toISOString();
  try {
    const result = await step(tools);
    await recordRun(deps, tenant, startedAt);
    return result;
  } catch (e) {
    if (!(e instanceof DirectoryUnavailable)) throw e;
    await recordRun(deps, tenant, startedAt, e.message);
    throw new ApiError(503, 'party_directory_unavailable');
  }
}

export async function listParties(deps: ApiDeps, tenant: TenantRow) {
  const rows = await deps.db
    .select()
    .from(parties)
    .where(and(eq(parties.tenantId, tenant.id), eq(parties.kind, 'customer')))
    .orderBy(asc(parties.legalName), asc(parties.id))
    .limit(LIST_LIMIT);
  return rows.map(partyView);
}

/** « Chercher dans l'annuaire »: the candidates, each with whether it is already a customer here. */
export async function searchParties(
  deps: ApiDeps,
  tenant: TenantRow,
  query: z.infer<typeof PartySearch>,
) {
  const finding = await withDirectory(deps, tenant, (tools) => findParty(query, tools));
  const known = new Map((await listParties(deps, tenant)).map((p) => [p.siren, p.id] as const));
  return {
    question: finding.question,
    candidates: finding.candidates.map((c: PartyCandidate) => ({
      ...c,
      partyId: known.get(c.siren) ?? null,
    })),
  };
}

function refusal(result: Exclude<PartyConfirmation, { ok: true }>, siren: string): ApiError {
  switch (result.reason) {
    case 'invalid':
      return new ApiError(400, 'siren_invalid');
    case 'unknown':
      return new ApiError(404, 'party_not_found', { siren });
    case 'closed':
      return new ApiError(409, 'party_closed', { siren });
    case 'duplicate':
      return new ApiError(409, 'party_duplicate', { siren: result.keptSiren ?? '' });
  }
}

/** One name, one customer: the name now points here and nowhere else. */
async function claimNames(tx: Tx, tenant: TenantRow, id: string, keys: string[]) {
  for (const key of keys) {
    await tx
      .update(parties)
      .set({ names: sql`${parties.names} - ${key}::text` })
      .where(
        and(
          eq(parties.tenantId, tenant.id),
          ne(parties.id, id),
          sql`${parties.names} @> ${JSON.stringify([key])}::jsonb`,
        ),
      );
  }
}

/**
 * « C'est ce client »: the company is looked up again by SIREN, whatever the pane showed, and saved as
 * the directory describes it now (the guardrail of plan §6). Confirming a known customer refreshes it.
 */
export async function confirmCustomer(
  deps: ApiDeps,
  tenant: TenantRow,
  input: z.infer<typeof PartyConfirm>,
) {
  const siren = input.siren.replace(/\s/g, '');
  const result = await withDirectory(deps, tenant, (tools) => confirmParty(siren, tools));
  if (!result.ok) throw refusal(result, siren);
  const { company, routing } = result;
  const legalName = company.name ?? input.name;
  if (!legalName) throw new ApiError(422, 'party_name_needed');
  const now = deps.now();
  const keys = [...new Set([legalName, input.name ?? ''].map(partyKey).filter(Boolean))];
  const facts = {
    legalName,
    // A computed VAT number could be wrong on the customer's invoice: only DGFiP's list fills it.
    vatId: company.vatSource === 'dgfip' ? company.vatId : null,
    address: company.address,
    routing: routing === null ? null : { found: routing, checkedAt: now.toISOString() },
    verifiedAt: now,
  };
  return deps.db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(parties)
      .values({ tenantId: tenant.id, kind: 'customer', siren, names: keys, ...facts })
      .onConflictDoNothing()
      .returning();
    let row = inserted;
    let before: PartyRow | undefined;
    if (!row) {
      [before] = await tx
        .select()
        .from(parties)
        .where(
          and(
            eq(parties.tenantId, tenant.id),
            eq(parties.kind, 'customer'),
            eq(parties.siren, siren),
          ),
        )
        .for('update');
      if (!before) throw new ApiError(500, 'internal');
      [row] = await tx
        .update(parties)
        .set({ ...facts, names: [...new Set([...before.names, ...keys])], updatedAt: now })
        .where(eq(parties.id, before.id))
        .returning();
    }
    if (!row) throw new ApiError(500, 'internal');
    await claimNames(tx, tenant, row.id, keys);
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'party.confirm',
      objectType: 'party',
      objectId: row.id,
      ...(before && { before: partyView(before) }),
      after: partyView(row),
    });
    return partyView(row);
  });
}

/** A customer of the company: a supplier (R3) is not changed or forgotten from « Clients ». */
async function lockParty(tx: Tx, tenant: TenantRow, id: string) {
  const [row] = await tx
    .select()
    .from(parties)
    .where(and(eq(parties.id, id), eq(parties.tenantId, tenant.id), eq(parties.kind, 'customer')))
    .for('update');
  if (!row) throw new ApiError(404, 'party_missing');
  return row;
}

/** The customer's e-mail for chasing, and « Envoi automatique ». */
export async function updateParty(
  deps: ApiDeps,
  tenant: TenantRow,
  id: string,
  patch: z.infer<typeof PartyPatch>,
) {
  return deps.db.transaction(async (tx) => {
    const before = await lockParty(tx, tenant, id);
    const [row] = await tx
      .update(parties)
      .set({ ...patch, updatedAt: deps.now() })
      .where(eq(parties.id, id))
      .returning();
    if (!row) throw new ApiError(404, 'party_missing');
    // What the rules know about the customer changed: its invoices not yet sent are checked now.
    const rules =
      row.requiresPurchaseOrder !== before.requiresPurchaseOrder ||
      row.publicEntity !== before.publicEntity ||
      row.subcontracting !== before.subcontracting;
    if (rules) await recheckParty(tx, tenant, row, deps.now());
    if (row.autopilot !== before.autopilot) {
      if (row.autopilot) await planAll(tx, deps.now(), tenant, id);
      else await unplanAll(tx, tenant.id, id);
    }
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'party.update',
      objectType: 'party',
      objectId: id,
      before: partyView(before),
      after: partyView(row),
    });
    return partyView(row);
  });
}

/** A supplier as « Réception » shows it: the switch reads its SIREN, the screen its name. */
export function supplierView(row: PartyRow) {
  return { siren: row.siren, legalName: row.legalName, subcontracting: row.subcontracting };
}

/** A malformed SIREN is a supplier we do not have. */
export function supplierSiren(value: string): string {
  if (!/^\d{9}$/.test(value)) throw new ApiError(404, 'supplier_missing');
  return value;
}

/**
 * « Ce fournisseur est mon sous-traitant » (BTP): kept on the supplier, which joins the company's
 * parties as its received invoices name it (R3) if it is not there yet; its invoices still to decide
 * are triaged again for the VAT a sous-traitant must not charge.
 */
export async function updateSupplier(
  deps: ApiDeps,
  tenant: TenantRow,
  siren: string,
  patch: z.infer<typeof SupplierPatch>,
) {
  return deps.db.transaction(async (tx) => {
    const now = deps.now();
    const supplierKey = `siren:${siren}`;
    const [known] = await tx
      .select()
      .from(parties)
      .where(
        and(
          eq(parties.tenantId, tenant.id),
          eq(parties.kind, 'supplier'),
          eq(parties.siren, siren),
        ),
      )
      .for('update');
    let before = known;
    if (!before) {
      // Only a supplier the company received an invoice from: its name and address are the invoice's.
      const [received] = await tx
        .select({ name: inboundQueue.supplierName, parsed: inboundQueue.parsed })
        .from(inboundQueue)
        .where(and(eq(inboundQueue.tenantId, tenant.id), eq(inboundQueue.supplierKey, supplierKey)))
        .orderBy(desc(inboundQueue.receivedAt))
        .limit(1);
      if (!received) throw new ApiError(404, 'supplier_missing');
      [before] = await tx
        .insert(parties)
        .values({
          tenantId: tenant.id,
          kind: 'supplier',
          legalName: received.name ?? siren,
          siren,
          address: received.parsed?.seller.address ?? null,
          source: 'invoice',
          verifiedAt: null,
        })
        .returning();
      if (!before) throw new ApiError(404, 'supplier_missing');
    }
    const [row] = await tx
      .update(parties)
      .set({ subcontracting: patch.subcontracting, updatedAt: now })
      .where(eq(parties.id, before.id))
      .returning();
    if (!row) throw new ApiError(404, 'supplier_missing');
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'party.update',
      objectType: 'party',
      objectId: row.id,
      before: known ? supplierView(known) : null,
      after: supplierView(row),
    });
    if (row.subcontracting !== known?.subcontracting) {
      await recheckSubcontracting(tx, tenant, now, supplierKey);
    }
    return supplierView(row);
  });
}

/** Forgets the customer; its invoices stay as they are, without the link. */
export async function deleteParty(deps: ApiDeps, tenant: TenantRow, id: string) {
  await deps.db.transaction(async (tx) => {
    const before = await lockParty(tx, tenant, id);
    await unplanAll(tx, tenant.id, id);
    await tx.delete(parties).where(eq(parties.id, id));
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'party.delete',
      objectType: 'party',
      objectId: id,
      before: partyView(before),
    });
  });
  return { deleted: true };
}

/** What a sheet invoice's buyer got from its customer. */
export interface Enriched {
  draft: InvoiceDraft;
  partyId: string | null;
  party: PartyRow | null;
  filled: FilledField[];
}

/** The company's customers, read once per sync: by SIREN, and by every name the sheet uses. */
export class PartyBook {
  readonly #bySiren = new Map<string, PartyRow>();
  readonly #byName = new Map<string, PartyRow>();

  constructor(rows: PartyRow[]) {
    for (const row of rows) {
      this.#bySiren.set(row.siren, row);
      for (const name of row.names) this.#byName.set(name, row);
    }
  }

  static async load(db: DbOrTx, tenantId: string): Promise<PartyBook> {
    return new PartyBook(
      await db
        .select()
        .from(parties)
        .where(and(eq(parties.tenantId, tenantId), eq(parties.kind, 'customer'))),
    );
  }

  /** A sheet SIREN finds its customer or nobody; without one, the buyer's name does. */
  enrich(draft: InvoiceDraft): Enriched {
    const siren = buyerSirenOf(draft);
    const key = partyKey(draft.buyer.name ?? '');
    const party = siren ? this.#bySiren.get(siren) : key ? this.#byName.get(key) : undefined;
    if (!party) return { draft, partyId: null, party: null, filled: [] };
    const done = completeBuyer(draft, party);
    return { draft: done.draft, partyId: party.id, party, filled: done.filled };
  }
}

/** FI_Détail: « Complété depuis votre fiche client : l'adresse, l'e-mail. » */
export function filledNote(filled: readonly FilledField[]): string | null {
  if (filled.length === 0) return null;
  return t('party.filledNote', { fields: filled.map((f) => t(`party.filled.${f}`)).join(', ') });
}
