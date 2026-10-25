import type { SellerProfile } from '@fi/core';
import { type Frontmatter, type PageFacts, writePage } from '@fi/memory';
import { demoVault } from '@fi/memory/demo';
import { t } from '@fi/shared';
import { describe, expect, it } from 'vitest';
import {
  type FromQuote,
  invoiceFromQuote,
  type NextSituation,
  nextSituation,
  type Preparation,
  type PrepareBuyer,
  type PrepareCompany,
  type Prepared,
  type PrepareSite,
} from './prepare';

type FactsOf<T extends Frontmatter['type']> = Extract<PageFacts, { type: T }>;
type Quote = FactsOf<'devis'>;

const SELLER: SellerProfile = {
  name: 'Bâtiment Dupont SARL',
  siren: '100000009',
  vatId: 'FR88100000009',
  address: { line1: '12 rue des Lilas', city: 'Dijon', postCode: '21000', country: 'FR' },
  defaults: {
    siret: '10000000900017',
    iban: 'FR7630006000011234567890189',
    paymentDays: 30,
    operationCategory: 'services',
  },
};
const ADDRESS = { line1: '3 place Darcy', city: 'Dijon', postCode: '21000', country: 'FR' };
const COMPANY: PrepareCompany = { seller: SELLER, btp: true, vatOnDebits: false };
const TODAY = '2026-10-25';

const demo = demoVault();
const pages = new Map(demo.pages.map((p) => [p.path as string, p]));
const factsOf = <T extends Frontmatter['type']>(path: string, type: T): FactsOf<T> => {
  const f = pages.get(path)?.frontmatter;
  if (f?.type !== type) throw new Error(`${path} is not a ${type}`);
  return f as FactsOf<T>;
};

function buyerOf(path: string, extra: Partial<PrepareBuyer> = {}): PrepareBuyer {
  const f = factsOf(path, 'tiers');
  return {
    path,
    name: f.title,
    siren: f.siren,
    siret: f.siret,
    vatId: f.vat_id,
    email: f.email,
    address: ADDRESS,
    subcontracting: false,
    ...extra,
  };
}

function siteOf(path: string): PrepareSite {
  const f = factsOf(path, 'chantier');
  return {
    path,
    title: f.title,
    erpRef: f.erp_ref,
    ...(f.retenue_pct !== undefined && { retenueBps: Math.round(f.retenue_pct * 100) }),
  };
}

interface QuotePage {
  path: string;
  frontmatter: Quote;
}
const accepted = demo.pages.flatMap((p): QuotePage[] => {
  const f = p.frontmatter;
  return f.type === 'devis' && f.status === 'accepte' ? [{ path: p.path, frontmatter: f }] : [];
});

function fromDemo(p: QuotePage, i: number): FromQuote {
  const q = p.frontmatter;
  return {
    company: COMPANY,
    buyer: buyerOf(q.party),
    number: `F2026-${String(i + 1).padStart(4, '0')}`,
    issueDate: TODAY,
    quote: { path: p.path, facts: q },
    ...(q.chantier && { site: siteOf(q.chantier) }),
  };
}

const ok = (p: Preparation): Prepared => {
  if (!p.ok) throw new Error(`refused: ${p.reason} ${JSON.stringify(p.params)}`);
  return p;
};
const bytes = (p: Prepared) =>
  writePage({
    path: p.page.path,
    frontmatter: { ...p.page.frontmatter, updated: TODAY } as Frontmatter,
    text: p.page.text ?? '',
  });

/** A quote of its own, made from a demo one. */
const first = accepted[0] as QuotePage;
const quote = (facts: Partial<Quote>, extra: Partial<FromQuote> = {}): FromQuote => ({
  ...fromDemo(first, 0),
  quote: { path: first.path, facts: { ...first.frontmatter, ...facts } },
  ...extra,
});

