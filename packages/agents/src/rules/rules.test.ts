// Memory M5: each rule of the catalogue « fires / does not fire » on pages written as the vault writes
// them (parsed by the memory's own schema), and the catalogue's guards.
import { Frontmatter } from '@fi/memory';
import { isMessageKey } from '@fi/shared';
import { describe, expect, it } from 'vitest';
import {
  AUTONOMY,
  autonomyOf,
  CATALOGUE,
  cashForecast,
  devisAcceptedNoInvoice,
  evaluateRules,
  MEMORY_RULES,
  type MemoryRule,
  marginBelowThreshold,
  noticeOf,
  noticeParams,
  priceIncrease,
  purchaseNotRebilled,
  RuleContext,
  RuleEntry,
  type RulePage,
  situationDue,
  subcontractorNoDocs,
  tvaDeclarationDue,
} from './index';

const TODAY = '2026-10-25';

function page(path: string, fields: Record<string, unknown>): RulePage {
  return {
    path,
    frontmatter: Frontmatter.parse({
      title: path.split('/').at(-1),
      sources: ['user:test'],
      updated: '2026-10-01',
      ...fields,
    }),
  };
}
const link = (kind: string, to: string, confidence = 'exact') => ({
  kind,
  to,
  confidence,
  evidence: 'test',
});

const CLIENT = page('tiers/client-a', { type: 'tiers', roles: ['client'] });
const SUPPLIER = page('tiers/fournisseur-b', { type: 'tiers', roles: ['fournisseur'] });
const SITE = page('chantiers/2026-lilas', {
  type: 'chantier',
  status: 'en_cours',
  client: CLIENT.path,
});
const CLOSED = page('chantiers/2026-vignes', { type: 'chantier', status: 'clos' });

const run = (
  rule: MemoryRule,
  pages: RulePage[],
  today = TODAY,
  options?: RuleContext['options'],
) => rule.detect(new RuleContext([CLIENT, SUPPLIER, SITE, CLOSED, ...pages], today, options));

describe('devis-accepted-no-invoice', () => {
  const devis = (fields: Record<string, unknown> = {}) =>
    page('finances/2026/devis-d-12', {
      type: 'devis',
      number: 'D-12',
      party: CLIENT.path,
      chantier: SITE.path,
      date: '2026-10-01',
      status: 'accepte',
      ht: '12400.00',
      ...fields,
    });
  const invoice = (confidence: string) =>
    page('finances/2026/f-43', {
      type: 'facture_vente',
      number: 'F-43',
      party: CLIENT.path,
      issue_date: '2026-10-20',
      ht: '100.00',
      tva: '20.00',
      ttc: '120.00',
      links: [link('fulfils', 'finances/2026/devis-d-12', confidence)],
    });

  it('fires on a quote accepted more than 14 days ago with no invoice', () => {
    const [found, ...rest] = run(devisAcceptedNoInvoice, [devis()]);
    expect(rest).toEqual([]);
    expect(found).toEqual({
      entity: 'finances/2026/devis-d-12',
      facts: { number: 'D-12', party: 'client-a', ht: 1_240_000, date: '2026-10-01', days: 24 },
      cites: ['finances/2026/devis-d-12', CLIENT.path, SITE.path],
    });
  });

  it('cites no chantier and no amount when the quote has none', () => {
    const [found] = run(devisAcceptedNoInvoice, [devis({ chantier: undefined, ht: undefined })]);
    expect(found?.facts.ht).toBeNull();
    expect(found?.cites).toEqual(['finances/2026/devis-d-12', CLIENT.path]);
  });

  it('does not fire on a quote not accepted, a recent one, or one an invoice is tied to', () => {
    expect(run(devisAcceptedNoInvoice, [devis({ status: 'envoye' })])).toEqual([]);
    expect(run(devisAcceptedNoInvoice, [devis({ date: '2026-10-11' })])).toEqual([]);
    expect(run(devisAcceptedNoInvoice, [devis(), invoice('exact')])).toEqual([]);
    // Even a guessed tie keeps it quiet: a person confirms it, nothing invoices twice.
    expect(run(devisAcceptedNoInvoice, [devis(), invoice('inferred')])).toEqual([]);
  });
});

