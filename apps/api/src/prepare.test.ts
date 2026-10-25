// Memory M6 through the API: an accepted quote of the vault, or a chantier's next situation, made an
// invoice held for « Envoyer », its page written back into the vault; the same request twice gives
// the same invoice, and what cannot be prepared says why, with nothing created.
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RuleContext } from '@fi/agents';
import {
  and,
  auditEvents,
  chantiers,
  type Database,
  eq,
  invoices,
  memoryPages,
  parties,
  tenants,
} from '@fi/db';
import { MemoryStore, MemoryVault, type PageWrite } from '@fi/memory';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { invoiceSources } from './prepare';
import { rulePages } from './rules';
import { fakeAdapter, newTenant, paris, testApi, testDatabase } from './test-helpers';

let database: Database;
let api: ReturnType<typeof testApi>;
const made: string[] = [];
const NOW = paris('2026-10-26', 10);
const ADDRESS = { line1: '3 place Darcy', city: 'Dijon', postCode: '21000', country: 'FR' };

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: fakeAdapter() }, undefined, { now: () => NOW });
});
afterAll(async () => {
  await database.close();
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

const CLIENT = 'tiers/sci-les-tilleuls';
const SITE = 'chantiers/2026-residence-des-lilas';
const OTHER = 'chantiers/2026-hotel-du-lac';
const QUOTE = 'finances/2026/2026-10-01_devis_sci-les-tilleuls_d-2026-001';

const devis = (n: number, status: string, ht: number, extra: object = {}): PageWrite => ({
  path: `finances/2026/2026-10-0${n}_devis_sci-les-tilleuls_d-2026-00${n}`,
  frontmatter: {
    type: 'devis',
    title: `Devis D-2026-00${n}`,
    sources: [`document:devis-${n}`],
    number: `D-2026-00${n}`,
    party: CLIENT,
    chantier: SITE,
    date: `2026-10-0${n}`,
    status,
    ht,
    ttc: ht * 1.2,
    lines: [
      { label: "Main-d'œuvre", quantity: 10, unit_price: 4_500, amount: 45_000 },
      { label: 'Travaux selon descriptif', amount: ht - 45_000 },
    ],
    ...extra,
  } as PageWrite['frontmatter'],
});

const PAGES: PageWrite[] = [
  {
    path: CLIENT,
    frontmatter: {
      type: 'tiers',
      title: 'SCI Les Tilleuls',
      sources: ['erp:tiers-1'],
      roles: ['client'],
      siren: '482736154',
      siret: '48273615400012',
    },
  },
  {
    path: 'tiers/sans-fiche',
    frontmatter: {
      type: 'tiers',
      title: 'Sans Fiche',
      sources: ['erp:tiers-2'],
      roles: ['client'],
    },
  },
  {
    path: SITE,
    frontmatter: {
      type: 'chantier',
      title: 'Résidence des Lilas',
      sources: ['erp:chantier-1'],
      client: CLIENT,
      status: 'en_cours',
      start: '2026-01-12',
      retenue_pct: 5,
      erp_ref: 'CH-2026-01',
    },
  },
  {
    path: OTHER,
    frontmatter: {
      type: 'chantier',
      title: 'Hôtel du Lac',
      sources: ['erp:chantier-2'],
      client: CLIENT,
      status: 'en_cours',
    },
  },
  devis(1, 'accepte', 1_000_000),
  devis(2, 'envoye', 500_000),
  devis(3, 'accepte', 200_000, { party: 'tiers/sans-fiche' }),
  devis(4, 'accepte', 300_000),
  devis(5, 'accepte', 300_000),
  // D-2026-004 is invoiced already in the memory (BT-14); D-2026-005 maybe, by a guess.
  {
    path: 'finances/2026/2026-10-10_facture_sci-les-tilleuls_f-2026-0040',
    frontmatter: {
      type: 'facture_vente',
      title: 'Facture F-2026-0040',
      sources: ['erp:facture-40'],
      number: 'F-2026-0040',
      party: CLIENT,
      issue_date: '2026-10-10',
      ht: 300_000,
      tva: 60_000,
      ttc: 360_000,
      sales_order_ref: 'D-2026-004',
    },
  },
  {
    path: 'finances/2026/2026-10-11_facture_sci-les-tilleuls_f-2026-0041',
    frontmatter: {
      type: 'facture_vente',
      title: 'Facture F-2026-0041',
      sources: ['erp:facture-41'],
      number: 'F-2026-0041',
      party: CLIENT,
      issue_date: '2026-10-11',
      ht: 300_000,
      tva: 60_000,
      ttc: 360_000,
      links: [
        {
          kind: 'fulfils',
          to: 'finances/2026/2026-10-05_devis_sci-les-tilleuls_d-2026-005',
          confidence: 'inferred',
          evidence: 'même montant',
        },
      ],
    },
  },
  {
    path: 'finances/situations/2026-residence-des-lilas_sit-1',
    frontmatter: {
      type: 'situation',
      title: 'Situation n°1 Résidence des Lilas',
      sources: ['sheet:situation-1'],
      chantier: SITE,
      number: 1,
      cumul_ht: 300_000,
      party: CLIENT,
      issue_date: '2026-09-26',
      ht: 300_000,
      ttc: 360_000,
      retenue: 18_000,
    },
  },
];

async function company() {
  const t = await newTenant(api.request);
  await database.db
    .update(tenants)
    .set({
      btp: true,
      vatId: 'FR88100000009',
      address: { line1: '12 rue des Lilas', city: 'Dijon', postCode: '21000', country: 'FR' },
      invoiceDefaults: {
        siret: '10000000900017',
        iban: 'FR7630006000011234567890189',
        paymentDays: 30,
        operationCategory: 'services',
      },
    })
    .where(eq(tenants.id, t.id));
  const [party] = await database.db
    .insert(parties)
    .values({
      tenantId: t.id,
      legalName: 'SCI LES TILLEULS',
      siren: '482736154',
      address: ADDRESS,
      email: 'compta@tilleuls.example',
    })
    .returning();
  await database.db.insert(chantiers).values({
    tenantId: t.id,
    name: 'Résidence des Lilas',
    erpRef: 'CH-2026-01',
    retenueBps: 500,
    customerId: party?.id ?? null,
  });
  const root = await mkdtemp(join(tmpdir(), 'fi-prepare-vault-'));
  made.push(root);
  const vault = await MemoryVault.open(root, {
    host: 'test',
    clock: () => NOW,
    store: new MemoryStore(database.db, t.id),
    sourceExists: invoiceSources(database.db, t.id),
  });
  const compiled = await vault.compile({ reason: 'ingest', actor: 'agent:test', pages: PAGES });
  expect(compiled).toMatchObject({ ok: true });
  api.deps.memory = vault;
  const call = (path: string, body: unknown) =>
    api.request(path, { method: 'POST', token: t.apiKey, body });
  return { t, vault, call };
}

interface Answer {
  invoice: {
    id: string;
    number: string;
    status: string;
    autopilot: { at: string | null; held: boolean };
    document: {
      salesOrderReference?: string;
      projectReference?: string;
      totals: { taxExclusive: number; taxInclusive: number };
      btp?: { retenue?: { amount?: number }; situation?: { number: number; cumulative?: number } };
    };
  };
  created: boolean;
  text: string | null;
  page: string | null;
}
const error = async (res: Response) => ((await res.json()) as { error: { code: string } }).error;

describe('prepare an accepted quote', () => {
  it('creates a checked invoice held for « Envoyer », its page in the vault; twice is once', async () => {
    const { t, call } = await company();
    const res = await call('/memory/prepare/quote', { path: QUOTE });
    expect(res.status).toBe(201);
    const done = (await res.json()) as Answer;
    const { invoice } = done;
    expect(invoice).toMatchObject({
      number: 'F2026-0001',
      status: 'validated',
      autopilot: { at: null, held: true },
      document: {
        salesOrderReference: 'D-2026-001',
        projectReference: 'CH-2026-01',
        totals: { taxExclusive: 1_000_000, taxInclusive: 1_200_000 },
        btp: { retenue: { amount: 60_000 } },
      },
    });
    expect(done.text).toContain('D-2026-001');
    expect(done.page).toBe('finances/2026/2026-10-26_facture_sci-les-tilleuls_f2026-0001');

    // The page, its source the invoice, tied to its quote by BT-14: the rule keeps quiet.
    const [page] = await database.db
      .select()
      .from(memoryPages)
      .where(and(eq(memoryPages.tenantId, t.id), eq(memoryPages.path, done.page ?? '')));
    expect(page?.sources).toEqual([`invoice:${invoice.id}`]);
    const ctx = new RuleContext(await rulePages(database.db, t.id), '2026-10-26');
    const quote = ctx.get(QUOTE);
    if (!quote) throw new Error('no quote');
    expect(ctx.linking(quote, 'fulfils', 'exact').map((p) => p.path)).toEqual([done.page]);

    const audited = await database.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.tenantId, t.id), eq(auditEvents.action, 'memory.prepare')));
    expect(audited).toMatchObject([{ actor: 'api', objectId: invoice.id }]);

    const again = await call('/memory/prepare/quote', { path: QUOTE });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ invoice: { id: invoice.id }, created: false });
    const rows = await database.db.select().from(invoices).where(eq(invoices.tenantId, t.id));
    expect(rows).toHaveLength(1);
  });

  it('says why it prepares nothing, and creates nothing', async () => {
    const { t, call } = await company();
    const quote = (n: number) => devis(n, '', 0).path;
    const cases: [string, number, string][] = [
      ['finances/2026/absent', 404, 'memory_prepare_not_found'],
      [CLIENT, 422, 'memory_prepare_not_quote'],
      [quote(2), 422, 'memory_prepare_not_accepted'],
      [quote(3), 422, 'memory_prepare_party_unknown'],
      [quote(4), 409, 'memory_prepare_invoiced'],
      [quote(5), 409, 'memory_prepare_maybe_invoiced'],
    ];
    for (const [path, status, code] of cases) {
      const res = await call('/memory/prepare/quote', { path });
      expect([path, res.status, (await error(res)).code]).toEqual([path, status, code]);
    }
    const rows = await database.db.select().from(invoices).where(eq(invoices.tenantId, t.id));
    expect(rows).toEqual([]);
  });
});

