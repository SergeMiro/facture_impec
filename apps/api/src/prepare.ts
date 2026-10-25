// Prepare (memory doc §8, M6) on a person's request: an accepted quote of the memory, or a chantier's
// next situation, becomes an invoice made by code (@fi/agents prepare.ts) and checked before
// anything is created. What the memory holds is only read: the customer's address and settings come
// from its fiche in Clients, the retenue from the chantier's. The invoice is created held from the
// autopilot, so only a person's « Envoyer » sends it, and on a runner its page goes into the vault.
// The same quote, or the same situation, asked twice gives the same invoice; every preparation is
// audited. Nothing prepares by itself (docs/DECISIONS.md D12): a draft nobody asked for would hold a
// number of the company's series.
import {
  invoiceFromQuote,
  nextSituation,
  type Preparation,
  type PrepareBuyer,
  type PrepareCompany,
  type PrepareSite,
  RuleContext,
  type RulePage,
} from '@fi/agents';
import { nextInvoiceNumber, parisToday } from '@fi/core';
import {
  and,
  audit,
  chantiers,
  type Db,
  eq,
  type InvoiceRow,
  invoices,
  ne,
  parties,
  type SQL,
  sql,
  type TenantRow,
} from '@fi/db';
import { z } from 'zod';
import type { Principal } from './auth';
import type { ApiDeps } from './deps';
import { ApiError } from './errors';
import { createInvoice, loadHistory, TEST_PREFIX } from './invoices';
import { rulePages } from './rules';

export const PrepareQuoteBody = z.object({
  /** The quote's page, `finances/2026/…_devis_…`. */
  path: z.string().min(1),
  test: z.boolean().default(false),
});
export type PrepareQuoteBody = z.infer<typeof PrepareQuoteBody>;

/** The chantier's progress, as the ERP or the person gives it: cumulative works HT, or a percent of its accepted quotes. */
export const PrepareSituationBody = z
  .object({
    chantier: z.string().min(1),
    cumulative: z.int().min(1).optional(),
    percent: z.number().gt(0).max(100).optional(),
    test: z.boolean().default(false),
  })
  .refine((b) => (b.cumulative === undefined) !== (b.percent === undefined), {
    message: 'give cumulative or percent',
  });
export type PrepareSituationBody = z.infer<typeof PrepareSituationBody>;

export interface PrepareResult {
  row: InvoiceRow;
  created: boolean;
  /** The covering mail (a template), for the person to send with the invoice. */
  text: string | null;
  /** The page written into the vault; null without a runner's vault, or when it refused it. */
  page: string | null;
}

/** `invoice:<id>` names an invoice of the company: the sources a runner's vault can check. */
export function invoiceSources(db: Db, tenantId: string) {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  return async (ref: string): Promise<boolean> => {
    if (!ref.startsWith('invoice:')) return true;
    const id = ref.slice('invoice:'.length);
    if (!UUID.test(id)) return true;
    const [row] = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, id)));
    return row !== undefined;
  };
}

const actorOf = (principal: Principal) =>
  principal.kind === 'session' ? `user:${principal.userId}` : 'api';

function company(tenant: TenantRow): PrepareCompany {
  return {
    seller: {
      name: tenant.name,
      siren: tenant.siren,
      vatId: tenant.vatId,
      address: tenant.address,
      defaults: tenant.invoiceDefaults,
    },
    btp: tenant.btp,
    vatOnDebits: tenant.vatOnDebits,
  };
}

/** The customer as its page names it and its fiche in Clients knows it; refused without a fiche. */
async function buyerOf(db: Db, tenant: TenantRow, ctx: RuleContext, path: string | undefined) {
  const page = ctx.get(path);
  const f = page?.frontmatter;
  const siren = f?.type === 'tiers' ? f.siren : undefined;
  const [party] = siren
    ? await db
        .select()
        .from(parties)
        .where(and(eq(parties.tenantId, tenant.id), eq(parties.siren, siren)))
        .orderBy(sql`${parties.kind} = 'customer' desc`)
    : [];
  if (!page || f?.type !== 'tiers' || !party)
    throw new ApiError(422, 'memory_prepare_party_unknown');
  const buyer: PrepareBuyer = {
    path: page.path,
    name: party.legalName,
    siren: party.siren,
    siret: f.siret,
    vatId: party.vatId ?? f.vat_id,
    email: party.email ?? f.email,
    address: party.address ?? undefined,
    subcontracting: party.subcontracting,
    settings: {
      requiresPurchaseOrder: party.requiresPurchaseOrder,
      publicEntity: party.publicEntity,
    },
  };
  return buyer;
}