describe('situation-due', () => {
  const situation = (number: number, issue_date?: string, chantier = SITE.path) =>
    page(`finances/situations/2026-lilas-sit-${number}`, {
      type: 'situation',
      chantier,
      number,
      cumul_ht: `${number * 10000}.00`,
      ...(issue_date ? { issue_date } : {}),
    });

  it('fires when the last situation of a live chantier is more than 30 days old', () => {
    const found = run(situationDue, [situation(2, '2026-09-01'), situation(1, '2026-08-01')]);
    expect(found).toEqual([
      {
        entity: SITE.path,
        facts: {
          chantier: '2026-lilas',
          last: 2,
          lastDate: '2026-09-01',
          cumulHt: 2_000_000,
          days: 54,
        },
        cites: [SITE.path, 'finances/situations/2026-lilas-sit-2'],
      },
    ]);
  });

  it('does not fire on a recent situation, a closed chantier, no situation or no date', () => {
    expect(run(situationDue, [situation(1, '2026-08-01'), situation(2, '2026-10-01')])).toEqual([]);
    expect(run(situationDue, [situation(1, '2026-08-01', CLOSED.path)])).toEqual([]);
    expect(run(situationDue, [])).toEqual([]);
    expect(run(situationDue, [situation(1)])).toEqual([]);
  });
});

describe('purchase-not-rebilled', () => {
  const A = page('catalogue/cable', { type: 'article' });
  const B = page('catalogue/tableau', { type: 'article' });
  const purchase = (fields: Record<string, unknown> = {}) =>
    page('finances/2026/achat-a-7', {
      type: 'facture_achat',
      number: 'A-7',
      party: SUPPLIER.path,
      issue_date: '2026-09-01',
      ht: '500.00',
      tva: '100.00',
      ttc: '600.00',
      chantier: SITE.path,
      links: [link('uses', A.path, 'strong'), link('uses', B.path, 'exact')],
      ...fields,
    });
  const sale = (issue_date: string, uses: string[], path = 'finances/2026/f-50') =>
    page(path, {
      type: 'facture_vente',
      number: path.split('/').at(-1),
      party: CLIENT.path,
      issue_date,
      ht: '900.00',
      tva: '180.00',
      ttc: '1080.00',
      links: [link('belongs_to', SITE.path, 'strong'), ...uses.map((u) => link('uses', u))],
    });

  it('fires on the articles of a chantier purchase no later sale of that chantier carries', () => {
    const found = run(purchaseNotRebilled, [
      A,
      B,
      purchase(),
      sale('2026-09-10', [A.path]),
      // Billed before the purchase: not a re-billing of it.
      sale('2026-08-01', [B.path], 'finances/2026/f-40'),
    ]);
    expect(found).toEqual([
      {
        entity: 'finances/2026/achat-a-7',
        facts: {
          number: 'A-7',
          supplier: 'fournisseur-b',
          chantier: '2026-lilas',
          date: '2026-09-01',
          days: 54,
          articles: ['tableau'],
        },
        cites: ['finances/2026/achat-a-7', SITE.path, B.path],
      },
    ]);
  });

  it('finds the chantier by a link when the purchase names none', () => {
    const linked = purchase({
      chantier: undefined,
      links: [link('belongs_to', SITE.path, 'strong'), link('uses', A.path)],
    });
    expect(run(purchaseNotRebilled, [A, linked])).toHaveLength(1);
  });

  it('does not fire when all is sold, too early, too late, off-site or on guessed articles', () => {
    expect(run(purchaseNotRebilled, [purchase(), sale('2026-09-10', [A.path, B.path])])).toEqual(
      [],
    );
    expect(run(purchaseNotRebilled, [purchase({ issue_date: '2026-10-01' })])).toEqual([]);
    expect(run(purchaseNotRebilled, [purchase({ issue_date: '2026-05-01' })])).toEqual([]);
    expect(run(purchaseNotRebilled, [purchase({ chantier: undefined })])).toEqual([]);
    const guessed = purchase({ links: [link('uses', A.path, 'inferred')] });
    expect(run(purchaseNotRebilled, [guessed])).toEqual([]);
  });
});

