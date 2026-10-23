// Factur-X: the invoice drawn as PDF/A-3B with its CII XML attached (plan §9, docs/FORMATS.md §3.3).
// @cantoo/pdf-lib's embedFacturX does the PDF/A part (sRGB output intent, XMP with pdfaid and the
// fx: extension schema) and the attachment (/AF, AFRelationship). We draw the page and keep the
// output reproducible: the same invoice at the same date gives the same bytes.
import fontkit from '@cantoo/fontkit';
import {
  AFRelationship,
  decodePDFRawStream,
  embedFacturX,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
} from '@cantoo/pdf-lib';
import { isMessageKey, t } from '@fi/shared';
import type { Invoice } from '../model';
import { toCii } from '../xml';
import { renderInvoice } from './render';

export const FACTUR_X_FILE = 'factur-x.xml';
/** Names a Factur-X / ZUGFeRD 2 reader accepts for the attached XML. */
const XML_FILES = [FACTUR_X_FILE, 'zugferd-invoice.xml', 'xrechnung.xml'];
const PRODUCER = 'Facture Impec';

export interface FacturXOptions {
  /** TrueType bytes, embedded as subsets. The core ships DejaVu Sans in packages/core/fonts/. */
  fonts: { regular: Uint8Array; bold: Uint8Array };
  /** Written as the creation and modification dates; fixed in tests so the bytes are too. */
  now?: Date;
}

/**
 * The file identifier PDF/A requires (/ID). pdf-lib draws a random one; ours is FNV-1a over the
 * XML and the date, four times with different seeds: stable, unique enough, and not a secret.
 */
function fileId(bytes: Uint8Array): Uint8Array {
  const id = new Uint8Array(16);
  const view = new DataView(id.buffer);
  for (let seed = 0; seed < 4; seed++) {
    let h = (0x811c9dc5 ^ seed) >>> 0;
    for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
    view.setUint32(4 * seed, h);
  }
  return id;
}

/** The invoice as a Factur-X PDF (profile EN 16931). */
export async function toFacturXPdf(invoice: Invoice, options: FacturXOptions): Promise<Uint8Array> {
  const now = options.now ?? new Date();
  const xml = new TextEncoder().encode(toCii(invoice));
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  const [regular, bold] = await Promise.all([
    doc.embedFont(options.fonts.regular, { subset: true }),
    doc.embedFont(options.fonts.bold, { subset: true }),
  ]);
  renderInvoice(doc, { regular, bold }, invoice);

  const key = `pdf.title.${invoice.typeCode}`;
  const title = isMessageKey(key) ? t(key) : t('pdf.title.other');
  doc.setTitle(`${title} ${t('pdf.number', { number: invoice.number ?? '' })}`);
  doc.setAuthor(invoice.seller.name ?? '');
  doc.setCreator(PRODUCER);
  doc.setProducer(PRODUCER);
  doc.setCreationDate(now);
  doc.setModificationDate(now);
  doc.setLanguage('fr-FR');
  const id = PDFHexString.fromBytes(
    fileId(new Uint8Array([...xml, ...new TextEncoder().encode(now.toISOString())])),
  );
  doc.context.trailerInfo.ID = doc.context.obj([id, id]);

  await embedFacturX(doc, xml, {
    conformanceLevel: 'EN 16931',
    afRelationship: AFRelationship.Alternative,
    creationDate: now,
    modificationDate: now,
  });
  return doc.save();
}

export interface FacturXContent {
  xml: string;
  /** /AFRelationship of the attachment: Alternative for EN 16931. */
  relationship: string | undefined;
  /** fx:ConformanceLevel from the XMP metadata ("EN 16931", "BASIC"…). */
  conformanceLevel: string | undefined;
}

export class FacturXPdfError extends Error {
  constructor(
    readonly reason: 'unreadable' | 'no-xml',
    message: string,
  ) {
    super(message);
    this.name = 'FacturXPdfError';
  }
}

/** A plain PDF has no attachment dictionary. Malformed dictionaries must still report an error. */
function attachmentsOf(doc: PDFDocument) {
  if (!doc.catalog.has(PDFName.of('Names'))) return [];
  return doc.getAttachments();
}

/** Takes the invoice XML back out of a Factur-X PDF. Throws FacturXPdfError otherwise. */
export async function readFacturXPdf(bytes: Uint8Array): Promise<FacturXContent> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const file = attachmentsOf(doc).find((a) => XML_FILES.includes(a.name.toLowerCase()));
    if (!file) throw new FacturXPdfError('no-xml', `no ${FACTUR_X_FILE} attached`);

    const meta = doc.catalog.lookup(PDFName.of('Metadata'));
    const xmp =
      meta instanceof PDFRawStream
        ? new TextDecoder().decode(decodePDFRawStream(meta).decode())
        : '';
    const level = /<fx:ConformanceLevel>([^<]*)<\/fx:ConformanceLevel>/.exec(xmp)?.[1];
    return {
      xml: new TextDecoder().decode(file.data),
      relationship: file.afRelationship,
      conformanceLevel: level,
    };
  } catch (e) {
    if (e instanceof FacturXPdfError) throw e;
    throw new FacturXPdfError('unreadable', e instanceof Error ? e.message : String(e));
  }
}
