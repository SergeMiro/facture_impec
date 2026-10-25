// Memory M5 on the runner: the rules' hits raised, cooled down, gone and back; a rule that throws
// recorded; the night's lint with the deadlines and recalls the database knows, and what a person
// decides on its findings through the API.
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { devisAcceptedNoInvoice, type MemoryRule } from '@fi/agents';
import {
  and,
  auditEvents,
  type Database,
  eq,
  memoryFindings,
  memoryPages,
  memoryRecalls,
  ruleHits,
  ruleRuns,
  tenants,
} from '@fi/db';
import { MemoryVault, readPage, writePage } from '@fi/memory';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { weekFacts } from './report';
import { findingId, openRuleHits, ruleOptionsOf, runLint, runRules } from './rules';
import { fakeAdapter, newTenant, paris, signIn, testApi, testDatabase } from './test-helpers';

let database: Database;
let api: ReturnType<typeof testApi>;
const made: string[] = [];

beforeAll(async () => {
  database = await testDatabase();
  api = testApi(database, { mock: fakeAdapter() });
});
afterAll(async () => {
  await database.close();
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

/** A page as the index holds it: the frontmatter as the file writes it. */
const page = (path: string, fields: Record<string, unknown> & { type: string }) => ({
  path,
  type: fields.type,
  facts: {
    title: path.split('/').at(-1),
    sources: ['user:test'],
    updated: '2026-10-01',
    ...fields,
  },
});
const link = (kind: string, to: string) => ({ kind, to, confidence: 'exact', evidence: 'test' });

const CLIENT = page('tiers/client-a', { type: 'tiers', roles: ['client'] });
const SITE = page('chantiers/2026-lilas', { type: 'chantier', status: 'en_cours' });
const SUB = page('tiers/elec-moreau', {
  type: 'tiers',
  roles: ['sous_traitant'],
  links: [link('works_on', SITE.path)],
});
const DEVIS = page('finances/2026/devis-d-12', {
  type: 'devis',
  number: 'D-12',
  party: CLIENT.path,
  chantier: SITE.path,
  date: '2026-10-01',
  status: 'accepte',
  ht: '12400.00',
});
const INVOICE = page('finances/2026/f-43', {
  type: 'facture_vente',
  number: 'F-43',
  party: CLIENT.path,
  issue_date: '2026-10-20',
  ht: '12400.00',
  tva: '2480.00',
  ttc: '14880.00',
  links: [link('fulfils', DEVIS.path)],
});

async function put(tenantId: string, pages: ReturnType<typeof page>[]) {
  for (const p of pages) {
    await database.db.insert(memoryPages).values({
      tenantId,
      path: p.path,
      type: p.type,
      section: p.path.split('/')[0] ?? '',
      title: p.facts.title ?? '',
      keys: [],
      facts: p.facts,
      sources: p.facts.sources,
      body: '',
      folded: '',
    });
  }
}

const hit = async (tenantId: string, rule: string) => {
  const [row] = await database.db
    .select()
    .from(ruleHits)
    .where(and(eq(ruleHits.tenantId, tenantId), eq(ruleHits.rule, rule)));
  return row;
};

describe('the rules on the runner', () => {
  it('raises what they find, keeps it quiet for its cooldown, closes it when gone', async () => {
    const t = await newTenant(api.request);
    await put(t.id, [CLIENT, SITE, SUB, DEVIS]);
    const first = paris('2026-10-25', 7);
    expect(await runRules(database.db, t.id, first)).toEqual({
      fired: 2,
      raised: 2,
      cooled: 0,
      gone: 0,
      failed: [],
    });
    const shown = await openRuleHits(database.db, t.id);
    expect(shown.map((h) => h.rule).sort()).toEqual([
      'devis-accepted-no-invoice',
      'subcontractor-no-docs',
    ]);
    const devis = shown.find((h) => h.rule === 'devis-accepted-no-invoice');
    expect(devis).toMatchObject({ category: 'facturation', entity: DEVIS.path });
    expect(devis?.text).toContain('D-12');
    expect(devis?.text).toContain('12 400,00');
    expect(shown.find((h) => h.rule === 'subcontractor-no-docs')?.legal).toContain('L8222-1');
    const runs = await database.db.select().from(ruleRuns).where(eq(ruleRuns.tenantId, t.id));
    expect(runs).toHaveLength(8);
    expect(runs.find((r) => r.rule === 'devis-accepted-no-invoice')).toMatchObject({
      checked: 1,
      fired: 1,
      cooled: 0,
      error: null,
    });

    // The same day, then 8 days on: the quote's cooldown (7 days) is over, the subcontractor's
    // (14 days) is not.
    expect(await runRules(database.db, t.id, paris('2026-10-25', 18))).toMatchObject({
      raised: 0,
      cooled: 2,
    });
    expect((await hit(t.id, 'devis-accepted-no-invoice'))?.raisedAt).toEqual(first);
    const later = paris('2026-11-02', 7);
    expect(await runRules(database.db, t.id, later)).toMatchObject({ raised: 1, cooled: 1 });
    expect((await hit(t.id, 'devis-accepted-no-invoice'))?.raisedAt).toEqual(later);

    // Invoiced: the quote's situation is gone. Its invoice deleted: it is back, raised at once.
    await put(t.id, [INVOICE]);
    const invoiced = paris('2026-11-03', 7);
    expect(await runRules(database.db, t.id, invoiced)).toMatchObject({ fired: 1, gone: 1 });
    expect(await hit(t.id, 'devis-accepted-no-invoice')).toMatchObject({
      status: 'gone',
      closedAt: invoiced,
    });
    await database.db
      .delete(memoryPages)
      .where(and(eq(memoryPages.tenantId, t.id), eq(memoryPages.path, INVOICE.path)));
    expect(await runRules(database.db, t.id, paris('2026-11-04', 7))).toMatchObject({
      raised: 1,
      cooled: 1,
    });
    expect(await hit(t.id, 'devis-accepted-no-invoice')).toMatchObject({
      status: 'open',
      closedAt: null,
    });

    // The week's report: what was raised in it (the subcontractor was raised before), and the rules
    // that ran: the memory's eight and the checks; the chasers' schedules did not run here.
    const [company] = await database.db.select().from(tenants).where(eq(tenants.id, t.id));
    if (!company) throw new Error('no company');
    const week = await weekFacts(api.deps, company, paris('2026-11-04', 9));
    expect(week.spotted?.map((s) => s.rule)).toEqual(['devis-accepted-no-invoice']);
    expect(week.completeness).toEqual({
      received: 0,
      filed: 0,
      rulesRun: 9,
      rulesDue: 12,
      questions: null,
      fixes: 0,
    });
  });

  it('takes the margin and the VAT basis from the company’s settings', async () => {
    const t = await newTenant(api.request);
    expect(await ruleOptionsOf(database.db, t.id)).toEqual({ marginPct: 15, vatOnDebits: false });
    await database.db
      .update(tenants)
      .set({ minMarginPercent: 25, vatOnDebits: true })
      .where(eq(tenants.id, t.id));
    expect(await ruleOptionsOf(database.db, t.id)).toEqual({ marginPct: 25, vatOnDebits: true });
  });

  it('records a rule that throws and leaves its hits as they were', async () => {
    const t = await newTenant(api.request);
    await put(t.id, [CLIENT, SITE, DEVIS, page('tiers/abime', { type: 'tiers' })]);
    await runRules(database.db, t.id, paris('2026-10-25', 7));
    const broken: MemoryRule = {
      ...devisAcceptedNoInvoice,
      detect: () => {
        throw new Error('page illisible');
      },
    };
    const at = paris('2026-10-26', 7);
    expect(await runRules(database.db, t.id, at, undefined, [broken])).toEqual({
      fired: 0,
      raised: 0,
      cooled: 0,
      gone: 0,
      failed: ['devis-accepted-no-invoice'],
    });
    expect(await hit(t.id, 'devis-accepted-no-invoice')).toMatchObject({ status: 'open' });
    const [run] = await database.db
      .select()
      .from(ruleRuns)
      .where(and(eq(ruleRuns.tenantId, t.id), eq(ruleRuns.ranAt, at)));
    expect(run).toMatchObject({ checked: 1, fired: 0, error: 'page illisible' });
  });
});

describe('the lint on the runner', () => {
  it('lints with what the database knows; a person mends or dismisses its findings', async () => {
    const OWNER = 'gerant@lint.test';
    const t = await newTenant(api.request, { ownerEmail: OWNER });
    const root = await mkdtemp(join(tmpdir(), 'fi-rules-vault-'));
    made.push(root);
    let clock = paris('2026-10-25', 2);
    const vault = await MemoryVault.open(root, {
      host: 'test',
      clock: () => clock,
      sourceExists: () => true,
    });
    api.deps.memory = vault;
    try {
      const compiled = await vault.compile({
        reason: 'ingest',
        actor: 'agent:test',
        pages: [
          {
            path: 'tiers/client-dupont',
            frontmatter: {
              type: 'tiers',
              title: 'Client Dupont',
              sources: ['erp:t-1'],
              roles: ['client'],
            },
          },
          {
            path: 'finances/2026/f-1',
            frontmatter: {
              type: 'facture_vente',
              title: 'Facture F-1',
              sources: ['invoice:F-1'],
              number: 'F-1',
              party: 'tiers/client-dupont',
              issue_date: '2026-10-20',
              due_date: '2026-11-20',
              ht: 100_000,
              tva: 20_000,
              ttc: 120_000,
              links: [
                {
                  kind: 'mentioned_in',
                  to: 'tiers/client-dupont',
                  confidence: 'strong',
                  evidence: 'dit par une personne',
                },
              ],
            },
          },
        ],
      });
      expect(compiled.ok).toBe(true);
      // A link to a page that is not there, written by hand.
      const file = join(root, 'finances/2026/f-1.md');
      const read = readPage('finances/2026/f-1', await readFile(file, 'utf8'));
      if (!read.ok) throw new Error(read.reason);
      const { frontmatter } = read.page;
      const links = [
        ...(frontmatter.links ?? []),
        { kind: 'uses', to: 'catalogue/absent', confidence: 'exact', evidence: 'test' } as const,
      ];
      await writeFile(file, writePage({ ...read.page, frontmatter: { ...frontmatter, links } }));
      const edited = paris('2026-10-24', 18);
      await utimes(file, edited, edited);
      // Found three times by the whole text in the last 30 days; the client, only before.
      const recall = (found: string, at: Date) => ({
        tenantId: t.id,
        at,
        intent: 'find',
        status: 'found',
        level: 5,
        ms: 10,
        searched: [],
        found: [found],
      });
      const old = paris('2026-09-01', 10);
      await database.db
        .insert(memoryRecalls)
        .values([
          ...[1, 2, 3].map(() => recall('finances/2026/f-1', clock)),
          ...[1, 2, 3].map(() => recall('tiers/client-dupont', old)),
        ]);

      expect(await runLint(database.db, vault, t.id, clock)).toEqual({
        found: 4,
        opened: 4,
        gone: 0,
        asked: 3,
      });
      const rows = await database.db
        .select()
        .from(memoryFindings)
        .where(eq(memoryFindings.tenantId, t.id));
      expect(rows.map((r) => `${r.code} ${r.detail}`).sort()).toEqual([
        'dangling link uses catalogue/absent',
        'misplaced recall',
        'no_deadline facture_echeance:100000009:F-1',
        'unsourced link mentioned_in tiers/client-dupont',
      ]);
      const questions = await readFile(join(root, 'open-questions.md'), 'utf8');
      expect(questions.match(/\[\[finances\/2026\/f-1\]\]/g)).toHaveLength(3);
      expect(await runLint(database.db, vault, t.id, clock)).toMatchObject({ opened: 0, asked: 0 });

      // The API: listed for the key, decided by a person only.
      const listed = await api.request('/memory/findings', { token: t.apiKey });
      const { findings } = (await listed.json()) as { findings: { id: string; code: string }[] };
      expect(findings).toHaveLength(4);
      const idOf = (code: string) => findings.find((f) => f.code === code)?.id ?? '';
      const dangling = idOf('dangling');
      expect(dangling).toBe(
        findingId({
          code: 'dangling',
          page: 'finances/2026/f-1',
          detail: 'link uses catalogue/absent',
        }),
      );
      const fix = (id: string, decision: string, token: string) =>
        api.request(`/memory/findings/${id}/${decision}`, { method: 'POST', token });
      expect((await fix(dangling, 'fix', t.apiKey)).status).toBe(403);
      const session = await signIn(api.request, api.mailer, OWNER);
      expect((await fix(dangling, 'shrug', session)).status).toBe(404);
      expect((await fix('0'.repeat(64), 'fix', session)).status).toBe(404);
      api.deps.memory = null;
      expect((await fix(dangling, 'fix', session)).status).toBe(503);
      api.deps.memory = vault;
      const fixed = await fix(dangling, 'fix', session);
      expect(await fixed.json()).toEqual({ status: 'fixed', done: true });
      expect(await readFile(file, 'utf8')).not.toContain('catalogue/absent');
      expect((await fix(dangling, 'dismiss', session)).status).toBe(409);
      const dismissed = await fix(idOf('misplaced'), 'dismiss', session);
      expect(await dismissed.json()).toEqual({ status: 'dismissed', done: false });
      const audited = await database.db
        .select({ action: auditEvents.action })
        .from(auditEvents)
        .where(eq(auditEvents.objectType, 'memory_finding'));
      expect(audited.map((a) => a.action).sort()).toEqual(['memory.dismiss', 'memory.fix']);

      // The next night: the mended link is not found, the dismissed one stays dismissed.
      clock = paris('2026-10-26', 2);
      expect(await runLint(database.db, vault, t.id, clock)).toEqual({
        found: 3,
        opened: 0,
        gone: 0,
        asked: 0,
      });
      const after = await database.db
        .select({ code: memoryFindings.code, status: memoryFindings.status })
        .from(memoryFindings)
        .where(eq(memoryFindings.tenantId, t.id));
      expect(Object.fromEntries(after.map((a) => [a.code, a.status]))).toEqual({
        dangling: 'fixed',
        misplaced: 'dismissed',
        no_deadline: 'open',
        unsourced: 'open',
      });
      const open = await api.request('/memory/findings', { token: t.apiKey });
      expect(((await open.json()) as { findings: unknown[] }).findings).toHaveLength(2);
      const hits = await api.request('/memory/rules', { token: t.apiKey });
      expect(await hits.json()).toEqual({ hits: [] });

      // The report counts the questions the lint asked and the fixes left to approve.
      const [company] = await database.db.select().from(tenants).where(eq(tenants.id, t.id));
      if (!company) throw new Error('no company');
      expect((await weekFacts(api.deps, company, clock)).completeness).toMatchObject({
        questions: { open: 3, blocking: 0 },
        fixes: 0,
      });
    } finally {
      api.deps.memory = null;
      await vault.close();
    }
  });
});