describe('price-increase', () => {
  const A = page('catalogue/cable', { type: 'article', codes: ['CAB-3G'] });
  const bought = (path: string, issue_date: string, lines: Record<string, unknown>[]) =>
    page(path, {
      type: 'facture_achat',
      number: path.split('/').at(-1),
      party: SUPPLIER.path,
      issue_date,
      ht: '100.00',
      tva: '20.00',
      ttc: '120.00',
      lines: lines.map((l) => ({ label: 'Câble', amount: '100.00', ...l })),
    });
  const quote = (number: string, status: string, fields: Record<string, unknown> = {}) =>
    page(`finances/2026/devis-${number.toLowerCase()}`, {
      type: 'devis',
      number,
      party: CLIENT.path,
      date: '2026-10-15',
      status,
      ...fields,
    });

  const before = bought('finances/2026/achat-1', '2026-08-01', [
    { article: A.path, unit_price: '10.00' },
  ]);
  const after = bought('finances/2026/achat-2', '2026-10-10', [
    { code: 'CAB-3G', unit_price: '11.00' },
  ]);

  it('fires on a price more than 5 % above the last one, naming the open quotes that use it', () => {
    const found = run(priceIncrease, [
      A,
      before,
      after,
      quote('D-1', 'envoye', { lines: [{ label: 'Câble', amount: '1.00', article: A.path }] }),
      quote('D-2', 'brouillon', { links: [link('uses', A.path, 'strong')] }),
      quote('D-3', 'accepte', { lines: [{ label: 'Câble', amount: '1.00', article: A.path }] }),
      quote('D-4', 'envoye'),
    ]);
    expect(found).toEqual([
      {
        entity: 'catalogue/cable@finances/2026/achat-2',
        facts: {
          article: 'cable',
          before: 1000,
          after: 1100,
          pct: 10,
          supplier: 'fournisseur-b',
          date: '2026-10-10',
          quotes: ['D-1', 'D-2'],
        },
        cites: [
          A.path,
          'finances/2026/achat-2',
          'finances/2026/achat-1',
          'finances/2026/devis-d-1',
          'finances/2026/devis-d-2',
        ],
      },
    ]);
  });

  it('does not fire on 5 % or less, an old purchase, a single invoice or lines without price', () => {
    const small = bought('finances/2026/achat-2', '2026-10-10', [
      { article: A.path, unit_price: '10.50' },
    ]);
    expect(run(priceIncrease, [A, before, small])).toEqual([]);
    const old = bought('finances/2026/achat-2', '2026-09-01', [
      { article: A.path, unit_price: '20.00' },
    ]);
    expect(run(priceIncrease, [A, before, old])).toEqual([]);
    expect(run(priceIncrease, [A, after])).toEqual([]);
    const oneInvoice = bought('finances/2026/achat-3', '2026-10-12', [
      { article: A.path, unit_price: '10.00' },
      { article: A.path, unit_price: '15.00' },
    ]);
    expect(run(priceIncrease, [A, oneInvoice])).toEqual([]);
    const noPrice = bought('finances/2026/achat-4', '2026-10-12', [{ article: A.path }]);
    expect(run(priceIncrease, [A, before, noPrice])).toEqual([]);
    expect(run(priceIncrease, [page('catalogue/vis', { type: 'article' }), before])).toEqual([]);
  });
});

describe('margin-below-threshold', () => {
  const doc = (type: string, path: string, party: string, ht: string, chantier = SITE.path) =>
    page(path, {
      type,
      number: path.split('/').at(-1),
      party,
      issue_date: '2026-09-01',
      ht,
      tva: '0.00',
      ttc: ht,
      chantier,
    });
  const sale = doc('facture_vente', 'finances/2026/f-1', CLIENT.path, '1000.00');
  const cost = doc('facture_achat', 'finances/2026/a-1', SUPPLIER.path, '900.00');

  it('fires when a chantier earns less than the company threshold', () => {
    const [found] = run(marginBelowThreshold, [sale, cost]);
    expect(found).toEqual({
      entity: SITE.path,
      facts: {
        chantier: '2026-lilas',
        sales: 100_000,
        costs: 90_000,
        margin: 10_000,
        pct: 10,
        threshold: 15,
      },
      cites: [SITE.path, 'finances/2026/f-1', 'finances/2026/a-1'],
    });
  });

  it('counts the last situation, the client credit notes and the supplier ones', () => {
    const sits = [1, 2].map((n) =>
      page(`finances/situations/s-${n}`, {
        type: 'situation',
        chantier: SITE.path,
        number: n,
        cumul_ht: n === 1 ? '500.00' : '1000.00',
      }),
    );
    const clientCredit = doc('avoir', 'finances/2026/av-1', CLIENT.path, '300.00');
    const supplierCredit = doc('avoir', 'finances/2026/av-2', SUPPLIER.path, '100.00');
    const strangerCredit = doc('avoir', 'finances/2026/av-3', 'tiers/inconnu', '50.00');
    const [found] = run(marginBelowThreshold, [
      sale,
      cost,
      ...sits,
      clientCredit,
      supplierCredit,
      strangerCredit,
    ]);
    // Sales 1000 + 1000 − 300 = 1700, costs 900 − 100 − 50 = 750: 55.9 %, above 15 %.
    expect(found).toBeUndefined();
    const [tight] = run(marginBelowThreshold, [sale, cost, ...sits, clientCredit], TODAY, {
      marginPct: 50,
      vatOnDebits: false,
    });
    expect(tight?.facts).toMatchObject({ sales: 170_000, costs: 90_000, pct: 47.1 });
  });

  it('does not fire above the threshold or on a chantier with nothing sold', () => {
    expect(
      run(marginBelowThreshold, [sale, cost], TODAY, { marginPct: 5, vatOnDebits: false }),
    ).toEqual([]);
    expect(run(marginBelowThreshold, [cost])).toEqual([]);
    expect(run(marginBelowThreshold, [])).toEqual([]);
  });
});