describe('invoiceFromQuote: the demo', () => {
  it('makes 20 valid invoices of the 20 accepted quotes, every amount the quote’s', () => {
    expect(accepted).toHaveLength(20);
    for (const [i, p] of accepted.entries()) {
      const q = p.frontmatter;
      const done = ok(invoiceFromQuote(fromDemo(p, i)));
      const { invoice, issues, page } = done;
      expect(issues.filter((x) => x.severity === 'error')).toEqual([]);
      expect(invoice.totals.taxExclusive).toBe(q.ht);
      expect(invoice.totals.taxInclusive).toBe(q.ttc);
      expect(invoice.lines.map((l) => l.netAmount)).toEqual((q.lines ?? []).map((l) => l.amount));
      expect(invoice.salesOrderReference).toBe(q.number);
      expect(invoice.projectReference).toMatch(/^CH-2026-\d{2}$/);
      // The chantier's 5 %, on the TTC.
      expect(invoice.btp?.retenue?.amount).toBe(Math.floor(((q.ttc ?? 0) * 500) / 10_000));
      expect(invoice.notes.map((n) => n.subjectCode)).toEqual(['PMT', 'PMD', 'AAB', 'ABU']);
      expect(page.frontmatter).toMatchObject({
        type: 'facture_vente',
        number: invoice.number,
        party: q.party,
        ht: q.ht,
        ttc: q.ttc,
        sales_order_ref: q.number,
        chantier: q.chantier,
      });
      expect(page.path).toMatch(
        new RegExp(
          `^finances/2026/${TODAY}_facture_[a-z-]+_${(invoice.number ?? '').toLowerCase()}$`,
        ),
      );
      expect(done.text).toContain(q.number);
    }
  });

  it('gives the same page byte for byte twice', () => {
    const run = () => accepted.map((p, i) => bytes(ok(invoiceFromQuote(fromDemo(p, i)))));
    expect(run()).toEqual(run());
  });

  it('writes a mail that says the amount and the due date', () => {
    const { text } = ok(invoiceFromQuote(fromDemo(first, 0)));
    expect(text.split('\n')).toEqual([
      t('prepare.text.hello'),
      '',
      expect.stringContaining(first.frontmatter.number),
      t('prepare.text.due', { due: '24/11/2026' }),
      '',
      t('prepare.text.bye'),
      SELLER.name,
    ]);
  });
});

describe('invoiceFromQuote: what it refuses', () => {
  const refused = (p: Preparation) => (p.ok ? 'prepared' : p.reason);

  it('a quote not accepted, or read by a model', () => {
    expect(refused(invoiceFromQuote(quote({ status: 'envoye' })))).toBe('not_accepted');
    expect(refused(invoiceFromQuote(quote({ extracted: { confidence: 0.9 } })))).toBe('extracted');
  });

  it('a quote without lines', () => {
    expect(refused(invoiceFromQuote(quote({ lines: [] })))).toBe('no_lines');
    expect(refused(invoiceFromQuote(quote({ lines: undefined })))).toBe('no_lines');
  });

  it('lines that do not make the quote’s HT, or a line that is not quantity × price', () => {
    const r = invoiceFromQuote(quote({ ht: 100_000, ttc: 120_000 }));
    expect(r).toMatchObject({ ok: false, reason: 'total', params: { quote: 'D-2026-001' } });
    const lines = [{ label: 'Pose', quantity: 3, unit_price: 1_000, amount: 3_001 }];
    expect(refused(invoiceFromQuote(quote({ lines, ht: 3_001, ttc: 3_601 })))).toBe('line_amount');
  });

  it('a VAT nothing gives', () => {
    const lines = [{ label: 'Pose', amount: 10_000 }];
    expect(refused(invoiceFromQuote(quote({ lines, ht: 10_000, ttc: undefined })))).toBe(
      'vat_unknown',
    );
    expect(refused(invoiceFromQuote(quote({ lines, ht: 10_000, ttc: 10_300 })))).toBe(
      'vat_unknown',
    );
    const zero = [{ label: 'Pose', amount: 10_000, vat_rate: 0 }];
    expect(refused(invoiceFromQuote(quote({ lines: zero, ht: 10_000, ttc: 10_000 })))).toBe(
      'vat_unknown',
    );
  });

  it('VAT on a quote to a donneur d’ordre', () => {
    const buyer = buyerOf(first.frontmatter.party, { subcontracting: true });
    expect(refused(invoiceFromQuote(quote({}, { buyer })))).toBe('autoliquidation_vat');
    const rated = [{ label: 'Pose', amount: 10_000, vat_rate: 20 }];
    expect(
      refused(invoiceFromQuote(quote({ lines: rated, ht: 10_000, ttc: undefined }, { buyer }))),
    ).toBe('autoliquidation_vat');
  });

  it('a TTC the invoice’s rounding would not repeat', () => {
    const lines = [
      { label: 'A', amount: 1_005, vat_rate: 20 },
      { label: 'B', amount: 1_005, vat_rate: 20 },
    ];
    expect(invoiceFromQuote(quote({ lines, ht: 2_010, ttc: 2_413 }))).toMatchObject({
      ok: false,
      reason: 'amounts',
      params: { ttc: expect.any(String) },
    });
  });

  it('what the validator does not pass', () => {
    const site = { ...siteOf(first.frontmatter.chantier ?? ''), retenueBps: 600 };
    const r = invoiceFromQuote(quote({}, { site }));
    expect(r).toMatchObject({ ok: false, reason: 'invalid', params: { count: 1 } });
    if (!r.ok) expect(r.issues?.map((i) => i.ruleId)).toContain('BTP-RG-01');
  });
});

