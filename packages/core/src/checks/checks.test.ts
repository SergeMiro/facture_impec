import { describe, expect, it } from 'vitest';
import { bought, delivery, invoice, order, prices, purchase } from '../../test/checks-corpus';
import { checkRegistry, excused, NOISE, partyOf, priceValue } from './check';
import { findCosts, normalizeName } from './cost';
import { itemQuantities, linkDocs, sameParty, similarity } from './link';
import { applySynonyms, nameScore, proposeSynonyms } from './synonym';
import { type RuleException, ruleOf, SEVERITY } from './types';

const TODAY = '2026-10-20';
const chairs = (q: string, price = '40') => [{ item: 'Chaise', q, price }];
const run = (docs: Parameters<typeof checkRegistry>[0]['docs'], decisions = []) =>
  checkRegistry({ docs, decisions, today: TODAY });
const shape = (l: { fromDocId: string; toDocId: string; status: string; method: string }) =>
  `${l.fromDocId}>${l.toDocId} ${l.status} ${l.method}`;

describe('linker', () => {
  it('compares customers by SIREN, else by name, else says nothing', () => {
    const a = order('C-1', chairs('1'));
    expect(sameParty(a, invoice('F-1', chairs('1')))).toBe(true);
    expect(sameParty(a, invoice('F-1', chairs('1'), { partySiren: '999999999' }))).toBe(false);
    const noSiren = { partySiren: null };
    expect(sameParty(order('C-1', [], noSiren), invoice('F-1', [], noSiren))).toBe(true);
    expect(
      sameParty(order('C-1', [], noSiren), invoice('F-1', [], { ...noSiren, partyName: null })),
    ).toBe(null);
  });

  it('scores the articles and quantities a document shares with another', () => {
    const o = order('C-1', [
      { item: 'Chaise', q: '10', price: '40' },
      { item: 'Table', q: '2', price: '100' },
    ]);
    expect(similarity(invoice('F-1', chairs('10')), o)).toBe(100);
    expect(similarity(invoice('F-1', chairs('5')), o)).toBe(50);
    expect(similarity(invoice('F-1', [{ item: 'Chaise', q: null, price: '40' }]), o)).toBe(50);
    expect(similarity(invoice('F-1', [{ item: 'Lampe', q: '1', price: '9' }]), o)).toBe(0);
    expect(similarity(invoice('F-1', []), o)).toBe(0);
    const twice = invoice('F-1', [...chairs('4'), ...chairs('6')]);
    expect(itemQuantities(twice).get('item-chaise')).toBe(10);
    const unknown = invoice('F-1', [...chairs('4'), { item: 'Chaise', q: null }]);
    expect(itemQuantities(unknown).get('item-chaise')).toBeNull();
  });

  it('reads an order number however it is written', () => {
    const links = linkDocs(
      [order('C-118', chairs('10')), invoice('F-1', chairs('10'), { orderRef: 'c 118' })],
      [],
    );
    expect(links.map(shape)).toEqual(['order:C-118>invoice:F-1 auto number']);
  });

  it('proposes every order that carries the same number', () => {
    const links = linkDocs(
      [
        order('C-1', chairs('10')),
        order('C-1', chairs('5'), { id: 'order:C-1b' }),
        invoice('F-1', chairs('10'), { orderRef: 'C-1' }),
      ],
      [],
    );
    expect(links.map((l) => l.status)).toEqual(['proposed', 'proposed']);
  });

  it('asks a person before a third invoice bills an order already billed in full', () => {
    const docs = [
      order('C-1', chairs('10')),
      invoice('F-1', chairs('10'), { orderRef: 'C-1' }),
      invoice('F-2', chairs('10'), { issueDate: '2026-09-20' }),
    ];
    expect(linkDocs(docs, []).map(shape)).toEqual([
      'order:C-1>invoice:F-1 auto number',
      'order:C-1>invoice:F-2 proposed item',
    ]);
  });

  it('leaves out other customers, dates out of the window, advances and weak matches', () => {
    const o = order('C-1', chairs('10'));
    expect(linkDocs([o, invoice('F-1', chairs('10'), { partySiren: '999999999' })], [])).toEqual(
      [],
    );
    expect(linkDocs([o, invoice('F-1', chairs('10'), { issueDate: '2027-03-01' })], [])).toEqual(
      [],
    );
    expect(linkDocs([o, invoice('F-1', chairs('10'), { typeCode: '386' })], [])).toEqual([]);
    expect(linkDocs([o, invoice('F-1', chairs('2'))], [])).toEqual([]);
  });

  it('proposes a partial match instead of linking it', () => {
    const links = linkDocs([order('C-1', chairs('10')), invoice('F-1', chairs('6'))], []);
    expect(links.map(shape)).toEqual(['order:C-1>invoice:F-1 proposed similarity']);
  });

  it('links a clear leader and proposes at most three close ones', () => {
    const lead = linkDocs(
      [order('C-1', chairs('10')), order('C-2', chairs('6')), invoice('F-1', chairs('10'))],
      [],
    );
    expect(lead.map(shape)).toEqual(['order:C-1>invoice:F-1 auto item']);
    const close = linkDocs(
      ['1', '2', '3', '4']
        .map((n) => order(`C-${n}`, chairs('10')))
        .concat(invoice('F-1', chairs('10'))),
      [],
    );
    expect(close.map((l) => l.fromDocId)).toEqual(['order:C-1', 'order:C-2', 'order:C-3']);
  });

  it('ties a delivery note to its order, else to the invoice that bills it', () => {
    const toOrder = linkDocs(
      [
        order('C-1', chairs('10')),
        delivery('BL-1', [{ item: 'Chaise', q: '10' }], { issueDate: '2026-09-03' }),
      ],
      [],
    );
    expect(toOrder.map((l) => `${l.kind} ${shape(l)}`)).toEqual([
      'fulfils delivery:BL-1>order:C-1 auto item',
    ]);
    const byNumber = linkDocs(
      [
        order('C-1', chairs('10')),
        delivery('BL-1', [{ item: 'Chaise', q: '10' }], { orderRef: 'C-1' }),
      ],
      [],
    );
    expect(byNumber.map((l) => `${l.kind} ${l.method}`)).toEqual(['fulfils number']);
    const toInvoice = linkDocs(
      [
        delivery('BL-1', [{ item: 'Chaise', q: '10' }], { issueDate: '2026-09-05' }),
        invoice('F-1', chairs('10')),
      ],
      [],
    );
    expect(toInvoice.map((l) => `${l.kind} ${shape(l)}`)).toEqual([
      'billed_by delivery:BL-1>invoice:F-1 auto item',
    ]);
  });

  it('keeps what a person decided', () => {
    const docs = [order('C-1', chairs('10')), invoice('F-1', chairs('10'), { orderRef: 'C-1' })];
    const confirmed = linkDocs(docs, [
      { kind: 'billed_by', fromDocId: 'order:C-1', toDocId: 'invoice:F-1', status: 'confirmed' },
    ]);
    expect(confirmed.map(shape)).toEqual(['order:C-1>invoice:F-1 confirmed human']);
    const gone = linkDocs(docs, [
      { kind: 'billed_by', fromDocId: 'order:C-1', toDocId: 'invoice:gone', status: 'confirmed' },
    ]);
    expect(gone.map(shape)).toEqual(['order:C-1>invoice:F-1 auto number']);
    const fulfils = linkDocs(
      [
        order('C-1', chairs('10')),
        order('C-2', chairs('10')),
        delivery('BL-1', [{ item: 'Chaise', q: '10' }], { issueDate: '2026-09-03' }),
      ],
      [{ kind: 'fulfils', fromDocId: 'delivery:BL-1', toDocId: 'order:C-2', status: 'confirmed' }],
    );
    expect(fulfils.map(shape)).toEqual(['delivery:BL-1>order:C-2 confirmed human']);
  });
});