/** The chantier's page, its retenue from its fiche (BTP stage 4) when it has one, else the page's. */
async function siteOf(db: Db, tenant: TenantRow, page: RulePage): Promise<PrepareSite> {
  const f = page.frontmatter;
  if (f.type !== 'chantier') throw new ApiError(422, 'memory_prepare_not_site');
  const [row] = f.erp_ref
    ? await db
        .select({ retenueBps: chantiers.retenueBps })
        .from(chantiers)
        .where(and(eq(chantiers.tenantId, tenant.id), eq(chantiers.erpRef, f.erp_ref)))
    : [];
  const bps =
    row?.retenueBps ?? (f.retenue_pct === undefined ? undefined : Math.round(f.retenue_pct * 100));
  return {
    path: page.path,
    title: f.title,
    erpRef: f.erp_ref,
    ...(bps !== undefined && { retenueBps: bps }),
  };
}

/** The numbers the company issued, as the series reads them (a test invoice without its TEST-). */
async function numbering(db: Db, tenant: TenantRow, isTest: boolean, today: string) {
  const history = (await loadHistory(db, tenant, isTest)).map((h) => ({
    number: h.number.startsWith(TEST_PREFIX) ? h.number.slice(TEST_PREFIX.length) : h.number,
    issueDate: h.issueDate,
    ...(h.sellerSiren && { sellerSiren: h.sellerSiren }),
  }));
  return { history, number: nextInvoiceNumber(history, today) };
}

/** An invoice already made for the same thing: the company's, of its mode, not cancelled. */
async function madeBefore(db: Db, tenant: TenantRow, isTest: boolean, same: SQL) {
  const [row] = await db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.tenantId, tenant.id),
        eq(invoices.direction, 'out'),
        eq(invoices.isTest, isTest),
        ne(invoices.status, 'cancelled'),
        same,
      ),
    )
    .orderBy(invoices.createdAt)
    .limit(1);
  return row;
}

/** Refused with its reason, in the person's words (api.error.memory_prepare_*). */
function preparedOrThrow(p: Preparation) {
  if (!p.ok) throw new ApiError(422, `memory_prepare_${p.reason}`, p.params);
  return p;
}

/** Creates the prepared invoice, audits it, and writes its page into the vault when there is one. */
async function finish(
  deps: ApiDeps,
  tenant: TenantRow,
  principal: Principal,
  isTest: boolean,
  p: ReturnType<typeof preparedOrThrow>,
  from: { kind: 'quote' | 'situation'; path: string },
): Promise<PrepareResult> {
  const { row, created } = await createInvoice(deps, tenant, {
    draft: p.draft,
    isTest,
    held: true,
  });
  let page: string | null = null;
  if (created && deps.memory) {
    const written = await deps.memory.compile({
      reason: 'action_result',
      actor: 'agent:prepare',
      pages: [
        { ...p.page, frontmatter: { ...p.page.frontmatter, sources: [`invoice:${row.id}`] } },
      ],
      note: row.number ?? '',
    });
    if (written.ok) page = p.page.path;
  }
  await deps.db.transaction((tx) =>
    audit(tx, {
      tenantId: tenant.id,
      actor: actorOf(principal),
      action: 'memory.prepare',
      objectType: 'invoice',
      objectId: row.id,
      after: { from, number: row.number, created, page },
    }),
  );
  return { row, created, text: p.text, page };
}