describe('prepare the next situation', () => {
  it('invoices the progress since the last one; the same progress twice is once', async () => {
    const { t, call } = await company();
    // Half of the accepted quotes on the chantier (D-2026-001, 003, 004 and 005: 1 800 000).
    const res = await call('/memory/prepare/situation', { chantier: SITE, percent: 50 });
    expect(res.status).toBe(201);
    const done = (await res.json()) as Answer;
    expect(done.invoice).toMatchObject({
      autopilot: { held: true },
      document: {
        projectReference: 'CH-2026-01',
        totals: { taxExclusive: 600_000, taxInclusive: 720_000 },
        btp: { situation: { number: 2, cumulative: 900_000 }, retenue: { amount: 36_000 } },
      },
    });
    expect(done.page).toBe('finances/situations/2026-residence-des-lilas_sit-2');

    const again = await call('/memory/prepare/situation', { chantier: SITE, cumulative: 900_000 });
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ invoice: { id: done.invoice.id }, created: false });
    // The next month: situation 3 follows the page written.
    const next = await call('/memory/prepare/situation', { chantier: SITE, cumulative: 1_000_000 });
    expect(next.status).toBe(201);
    expect(((await next.json()) as Answer).invoice.document.btp?.situation).toEqual({
      number: 3,
      cumulative: 1_000_000,
    });
    const rows = await database.db.select().from(invoices).where(eq(invoices.tenantId, t.id));
    expect(rows).toHaveLength(2);
  });

  it('refuses a situation number taken with another progress', async () => {
    const { call } = await company();
    // A hosted API has no vault: the page of situation 2 never reaches the memory.
    api.deps.memory = null;
    const first = await call('/memory/prepare/situation', { chantier: SITE, cumulative: 600_000 });
    expect(first.status).toBe(201);
    expect(((await first.json()) as Answer).page).toBeNull();
    const res = await call('/memory/prepare/situation', { chantier: SITE, cumulative: 700_000 });
    expect([res.status, (await error(res)).code]).toEqual([409, 'memory_prepare_situation_taken']);
  });

  it('says why it prepares nothing', async () => {
    const { call } = await company();
    const cases: [object, number, string][] = [
      [{ chantier: 'chantiers/absent', cumulative: 1 }, 404, 'memory_prepare_not_found'],
      [{ chantier: CLIENT, cumulative: 1 }, 422, 'memory_prepare_not_site'],
      [{ chantier: OTHER, cumulative: 1 }, 422, 'memory_prepare_no_situation'],
      [{ chantier: SITE, cumulative: 300_000 }, 422, 'memory_prepare_not_ahead'],
    ];
    for (const [body, status, code] of cases) {
      const res = await call('/memory/prepare/situation', body);
      expect([body, res.status, (await error(res)).code]).toEqual([body, status, code]);
    }
    const both = await call('/memory/prepare/situation', {
      chantier: SITE,
      cumulative: 1,
      percent: 1,
    });
    expect(both.status).toBe(400);
  });
});

describe('the vault on a runner', () => {
  it('finds an invoice a page names; the other sources are vouched by what wrote them', async () => {
    const t = await newTenant(api.request);
    const exists = invoiceSources(database.db, t.id);
    expect(await exists('erp:tiers-1')).toBe(true);
    expect(await exists('invoice:purchase-1')).toBe(true);
    expect(await exists(`invoice:${randomUUID()}`)).toBe(false);
  });
});