describe('checker', () => {
  it('gives every message a rule and a severity', () => {
    for (const [message, severity] of Object.entries(SEVERITY)) {
      expect(message.startsWith(ruleOf(message as keyof typeof SEVERITY))).toBe(true);
      expect(['blocking', 'warning']).toContain(severity);
    }
  });

  it('explains the 300/400 example with the amounts and the cells', () => {
    const [f] = run([
      order('C-118', chairs('10')),
      invoice('F-2026-042', chairs('10', '30'), { orderRef: 'C-118' }),
    ]).findings;
    expect(f).toMatchObject({
      rule: 'B1',
      severity: 'blocking',
      message: 'B1.under',
      docId: 'invoice:F-2026-042',
      key: 'B1:order:C-118:item-chaise',
      amount: 10_000,
      params: {
        invoice: 'F-2026-042',
        source: 'la commande C-118',
        quantity: '10',
        invoiced: '300,00\u00a0€',
        expected: '400,00\u00a0€',
        amount: '100,00\u00a0€',
        item: 'Chaise',
      },
      evidence: [
        { role: 'invoice', docId: 'invoice:F-2026-042', number: 'F-2026-042', cell: 'D2' },
        { role: 'order', docId: 'order:C-118', number: 'C-118', cell: 'B2' },
      ],
    });
  });

  it('sorts the money at stake first, blocking before warning at the same amount', () => {
    const { findings } = run([
      order('C-1', chairs('10')),
      invoice('F-1', chairs('10', '30'), { orderRef: 'C-1' }),
      delivery('BL-1', [{ item: 'Palette', q: '1', price: '500' }]),
      delivery('BL-2', [{ item: 'Sac', q: '1' }]),
      prices('T-1', [{ item: 'Carton', price: '25' }]),
      invoice('F-2', [{ item: 'Carton', q: '1', price: '24' }], { partySiren: '999999999' }),
    ]);
    expect(findings.map((f) => f.message)).toEqual([
      'B3.unbilled',
      'B1.under',
      'A5.price',
      'B3.unbilledNoAmount',
    ]);
    expect(NOISE).toBe(100);
  });

  it('skips lines it cannot read', () => {
    const { findings } = run([
      order('C-1', [
        { item: 'Chaise', q: null, price: '40' },
        { item: 'Table', q: '2', price: null, net: null },
      ]),
      invoice(
        'F-1',
        [
          { item: 'Chaise', q: '3', price: 'abc', net: 100 },
          { item: 'Table', q: '2', price: '50' },
        ],
        { orderRef: 'C-1' },
      ),
      prices('T-1', [{ item: 'Lampe', price: null }]),
      invoice('F-2', [
        { item: 'Lampe', q: null, price: '9' },
        { item: 'Lampe', q: '1', price: '9', rate: null },
      ]),
      delivery('BL-1', [
        { item: 'Sac', q: null },
        { item: 'Sac', q: '0' },
      ]),
      delivery('BL-2', [{ item: 'Sac', q: '2', price: '10' }], { issueDate: null }),
    ]);
    expect(findings).toEqual([]);
  });

  it('does not judge an advance alone, nor an invoice that bills two orders', () => {
    const docs = [
      order('C-1', chairs('10')),
      order('C-2', [{ item: 'Table', q: '1', price: '100' }]),
      invoice('A-1', [{ item: 'Acompte', price: '120' }], { orderRef: 'C-1', typeCode: '386' }),
    ];
    expect(run(docs).findings).toEqual([]);
    const both = invoice('F-1', [...chairs('10'), { item: 'Table', q: '1', price: '100' }], {
      orderRef: 'C-1',
    });
    const decisions = [
      {
        kind: 'billed_by' as const,
        fromDocId: 'order:C-2',
        toDocId: 'invoice:F-1',
        status: 'confirmed' as const,
      },
    ];
    expect(checkRegistry({ docs: [...docs, both], decisions, today: TODAY }).findings).toEqual([]);
  });

  it('counts the advances of an order with an unreadable total as unknown', () => {
    const docs = [
      order('C-1', chairs('10')),
      invoice('A-1', [{ item: 'Acompte', price: '120' }], {
        orderRef: 'C-1',
        typeCode: '386',
        netTotal: null,
      }),
      invoice('F-1', chairs('10'), { orderRef: 'C-1', issueDate: '2026-09-20' }),
    ];
    expect(run(docs).findings).toEqual([]);
  });

  it('says how a credit note and a test invoice stay apart', () => {
    const { findings } = run([
      order('C-1', chairs('10')),
      invoice('TEST-1', chairs('12'), { orderRef: 'C-1', isTest: true }),
      delivery('BL-1', [{ item: 'Palette', q: '1', price: '500' }]),
    ]);
    // The delivery note's delay belongs to the real pass, once; the test invoice keeps its own key.
    expect(findings.map((f) => f.key)).toEqual([
      'B3:delivery:BL-1',
      'test:B4:order:C-1:item-chaise',
    ]);
  });

  it('keeps an unusual rate quiet when the line has no amount', () => {
    const history = ['06', '07', '08'].map((m) =>
      invoice(`H-${m}`, [{ item: 'Livre', price: '30', rate: '5.5' }], {
        issueDate: `2026-${m}-01`,
      }),
    );
    const { findings } = run([
      ...history,
      invoice('F-1', [{ item: 'Livre', price: '30', rate: '20', net: null }]),
    ]);
    expect(findings).toEqual([]);
  });
});

