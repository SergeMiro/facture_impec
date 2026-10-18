// The layout drawn on a fake document that records every text, with fonts whose width is
// proportional to the length: what the page says, not how pdf-lib encodes it (pdf.test.ts).
import type { PDFDocument, PDFFont } from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { computeGolden, golden } from '../../test/fixtures';
import type { Invoice, Line } from '../model';
import { NBSP } from './format';
import { renderInvoice } from './render';

interface Drawn {
  text: string;
  x: number;
  y: number;
  size: number;
}

const width = (text: string, size: number) => text.length * size * 0.5;
const font = { widthOfTextAtSize: width } as unknown as PDFFont;

function render(inv: Invoice): Drawn[][] {
  const pages: Drawn[][] = [];
  const doc = {
    addPage: () => {
      const page: Drawn[] = [];
      pages.push(page);
      return {
        drawText: (text: string, o: Drawn) => page.push({ text, x: o.x, y: o.y, size: o.size }),
        drawRectangle: () => {},
        drawLine: () => {},
      };
    },
  } as unknown as PDFDocument;
  renderInvoice(doc, { regular: font, bold: font }, inv);
  return pages;
}

const texts = (pages: Drawn[][]) => pages.flat().map((d) => d.text.replaceAll(NBSP, ' '));
const base = (name = '01-services-standard-rate') => computeGolden(golden(name));
const line = (inv: Invoice, patch: Partial<Line>): Line => ({
  ...(inv.lines[0] as Line),
  ...patch,
});

