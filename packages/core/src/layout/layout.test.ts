import { describe, expect, it } from 'vitest';
import { type GridCell, grid } from '../sheet/grid';
import {
  detectKind,
  detectLayout,
  headerSignature,
  headerSignatures,
  kindFromName,
  layoutHeaderScore,
  layoutWarnings,
} from './detect';
import { fieldAllowed, type LayoutMapping } from './fields';
import { readLayout } from './read';

const d = (serial: number, text: string): GridCell => ({ v: serial, t: text, f: 'dd/mm/yyyy' });
const OCT1 = d(46296, '01/10/2026');
const OCT2 = d(46297, '02/10/2026');
const columns = (layout: LayoutMapping) =>
  Object.fromEntries(Object.entries(layout.mapping).map(([f, m]) => [f, m?.column]));

describe('the kind of a sheet', () => {
  it('reads it in the sheet name, purchases first', () => {
    expect(kindFromName('Commandes')).toBe('order');
    expect(kindFromName('Commandes fournisseurs')).toBe('purchase');
    expect(kindFromName('BL 2026')).toBe('delivery');
    expect(kindFromName('Achats')).toBe('purchase');
    expect(kindFromName('Tarifs')).toBe('price_list');
    expect(kindFromName('Factures')).toBe('invoice');
    expect(kindFromName('Feuil3')).toBeNull();
  });

  it('reads it in the headers when the name says nothing, and asks when they disagree', () => {
    const delivery = grid('Feuil2', [['N° BL', 'Date', 'Client', 'Désignation', 'Qté livrée']]);
    expect(detectKind(delivery, 1)).toEqual({ kind: 'delivery', confidence: 0.8 });
    const purchase = grid('Feuil3', [['N° commande', 'Fournisseur', 'Article', 'Prix d’achat']]);
    expect(detectKind(purchase, 1).kind).toBe('purchase');
    const prices = grid('Feuil4', [['Réf.', 'Article', 'Prix de vente HT']]);
    expect(detectKind(prices, 1).kind).toBe('price_list');
    const orders = grid('Feuil5', [['N° commande', 'Date', 'Client', 'Article', 'Qté']]);
    expect(detectKind(orders, 1).kind).toBe('order');
    const invoices = grid('Feuil6', [['N° facture', 'Date', 'Client', 'Échéance']]);
    expect(detectKind(invoices, 1).kind).toBe('invoice');
    const mixed = grid('Commandes', [['N° BL', 'Client', 'Qté livrée']]);
    // An order sheet may number the delivery notes of its orders: the name wins, the pane asks.
    expect(detectKind(mixed, 1)).toEqual({ kind: 'order', confidence: 0.6 });
    expect(layoutHeaderScore('N° BL', 'docNumber', 'order')).toBe(0);
    expect(detectKind(grid('Feuil7', [['A', 'B']]), 1)).toEqual({ kind: 'other', confidence: 0.5 });
  });
});