describe('what a sold line cost (R3)', () => {
  const sale = (o = {}) => invoice('F-1', chairs('10', '30'), o);

  it('names an article the same way whatever its accents, case and punctuation', () => {
    expect(normalizeName('  Chaise  PLIANTE. ')).toBe('chaise pliante');
    expect(normalizeName('Œuvre — Été 2026 !')).toBe('œuvre ete 2026');
  });

  it('takes a purchase a person confirmed over a later one, and says it was a person', () => {
    const later = bought('FA-2', chairs('10', '35'), { issueDate: '2026-09-05' });
    const chosen = bought('FA-1', chairs('10', '20'), { issueDate: '2026-08-01' });
    const { costs, links } = findCosts(
      [later, chosen, sale()],
      [{ kind: 'cost', fromDocId: chosen.id, toDocId: 'invoice:F-1', status: 'confirmed' }],
    );
    expect(costs.get('invoice:F-1:1')?.doc.id).toBe(chosen.id);
    expect(links.map(shape)).toEqual(['in:FA-1>invoice:F-1 confirmed human']);
  });

  it('takes the latest purchase for a sale without a date, and one without a date last', () => {
    const undated = bought('FA-0', chairs('10', '50'), { issueDate: null });
    const dated = bought('FA-1', chairs('10', '35'), { issueDate: '2026-12-01' });
    expect(
      findCosts([undated, dated, sale({ issueDate: null })], []).costs.get('invoice:F-1:1')?.doc.id,
    ).toBe(dated.id);
    // Sold on 10 September: December is too late, the undated purchase is the one known before.
    expect(findCosts([undated, dated, sale()], []).costs.get('invoice:F-1:1')?.doc.id).toBe(
      undated.id,
    );
  });

  it('ties a purchase once to an invoice, by its item when one line says so', () => {
    const twoLines = bought('FA-1', [
      { item: 'Chaise', q: '10', price: '35' },
      { item: 'Table', key: 'supplier:siren:600000004:ref:T-9', q: '1', price: '90' },
    ]);
    const sold = invoice('F-1', [{ item: 'Table', q: '1', price: '100' }, ...chairs('10', '30')]);
    const { costs, links } = findCosts([twoLines, sold], []);
    expect([...costs.values()].map((c) => c.by)).toEqual(['name', 'item']);
    expect(links).toMatchObject([{ score: 100, method: 'item', status: 'auto' }]);
  });

  it('reads « one », « piece » and « each » as the same unit, a box as another', () => {
    const cost = (sold: string, bought_: string) =>
      findCosts(
        [
          bought('FA-1', [{ item: 'Chaise', q: '10', price: '35', unit: bought_ }]),
          invoice('F-1', [{ item: 'Chaise', q: '10', price: '30', unit: sold }]),
        ],
        [],
      ).costs.size;
    expect(cost('C62', 'H87')).toBe(1);
    expect(cost('EA', 'C62')).toBe(1);
    expect(cost('C62', 'XBX')).toBe(0);
    expect(cost('KGM', 'KGM')).toBe(1);
  });

  it('writes where the cost comes from when the purchase has no number', () => {
    const findings = run([
      bought('', chairs('10', '35'), { id: 'in:x', number: null, partyName: null }),
      sale(),
    ]).findings;
    expect(findings[0]?.params.purchase).toBe('une facture');
    const sheet = run([purchase('', chairs('10', '35'), { number: null }), sale()]).findings;
    expect(sheet[0]?.params.purchase).toBe('la feuille « Achats »');
    const named = run([bought('', chairs('10', '35'), { number: null }), sale()]).findings;
    expect(named[0]?.params.purchase).toBe('une facture de Grossiste Martin');
  });

  it('judges no line given away, and no line without a quantity', () => {
    const cost = bought('FA-1', [...chairs('10', '35'), { item: 'Table', q: '1', price: '90' }]);
    const sold = invoice('F-1', [
      { item: 'Chaise', q: '1', price: '0' },
      { item: 'Table', q: null, price: '50' },
      ...chairs('10', '30'),
    ]);
    const out = checkRegistry({
      docs: [cost, sold],
      decisions: [],
      today: TODAY,
      minMarginPercent: 20,
    });
    expect(out.findings.map((f) => [f.message, f.key, f.amount])).toEqual([
      ['B2.loss', 'B2:invoice:F-1:3', 5_000],
    ]);
  });
});

