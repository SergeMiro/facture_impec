// Supplier invoices received (plan §3 screen 5, §6 InboundAgent): the triage of what the platforms
// delivered, « Bon pour paiement » and « Contester », the export for the accountant, and « Mode test »
// supplier invoices. Polling them is the sweep's job (workers.ts).
import { randomUUID } from 'node:crypto';
import {
  type EarlierInbound,
  type InboundBtp,
  readInbound,
  retriageSubcontracting,
  triageInbound,
} from '@fi/agents';
import {
  buildCsv,
  buildFec,
  computeInvoice,
  fecReady,
  flagLevel,
  frenchVatKey,
  type InboundFlag,
  InvoiceDraft,
  isCreditNote,
  maskIban,
  parisToday,
  purchaseItem,
  toCii,
  toUbl,
} from '@fi/core';
import {
  and,
  applyInboundTransition,
  asc,
  audit,
  count,
  type Db,
  desc,
  eq,
  hashOf,
  type InboundExportRow,
  type InboundRow,
  inArray,
  inboundExports,
  inboundQueue,
  isNotNull,
  isNull,
  like,
  max,
  ne,
  parties,
  type TenantRow,
  type Tx,
  tenants,
} from '@fi/db';
import { t } from '@fi/shared';
import { z } from 'zod';
import type { Principal } from './auth';
import type { ApiDeps, Jobs } from './deps';
import { ApiError } from './errors';
import { TEST_PREFIX } from './invoices';
import { assertTestMode } from './workbooks';

/**
 * The platform reference of a « Mode test » supplier invoice made by the API: no platform holds it,
 * and polling leaves these out when it asks a platform what is new.
 */
export const INJECTED_PREFIX = 'fi-test-';

const who = (principal: Principal) => (principal.kind === 'session' ? principal.email : 'api');

// ── Triage ───────────────────────────────────────────────────────────────────────────────────────

/**
 * Runs the InboundAgent on every invoice not triaged yet (of one company, or all), oldest first, so
 * that a duplicate is compared with the invoice it repeats. Returns how many were triaged.
 */