describe('cash-forecast', () => {
  const doc = (
    type: string,
    path: string,
    due_date: string | undefined,
    ttc: string,
    paid?: string,
  ) =>
    page(path, {
      type,
      number: path.split('/').at(-1),
      party: type === 'facture_vente' ? CLIENT.path : SUPPLIER.path,
      issue_date: '2026-09-01',
      ...(due_date ? { due_date } : {}),
      ht: ttc,
      tva: '0.00',
      ttc,
      ...(paid ? { paid_at: paid } : {}),
    });

  it('sums what comes in and goes out in 30, 60 and 90 days, the late part apart', () => {
    const found = run(cashForecast, [
      doc('facture_vente', 'finances/2026/f-1', '2026-10-20', '1200.00'),
      doc('facture_vente', 'finances/2026/f-2', '2026-11-30', '600.00'),
      doc('facture_vente', 'finances/2026/f-3', '2027-01-20', '300.00'),
      doc('facture_vente', 'finances/2026/f-4', '2027-06-01', '999.00'),
      doc('facture_achat', 'finances/2026/a-1', '2026-11-10', '400.00'),
      doc('facture_vente', 'finances/2026/f-5', '2026-10-20', '50.00', '2026-10-19'),
      doc('facture_vente', 'finances/2026/f-6', undefined, '70.00'),
    ]);
    expect(found).toHaveLength(1);
    expect(found[0]?.entity).toBe('company');
    expect(found[0]?.facts).toEqual({
      in30: 120_000,
      out30: 40_000,
      in60: 180_000,
      out60: 40_000,
      in90: 210_000,
      out90: 40_000,
      lateIn: 120_000,
      lateCount: 1,
    });
    expect(found[0]?.cites).toHaveLength(5);
  });

  it('does not fire with nothing open', () => {
    expect(run(cashForecast, [])).toEqual([]);
    expect(
      run(cashForecast, [
        doc('facture_vente', 'finances/2026/f-5', '2026-10-20', '5.00', '2026-10-19'),
      ]),
    ).toEqual([]);
  });
});