describe('the correction the code builds (R8)', () => {
  const C118 = order('C-118', chairs('10'));
  const ref = { orderRef: 'C-118' };

  it('sets the 300/400 invoice price to the order one, and gives a loss no correction of its own', () => {
    const { findings } = checkRegistry({
      docs: [
        C118,
        invoice('F-2026-042', chairs('10', '30'), ref),
        bought('FA-1', [{ item: 'Chaise', q: '10', price: '35' }]),
      ],
      decisions: [],
      today: TODAY,
    });
    expect(findings.map((f) => [f.message, f.fix ?? null])).toEqual([
      ['B1.under', { cell: 'D2', field: 'price', before: '30', after: '40' }],
      ['B2.loss', null],
    ]);
  });

  it('lowers a price above the order, and takes the VAT off a price that carries it', () => {
    const over = run([C118, invoice('F-1', chairs('10', '45'), ref)]).findings[0];
    expect(over).toMatchObject({ message: 'B4.price', fix: { before: '45', after: '40' } });
    const vat = run([C118, invoice('F-1', chairs('10', '48'), ref)]).findings[0];
    expect(vat).toMatchObject({ message: 'A1.price', fix: { before: '48', after: '40' } });
  });

  it('takes the price list price for A5, never for a discount taken twice', () => {
    const list = prices('T-1', [{ item: 'Lampe', price: '12.5' }]);
    const a5 = run([list, invoice('F-1', [{ item: 'Lampe', q: '4', price: '10' }])]).findings[0];
    expect(a5).toMatchObject({ message: 'A5.price', fix: { cell: 'D2', after: '12.5' } });
    const twice = run([list, invoice('F-1', [{ item: 'Lampe', q: '4', price: '10', off: 1_000 }])])
      .findings[0];
    expect(twice?.message).toBe('A3.reference');
    expect(twice?.fix).toBeUndefined();
  });

  it('proposes nothing when one cell would not say it all', () => {
    const fixes = (docs: Parameters<typeof run>[0]) => run(docs).findings.map((f) => f.fix);
    // A discount on the line: the price or the discount may be the part to change.
    expect(
      fixes([C118, invoice('F-1', [{ ...chairs('10', '32')[0], off: 2_000 } as never], ref)]),
    ).toEqual([undefined]);
    // Two invoices bill the order: which one to change is a person's call.
    expect(
      fixes([
        C118,
        invoice('F-1', chairs('5', '30'), ref),
        invoice('F-2', chairs('5', '30'), { ...ref, issueDate: '2026-09-12' }),
      ]),
    ).toEqual([undefined]);
    // A price the sheet does not map, and a reference no cell can hold exactly.
    const noCell = invoice('F-1', chairs('10', '30'), ref);
    noCell.lines = noCell.lines.map((l) => ({ ...l, priceCell: null }));
    expect(fixes([C118, noCell])).toEqual([undefined]);
    const thirds = order('C-118', [{ item: 'Chaise', q: '3', price: null, net: 10_000 }]);
    expect(fixes([thirds, invoice('F-1', chairs('3', '30'), ref)])).toEqual([undefined]);
  });

  it('writes a price in euros only when four decimals hold it', () => {
    expect(priceValue(4_000)).toBe('40');
    expect(priceValue(1_250.5)).toBe('12.505');
    expect(priceValue(10_000 / 3)).toBeNull();
  });
});