describe('invoiceFromQuote: VAT, autoliquidation, retenue', () => {
  it('keeps each line’s own rate', () => {
    const lines = [
      { label: 'Isolation', amount: 10_000, vat_rate: 5.5 },
      {
        label: 'Peinture',
        quantity: 2,
        unit_price: 5_000,
        amount: 10_000,
        vat_rate: 10,
        code: 'P1',
      },
    ];
    const { invoice, page } = ok(invoiceFromQuote(quote({ lines, ht: 20_000, ttc: 21_550 })));
    expect(invoice.vatBreakdown.map((b) => [b.rate, b.taxAmount])).toEqual([
      ['5.5', 550],
      ['10', 1_000],
    ]);
    expect(invoice.lines[1]?.item.sellerId).toBe('P1');
    expect(page.frontmatter).toMatchObject({
      tva: 1_550,
      lines: [{ vat_rate: 5.5 }, { vat_rate: 10 }],
    });
  });

  it('a line without its rate takes the quote’s', () => {
    const lines = [
      { label: 'A', amount: 10_000, vat_rate: 20 },
      { label: 'B', amount: 10_000 },
    ];
    const { invoice } = ok(invoiceFromQuote(quote({ lines, ht: 20_000, ttc: 24_000 })));
    expect(invoice.vatBreakdown).toHaveLength(1);
  });

  it('invoices a donneur d’ordre without VAT, under reverse charge', () => {
    const buyer = buyerOf(first.frontmatter.party, { subcontracting: true });
    const lines = [{ label: 'Pose', amount: 10_000 }];
    const done = ok(invoiceFromQuote(quote({ lines, ht: 10_000, ttc: 10_000 }, { buyer })));
    expect(done.invoice.vatBreakdown).toMatchObject([
      { category: 'AE', exemptionCode: 'VATEX-FR-AE', taxAmount: 0 },
    ]);
    expect(done.text).toContain(t('prepare.text.autoliquidation'));
  });

  it('holds no retenue outside the building trade, or on a chantier without one', () => {
    const plain = ok(invoiceFromQuote(quote({}, { company: { ...COMPANY, btp: false } })));
    expect(plain.invoice.btp).toBeUndefined();
    const site = { path: 'chantiers/x', title: 'X' };
    const bare = ok(invoiceFromQuote(quote({}, { site })));
    expect(bare.invoice.btp).toBeUndefined();
    expect(bare.invoice.projectReference).toBeUndefined();
    const none = ok(invoiceFromQuote(quote({}, { site: undefined })));
    expect(none.page.frontmatter).not.toHaveProperty('chantier');
  });

  it('holds a retenue of an odd TTC under the 5 %', () => {
    const lines = [{ label: 'Pose', amount: 17_958 }];
    const { invoice } = ok(invoiceFromQuote(quote({ lines, ht: 17_958, ttc: 21_550 })));
    expect(invoice.btp?.retenue?.amount).toBe(1_077);
  });

  it('prepares nothing without a due date', () => {
    const seller = { ...SELLER, defaults: { iban: SELLER.defaults.iban } };
    const r = invoiceFromQuote(quote({}, { company: { ...COMPANY, seller } }));
    expect(r.ok ? [] : r.issues?.map((i) => i.ruleId)).toContain('FF-DUE-01');
  });

  it('passes the history and the customer’s settings to the validator', () => {
    const ids = (p: Preparation) => (p.ok ? p.issues : (p.issues ?? [])).map((i) => i.ruleId);
    const history = [{ number: 'F2026-0005', issueDate: '2026-10-01' }];
    expect(ids(invoiceFromQuote(quote({}, { history })))).toContain('FF-NUM-02');
    const buyer = buyerOf(first.frontmatter.party, { settings: { requiresPurchaseOrder: true } });
    expect(ids(invoiceFromQuote(quote({}, { buyer })))).toContain('FF-PO-01');
  });
});