describe('the columns of a layout', () => {
  it('maps an order sheet below its title rows', () => {
    const layout = detectLayout(
      grid('Commandes', [
        ['CARNET DE COMMANDES — OCTOBRE'],
        [],
        [
          'N° commande',
          'Date commande',
          'Client',
          'SIREN',
          'Réf. article',
          'Désignation',
          'Qté commandée',
          'PU HT',
          'Date de livraison souhaitée',
          'TVA',
        ],
        [
          'C-118',
          OCT1,
          'Boulangerie Martin',
          '200000008',
          'VIS-6',
          'Vis inox 6 mm',
          400,
          0.2,
          OCT2,
          20,
        ],
      ]),
    );
    expect(layout).toMatchObject({ kind: 'order', kindConfidence: 0.95, headerRow: 3 });
    expect(columns(layout)).toEqual({
      docNumber: 'A',
      docDate: 'B',
      partyName: 'C',
      partySiren: 'D',
      itemRef: 'E',
      itemName: 'F',
      quantity: 'G',
      unitPrice: 'H',
      vatRate: 'J',
    });
    expect(layout.warnings).toEqual([]);
  });

  it('tells the delivered order from the delivery note, and the delivered quantity from the ordered one', () => {
    const layout = detectLayout(
      grid('BL', [
        ['N° BL', 'Livré le', 'N° commande', 'Client', 'Code', 'Article', 'Qté cdée', 'Qté livrée'],
        ['BL-77', OCT2, 'C-118', 'Boulangerie Martin', 'VIS-6', 'Vis inox 6 mm', 400, 380],
      ]),
    );
    expect(layout.kind).toBe('delivery');
    expect(columns(layout)).toMatchObject({
      docNumber: 'A',
      docDate: 'B',
      orderRef: 'C',
      partyName: 'D',
      itemRef: 'E',
      itemName: 'F',
      quantity: 'H',
    });
    expect(layout.mapping.itemRef?.needsConfirmation).toBe(true);
  });

  it('takes the supplier and the purchase price on a purchase sheet, never the sale price', () => {
    const layout = detectLayout(
      grid('Achats', [
        [
          'N° commande',
          'Date',
          'Fournisseur',
          'Réf. fournisseur',
          'Désignation',
          'Qté',
          'Prix de vente',
          'Prix d’achat HT',
        ],
        ['A-12', OCT1, 'Visserie du Centre', 'VC-6', 'Vis inox 6 mm', 1000, 0.2, 0.08],
      ]),
    );
    expect(layout.kind).toBe('purchase');
    expect(columns(layout)).toMatchObject({
      docNumber: 'A',
      partyName: 'C',
      itemRef: 'D',
      unitPrice: 'H',
    });
    expect(layoutHeaderScore('Client', 'partyName', 'purchase')).toBeLessThan(0.8);
  });

  it('reads a price list as the company own prices, without number, date or company', () => {
    const layout = detectLayout(
      grid('Tarifs', [
        [
          'Mise à jour',
          'Réf. article',
          'Désignation',
          'Prix d’achat',
          'Prix de vente HT',
          'Client',
        ],
        [OCT1, 'VIS-6', 'Vis inox 6 mm', 0.08, 0.2, 'Tous'],
      ]),
    );
    expect(layout.kind).toBe('price_list');
    expect(columns(layout)).toEqual({ itemRef: 'B', itemName: 'C', unitPrice: 'E' });
    expect(layout.warnings).toEqual([]);
  });

  it('never takes a customer code, an invoice number or a later date for the document', () => {
    expect(layoutHeaderScore('Code client', 'partyName', 'order')).toBe(0);
    expect(layoutHeaderScore('N° client', 'docNumber', 'order')).toBe(0);
    expect(layoutHeaderScore('N° facture', 'docNumber', 'order')).toBe(0);
    expect(layoutHeaderScore('Fournisseur', 'partyName', 'order')).toBe(0);
    expect(layoutHeaderScore('Date de livraison', 'docDate', 'order')).toBeLessThan(0.8);
    expect(layoutHeaderScore('Date de livraison', 'docDate', 'delivery')).toBe(0.95);
    expect(layoutHeaderScore('Date commande', 'docDate', 'delivery')).toBeLessThan(0.8);
    expect(layoutHeaderScore('Reliquat', 'quantity', 'delivery')).toBe(0);
    expect(layoutHeaderScore('Qté', 'quantity', 'order')).toBe(0.95);
    expect(layoutHeaderScore('Qté livrée', 'quantity', 'order')).toBeLessThan(0.8);
    expect(layoutHeaderScore('Prix d’achat', 'unitPrice', 'order')).toBe(0);
    expect(layoutHeaderScore('PV HT', 'unitPrice', 'price_list')).toBe(0.95);
    expect(layoutHeaderScore('', 'itemName', 'order')).toBe(0);
    expect(fieldAllowed('order', 'orderRef')).toBe(false);
  });

  it('keeps a « TVA » column of amounts out of the rate', () => {
    const layout = detectLayout(
      grid('Commandes', [
        ['N° commande', 'Client', 'Article', 'Qté', 'PU HT', 'TVA'],
        ['C-1', 'Martin', 'Vis', 2, 10, 4],
        ['C-2', 'Roux', 'Écrou', 1, 25, 5],
      ]),
    );
    expect(layout.mapping.vatRate).toBeUndefined();
  });

  it('says what is missing, and what it cannot read', () => {
    const layout = detectLayout(
      grid('Commandes', [
        ['Client', 'Article'],
        ['Martin', 'Vis'],
      ]),
    );
    expect(layout.warnings).toEqual([
      'Colonne introuvable : Numéro du document. Indiquez-la si votre feuille la contient.',
      'Colonne introuvable : Date du document. Indiquez-la si votre feuille la contient.',
      'Colonne introuvable : Quantité. Indiquez-la si votre feuille la contient.',
      'Colonne introuvable : Prix unitaire HT. Indiquez-la si votre feuille la contient.',
    ]);
    expect(
      layoutWarnings('price_list', {
        lineNet: { column: 'C', confidence: 1, needsConfirmation: false },
      }),
    ).toEqual([
      'Colonne introuvable : Prix unitaire HT. Indiquez-la si votre feuille la contient.',
    ]);
    expect(
      layoutWarnings('order', {
        lineNet: { column: 'C', confidence: 1, needsConfirmation: false },
      }),
    ).not.toContain(
      'Colonne introuvable : Prix unitaire HT. Indiquez-la si votre feuille la contient.',
    );
    expect(layoutWarnings('other', {})[0]).toMatch(/ne reconnaissons pas/);
    expect(layoutWarnings('invoice', {})[0]).toMatch(/feuille de factures/);
    const unknown = detectLayout(grid('Feuil1', [['x'], ['y']]));
    expect(unknown).toMatchObject({ kind: 'other', headerRow: 1, mapping: {} });
    expect(detectLayout({ sheet: 'Vide', rows: [] }).headerRow).toBe(1);
  });
});

