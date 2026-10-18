// The real PDF: the XML inside, the PDF/A-3 and Factur-X structure veraPDF and the Factur-X
// extractor look for (their own run: pnpm --filter @fi/core pdf:check), and stable bytes.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
} from '@cantoo/pdf-lib';
import { describe, expect, it } from 'vitest';
import { computeGolden, FIXTURES, golden, goldens, PDF_DATE } from '../../test/fixtures';
import { toCii } from '../xml';
import { FACTUR_X_FILE, FacturXPdfError, readFacturXPdf, toFacturXPdf } from './index';

const font = (file: string) => readFileSync(new URL(`../../fonts/${file}`, import.meta.url));
const fonts = { regular: font('DejaVuSans.ttf'), bold: font('DejaVuSans-Bold.ttf') };
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('golden invoices as Factur-X', () => {
  // Any change to the layout, the fonts or pdf-lib changes the hashes: run pdf:check on the new
  // files, then update with vitest -u.
  it('carry the CII we write, as an Alternative EN 16931 attachment, in stable bytes', async () => {
    const hashes: string[] = [];
    for (const g of goldens) {
      const invoice = computeGolden(g);
      const pdf = await toFacturXPdf(invoice, { fonts, now: PDF_DATE });
      const content = await readFacturXPdf(pdf);
      expect(content.xml, g.name).toBe(toCii(invoice));
      expect(content.relationship).toBe('Alternative');
      expect(content.conformanceLevel).toBe('EN 16931');
      hashes.push(`${sha256(pdf)}  ${g.name}.pdf`);
    }
    await expect(`${hashes.join('\n')}\n`).toMatchFileSnapshot(
      fileURLToPath(new URL('golden/pdf.sha256', FIXTURES)),
    );
  }, 60_000);
});

const invoice = computeGolden(golden('01-services-standard-rate'));
const bytes = await toFacturXPdf(invoice, { fonts, now: PDF_DATE });
const doc = await PDFDocument.load(bytes, { updateMetadata: false });
const dict = (value: unknown) =>
  value instanceof PDFDict ? value : PDFDict.withContext(doc.context);

describe('PDF/A-3 and Factur-X structure', () => {
  it('attaches factur-x.xml as an associated file of the document', () => {
    const af = doc.catalog.lookup(PDFName.of('AF'), PDFArray);
    expect(af.size()).toBe(1);
    const spec = dict(doc.context.lookup(af.get(0)));
    expect(spec.get(PDFName.of('AFRelationship'))).toBe(PDFName.of('Alternative'));
    expect(spec.get(PDFName.of('F'))?.toString()).toBe(`(${FACTUR_X_FILE})`);
    const file = doc.context.lookup(dict(spec.lookup(PDFName.of('EF'))).get(PDFName.of('F')));
    expect(file).toBeInstanceOf(PDFRawStream);
    expect((file as PDFRawStream).dict.get(PDFName.of('Subtype'))).toBe(PDFName.of('text/xml'));
  });

  it('declares PDF/A-3B and the Factur-X profile in XMP, with an sRGB output intent', () => {
    const meta = doc.catalog.lookup(PDFName.of('Metadata')) as PDFRawStream;
    const xmp = new TextDecoder().decode(decodePDFRawStream(meta).decode());
    for (const fragment of [
      '<pdfaid:part>3</pdfaid:part><pdfaid:conformance>B</pdfaid:conformance>',
      '<fx:DocumentType>INVOICE</fx:DocumentType>',
      `<fx:DocumentFileName>${FACTUR_X_FILE}</fx:DocumentFileName>`,
      '<fx:Version>1.0</fx:Version>',
      '<fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>',
      '<pdfaSchema:prefix>fx</pdfaSchema:prefix>',
      '<xmp:CreateDate>2026-10-17T10:00:00Z</xmp:CreateDate>',
    ])
      expect(xmp).toContain(fragment);
    const intent = dict(
      doc.context.lookup(doc.catalog.lookup(PDFName.of('OutputIntents'), PDFArray).get(0)),
    );
    expect(intent.get(PDFName.of('S'))).toBe(PDFName.of('GTS_PDFA1'));
  });

  it('says what it is: title, author, producer, date, language', () => {
    expect(doc.getTitle()).toBe('Facture N° F2026-0042');
    expect(doc.getAuthor()).toBe('Atelier Dupont SARL');
    expect(doc.getProducer()).toBe('Facture Impec');
    expect(doc.getCreationDate()).toEqual(PDF_DATE);
    expect(doc.catalog.get(PDFName.of('Lang'))?.toString()).toBe('(fr-FR)');
  });

  it('gives the same bytes and /ID for the same invoice and date, others for another date', async () => {
    const id = (pdf: PDFDocument) => pdf.context.trailerInfo.ID?.toString();
    expect(sha256(await toFacturXPdf(invoice, { fonts, now: PDF_DATE }))).toBe(sha256(bytes));
    const later = await toFacturXPdf(invoice, { fonts, now: new Date('2026-10-18T10:00:00Z') });
    expect(sha256(later)).not.toBe(sha256(bytes));
    expect(id(await PDFDocument.load(later))).not.toBe(id(doc));
    expect(id(doc)).toMatch(/^\[ <([0-9a-f]{32})> <\1> \]$/);
  });

  it('dates the PDF now when no date is given', async () => {
    const before = Date.now() - 1000;
    const pdf = await PDFDocument.load(await toFacturXPdf(invoice, { fonts }));
    expect(pdf.getCreationDate()?.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe('readFacturXPdf', () => {
  it('refuses a file that is not a PDF', async () => {
    const reading = readFacturXPdf(new TextEncoder().encode('facture.xlsx'));
    await expect(reading).rejects.toThrowError(FacturXPdfError);
    await expect(reading).rejects.toMatchObject({ reason: 'unreadable' });
  });

  it('refuses a PDF without invoice XML', async () => {
    const plain = await PDFDocument.create();
    plain.addPage();
    await expect(readFacturXPdf(await plain.save())).rejects.toMatchObject({ reason: 'no-xml' });
  });

  it('reads a ZUGFeRD 2.0 attachment name, even without Factur-X metadata', async () => {
    const zugferd = await PDFDocument.create();
    zugferd.addPage();
    await zugferd.attach(new TextEncoder().encode('<x/>'), 'ZUGFeRD-invoice.xml', {
      mimeType: 'text/xml',
    });
    const content = await readFacturXPdf(await zugferd.save());
    expect(content).toEqual({ xml: '<x/>', relationship: undefined, conformanceLevel: undefined });
  });
});