describe('tva-declaration-due', () => {
  const doc = (type: string, path: string, party: string, fields: Record<string, unknown>) =>
    page(path, {
      type,
      number: path.split('/').at(-1),
      party,
      ht: '1000.00',
      ttc: '1200.00',
      tva: '200.00',
      ...fields,
    });
  const pages = [
    doc('facture_vente', 'finances/2026/f-1', CLIENT.path, {
      issue_date: '2026-08-20',
      paid_at: '2026-09-15',
    }),
    doc('facture_vente', 'finances/2026/f-2', CLIENT.path, { issue_date: '2026-09-05' }),
    doc('facture_achat', 'finances/2026/a-1', SUPPLIER.path, {
      issue_date: '2026-09-20',
      tva: '100.00',
    }),
    doc('avoir', 'finances/2026/av-1', CLIENT.path, { issue_date: '2026-09-21', tva: '20.00' }),
    doc('avoir', 'finances/2026/av-2', SUPPLIER.path, { issue_date: '2026-09-22', tva: '10.00' }),
    doc('facture_achat', 'finances/2026/a-2', SUPPLIER.path, { issue_date: '2026-10-02' }),
  ];

  it('fires from the 10th on the previous month, on payments by default', () => {
    expect(run(tvaDeclarationDue, pages)).toEqual([
      {
        entity: 'tva:2026-09',
        facts: {
          month: '2026-09',
          collected: 18_000,
          deductible: 9_000,
          net: 9_000,
          basis: 'encaissements',
        },
        cites: [
          'finances/2026/f-1',
          'finances/2026/a-1',
          'finances/2026/av-1',
          'finances/2026/av-2',
        ],
      },
    ]);
  });

  it('counts the invoices of the month for a company that opted for débits', () => {
    const [found] = run(tvaDeclarationDue, pages, TODAY, { marginPct: 15, vatOnDebits: true });
    expect(found?.facts).toMatchObject({ collected: 18_000, basis: 'debits' });
    expect(found?.cites).toContain('finances/2026/f-2');
    expect(found?.cites).not.toContain('finances/2026/f-1');
  });

  it('looks at December in January, and stays quiet before the 10th or on an empty month', () => {
    const december = doc('facture_achat', 'finances/2026/a-9', SUPPLIER.path, {
      issue_date: '2026-12-03',
    });
    expect(run(tvaDeclarationDue, [december], '2027-01-12')[0]?.entity).toBe('tva:2026-12');
    expect(run(tvaDeclarationDue, pages, '2026-10-09')).toEqual([]);
    expect(run(tvaDeclarationDue, pages, '2026-12-15')).toEqual([]);
  });
});

describe('subcontractor-no-docs', () => {
  const sub = (confidence = 'strong', to = SITE.path, roles = ['sous_traitant']) =>
    page('tiers/elec-moreau', {
      type: 'tiers',
      roles,
      siren: '404833048',
      links: [link('works_on', to, confidence)],
    });
  const attestation = (valid_to: string) =>
    page('juridique/elec-moreau/vigilance', {
      type: 'attestation_vigilance',
      party: 'tiers/elec-moreau',
      valid_from: '2026-04-01',
      valid_to,
    });

  it('fires on a subcontractor of a live chantier with no valid attestation', () => {
    const expected = [
      {
        entity: 'tiers/elec-moreau',
        facts: { party: 'elec-moreau', siren: '404833048', chantiers: ['2026-lilas'] },
        cites: ['tiers/elec-moreau', SITE.path],
      },
    ];
    expect(run(subcontractorNoDocs, [sub()])).toEqual(expected);
    expect(run(subcontractorNoDocs, [sub(), attestation('2026-10-24')])).toEqual(expected);
  });

  it('does not fire with a valid attestation, a guessed link, a closed site or another role', () => {
    expect(run(subcontractorNoDocs, [sub(), attestation('2026-10-25')])).toEqual([]);
    expect(run(subcontractorNoDocs, [sub('inferred')])).toEqual([]);
    expect(run(subcontractorNoDocs, [sub('exact', CLOSED.path)])).toEqual([]);
    expect(run(subcontractorNoDocs, [sub('exact', 'chantiers/absent')])).toEqual([]);
    expect(run(subcontractorNoDocs, [sub('exact', SITE.path, ['fournisseur'])])).toEqual([]);
  });

  it('writes a null SIREN when the page has none', () => {
    const bare = page('tiers/elec-moreau', {
      type: 'tiers',
      roles: ['sous_traitant'],
      links: [link('works_on', SITE.path)],
    });
    expect(run(subcontractorNoDocs, [bare])[0]?.facts.siren).toBeNull();
  });
});