describe('patterns and learning (R7)', () => {
  const C = order('C-118', chairs('10'));
  const under = invoice('F-1', chairs('10', '30'), { orderRef: 'C-118' });
  const history = (item: string, price: string) =>
    ['2026-06-01', '2026-07-01', '2026-08-01'].map((issueDate, i) =>
      invoice(`H-${item}-${i}`, [{ item, q: '1', price }], { issueDate }),
    );

  it('says who a finding is about, and marks money not invoiced', () => {
    const [b1] = run([C, under]).findings;
    expect(b1?.scope).toEqual({ party: 'siren:123456789', itemId: 'item-chaise' });
    expect(b1?.short).toBe(true);
    const [b4] = run([C, invoice('F-1', chairs('10', '50'), { orderRef: 'C-118' })]).findings;
    expect(b4?.message).toBe('B4.price');
    expect(b4?.short).toBeUndefined();
    // A price under « Tarifs » bills short; above it, no.
    const list = prices('T-1', [{ item: 'Pot', price: '15' }]);
    const a5 = (price: string) =>
      run([list, invoice('F-2', [{ item: 'Pot', q: '10', price }])]).findings[0];
    expect(a5('10')?.short).toBe(true);
    expect(a5('20')?.short).toBeUndefined();
    // A sum or a VAT rate is never « normal »: no scope.
    const [a4] = run([
      ...history('Livre', '30').map((d) => ({
        ...d,
        lines: d.lines.map((l) => ({ ...l, vatRate: '5.5' })),
      })),
      invoice('F-3', [{ item: 'Livre', q: '1', price: '30' }]),
    ]).findings;
    expect(a4?.message).toBe('A4.rate');
    expect(a4?.scope).toBeUndefined();
  });

  it('names a customer by SIREN, else by name, else not at all', () => {
    expect(partyOf({ partySiren: '123456789', partyName: 'Durand' })).toBe('siren:123456789');
    expect(partyOf({ partySiren: null, partyName: ' Durand  S.A.R.L ' })).toBe(
      'name:durand s a r l',
    );
    expect(partyOf({ partySiren: null, partyName: null })).toBeNull();
  });

  it('keeps quiet a finding a person called normal, for its customer and article, until its end', () => {
    const exception: RuleException = {
      rule: 'B1',
      party: 'siren:123456789',
      itemId: 'item-chaise',
      until: '2026-12-31',
    };
    const check = (exceptions: RuleException[], today = TODAY) =>
      checkRegistry({ docs: [C, under], decisions: [], today, exceptions }).findings.map(
        (f) => f.message,
      );
    expect(check([])).toEqual(['B1.under']);
    expect(check([exception])).toEqual([]);
    // Every customer, no end.
    expect(check([{ ...exception, party: null, until: null }])).toEqual([]);
    // Another customer, another article, another rule, or ended.
    expect(check([{ ...exception, party: 'siren:999999999' }])).toEqual(['B1.under']);
    expect(check([{ ...exception, itemId: 'item-table' }])).toEqual(['B1.under']);
    expect(check([{ ...exception, rule: 'B7' as never }])).toEqual(['B1.under']);
    expect(check([exception], '2027-01-01')).toEqual(['B1.under']);
    // Its last day still counts.
    expect(check([exception], '2026-12-31')).toEqual([]);
    expect(excused({ rule: 'B1' }, [exception], TODAY)).toBe(false);
  });

  it('reads the articles a person tied as one, and follows a chain of them', () => {
    const docs = applySynonyms(
      [bought('A-1', [{ item: 'GM chaise chene', key: 'gm' }]), invoice('F-1', chairs('1'))],
      [
        { itemId: 'mid', aliasId: 'gm', status: 'confirmed' },
        { itemId: 'item-chaise', aliasId: 'mid', status: 'confirmed' },
        { itemId: 'item-table', aliasId: 'item-chaise', status: 'rejected' },
      ],
    );
    expect(docs.flatMap((d) => d.lines.map((l) => l.itemId))).toEqual([
      'item-chaise',
      'item-chaise',
    ]);
    // A loop of answers ends.
    const loop = applySynonyms(
      [invoice('F-1', [{ item: 'A' }])],
      [
        { itemId: 'item-b', aliasId: 'item-a', status: 'confirmed' },
        { itemId: 'item-a', aliasId: 'item-b', status: 'confirmed' },
      ],
    );
    expect(loop[0]?.lines[0]?.itemId).toBe('item-b');
  });

  it('compares names by their words', () => {
    expect(nameScore('Chaise chêne', 'GM - Chaises CHENE massif')).toBe(100);
    // One word in common is not enough when both names have two.
    expect(nameScore('Chaise chêne', 'Table chêne')).toBe(0);
    expect(nameScore('Chaise chêne pliante', 'Chaise chêne')).toBe(100);
    expect(nameScore('Chaise chêne pliante', 'Chaise chêne massive')).toBe(67);
    expect(nameScore('Chaise', 'Chaises')).toBe(100);
    expect(nameScore('Chaise', '')).toBe(0);
  });

  it('proposes a bought article for a sold one with no cost, then B2 finds its cost once tied', () => {
    const sale = invoice('F-1', [{ item: 'Chaise chêne', q: '10', price: '30' }]);
    const supplier = bought('A-1', [
      { item: 'GM chaise chene massif', key: 'gm-ch', q: '10', price: '35' },
      { item: 'Table chêne', key: 'gm-ta', q: '1', price: '200' },
    ]);
    const docs = [sale, supplier];
    const first = checkRegistry({ docs, decisions: [], today: TODAY });
    expect(first.findings).toEqual([]);
    expect(first.synonyms).toEqual([
      {
        itemId: 'item-chaise chêne',
        aliasId: 'gm-ch',
        itemName: 'Chaise chêne',
        aliasName: 'GM chaise chene massif',
        score: 100,
      },
    ]);
    const yes = checkRegistry({
      docs,
      decisions: [],
      today: TODAY,
      synonyms: [{ itemId: 'item-chaise chêne', aliasId: 'gm-ch', status: 'confirmed' }],
    });
    expect(yes.findings.map((f) => [f.message, f.amount])).toEqual([['B2.loss', 5_000]]);
    expect(yes.synonyms).toEqual([]);
    // « Non »: the pair is not asked again; the next closest name is not close enough.
    const no = checkRegistry({
      docs,
      decisions: [],
      today: TODAY,
      synonyms: [{ itemId: 'item-chaise chêne', aliasId: 'gm-ch', status: 'rejected' }],
    });
    expect(no.synonyms).toEqual([]);
  });

  it('proposes nothing for an article that has its cost, another unit, or no purchase', () => {
    const costed = [
      invoice('F-1', [{ item: 'Chaise', q: '1', price: '40' }]),
      invoice('F-2', [{ item: 'Chaise', q: '1', price: '40', key: 'item-chaise' }]),
      bought('A-1', [
        { item: 'Chaise', q: '1', price: '30' },
        { item: 'Chaise pliante', key: 'gm', q: '1', price: '20' },
      ]),
    ];
    const { costs } = findCosts(costed, []);
    expect(proposeSynonyms(costed, costs, [])).toEqual([]);
    const boxes = [
      invoice('F-1', [{ item: 'Vis inox', q: '100', price: '1', unit: 'H87' }]),
      bought('A-1', [{ item: 'Vis inox 4x40', key: 'gm', q: '1', price: '20', unit: 'XBX' }]),
    ];
    expect(proposeSynonyms(boxes, new Map(), [])).toEqual([]);
    expect(proposeSynonyms([invoice('F-1', chairs('1'))], new Map(), [])).toEqual([]);
  });
});