describe('the signature of a layout', () => {
  const sheet = grid('Commandes', [
    ['Commandes'],
    ['N° commande', ' Date ', 'Client'],
    ['C-1', OCT1, 'Martin'],
  ]);

  it('is the header labels column by column, whatever their case and accents', () => {
    expect(headerSignature(sheet, 2)).toBe('A=n commande|B=date|C=client');
    const same = grid('Autre', [['N° COMMANDE', 'date', 'CLIENT']]);
    expect(headerSignature(same, 1)).toBe(headerSignature(sheet, 2));
    expect(headerSignature(sheet, 1)).toBeNull();
    expect(headerSignature(sheet, 9)).toBeNull();
  });

  it('is offered for every row a header could be on', () => {
    expect(headerSignatures(sheet).map((s) => s.row)).toEqual([2, 3]);
  });
});

describe('reading a layout', () => {
  const orders = grid('Commandes', [
    [
      'N° commande',
      'Date',
      'Client',
      'SIRET',
      'Réf.',
      'Désignation',
      'Qté',
      'Unité',
      'PU HT',
      'Montant HT',
      'TVA',
    ],
    [
      'C-118',
      OCT1,
      'Boulangerie Martin',
      '20000000800012',
      'VIS-6',
      'Vis inox 6 mm',
      400,
      'pièce',
      0.2,
      null,
      0.2,
    ],
    [
      null,
      null,
      null,
      null,
      'ECR-6',
      'Écrou 6 mm',
      400,
      'pièce',
      0.1,
      40,
      { v: 0.2, t: '20%', f: '0%' },
    ],
    ['C-119', OCT2, 'Garage des Lilas', '300000007', null, 'Pose', null, 'h', 45, null, 20],
    [null, null, null, null, null, null, null, null, null, null, null],
    ['Total', null, null, null, null, null, null, null, null, 165, null],
    [null, null, null, null, null, null, null, null, null, null, null, 'note : relancer'],
    ['C-118', null, null, null, 'RON-6', 'Rondelle', 400, null, '0,05', null, null],
  ]);
  const layout = detectLayout(orders);

  it('groups the lines of each order, the number repeated or left blank', () => {
    const reading = readLayout(orders, layout);
    expect(reading.rows).toBe(6);
    expect(reading.ignoredRows).toEqual([6]);
    expect(reading.unreadRows).toEqual([7]);
    expect(reading.docs.map((doc) => [doc.key, doc.rows])).toEqual([
      ['C-118', [2, 3, 8]],
      ['C-119', [4]],
    ]);
    const [c118, c119] = reading.docs;
    expect(c118).toMatchObject({
      number: 'C-118',
      date: '2026-10-01',
      partyName: 'Boulangerie Martin',
      partySiren: '200000008',
      cell: 'Commandes!A2',
    });
    expect(c118?.lines).toEqual([
      {
        row: 2,
        cell: 'Commandes!F2',
        itemRef: 'VIS-6',
        itemName: 'Vis inox 6 mm',
        quantity: '400',
        unit: 'H87',
        unitPrice: '0.2',
        vatRate: '20',
        netAmount: 8000,
      },
      expect.objectContaining({ row: 3, itemRef: 'ECR-6', netAmount: 4000, vatRate: '20' }),
      expect.objectContaining({ row: 8, unitPrice: '0.05', netAmount: 2000 }),
    ]);
    // No quantity: one unit.
    expect(c119?.lines[0]).toMatchObject({ unit: 'HUR', netAmount: 4500 });
    expect(c119?.partySiren).toBe('300000007');
  });

  it('makes a row without a number its own document, and reads a price list as one document', () => {
    const loose = grid('BL', [
      ['N° BL', 'Article', 'Qté livrée'],
      [null, 'Vis', 3],
      ['BL-1', 'Écrou', 2],
    ]);
    const docs = readLayout(loose, detectLayout(loose)).docs;
    expect(docs.map((doc) => doc.key)).toEqual(['row:2', 'BL-1']);
    expect(docs[0]?.lines[0]).toMatchObject({ netAmount: null, cell: 'BL!B2' });

    const prices = grid('Tarifs', [
      ['Réf. article', 'Désignation', 'Prix de vente HT', 'TVA'],
      ['VIS-6', 'Vis inox 6 mm', 0.2, 20],
      [null, null, null, 20],
      ['ECR-6', 'Écrou 6 mm', 0.1, 20],
      ['QUINCAILLERIE', null, null, null],
      [null, 'Rondelle 6 mm', 0.05, 20],
    ]);
    const list = readLayout(prices, detectLayout(prices));
    expect(list.docs).toHaveLength(1);
    expect(list.docs[0]).toMatchObject({ key: 'sheet', rows: [2, 4, 6], cell: 'Tarifs!A2' });
    expect(list.docs[0]?.lines.map((l) => l.netAmount)).toEqual([20, 10, 5]);
    expect(list.unreadRows).toEqual([3]);
    // A section title is not an article.
    expect(list.ignoredRows).toEqual([5]);
  });

  it('points a document without its number at its first value', () => {
    const sheet = grid('Commandes', [
      ['Client', 'Article'],
      ['Martin', 'Vis'],
    ]);
    expect(readLayout(sheet, detectLayout(sheet)).docs[0]?.cell).toBe('Commandes!A2');
    const blank = grid('Commandes', [
      ['N° commande', 'Article'],
      [null, null],
    ]);
    expect(readLayout(blank, detectLayout(blank)).docs).toEqual([]);
  });
});