export async function triagePending(
  deps: { db: Db; now: () => Date; jobs: Pick<Jobs, 'enqueueRegistry'> },
  tenantId?: string,
  log: (message: string) => void = () => {},
): Promise<number> {
  const pending = await deps.db
    .select({ id: inboundQueue.id, tenantId: inboundQueue.tenantId })
    .from(inboundQueue)
    .where(
      and(
        isNull(inboundQueue.triagedAt),
        tenantId ? eq(inboundQueue.tenantId, tenantId) : undefined,
      ),
    )
    .orderBy(asc(inboundQueue.receivedAt), asc(inboundQueue.id));
  let triaged = 0;
  const read = new Set<string>();
  for (const { id, tenantId: company } of pending) {
    try {
      if (await deps.db.transaction((tx) => triageOne(tx, id, deps.now()))) {
        triaged++;
        read.add(company);
      }
    } catch (e) {
      log(`inbound triage ${id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // What was read joins the registry (src/registry.ts).
  for (const company of read) await deps.jobs.enqueueRegistry(company);
  return triaged;
}

async function triageOne(tx: Tx, id: string, now: Date): Promise<boolean> {
  const [row] = await tx.select().from(inboundQueue).where(eq(inboundQueue.id, id)).for('update');
  if (!row || row.triagedAt) return false;
  // One triage at a time per company: two copies arriving together still see each other.
  const [tenant] = await tx
    .select({ siren: tenants.siren, btp: tenants.btp })
    .from(tenants)
    .where(eq(tenants.id, row.tenantId))
    .for('update');
  if (!tenant) return false;
  const read = readInbound(row.xml, parisToday(now), await inboundBtp(tx, row.tenantId, tenant));
  const facts = read.ok ? read.facts : null;
  const earlier: EarlierInbound[] = facts?.supplierKey
    ? (
        await tx
          .select({
            id: inboundQueue.id,
            supplierKey: inboundQueue.supplierKey,
            number: inboundQueue.number,
            issueDate: inboundQueue.issueDate,
            amount: inboundQueue.amount,
            ibans: inboundQueue.ibans,
            status: inboundQueue.status,
            receivedAt: inboundQueue.receivedAt,
          })
          .from(inboundQueue)
          .where(
            and(
              eq(inboundQueue.tenantId, row.tenantId),
              eq(inboundQueue.isTest, row.isTest),
              eq(inboundQueue.supplierKey, facts.supplierKey),
              isNotNull(inboundQueue.triagedAt),
              ne(inboundQueue.id, row.id),
            ),
          )
      ).map((e) => ({ ...e, ibans: e.ibans ?? [] }))
    : [];
  const triage = triageInbound(read, { buyerSiren: tenant.siren, earlier });
  await tx
    .update(inboundQueue)
    .set({
      parsed: read.ok ? read.invoice : null,
      triage,
      triagedAt: now,
      supplierKey: facts?.supplierKey ?? null,
      supplierName: facts?.supplierName ?? null,
      number: facts?.number ?? null,
      issueDate: facts?.issueDate ?? null,
      dueDate: facts?.dueDate ?? null,
      amount: facts?.amount ?? null,
      currency: facts?.currency ?? null,
      ibans: facts?.ibans ?? null,
      updatedAt: now,
    })
    .where(eq(inboundQueue.id, row.id));
  await audit(tx, {
    tenantId: row.tenantId,
    actor: 'agent:inbound',
    action: 'inbound.triage',
    objectType: 'inbound',
    objectId: row.id,
    after: triage,
  });
  return true;
}

/** The SIRENs of the suppliers the company marked as its sous-traitants. */
export async function subcontractors(db: Db | Tx, tenantId: string): Promise<Set<string>> {
  const rows = await db
    .select({ siren: parties.siren })
    .from(parties)
    .where(
      and(
        eq(parties.tenantId, tenantId),
        eq(parties.kind, 'supplier'),
        eq(parties.subcontracting, true),
      ),
    );
  return new Set(rows.map((r) => r.siren));
}

/** What the BTP rules know of the suppliers, only for a building firm (docs/research/BTP_RULES.md). */
async function inboundBtp(
  db: Db | Tx,
  tenantId: string,
  tenant: Pick<TenantRow, 'btp'>,
): Promise<InboundBtp | undefined> {
  return tenant.btp ? { subcontractors: await subcontractors(db, tenantId) } : undefined;
}

/**
 * The company's word on a supplier moved (its « sous-traitance », or « Entreprise du bâtiment »): the
 * invoices still to decide, of that supplier or of all, get the flag that word decides made again.
 * The other flags stay: a duplicate is still compared with what had arrived before it.
 */
export async function recheckSubcontracting(
  tx: Tx,
  tenant: TenantRow,
  now: Date,
  supplierKey?: string,
): Promise<void> {
  const rows = await tx
    .select()
    .from(inboundQueue)
    .where(
      and(
        eq(inboundQueue.tenantId, tenant.id),
        inArray(inboundQueue.status, ['new', 'disputed']),
        isNotNull(inboundQueue.triagedAt),
        supplierKey ? eq(inboundQueue.supplierKey, supplierKey) : undefined,
      ),
    );
  const btp = await inboundBtp(tx, tenant.id, tenant);
  for (const row of rows) {
    if (!row.triage) continue;
    const triage = retriageSubcontracting(row.triage, readInbound(row.xml, parisToday(now), btp));
    if (hashOf(triage) === hashOf(row.triage)) continue;
    await tx
      .update(inboundQueue)
      .set({ triage, updatedAt: now })
      .where(eq(inboundQueue.id, row.id));
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'agent:inbound',
      action: 'inbound.retriage',
      objectType: 'inbound',
      objectId: row.id,
      before: row.triage,
      after: triage,
    });
  }
}

// ── What the pane shows ──────────────────────────────────────────────────────────────────────────

const flagMessage = (flag: InboundFlag) => t(`inbound.flag.${flag.code}`, flag.params);

export function inboundView(row: InboundRow) {
  const flags = row.triage?.flags ?? [];
  const blocked = flags.some((f) => flagLevel(f) === 'block');
  return {
    id: row.id,
    status: row.status,
    statusLabel: t(`inbound.status.${row.status}`),
    isTest: row.isTest,
    triaged: row.triagedAt !== null,
    supplierName: row.supplierName ?? t('inbound.unknownSupplier'),
    /** The supplier's SIREN when its invoice gives one: the pane's « sous-traitant » switch needs it. */
    supplierSiren: row.supplierKey?.startsWith('siren:') ? row.supplierKey.slice(6) : null,
    number: row.number,
    creditNote: row.parsed ? isCreditNote(row.parsed) : false,
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    /** Cents, as written on the invoice. */
    amount: row.amount,
    currency: row.currency,
    /** Masked: enough to compare with the IBAN the supplier gave before, not to pay. */
    iban: row.ibans?.[0] ? maskIban(row.ibans[0]) : null,
    receivedAt: row.receivedAt.toISOString(),
    flags: flags.map((f) => ({
      code: f.code,
      level: flagLevel(f),
      message: flagMessage(f),
      details: f.details ?? [],
      relatedId: f.relatedId ?? null,
    })),
    canApprove: row.triagedAt !== null && !blocked && ['new', 'disputed'].includes(row.status),
    /** « Bon pour paiement » needs the user to say they checked the new IBAN with the supplier. */
    needsIbanCheck: flags.some((f) => f.code === 'iban_changed'),
    canDispute: ['new', 'approved'].includes(row.status),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedBy: row.decidedBy,
    disputeReason: row.disputeReason,
    exportId: row.exportId,
  };
}

export function exportView(row: InboundExportRow) {
  return {
    id: row.id,
    isTest: row.isTest,
    count: row.count,
    skipped: row.skipped,
    firstEntry: row.firstEntry,
    lastEntry: row.lastEntry,
    fecName: row.fecName,
    csvName: row.csvName,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export const InboundQuery = z.object({
  /** The pane follows « Mode test »: test invoices with it on, real ones with it off. */
  test: z.stringbool().default(false),
});

export async function listInbound(deps: ApiDeps, tenant: TenantRow, test: boolean) {
  await triagePending(deps, tenant.id);
  const rows = await deps.db
    .select()
    .from(inboundQueue)
    .where(and(eq(inboundQueue.tenantId, tenant.id), eq(inboundQueue.isTest, test)))
    .orderBy(desc(inboundQueue.receivedAt), desc(inboundQueue.id))
    .limit(200);
  return {
    inbound: rows.map(inboundView),
    /** The suppliers marked « sous-traitant »; null: not a building firm, the pane hides the switch. */
    subcontractors: tenant.btp ? [...(await subcontractors(deps.db, tenant.id))].sort() : null,
  };
}

export async function listExports(deps: ApiDeps, tenant: TenantRow, test: boolean) {
  const rows = await deps.db
    .select()
    .from(inboundExports)
    .where(and(eq(inboundExports.tenantId, tenant.id), eq(inboundExports.isTest, test)))
    .orderBy(desc(inboundExports.createdAt), desc(inboundExports.id))
    .limit(20);
  return rows.map(exportView);
}

/** A malformed id is an invoice we do not have. */
export function inboundId(value: string): string {
  if (!z.uuid().safeParse(value).success) throw new ApiError(404, 'inbound_not_found');
  return value;
}

export async function getInbound(deps: ApiDeps, tenant: TenantRow, id: string) {
  await triagePending(deps, tenant.id);
  const [row] = await deps.db
    .select()
    .from(inboundQueue)
    .where(and(eq(inboundQueue.id, id), eq(inboundQueue.tenantId, tenant.id)));
  if (!row) throw new ApiError(404, 'inbound_not_found');
  return row;
}

// ── Decisions ────────────────────────────────────────────────────────────────────────────────────

export const ApproveBody = z.object({ ibanChecked: z.boolean().default(false) });
export const DisputeBody = z.object({ reason: z.string().trim().min(1).max(500) });

async function decide(
  deps: ApiDeps,
  tenant: TenantRow,
  id: string,
  check: (row: InboundRow) => void,
  move: (tx: Tx) => ReturnType<typeof applyInboundTransition>,
): Promise<InboundRow> {
  await triagePending(deps, tenant.id);
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(inboundQueue)
      .where(and(eq(inboundQueue.id, id), eq(inboundQueue.tenantId, tenant.id)))
      .for('update');
    if (!row) throw new ApiError(404, 'inbound_not_found');
    check(row);
    const result = await move(tx);
    if (!result.ok) {
      if (result.reason === 'not_found') throw new ApiError(404, 'inbound_not_found');
      throw new ApiError(409, 'inbound_not_now', { status: t(`inbound.status.${result.from}`) });
    }
    return result.row;
  });
}

export function approveInbound(
  deps: ApiDeps,
  tenant: TenantRow,
  principal: Principal,
  id: string,
  { ibanChecked }: z.infer<typeof ApproveBody>,
): Promise<InboundRow> {
  const by = who(principal);
  return decide(
    deps,
    tenant,
    id,
    (row) => {
      const flags = row.triage?.flags ?? [];
      const block = flags.find((f) => flagLevel(f) === 'block');
      if (block) throw new ApiError(409, 'inbound_blocked', { reason: flagMessage(block) });
      if (flags.some((f) => f.code === 'iban_changed') && !ibanChecked) {
        throw new ApiError(409, 'inbound_iban_unchecked');
      }
    },
    (tx) =>
      applyInboundTransition(tx, {
        id,
        tenantId: tenant.id,
        event: 'approve',
        actor: 'user',
        patch: { decidedAt: deps.now(), decidedBy: by, disputeReason: null },
        audit: { by, ibanChecked },
      }),
  );
}

export function disputeInbound(
  deps: ApiDeps,
  tenant: TenantRow,
  principal: Principal,
  id: string,
  { reason }: z.infer<typeof DisputeBody>,
): Promise<InboundRow> {
  const by = who(principal);
  return decide(
    deps,
    tenant,
    id,
    () => {},
    (tx) =>
      applyInboundTransition(tx, {
        id,
        tenantId: tenant.id,
        event: 'dispute',
        actor: 'user',
        patch: { decidedAt: deps.now(), decidedBy: by, disputeReason: reason },
        audit: { by, reason },
      }),
  );
}

// ── Export for the accountant ────────────────────────────────────────────────────────────────────

export const ExportBody = z.object({ test: z.boolean().default(false) });

/**
 * Every invoice marked « Bon pour paiement » goes into one export: the CSV holds them all, the FEC
 * those it can book (core fecReady). Entry numbers continue from the previous export of the same
 * side (real or test). Both files are kept for downloading again.
 */
export async function exportInbound(
  deps: ApiDeps,
  tenant: TenantRow,
  principal: Principal,
  { test }: z.infer<typeof ExportBody>,
): Promise<InboundExportRow> {
  const now = deps.now();
  const by = who(principal);
  return deps.db.transaction(async (tx) => {
    // Two exports at once would number the same entries twice.
    await tx
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.id, tenant.id))
      .for('update');
    const rows = await tx
      .select()
      .from(inboundQueue)
      .where(
        and(
          eq(inboundQueue.tenantId, tenant.id),
          eq(inboundQueue.isTest, test),
          eq(inboundQueue.status, 'approved'),
        ),
      )
      .orderBy(asc(inboundQueue.issueDate), asc(inboundQueue.number), asc(inboundQueue.id));
    if (rows.length === 0) throw new ApiError(409, 'nothing_to_export');
    const items = rows.map((r) => {
      // Approving needs a readable file (an unreadable one is blocked): parsed is there.
      if (!r.parsed) throw new Error(`approved inbound ${r.id} has no parsed invoice`);
      return purchaseItem(r.parsed, { pdpRef: r.pdpRef, receivedAt: r.receivedAt.toISOString() });
    });
    const [last] = await tx
      .select({ entry: max(inboundExports.lastEntry) })
      .from(inboundExports)
      .where(and(eq(inboundExports.tenantId, tenant.id), eq(inboundExports.isTest, test)));
    const firstEntry = (last?.entry ?? 0) + 1;
    const day = parisToday(now);
    const ready = items.filter(fecReady);
    const fec = buildFec(ready, { siren: tenant.siren, firstEntry, validDate: day });
    const prefix = test ? TEST_PREFIX : '';
    const [saved] = await tx
      .insert(inboundExports)
      .values({
        tenantId: tenant.id,
        isTest: test,
        count: rows.length,
        skipped: items.length - ready.length,
        firstEntry,
        lastEntry: fec.lastEntry,
        fecName: `${prefix}${fec.name}.txt`,
        fec: fec.text,
        csvName: `${prefix}factures-fournisseurs-${day}.csv`,
        csv: buildCsv(items),
        createdBy: by,
        createdAt: now,
      })
      .returning();
    if (!saved) throw new Error('insert returned nothing');
    for (const r of rows) {
      const moved = await applyInboundTransition(tx, {
        id: r.id,
        tenantId: tenant.id,
        event: 'export',
        actor: 'user',
        patch: { exportId: saved.id },
        audit: { exportId: saved.id },
      });
      if (!moved.ok) throw new Error(`inbound ${r.id} could not be exported`);
    }
    // The hash of both files: what the accountant received can be checked later.
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'inbound_export.create',
      objectType: 'inbound_export',
      objectId: saved.id,
      after: { by, count: saved.count, fec: saved.fec, csv: saved.csv },
    });
    return saved;
  });
}

export async function getExport(deps: ApiDeps, tenant: TenantRow, id: string) {
  if (!z.uuid().safeParse(id).success) throw new ApiError(404, 'export_not_found');
  const [row] = await deps.db
    .select()
    .from(inboundExports)
    .where(and(eq(inboundExports.id, id), eq(inboundExports.tenantId, tenant.id)));
  if (!row) throw new ApiError(404, 'export_not_found');
  return row;
}

// ── « Mode test » supplier invoices ──────────────────────────────────────────────────────────────

export const TEST_INBOUND_KINDS = ['normal', 'duplicate', 'iban_change'] as const;
export const TestInboundBody = z.object({ kind: z.enum(TEST_INBOUND_KINDS) });

/** A made-up supplier (valid SIREN, SIRET, VAT number and IBANs; no real company). */
export const DEMO_SUPPLIER = {
  siren: '600000004',
  siret: '60000000400009',
  ibans: ['FR7610107001011234567890129', 'FR7630004000031234567890143'],
} as const;

const addDays = (iso: string, days: number) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The test supplier's invoice to the company, dated today; `n` varies the number and the amount. */
export function demoInvoiceDraft(tenant: TenantRow, n: number, today: string, iban: string) {
  const name = t('inbound.test.supplier');
  const line = (
    id: string,
    item: 'paper' | 'toner' | 'delivery',
    quantity: string,
    net: string,
  ) => ({
    id,
    quantity,
    unitCode: 'H87',
    price: { net },
    vat: { category: 'S', rate: '20' },
    item: { name: t(`inbound.test.item.${item}`) },
    nature: item === 'delivery' ? 'services' : 'goods',
  });
  return InvoiceDraft.parse({
    processType: 'M1',
    number: `${TEST_PREFIX}FD-${String(n).padStart(4, '0')}`,
    issueDate: today,
    typeCode: '380',
    currency: 'EUR',
    dueDate: addDays(today, 30),
    paymentTerms: t('invoice.default.paymentTerms', { days: 30 }),
    notes: (['PMT', 'PMD', 'AAB'] as const).map((subjectCode) => ({
      subjectCode,
      text: t(`invoice.default.note.${subjectCode}`),
    })),
    seller: {
      name,
      ids: [{ id: DEMO_SUPPLIER.siret, scheme: '0009' }],
      legalId: { id: DEMO_SUPPLIER.siren, scheme: '0002' },
      vatId: `FR${frenchVatKey(DEMO_SUPPLIER.siren)}${DEMO_SUPPLIER.siren}`,
      electronicAddress: { id: DEMO_SUPPLIER.siren, scheme: '0225' },
      address: { line1: t('inbound.test.street'), city: 'Dijon', postCode: '21000', country: 'FR' },
    },
    buyer: {
      name: tenant.name,
      legalId: { id: tenant.siren, scheme: '0002' },
      ...(tenant.vatId && { vatId: tenant.vatId }),
      electronicAddress: { id: tenant.siren, scheme: '0225' },
      ...(tenant.address && { address: tenant.address }),
    },
    delivery: { date: today },
    payment: { meansCode: '30', accounts: [{ iban, name }] },
    lines: [
      line('1', 'paper', String(4 + n), '4.90'),
      line('2', 'toner', '2', '38.50'),
      line('3', 'delivery', '1', '12.00'),
    ],
  });
}

/**
 * « Recevoir une facture test » (plan §3 Mode test): a supplier invoice from the test supplier,
 * stored as if the test platform had delivered it, and triaged at once. `duplicate` sends the last
 * one again; `iban_change` asks to be paid on another IBAN (in UBL, the other syntax).
 */
export async function injectTestInbound(
  deps: ApiDeps,
  tenant: TenantRow,
  { kind }: z.infer<typeof TestInboundBody>,
): Promise<InboundRow> {
  assertTestMode(deps, tenant);
  const provider = deps.test?.provider;
  if (!provider) throw new ApiError(409, 'test_platform_missing');
  const now = deps.now();
  const injected = and(
    eq(inboundQueue.tenantId, tenant.id),
    eq(inboundQueue.isTest, true),
    like(inboundQueue.pdpRef, `${INJECTED_PREFIX}%`),
  );
  const [previous] = await deps.db
    .select({ xml: inboundQueue.xml, ibans: inboundQueue.ibans })
    .from(inboundQueue)
    .where(injected)
    .orderBy(desc(inboundQueue.receivedAt), desc(inboundQueue.id))
    .limit(1);
  if (kind !== 'normal' && !previous) throw new ApiError(409, 'inbound_test_needs_one');
  const [sent] = await deps.db.select({ n: count() }).from(inboundQueue).where(injected);
  const n = (sent?.n ?? 0) + 1;
  const [first, second] = DEMO_SUPPLIER.ibans;
  let xml: string;
  if (kind === 'duplicate' && previous) {
    xml = previous.xml;
  } else {
    const iban = kind === 'iban_change' && previous?.ibans?.includes(first) ? second : first;
    const invoice = computeInvoice(demoInvoiceDraft(tenant, n, parisToday(now), iban));
    xml = kind === 'iban_change' ? toUbl(invoice) : toCii(invoice);
  }
  const id = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .insert(inboundQueue)
      .values({
        tenantId: tenant.id,
        provider,
        pdpRef: `${INJECTED_PREFIX}${randomUUID()}`,
        receivedAt: now,
        xml,
        isTest: true,
      })
      .returning({ id: inboundQueue.id });
    if (!row) throw new Error('insert returned nothing');
    await audit(tx, {
      tenantId: tenant.id,
      actor: 'user',
      action: 'inbound.test',
      objectType: 'inbound',
      objectId: row.id,
      after: { kind, xml },
    });
    return row.id;
  });
  return getInbound(deps, tenant, id);
}