/** The invoice of an accepted quote of the memory. */
export async function prepareFromQuote(
  deps: ApiDeps,
  tenant: TenantRow,
  principal: Principal,
  input: PrepareQuoteBody,
): Promise<PrepareResult> {
  const today = parisToday(deps.now());
  const ctx = new RuleContext(await rulePages(deps.db, tenant.id), today);
  const page = ctx.get(input.path);
  if (!page) throw new ApiError(404, 'memory_prepare_not_found');
  const q = page.frontmatter;
  if (q.type !== 'devis') throw new ApiError(422, 'memory_prepare_not_quote');

  // Its invoice made already (BT-14 is the quote's number): the same one again.
  const same = sql`${invoices.document}->>'salesOrderReference' = ${q.number}
    and coalesce(${invoices.document}->>'typeCode', '380') = '380'`;
  const before = await madeBefore(deps.db, tenant, input.test, same);
  if (before) return { row: before, created: false, text: null, page: null };
  // An invoice of the memory tied to it, even by a guess (the rule keeps quiet on the same).
  const sure = ctx.linking(page, 'fulfils', 'strong')[0];
  if (sure) {
    throw new ApiError(409, 'memory_prepare_invoiced', {
      quote: q.number,
      invoice: sure.frontmatter.title,
    });
  }
  const guess = ctx.linking(page, 'fulfils', 'inferred')[0];
  if (guess) {
    throw new ApiError(409, 'memory_prepare_maybe_invoiced', {
      quote: q.number,
      invoice: guess.frontmatter.title,
    });
  }

  const buyer = await buyerOf(deps.db, tenant, ctx, q.party);
  const sitePage = ctx.get(q.chantier);
  const site = sitePage && (await siteOf(deps.db, tenant, sitePage));
  const { history, number } = await numbering(deps.db, tenant, input.test, today);
  const p = preparedOrThrow(
    invoiceFromQuote({
      company: company(tenant),
      buyer,
      number,
      issueDate: today,
      history,
      quote: { path: page.path, facts: q },
      site,
    }),
  );
  return finish(deps, tenant, principal, input.test, p, { kind: 'quote', path: page.path });
}

/** The next situation of a chantier, from its last one and the progress given. */
export async function prepareSituation(
  deps: ApiDeps,
  tenant: TenantRow,
  principal: Principal,
  input: PrepareSituationBody,
): Promise<PrepareResult> {
  const today = parisToday(deps.now());
  const ctx = new RuleContext(await rulePages(deps.db, tenant.id), today);
  const sitePage = ctx.get(input.chantier);
  if (!sitePage) throw new ApiError(404, 'memory_prepare_not_found');
  const site = await siteOf(deps.db, tenant, sitePage);
  const [last] = ctx
    .ofType('situation')
    .filter((s) => s.frontmatter.chantier === site.path)
    .sort((a, b) => b.frontmatter.number - a.frontmatter.number);
  if (!last) throw new ApiError(422, 'memory_prepare_no_situation', { chantier: site.title });

  let cumulative = input.cumulative;
  if (cumulative === undefined) {
    const market = ctx
      .ofType('devis')
      .filter((d) => d.frontmatter.chantier === site.path && d.frontmatter.status === 'accepte')
      .reduce((total, d) => total + (d.frontmatter.ht ?? 0), 0);
    if (market === 0) throw new ApiError(422, 'memory_prepare_no_market', { chantier: site.title });
    cumulative = Math.round((market * (input.percent ?? 0)) / 100);
  }

  // The same progress invoiced already on this chantier (a double click, a retry, its page written
  // since): that situation again. Its next number taken with another progress: refused, since its
  // page never reached the memory.
  const ref = sql`${invoices.document}->>'projectReference' = ${site.erpRef ?? site.title}`;
  const situation = sql`${invoices.document}->'btp'->'situation'`;
  const again = await madeBefore(
    deps.db,
    tenant,
    input.test,
    sql`${ref} and ${situation}->>'cumulative' = ${String(cumulative)}`,
  );
  if (again) return { row: again, created: false, text: null, page: null };
  const number = last.frontmatter.number + 1;
  const taken = await madeBefore(
    deps.db,
    tenant,
    input.test,
    sql`${ref} and ${situation}->>'number' = ${String(number)}`,
  );
  if (taken) {
    throw new ApiError(409, 'memory_prepare_situation_taken', {
      number,
      invoice: taken.number ?? '',
    });
  }

  const sf = sitePage.frontmatter;
  const client = last.frontmatter.party ?? (sf.type === 'chantier' ? sf.client : undefined);
  const buyer = await buyerOf(deps.db, tenant, ctx, client);
  const numbered = await numbering(deps.db, tenant, input.test, today);
  const p = preparedOrThrow(
    nextSituation({
      company: company(tenant),
      buyer,
      number: numbered.number,
      issueDate: today,
      history: numbered.history,
      previous: { path: last.path, facts: last.frontmatter },
      site,
      cumulative,
    }),
  );
  return finish(deps, tenant, principal, input.test, p, { kind: 'situation', path: last.path });
}