describe('the catalogue', () => {
  it('lists the four chasers and the eight memory rules, each valid, once', () => {
    expect(CATALOGUE).toHaveLength(12);
    expect(new Set(CATALOGUE.map((e) => e.id)).size).toBe(12);
    for (const e of CATALOGUE) expect(RuleEntry.safeParse(e).success).toBe(true);
    expect(CATALOGUE.filter((e) => e.runs !== 'memory').map((e) => e.id)).toEqual([
      'invoice-overdue',
      'attestation-expiring',
      'retenue-releasable',
      'autoliquidation-error',
    ]);
  });

  it('has a French title for every rule and a sentence for every memory rule', () => {
    for (const e of CATALOGUE) expect(isMessageKey(`rules.${e.id}.title`)).toBe(true);
    for (const r of MEMORY_RULES) expect(isMessageKey(`rules.${r.entry.id}.notice`)).toBe(true);
  });

  it('refuses execute for a rule whose draft leaves the company, whatever is preferred', () => {
    const outward = devisAcceptedNoInvoice.entry;
    expect(RuleEntry.safeParse({ ...outward, autonomy: 'execute' }).success).toBe(false);
    expect(autonomyOf(outward, 'execute')).toBe('prepare');
    expect(autonomyOf(outward, 'notify')).toBe('notify');
    expect(autonomyOf(outward)).toBe('prepare');
    expect(autonomyOf(priceIncrease.entry, 'execute')).toBe('execute');
    expect(AUTONOMY).toContain('execute');
  });
});

describe('evaluateRules', () => {
  it('runs each rule, counts what it looked at, and keeps going past a rule that throws', () => {
    const broken: MemoryRule = {
      entry: { ...priceIncrease.entry, id: 'broken' },
      on: ['tiers'],
      detect: () => {
        throw new Error('boom');
      },
    };
    const thrower: MemoryRule = {
      entry: { ...priceIncrease.entry, id: 'thrower' },
      on: [],
      detect: () => {
        throw 'plain';
      },
    };
    const uncited: MemoryRule = {
      entry: { ...priceIncrease.entry, id: 'uncited' },
      on: ['chantier'],
      detect: () => [{ entity: 'x', facts: {}, cites: [] }],
    };
    const ctx = new RuleContext([CLIENT, SUPPLIER, SITE, CLOSED], TODAY);
    expect(evaluateRules(ctx, [broken, thrower, uncited, situationDue])).toEqual([
      { rule: 'broken', checked: 2, found: [], error: 'boom' },
      { rule: 'thrower', checked: 0, found: [], error: 'plain' },
      { rule: 'uncited', checked: 2, found: [] },
      { rule: 'situation-due', checked: 2, found: [] },
    ]);
    expect(evaluateRules(ctx)).toHaveLength(8);
  });

  it('reads pages by path and titles a missing page by its path', () => {
    const ctx = new RuleContext([SITE], TODAY);
    expect(ctx.get(undefined)).toBeUndefined();
    expect(ctx.title('tiers/absent')).toBe('tiers/absent');
    expect(ctx.title(undefined)).toBe('');
  });
});

describe('notices', () => {
  it('writes every firing in French with nothing left unfilled', () => {
    const facts = {
      'devis-accepted-no-invoice': {
        number: 'D-1',
        party: 'SCI',
        ht: 1_240_000,
        date: '2026-10-01',
        days: 24,
      },
      'tva-declaration-due': {
        month: '2026-09',
        collected: 1,
        deductible: 2,
        net: -1,
        basis: 'debits',
      },
      'price-increase': {
        article: 'Câble',
        before: 1000,
        after: 1155,
        pct: 15.5,
        supplier: 'X',
        date: '2026-10-10',
        quotes: [],
      },
    } as const;
    const devis = noticeOf('devis-accepted-no-invoice', facts['devis-accepted-no-invoice']);
    expect(devis.title).toBe('Devis accepté, pas encore facturé');
    expect(devis.text).toContain('12\u00a0400,00');
    expect(devis.text).toContain('01/10/2026');
    const tva = noticeOf('tva-declaration-due', facts['tva-declaration-due']).text;
    expect(tva).toContain('septembre 2026');
    expect(tva).toContain('vos factures émises');
    const price = noticeOf('price-increase', facts['price-increase']).text;
    expect(price).toContain('+15,5 %');
    expect(price).toContain('aucun');
    for (const text of [devis.text, tva, price]) expect(text).not.toMatch(/\{\w+\}/);
  });

  it('says unknown, yes and no plainly, and names a rule without its sentence', () => {
    expect(noticeParams({ siren: null, sent: true, paid: false, other: 'libre' })).toEqual({
      siren: 'non précisé',
      sent: 'oui',
      paid: 'non',
      other: 'libre',
    });
    expect(noticeOf('invoice-overdue', {})).toEqual({
      title: 'Facture en retard de paiement',
      text: 'La règle « invoice-overdue » a relevé un point : ouvrez le volet pour le détail.',
    });
    expect(noticeOf('no-such-rule', {}).title).toBe('no-such-rule');
  });
});