describe('nextSituation', () => {
  const [last] = demo.pages.flatMap((p) => {
    const f = p.frontmatter;
    return f.type === 'situation' && f.number === 4 ? [{ path: p.path, frontmatter: f }] : [];
  });
  if (!last) throw new Error('the demo has no situation 4');
  const prev = last.frontmatter;
  const input = (extra: Partial<NextSituation> = {}): NextSituation => ({
    company: COMPANY,
    buyer: buyerOf(prev.party ?? ''),
    number: 'F2026-0100',
    issueDate: TODAY,
    previous: { path: last.path, facts: prev },
    site: siteOf(prev.chantier),
    cumulative: prev.cumul_ht + 1_000_000,
    ...extra,
  });

  it('invoices the progress since the last situation', () => {
    const done = ok(nextSituation(input()));
    const { invoice, page } = done;
    expect(invoice.totals.taxExclusive).toBe(1_000_000);
    expect(invoice.totals.taxInclusive).toBe(1_200_000);
    expect(invoice.btp?.situation).toEqual({ number: 5, cumulative: prev.cumul_ht + 1_000_000 });
    expect(invoice.btp?.retenue?.amount).toBe(60_000);
    expect(invoice.notes.map((n) => n.subjectCode)).toEqual(['PMT', 'PMD', 'AAB', 'ABU', 'AAI']);
    expect(page.frontmatter).toMatchObject({
      type: 'situation',
      number: 5,
      chantier: prev.chantier,
      cumul_ht: prev.cumul_ht + 1_000_000,
      ht: 1_000_000,
      ttc: 1_200_000,
      retenue: 60_000,
    });
    expect(page.path).toBe(last.path.replace(/sit-4$/, 'sit-5'));
    expect(done.text).toContain('n° 5');
    expect(bytes(done)).toBe(bytes(ok(nextSituation(input()))));
  });

  it('refuses no progress, a read situation, or no VAT', () => {
    const r = nextSituation(input({ cumulative: prev.cumul_ht }));
    expect(r).toMatchObject({ ok: false, reason: 'not_ahead', params: { number: 4 } });
    const read = { path: last.path, facts: { ...prev, extracted: { confidence: 0.9 } } };
    expect(nextSituation(input({ previous: read }))).toMatchObject({ reason: 'extracted' });
    const bare = { path: last.path, facts: { ...prev, ht: undefined, ttc: undefined } };
    expect(nextSituation(input({ previous: bare }))).toMatchObject({ reason: 'vat_unknown' });
  });

  it('autoliquidation, no retenue, the title as the reference', () => {
    const bare = { path: last.path, facts: { ...prev, ht: undefined, ttc: undefined } };
    const done = ok(
      nextSituation(
        input({
          previous: bare,
          buyer: buyerOf(prev.party ?? '', { subcontracting: true }),
          company: { ...COMPANY, btp: false },
          site: { path: prev.chantier, title: 'Chantier X' },
        }),
      ),
    );
    expect(done.invoice.totals.taxInclusive).toBe(1_000_000);
    expect(done.invoice.projectReference).toBe('Chantier X');
    expect(done.page.frontmatter).not.toHaveProperty('retenue');
  });

  it('refuses what the validator does not pass', () => {
    const site = { ...siteOf(prev.chantier), retenueBps: 600 };
    expect(nextSituation(input({ site }))).toMatchObject({ ok: false, reason: 'invalid' });
  });
});
