// R2–R3 corpus: small companies' registries with the findings a person expects, money first. Each
// scenario says which rules it shows firing and which it shows staying quiet; corpus.test.ts runs them
// all and checks that every rule has both. Amounts are cents, quantities and prices decimal text.

import type {
  CheckDoc,
  CheckLine,
  CheckMessage,
  CheckRule,
  LinkDecision,
  LinkStatus,
  SheetCheck,
} from '../src/checks/types';
import { lineAmount } from '../src/money';

export interface CheckScenario {
  name: string;
  /** What it shows, in a sentence. */
  about: string;
  fires: CheckRule[];
  quiet: CheckRule[];
  docs: CheckDoc[];
  decisions?: LinkDecision[];
  today?: string;
  /** The company's margin in Réglages (B2). */
  minMarginPercent?: number;
  /** Exactly these findings: the message, the number of the document it is on, the cents. */
  expected: { message: CheckMessage; doc: string; amount: number | null }[];
  /** These links, by document numbers (others may exist). */
  links?: { from: string; to: string; status: LinkStatus }[];
}

interface L {
  item: string;
  q?: string | null;
  price?: string | null;
  /** The line's net amount when it is not quantity × price − discount. */
  net?: number | null;
  off?: number;
  rate?: string | null;
  /** The registry's item when it is not the name's (a supplier's own article). */
  key?: string;
  unit?: string;
}

const lines = (ls: L[]): CheckLine[] =>
  ls.map((l, i) => {
    const q = l.q === undefined ? '1' : l.q;
    const price = l.price === undefined ? null : l.price;
    const computed =
      q !== null && price !== null ? (lineAmount(q, price) ?? 0) - (l.off ?? 0) : null;
    return {
      position: i + 1,
      itemId: l.key ?? `item-${l.item.toLowerCase()}`,
      name: l.item,
      quantity: q,
      netPrice: price,
      netAmount: l.net === undefined ? computed : l.net,
      discount: l.off ?? null,
      vatRate: l.rate === undefined ? '20' : l.rate,
      ...(l.unit && { unitCode: l.unit }),
      cell: `B${i + 2}`,
      priceCell: `D${i + 2}`,
      rateCell: `E${i + 2}`,
    };
  });

const PARTY = { partySiren: '123456789', partyName: 'Durand SARL' };

function doc(kind: CheckDoc['kind'], number: string, ls: L[], o: Partial<CheckDoc>): CheckDoc {
  const ln = lines(ls);
  return {
    id: `${kind}:${number}`,
    direction: 'out',
    kind,
    typeCode: kind === 'invoice' ? '380' : null,
    isTest: false,
    number,
    issueDate: '2026-09-01',
    ...PARTY,
    orderRef: null,
    netTotal: ln.reduce((s, l) => s + (l.netAmount ?? 0), 0),
    prepaid: null,
    invoiceId: kind === 'invoice' ? `inv-${number}` : null,
    locked: false,
    sheet: {
      invoice: 'Factures',
      order: 'Commandes',
      delivery: 'Livraisons',
      purchase: 'Achats',
      price_list: 'Tarifs',
    }[kind],
    lines: ln,
    ...o,
  };
}

export const invoice = (number: string, ls: L[], o: Partial<CheckDoc> = {}) =>
  doc('invoice', number, ls, { issueDate: '2026-09-10', ...o });
export const order = (number: string, ls: L[], o: Partial<CheckDoc> = {}) =>
  doc('order', number, ls, o);
export const delivery = (number: string, ls: L[], o: Partial<CheckDoc> = {}) =>
  doc('delivery', number, ls, { issueDate: '2026-08-01', ...o });
export const prices = (number: string, ls: L[], o: Partial<CheckDoc> = {}) =>
  doc('price_list', number, ls, {
    issueDate: '2026-01-01',
    partySiren: null,
    partyName: null,
    ...o,
  });

/** A supplier invoice received through the platform: no sheet, no cell. */
export const bought = (number: string, ls: L[], o: Partial<CheckDoc> = {}) => {
  const d = doc('invoice', number, ls, {
    id: `in:${number}`,
    direction: 'in',
    issueDate: '2026-08-20',
    partySiren: '600000004',
    partyName: 'Grossiste Martin',
    invoiceId: null,
    sheet: null,
    ...o,
  });
  return {
    ...d,
    lines: d.lines.map((l) => ({ ...l, cell: null, priceCell: null, rateCell: null })),
  };
};
/** A row of the « Achats » sheet. */
export const purchase = (number: string, ls: L[], o: Partial<CheckDoc> = {}) =>
  doc('purchase', number, ls, {
    direction: 'in',
    issueDate: '2026-08-20',
    partySiren: null,
    partyName: 'Dupont Négoce',
    ...o,
  });