describe('renderInvoice', () => {
  it('draws the invoice: parties, lines, VAT, totals, payment, mentions, footer', () => {
    const all = texts(render(base()));
    expect(all).toEqual(
      expect.arrayContaining([
        'Atelier Dupont SARL',
        'SIRET : 10000000900017',
        'Facture',
        'N° F2026-0042',
        'Date de la facture : 15/10/2026',
        'Échéance : 14/11/2026',
        'CLIENT',
        'Boulangerie Martin SAS',
        'SIREN : 200000008',
        'N° TVA : FR37200000008',
        'Journée de conseil en organisation',
        '3 j',
        '450,00 €',
        '20 %',
        '1 350,00 €',
        'Total TTC',
        'Net à payer',
        '1 620,00 €',
        'IBAN : FR76 3000 6000 0112 3456 7890 189',
        'Mentions',
        'Page 1 / 1',
      ]),
    );
    expect(all).not.toContain('Total des lignes HT');
  });

  it.each([
    ['381', 'Avoir'],
    ['384', 'Facture rectificative'],
    ['386', "Facture d'acompte"],
    ['999', 'Facture'],
  ])('titles a type %s "%s"', (typeCode, title) => {
    expect(texts(render({ ...base(), typeCode }))[texts(render(base())).indexOf('Facture')]).toBe(
      title,
    );
  });

  it('names the invoice a credit note or a corrective invoice refers to', () => {
    expect(texts(render(base('10-credit-note')))).toContain(
      "Facture d'origine : F2026-0042 du 15/10/2026",
    );
    const undated = { ...base(), precedingInvoices: [{ number: 'F2026-0001' }] };
    expect(texts(render(undated))).toContain("Facture d'origine : F2026-0001");
  });

  it('shows the delivery address and the references next to the client', () => {
    const all = texts(render({ ...base('17-delivery-address'), purchaseOrderReference: 'BC-7' }));
    expect(all).toEqual(
      expect.arrayContaining([
        'ADRESSE DE LIVRAISON',
        'Boulangerie Martin — atelier de Nuits',
        '21700 Nuits-Saint-Georges',
        'Bon de commande : BC-7',
      ]),
    );
    const refs = { buyerReference: 'R1', contractReference: 'C1', projectReference: 'P1' };
    expect(texts(render({ ...base(), ...refs }))).toEqual(
      expect.arrayContaining(['Votre référence : R1', 'Contrat : C1', 'Projet : P1']),
    );
  });

  it('writes a foreign country, and amounts in the invoice currency and in euros', () => {
    expect(texts(render(base('06-intra-eu-supply')))).toContain('DE');
    const all = texts(render(base('16-foreign-currency')));
    expect(all).toEqual(
      expect.arrayContaining(['2 000,00 USD', 'Total TVA en EUR', '368,00 €', '2 400,00 USD']),
    );
  });

  it('explains VAT without a rate: category and exemption', () => {
    const reverse = texts(render(base('05-reverse-charge-construction')));
    expect(reverse).toEqual(
      expect.arrayContaining([
        'Autoliquidation',
        'Autoliquidation — article 283-2 nonies du CGI (VATEX-FR-AE)',
        'AE',
      ]),
    );
    const outOfScope = texts(render(base('08-out-of-scope-association')));
    expect(outOfScope).toEqual(expect.arrayContaining(['Hors champ de la TVA', 'O']));
  });

  it('lists allowances, charges and periods, on the line and on the invoice', () => {
    expect(texts(render(base('15-line-allowance-charge')))).toEqual(
      expect.arrayContaining([
        'Remise : Remise quantité (-42,00 €)',
        'Frais : Emballage renforcé (12,00 €)',
      ]),
    );
    expect(texts(render(base('19-line-periods')))).toContain(
      'Période : du 01/10/2026 au 31/10/2026',
    );
    const doc = texts(render(base('14-document-allowance-charge')));
    expect(doc).toEqual(
      expect.arrayContaining([
        'Remise : Remise fidélité',
        '-12,50 €',
        'Frais : Frais de port',
        'Total des lignes HT',
        'Remises',
      ]),
    );
    const bare = { ...base(), allowances: [{}], charges: [{ reasonCode: 'FC' }] };
    expect(texts(render(bare))).toEqual(expect.arrayContaining(['Remise', 'Frais : FC']));
  });

  it('falls back to the code for an unknown unit or payment means', () => {
    const inv = base();
    const all = texts(
      render({
        ...inv,
        lines: [line(inv, { unitCode: 'XYZ', price: { net: '10', baseQuantity: '100' } })],
        payment: {
          meansCode: '1',
          meansText: 'Autre moyen',
          accounts: [{ bic: 'AGRIFRPP', name: 'X' }],
        },
        totals: { ...inv.totals, prepaid: 1000, rounding: 1 },
      }),
    );
    expect(all).toEqual(
      expect.arrayContaining([
        '3 XYZ',
        '10,00 € / 100',
        'Autre moyen',
        'BIC : AGRIFRPP',
        'Titulaire : X',
        'Déjà payé',
        'Arrondi',
      ]),
    );
  });

  it('draws an invoice with nothing filled in without failing', () => {
    const inv = base();
    const empty: Invoice = {
      seller: { ids: [] },
      buyer: { ids: [], legalId: { id: '1', scheme: '0009' } },
      notes: [],
      precedingInvoices: [],
      allowances: [],
      charges: [],
      vatBreakdown: [{}],
      totals: {},
      lines: [{ allowances: [], charges: [], price: {}, vat: {}, item: {} }],
      payment: { accounts: [{}] },
      invoicePeriod: { start: '2026-10-01' },
    };
    const all = texts(render(empty));
    expect(all).toEqual(expect.arrayContaining(['Facture', 'N° ', 'Page 1 / 1']));
    expect(all).not.toContain('Net à payer');
    expect(all).not.toContain('Paiement');
    expect(texts(render({ ...inv, payment: undefined, paymentTerms: undefined }))).not.toContain(
      'Paiement',
    );
  });

  it('turns control characters into spaces and keeps line breaks', () => {
    const inv = base();
    const all = texts(render({ ...inv, lines: [line(inv, { item: { name: 'A\tB\nC' } })] }));
    expect(all).toEqual(expect.arrayContaining(['A B', 'C']));
  });

  it('wraps long text, even a word longer than its column, inside the page', () => {
    const inv = base();
    const word = 'X'.repeat(150);
    const name = `${'Désignation très longue '.repeat(12)}${word}`;
    const pages = render({
      ...inv,
      seller: { ...inv.seller, legalInfo: 'SARL au capital de 10 000 €' },
      lines: [line(inv, { item: { name } })],
    });
    for (const d of pages.flat()) expect(d.x + width(d.text, d.size)).toBeLessThanOrEqual(547.3);
    expect(texts(pages).join('')).toContain(word);
    expect(texts(pages)).toContain('SARL au capital de 10 000 €');
  });

  it('continues on new pages, repeating the table header and numbering the pages', () => {
    const inv = base();
    const many = Array.from({ length: 80 }, (_, i) =>
      line(inv, { item: { name: `Article ${i + 1}` } }),
    );
    const notes = Array.from({ length: 90 }, (_, i) => ({ text: `Mention ${i + 1}` }));
    const pages = render({ ...inv, lines: many, notes });
    expect(pages.length).toBeGreaterThan(3);
    const withLines = pages.filter((p) => p.some((d) => d.text.startsWith('Article ')));
    expect(withLines.length).toBeGreaterThan(1);
    for (const p of withLines) expect(p.map((d) => d.text)).toContain('Désignation');
    expect(texts(pages)).toContain(`Page ${pages.length} / ${pages.length}`);
    expect(texts(pages).filter((s) => s.startsWith('Mention '))).toHaveLength(90);
    for (const d of pages.flat()) expect(d.y).toBeGreaterThan(20);
  });
});