const C118 = order('C-118', [{ item: 'Chaise', q: '10', price: '40' }]);
const ref = { orderRef: 'C-118' };
const sheetCheck = (message: CheckMessage, cell: string, amount: number): SheetCheck => ({
  rule: message.slice(0, 2) as SheetCheck['rule'],
  message,
  cell,
  amount,
  // What src/sheet/build.ts writes; the values here only fill the wording.
  params: {
    invoice: 'F-1',
    cell,
    sheet: '1,00 €',
    computed: '1,00 €',
    amount: '1,00 €',
    rate: '20',
    discount: '1,00 €',
    percent: '10',
  },
});

export const CHECK_CORPUS: CheckScenario[] = [
  {
    name: 'b1-300-400',
    about: 'The plan’s example: order C-118 for 10 × 40 €, invoice F-2026-042 for the 10 at 300 €.',
    fires: ['B1'],
    quiet: [],
    docs: [C118, invoice('F-2026-042', [{ item: 'Chaise', q: '10', price: '30' }], ref)],
    expected: [{ message: 'B1.under', doc: 'F-2026-042', amount: 10_000 }],
    links: [{ from: 'C-118', to: 'F-2026-042', status: 'auto' }],
  },
  {
    name: 'b1-partial-invoice',
    about:
      'Half the order invoiced at the right price: the rest may come later, nothing is missing.',
    fires: [],
    quiet: ['B1', 'B4'],
    docs: [C118, invoice('F-1', [{ item: 'Chaise', q: '5', price: '40' }], ref)],
    expected: [],
  },
  {
    name: 'b1-two-invoices-complete',
    about: 'The order invoiced in two halves at the right price.',
    fires: [],
    quiet: ['B1', 'B5'],
    docs: [
      C118,
      invoice('F-1', [{ item: 'Chaise', q: '5', price: '40' }], ref),
      invoice('F-2', [{ item: 'Chaise', q: '5', price: '40' }], {
        ...ref,
        issueDate: '2026-09-20',
      }),
    ],
    expected: [],
  },
  {
    name: 'b1-second-invoice-under',
    about: 'The second half invoiced at 30 €: the shortfall goes on the latest invoice.',
    fires: ['B1'],
    quiet: ['B5'],
    docs: [
      C118,
      invoice('F-1', [{ item: 'Chaise', q: '5', price: '40' }], ref),
      invoice('F-2', [{ item: 'Chaise', q: '5', price: '30' }], {
        ...ref,
        issueDate: '2026-09-20',
      }),
    ],
    expected: [{ message: 'B1.several', doc: 'F-2', amount: 5_000 }],
  },
  {
    name: 'b1-rounding',
    about: '99 cents under on 3 × 33,33 €: a rounding, not money worth a look.',
    fires: [],
    quiet: ['B1'],
    docs: [
      order('C-7', [{ item: 'Tasse', q: '3', price: '33.33' }]),
      invoice('F-7', [{ item: 'Tasse', q: '3', price: '33' }], { orderRef: 'C-7' }),
    ],
    expected: [],
  },
  {
    name: 'b1-granted-discount',
    about:
      'A 40 € discount on the right price: under the order, a person says whether it was granted.',
    fires: ['B1'],
    quiet: ['A3'],
    docs: [C118, invoice('F-3', [{ item: 'Chaise', q: '10', price: '40', off: 4_000 }], ref)],
    expected: [{ message: 'B1.under', doc: 'F-3', amount: 4_000 }],
  },
  {
    name: 'b4-quantity',
    about: '12 chairs invoiced on an order of 10.',
    fires: ['B4'],
    quiet: [],
    docs: [C118, invoice('F-4', [{ item: 'Chaise', q: '12', price: '40' }], ref)],
    expected: [{ message: 'B4.quantity', doc: 'F-4', amount: 8_000 }],
  },
  {
    name: 'b4-price',
    about: '10 chairs at 45 € on an order at 40 €.',
    fires: ['B4'],
    quiet: ['A1'],
    docs: [C118, invoice('F-5', [{ item: 'Chaise', q: '10', price: '45' }], ref)],
    expected: [{ message: 'B4.price', doc: 'F-5', amount: 5_000 }],
  },
  {
    name: 'b4-exact',
    about: 'The invoice is the order.',
    fires: [],
    // A2 and the sheet's A1/A3 come from the invoice's own sheet: src/sheet/build.test.ts shows them.
    quiet: ['B1', 'B4', 'B5', 'B6', 'A1', 'A2', 'A3', 'A5'],
    docs: [C118, invoice('F-6', [{ item: 'Chaise', q: '10', price: '40' }], ref)],
    expected: [],
  },
  {
    name: 'b4-several-over-price',
    about: 'Two halves at 45 €: together 50 € above the order.',
    fires: ['B4'],
    quiet: ['B5'],
    docs: [
      C118,
      invoice('F-1', [{ item: 'Chaise', q: '5', price: '45' }], ref),
      invoice('F-2', [{ item: 'Chaise', q: '5', price: '45' }], {
        ...ref,
        issueDate: '2026-09-20',
      }),
    ],
    expected: [{ message: 'B4.several', doc: 'F-2', amount: 5_000 }],
  },
  {
    name: 'b4-delivery-billed-directly',
    about: 'An invoice that names a delivery note bills 5 where 3 were delivered.',
    fires: ['B4'],
    quiet: ['B3'],
    docs: [
      delivery('BL-9', [{ item: 'Palette', q: '3', price: '40' }]),
      invoice('F-9', [{ item: 'Palette', q: '5', price: '40' }], { orderRef: 'BL-9' }),
    ],
    expected: [{ message: 'B4.quantity', doc: 'F-9', amount: 8_000 }],
  },
  {
    name: 'b5-lines',
    about: 'The whole order invoiced twice.',
    fires: ['B5'],
    quiet: ['B4'],
    docs: [
      C118,
      invoice('F-1', [{ item: 'Chaise', q: '10', price: '40' }], ref),
      invoice('F-2', [{ item: 'Chaise', q: '10', price: '40' }], {
        ...ref,
        issueDate: '2026-09-20',
      }),
    ],
    expected: [{ message: 'B5.lines', doc: 'F-2', amount: 40_000 }],
  },
  {
    name: 'b5-lines-sent-first',
    about: 'The later invoice is already sent: the finding goes on the one that can still change.',
    fires: ['B5'],
    quiet: [],
    docs: [
      C118,
      invoice('F-1', [{ item: 'Chaise', q: '10', price: '40' }], ref),
      invoice('F-2', [{ item: 'Chaise', q: '10', price: '40' }], {
        ...ref,
        issueDate: '2026-09-20',
        locked: true,
      }),
    ],
    expected: [{ message: 'B5.lines', doc: 'F-1', amount: 40_000 }],
  },
  {
    name: 'b5-advance-not-deducted',
    about: 'A 120 € advance, then the full invoice without deducting it.',
    fires: ['B5'],
    quiet: [],
    docs: [
      C118,
      invoice('A-1', [{ item: 'Acompte', q: '1', price: '120' }], {
        ...ref,
        typeCode: '386',
        issueDate: '2026-09-02',
      }),
      invoice('F-10', [{ item: 'Chaise', q: '10', price: '40' }], {
        ...ref,
        issueDate: '2026-09-20',
      }),
    ],
    expected: [{ message: 'B5.total', doc: 'F-10', amount: 12_000 }],
  },
  {
    name: 'b5-advance-deducted',
    about: 'The same advance, deducted on the final invoice.',
    fires: [],
    quiet: ['B5'],
    docs: [
      C118,
      invoice('A-1', [{ item: 'Acompte', q: '1', price: '120' }], {
        ...ref,
        typeCode: '386',
        issueDate: '2026-09-02',
      }),
      invoice('F-10', [{ item: 'Chaise', q: '10', price: '40' }], {
        ...ref,
        issueDate: '2026-09-20',
        prepaid: 12_000,
      }),
    ],
    expected: [],
  },
  {
    name: 'b5-credit-note',
    about: 'Invoiced, cancelled by a credit note, invoiced again: billed once.',
    fires: [],
    quiet: ['B5', 'B4'],
    docs: [
      C118,
      invoice('F-1', [{ item: 'Chaise', q: '10', price: '40' }], ref),
      invoice('AV-1', [{ item: 'Chaise', q: '10', price: '40' }], {
        ...ref,
        typeCode: '381',
        issueDate: '2026-09-12',
      }),
      invoice('F-2', [{ item: 'Chaise', q: '10', price: '40' }], {
        ...ref,
        issueDate: '2026-09-20',
      }),
    ],
    expected: [],
  },
  {
    name: 'a1-vat-on-order-price',
    about: '48 € a chair on an order at 40 € HT: the TTC price typed as HT.',
    fires: ['A1'],
    quiet: ['B4'],
    docs: [C118, invoice('F-11', [{ item: 'Chaise', q: '10', price: '48' }], ref)],
    expected: [{ message: 'A1.price', doc: 'F-11', amount: 8_000 }],
  },
  {
    name: 'a1-order-sheet-ttc',
    about: 'The order sheet’s amount column holds the TTC; the invoice at the HT price is right.',
    fires: ['A1'],
    quiet: ['B1', 'B4'],
    docs: [
      order('C-12', [{ item: 'Chaise', q: '10', price: '40', net: 48_000 }]),
      invoice('F-12', [{ item: 'Chaise', q: '10', price: '40' }], { orderRef: 'C-12' }),
    ],
    expected: [{ message: 'A1.order', doc: 'C-12', amount: 8_000 }],
  },
  {
    name: 'a3-discount-twice-order',
    about: 'The price already lowered to 36 € and the 40 € discount taken again.',
    fires: ['A3'],
    quiet: ['B1'],
    docs: [C118, invoice('F-13', [{ item: 'Chaise', q: '10', price: '36', off: 4_000 }], ref)],
    expected: [{ message: 'A3.reference', doc: 'F-13', amount: 4_000 }],
  },
  {
    name: 'a5-price-list',
    about: 'No order: 22 € where « Tarifs » says 25 €.',
    fires: ['A5'],
    quiet: [],
    docs: [
      prices('T-1', [{ item: 'Carton', price: '25' }]),
      invoice('F-14', [{ item: 'Carton', q: '4', price: '22' }]),
    ],
    expected: [{ message: 'A5.price', doc: 'F-14', amount: 1_200 }],
  },
  {
    name: 'a5-list-price',
    about: 'The « Tarifs » price.',
    fires: [],
    quiet: ['A5'],
    docs: [
      prices('T-1', [{ item: 'Carton', price: '25' }]),
      invoice('F-15', [{ item: 'Carton', q: '4', price: '25' }]),
    ],
    expected: [],
  },
  {
    name: 'a5-order-wins',
    about: 'An order agreed 22 €: the order settles the price, not the list.',
    fires: [],
    quiet: ['A5'],
    docs: [
      prices('T-1', [{ item: 'Carton', price: '25' }]),
      order('C-16', [{ item: 'Carton', q: '4', price: '22' }]),
      invoice('F-16', [{ item: 'Carton', q: '4', price: '22' }], { orderRef: 'C-16' }),
    ],
    expected: [],
  },
  {
    name: 'a5-latest-list',
    about: 'Two lists: the latest price applies.',
    fires: [],
    quiet: ['A5'],
    docs: [
      prices('T-2', [{ item: 'Carton', price: '25' }], { issueDate: '2026-06-01' }),
      prices('T-1', [{ item: 'Carton', price: '20' }]),
      invoice('F-17', [{ item: 'Carton', q: '4', price: '25' }]),
    ],
    expected: [],
  },
  {
    name: 'a1-vat-on-list-price',
    about: 'No order: 30 € where the list says 25 € HT, 25 € plus 20 %.',
    fires: ['A1'],
    quiet: ['A5'],
    docs: [
      prices('T-1', [{ item: 'Carton', price: '25' }]),
      invoice('F-18', [{ item: 'Carton', q: '4', price: '30' }]),
    ],
    expected: [{ message: 'A1.price', doc: 'F-18', amount: 2_000 }],
  },
  {
    name: 'a3-discount-twice-list',
    about: 'The list says 50 €; 45 € and the 10 € discount taken again.',
    fires: ['A3'],
    quiet: ['A5'],
    docs: [
      prices('T-1', [{ item: 'Lampe', price: '50' }]),
      invoice('F-19', [{ item: 'Lampe', q: '2', price: '45', off: 1_000 }]),
    ],
    expected: [{ message: 'A3.reference', doc: 'F-19', amount: 1_000 }],
  },
  {
    name: 'a5-credit-note',
    about: 'A credit note is not judged against the list.',
    fires: [],
    quiet: ['A5'],
    docs: [
      prices('T-1', [{ item: 'Carton', price: '25' }]),
      invoice('AV-2', [{ item: 'Carton', q: '4', price: '22' }], { typeCode: '381' }),
    ],
    expected: [],
  },
  {
    name: 'a4-unusual-rate',
    about: 'A book always at 5,5 %, this time at 20 %.',
    fires: ['A4'],
    quiet: [],
    docs: [
      invoice('H-1', [{ item: 'Livre', price: '30', rate: '5.5' }], { issueDate: '2026-06-01' }),
      invoice('H-2', [{ item: 'Livre', price: '30', rate: '5.5' }], { issueDate: '2026-07-01' }),
      invoice('H-3', [{ item: 'Livre', price: '30', rate: '5.5' }], { issueDate: '2026-08-01' }),
      invoice('F-20', [{ item: 'Livre', price: '30', rate: '20' }]),
    ],
    expected: [{ message: 'A4.rate', doc: 'F-20', amount: 435 }],
  },
  {
    name: 'a4-short-history',
    about: 'Two earlier invoices are not a habit yet.',
    fires: [],
    quiet: ['A4'],
    docs: [
      invoice('H-1', [{ item: 'Livre', price: '30', rate: '5.5' }], { issueDate: '2026-06-01' }),
      invoice('H-2', [{ item: 'Livre', price: '30', rate: '5.5' }], { issueDate: '2026-07-01' }),
      invoice('F-21', [{ item: 'Livre', price: '30', rate: '20' }]),
    ],
    expected: [],
  },
  {
    name: 'a4-mixed-history',
    about: 'The article goes at both rates: no usual one.',
    fires: [],
    quiet: ['A4'],
    docs: [
      invoice('H-1', [{ item: 'Repas', price: '30', rate: '10' }], { issueDate: '2026-06-01' }),
      invoice('H-2', [{ item: 'Repas', price: '30', rate: '10' }], { issueDate: '2026-06-15' }),
      invoice('H-3', [{ item: 'Repas', price: '30', rate: '10' }], { issueDate: '2026-07-01' }),
      invoice('H-4', [{ item: 'Repas', price: '30', rate: '20' }], { issueDate: '2026-07-15' }),
      invoice('H-5', [{ item: 'Repas', price: '30', rate: '20' }], { issueDate: '2026-08-01' }),
      invoice('F-22', [{ item: 'Repas', price: '30', rate: '20' }]),
    ],
    expected: [],
  },
  {
    name: 'b3-unbilled',
    about: '5 pallets delivered on 1 August, nothing invoiced on 20 October.',
    fires: ['B3'],
    quiet: [],
    docs: [delivery('BL-7', [{ item: 'Palette', q: '5', price: '40' }])],
    expected: [{ message: 'B3.unbilled', doc: 'BL-7', amount: 20_000 }],
  },
  {
    name: 'b3-recent',
    about: 'Delivered ten days ago: not late yet.',
    fires: [],
    quiet: ['B3'],
    docs: [
      delivery('BL-8', [{ item: 'Palette', q: '5', price: '40' }], { issueDate: '2026-10-10' }),
    ],
    expected: [],
  },
  {
    name: 'b3-billed',
    about: 'Delivered against the order, and the order invoiced.',
    fires: [],
    quiet: ['B3'],
    docs: [
      C118,
      delivery('BL-1', [{ item: 'Chaise', q: '10' }], ref),
      invoice('F-23', [{ item: 'Chaise', q: '10', price: '40' }], ref),
    ],
    expected: [],
  },
  {
    name: 'b3-partly-billed',
    about:
      'Two deliveries of 6 and 4, one invoice of 6: the second delivery waits, at the order’s price.',
    fires: ['B3'],
    quiet: ['B1'],
    docs: [
      C118,
      delivery('BL-1', [{ item: 'Chaise', q: '6' }], ref),
      delivery('BL-2', [{ item: 'Chaise', q: '4' }], { ...ref, issueDate: '2026-08-20' }),
      invoice('F-24', [{ item: 'Chaise', q: '6', price: '40' }], ref),
    ],
    expected: [{ message: 'B3.unbilled', doc: 'BL-2', amount: 16_000 }],
  },
  {
    name: 'b3-no-price',
    about: 'Delivered, never invoiced, and no price anywhere: the delay without an amount.',
    fires: ['B3'],
    quiet: [],
    docs: [delivery('BL-3', [{ item: 'Sac', q: '2' }], { partySiren: null })],
    expected: [{ message: 'B3.unbilledNoAmount', doc: 'BL-3', amount: null }],
  },
  {
    name: 'b3-billed-directly',
    about: 'The invoice names the delivery note itself.',
    fires: [],
    quiet: ['B3', 'B4'],
    docs: [
      delivery('BL-4', [{ item: 'Palette', q: '3', price: '40' }]),
      invoice('F-25', [{ item: 'Palette', q: '3', price: '40' }], { orderRef: 'BL-4' }),
    ],
    expected: [],
  },
  {
    name: 'b6-siren',
    about: 'The invoice names order C-26 but another company’s SIREN.',
    fires: ['B6'],
    quiet: ['B1'],
    docs: [
      order('C-26', [{ item: 'Chaise', q: '10', price: '40' }], { partySiren: '111111111' }),
      invoice('F-26', [{ item: 'Chaise', q: '10', price: '40' }], {
        orderRef: 'C-26',
        partySiren: '222222222',
      }),
    ],
    expected: [{ message: 'B6.siren', doc: 'F-26', amount: 40_000 }],
  },
  {
    name: 'b6-name',
    about: 'No SIREN on either side, and two different names.',
    fires: ['B6'],
    quiet: [],
    docs: [
      order('C-27', [{ item: 'Chaise', q: '10', price: '40' }], { partySiren: null }),
      invoice('F-27', [{ item: 'Chaise', q: '10', price: '40' }], {
        orderRef: 'C-27',
        partySiren: null,
        partyName: 'Martin & Fils',
      }),
    ],
    expected: [{ message: 'B6.name', doc: 'F-27', amount: 40_000 }],
  },
  {
    name: 'b6-name-variant',
    about: '« DURAND » and « Durand SARL » are the same customer.',
    fires: [],
    quiet: ['B6'],
    docs: [
      order('C-28', [{ item: 'Chaise', q: '10', price: '40' }], { partySiren: null }),
      invoice('F-28', [{ item: 'Chaise', q: '10', price: '40' }], {
        orderRef: 'C-28',
        partySiren: null,
        partyName: 'DURAND',
      }),
    ],
    expected: [],
  },
  {
    name: 'sheet-checks',
    about: 'What the invoice’s own sheet showed: a typed total, a discount twice, a TTC column.',
    fires: ['A1', 'A2', 'A3'],
    quiet: [],
    docs: [
      invoice('F-1', [{ item: 'Chaise', q: '10', price: '40' }], {
        sheetChecks: [
          sheetCheck('A2.line', 'F5', 5_000),
          sheetCheck('A3.twice', 'G5', 4_000),
          sheetCheck('A1.sheet', 'F6', 800),
          sheetCheck('A2.total', 'F9', 5_000),
          sheetCheck('A3.percent', 'G7', 900),
        ],
      }),
    ],
    expected: [
      { message: 'A2.line', doc: 'F-1', amount: 5_000 },
      { message: 'A2.total', doc: 'F-1', amount: 5_000 },
      { message: 'A3.twice', doc: 'F-1', amount: 4_000 },
      { message: 'A3.percent', doc: 'F-1', amount: 900 },
      { message: 'A1.sheet', doc: 'F-1', amount: 800 },
    ],
  },
  {
    name: 'test-invoice-apart',
    about: 'A test invoice of the whole order next to the real one: not invoiced twice.',
    fires: [],
    quiet: ['B5'],
    docs: [
      C118,
      invoice('F-29', [{ item: 'Chaise', q: '10', price: '40' }], ref),
      invoice('TEST-1', [{ item: 'Chaise', q: '10', price: '40' }], { ...ref, isTest: true }),
    ],
    expected: [],
  },
  {
    name: 'test-invoice-under',
    about: 'A test invoice is checked against the sheets like a real one.',
    fires: ['B1'],
    quiet: [],
    docs: [
      C118,
      invoice('TEST-2', [{ item: 'Chaise', q: '10', price: '30' }], { ...ref, isTest: true }),
    ],
    expected: [{ message: 'B1.under', doc: 'TEST-2', amount: 10_000 }],
  },
  {
    name: 'link-by-articles',
    about: 'No order number on the invoice: same customer, same articles and quantities.',
    fires: ['B1'],
    quiet: [],
    docs: [C118, invoice('F-30', [{ item: 'Chaise', q: '10', price: '30' }])],
    expected: [{ message: 'B1.under', doc: 'F-30', amount: 10_000 }],
    links: [{ from: 'C-118', to: 'F-30', status: 'auto' }],
  },
  {
    name: 'link-ambiguous',
    about: 'Two identical orders and no number: proposed to a person, no finding meanwhile.',
    fires: [],
    quiet: ['B1'],
    docs: [
      C118,
      order('C-119', [{ item: 'Chaise', q: '10', price: '40' }], { issueDate: '2026-09-02' }),
      invoice('F-31', [{ item: 'Chaise', q: '10', price: '30' }]),
    ],
    expected: [],
    links: [
      { from: 'C-118', to: 'F-31', status: 'proposed' },
      { from: 'C-119', to: 'F-31', status: 'proposed' },
    ],
  },
  {
    name: 'link-confirmed',
    about: 'A person said which of the two orders the invoice bills.',
    fires: ['B1'],
    quiet: [],
    docs: [
      C118,
      order('C-119', [{ item: 'Chaise', q: '10', price: '40' }], { issueDate: '2026-09-02' }),
      invoice('F-32', [{ item: 'Chaise', q: '10', price: '30' }]),
    ],
    decisions: [
      { kind: 'billed_by', fromDocId: 'order:C-119', toDocId: 'invoice:F-32', status: 'confirmed' },
    ],
    expected: [{ message: 'B1.under', doc: 'F-32', amount: 10_000 }],
    links: [{ from: 'C-119', to: 'F-32', status: 'confirmed' }],
  },
  {
    name: 'link-one-refused',
    about: 'Of two identical orders a person said « Non » to one: the other is the one.',
    fires: ['B1'],
    quiet: [],
    docs: [
      C118,
      order('C-119', [{ item: 'Chaise', q: '10', price: '40' }], { issueDate: '2026-09-02' }),
      invoice('F-34', [{ item: 'Chaise', q: '10', price: '30' }]),
    ],
    decisions: [
      { kind: 'billed_by', fromDocId: 'order:C-118', toDocId: 'invoice:F-34', status: 'rejected' },
    ],
    expected: [{ message: 'B1.under', doc: 'F-34', amount: 10_000 }],
    links: [{ from: 'C-119', to: 'F-34', status: 'auto' }],
  },
  {
    name: 'link-rejected',
    about: 'A person said the number on the invoice is not that order.',
    fires: [],
    quiet: ['B1'],
    docs: [C118, invoice('F-33', [{ item: 'Chaise', q: '10', price: '30' }], ref)],
    decisions: [
      { kind: 'billed_by', fromDocId: 'order:C-118', toDocId: 'invoice:F-33', status: 'rejected' },
    ],
    expected: [],
  },
  {
    name: 'b2-300-400-bought-35',
    about:
      'The plan’s example with its purchase: the supplier billed the 10 chairs 35 € each, the invoice sells them 30 €.',
    fires: ['B1', 'B2'],
    quiet: [],
    docs: [
      C118,
      invoice('F-2026-042', [{ item: 'Chaise', q: '10', price: '30' }], ref),
      bought('FA-77', [{ item: 'Chaise', q: '10', price: '35' }]),
    ],
    expected: [
      { message: 'B1.under', doc: 'F-2026-042', amount: 10_000 },
      { message: 'B2.loss', doc: 'F-2026-042', amount: 5_000 },
    ],
    links: [
      { from: 'C-118', to: 'F-2026-042', status: 'auto' },
      { from: 'FA-77', to: 'F-2026-042', status: 'auto' },
    ],
  },
  {
    name: 'b2-achats-by-name',
    about:
      'A row of « Achats » with the supplier’s own article, the same name as the one sold: 35 € bought, 32 € sold.',
    fires: ['B2'],
    quiet: [],
    docs: [
      purchase('A-3', [
        {
          item: 'Chaise pliante',
          key: 'supplier:name:dupont negoce:name:chaise pliante',
          q: '20',
          price: '35',
        },
      ]),
      invoice('F-50', [{ item: 'Chaise  pliante.', q: '10', price: '32' }]),
    ],
    expected: [{ message: 'B2.loss', doc: 'F-50', amount: 3_000 }],
    links: [{ from: 'A-3', to: 'F-50', status: 'auto' }],
  },
  {
    name: 'b2-above-cost-and-margin',
    about: 'Bought 25 €, sold 30 €: a 16.7 % margin, above the 15 % the company asks for.',
    fires: [],
    quiet: ['B2'],
    minMarginPercent: 15,
    docs: [
      bought('FA-80', [{ item: 'Chaise', q: '10', price: '25' }]),
      invoice('F-51', [{ item: 'Chaise', q: '10', price: '30' }]),
    ],
    expected: [],
    links: [{ from: 'FA-80', to: 'F-51', status: 'auto' }],
  },
  {
    name: 'b2-margin-warning',
    about: 'Bought 25 €, sold 30 € when the company asks for 25 %: 33,33 € a chair would keep it.',
    fires: ['B2'],
    quiet: [],
    minMarginPercent: 25,
    docs: [
      bought('FA-80', [{ item: 'Chaise', q: '10', price: '25' }]),
      invoice('F-52', [{ item: 'Chaise', q: '10', price: '30' }]),
    ],
    expected: [{ message: 'B2.margin', doc: 'F-52', amount: 3_333 }],
  },
  {
    name: 'b2-latest-purchase',
    about:
      'The latest purchase before the sale gives the cost (28 €, not 40 € in June nor 45 € after); a sale before any purchase takes the first one after it.',
    fires: ['B2'],
    quiet: [],
    docs: [
      bought('FA-81', [{ item: 'Chaise', q: '10', price: '40' }], { issueDate: '2026-06-01' }),
      bought('FA-82', [{ item: 'Chaise', q: '10', price: '28' }], { issueDate: '2026-09-05' }),
      bought('FA-83', [{ item: 'Chaise', q: '10', price: '45' }], { issueDate: '2026-09-20' }),
      invoice('F-53', [{ item: 'Chaise', q: '10', price: '30' }]),
      invoice('F-54', [{ item: 'Chaise', q: '10', price: '30' }], { issueDate: '2026-05-01' }),
    ],
    expected: [{ message: 'B2.loss', doc: 'F-54', amount: 10_000 }],
    links: [
      { from: 'FA-82', to: 'F-53', status: 'auto' },
      { from: 'FA-81', to: 'F-54', status: 'auto' },
    ],
  },
  {
    name: 'b2-test-purchases-apart',
    about:
      'A « Mode test » supplier invoice gives its cost to a test invoice, never to a real one.',
    fires: ['B2'],
    quiet: [],
    docs: [
      bought('TEST-FD-1', [{ item: 'Chaise', q: '10', price: '35' }], { isTest: true }),
      invoice('F-55', [{ item: 'Chaise', q: '10', price: '30' }]),
      invoice('TEST-3', [{ item: 'Chaise', q: '10', price: '30' }], { isTest: true }),
    ],
    expected: [{ message: 'B2.loss', doc: 'TEST-3', amount: 5_000 }],
  },
  {
    name: 'b2-rejected-cost',
    about:
      'A person said the September purchase is not this article: the August one, 28 €, gives the cost.',
    fires: [],
    quiet: ['B2'],
    docs: [
      bought('FA-89', [{ item: 'Chaise', q: '10', price: '28' }], { issueDate: '2026-08-01' }),
      bought('FA-90', [{ item: 'Chaise', q: '10', price: '35' }], { issueDate: '2026-09-05' }),
      invoice('F-56', [{ item: 'Chaise', q: '10', price: '30' }]),
    ],
    decisions: [
      { kind: 'cost', fromDocId: 'in:FA-90', toDocId: 'invoice:F-56', status: 'rejected' },
    ],
    expected: [],
    links: [{ from: 'FA-89', to: 'F-56', status: 'auto' }],
  },
  {
    name: 'b2-not-a-cost',
    about:
      'A box of chairs, a supplier’s credit note and a purchase in dollars are no cost for chairs sold by the piece in euros; a credit note sells nothing.',
    fires: [],
    quiet: ['B2'],
    docs: [
      bought('FA-91', [{ item: 'Chaise', q: '1', price: '320', unit: 'XBX' }]),
      bought('AV-92', [{ item: 'Chaise', q: '10', price: '50' }], { typeCode: '381' }),
      bought('FA-93', [{ item: 'Chaise', q: '10', price: '50' }], { currency: 'USD' }),
      invoice('F-57', [{ item: 'Chaise', q: '10', price: '30', unit: 'H87' }]),
      bought('FA-94', [{ item: 'Table', q: '1', price: '200' }]),
      invoice('AV-58', [{ item: 'Table', q: '1', price: '150' }], { typeCode: '381' }),
    ],
    expected: [],
  },
];
