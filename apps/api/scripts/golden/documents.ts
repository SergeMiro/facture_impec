// The 50 golden documents of BTP plan stage 1 (docs/plans/phase-1.md › 1B): what a building firm
// receives, made here from the invoice goldens of @fi/core and a few French documents written for
// it, each with what ingest and the read must give. Text PDFs are written by hand (a few objects,
// no dates: the same bytes every run); scans and images are those pages through `pdftoppm`, so
// making the set needs poppler-utils, as reading it needs tesseract (docs/RUNBOOK.md).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundledFonts } from '@fi/core/fonts';
import { toFacturXPdf } from '@fi/core/pdf';
import { computeGolden, FIXTURES, golden } from '@fi/core/testing';
import type { DocumentKind, DocumentStage } from '@fi/domain';

/** The two companies of the set: most documents are received by the buyer of the goldens. */
export const GOLDEN_COMPANIES = {
  buyer: { siren: '200000008', name: 'Boulangerie Martin SAS', vatId: 'FR37200000008' },
  seller: { siren: '100000009', name: 'Atelier Dupont SARL', vatId: 'FR88100000009' },
} as const;

export type GoldenExpectation =
  /** Refused at the door: nothing stored. */
  | { refused: { status: number; code: string } }
  /** The same bytes as an earlier golden: that document again, nothing new. */
  | { duplicateOf: string }
  | {
      kind: DocumentKind | null;
      stage: DocumentStage;
      reviewReason?: string;
      /** For an invoice: the syntax it was read in. */
      format?: 'factur-x' | 'ubl' | 'cii';
      /** For a text: read by OCR or not, and words it must contain. */
      ocr?: boolean;
      text?: readonly string[];
    };

export interface GoldenDocument {
  id: string;
  /** The name it is sent under (never what decides what it is). */
  name: string;
  bytes: Uint8Array;
  to: keyof typeof GOLDEN_COMPANIES;
  expect: GoldenExpectation;
}

// ── A PDF by hand ───────────────────────────────────────────────────────────────────────────────

type Page =
  | { lines: readonly { text: string; size?: number; bold?: boolean }[] }
  | { jpeg: Uint8Array };

const A4 = { width: 595, height: 842 };
const latin1 = (text: string) => Buffer.from(text, 'latin1');
const pdfString = (text: string) => `(${text.replace(/[\\()]/g, (c) => `\\${c}`)})`;

/** The size and colours of a JPEG, from its start-of-frame marker. */
function jpegFrame(bytes: Uint8Array): { width: number; height: number; components: number } {
  for (let i = 2; i + 9 < bytes.length; ) {
    if (bytes[i] !== 0xff) throw new Error('not a JPEG marker');
    const marker = bytes[i + 1] ?? 0;
    const length = ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0);
    if (marker >= 0xc0 && marker <= 0xc2) {
      const height = ((bytes[i + 5] ?? 0) << 8) | (bytes[i + 6] ?? 0);
      const width = ((bytes[i + 7] ?? 0) << 8) | (bytes[i + 8] ?? 0);
      return { width, height, components: bytes[i + 9] ?? 3 };
    }
    i += 2 + length;
  }
  throw new Error('no JPEG frame');
}

/** A PDF of text pages (Helvetica, WinAnsi: French accents) or of scanned pages (a JPEG each). */
export function writePdf(pages: readonly Page[]): Uint8Array {
  const objects: Buffer[] = [];
  const add = (body: Buffer | string) => {
    objects.push(typeof body === 'string' ? latin1(body) : body);
    return objects.length;
  };
  const stream = (dict: string, data: Buffer) =>
    Buffer.concat([
      latin1(`<< ${dict} /Length ${data.length} >>\nstream\n`),
      data,
      latin1('\nendstream'),
    ]);
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // the page tree, written once the pages are numbered
  const regular = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  );
  const bold = add(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );
  const kids: number[] = [];
  for (const page of pages) {
    let content: string;
    let resources: string;
    if ('lines' in page) {
      let y = A4.height - 72;
      content = page.lines
        .map(({ text, size = 11, bold: strong = false }) => {
          const line = `BT /${strong ? 'F2' : 'F1'} ${size} Tf 56 ${y} Td ${pdfString(text)} Tj ET`;
          y -= size * 1.6;
          return line;
        })
        .join('\n');
      resources = `<< /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >>`;
    } else {
      // `pdftoppm -gray -jpeg` still writes three components: the frame says which space it is.
      const { width, height, components } = jpegFrame(page.jpeg);
      const image = add(
        stream(
          `/Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace ${components === 1 ? '/DeviceGray' : '/DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode`,
          Buffer.from(page.jpeg),
        ),
      );
      content = `q ${A4.width} 0 0 ${A4.height} 0 0 cm /Im1 Do Q`;
      resources = `<< /XObject << /Im1 ${image} 0 R >> >>`;
    }
    const contents = add(stream('', latin1(content)));
    kids.push(
      add(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Resources ${resources} /Contents ${contents} 0 R >>`,
      ),
    );
  }
  objects[1] = latin1(
    `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`,
  );
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets: number[] = [];
  let at = parts[0]?.length ?? 0;
  objects.forEach((body, i) => {
    offsets.push(at);
    const chunk = Buffer.concat([latin1(`${i + 1} 0 obj\n`), body, latin1('\nendobj\n')]);
    parts.push(chunk);
    at += chunk.length;
  });
  const xref = [
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`,
    ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${at}\n%%EOF\n`,
  ].join('');
  parts.push(latin1(xref));
  return new Uint8Array(Buffer.concat(parts));
}

/**
 * A page as an image, through `pdftoppm` (150 dpi, grey): what a scanner or a phone gives.
 * poppler 24 writes `-` as a file named `-.jpg`, not to stdout: hence the folder.
 */
function render(pdf: Uint8Array, format: 'jpeg' | 'png' | 'tiff'): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), 'fi-golden-'));
  try {
    const out = join(dir, 'page');
    execFileSync('pdftoppm', ['-r', '150', '-gray', `-${format}`, '-singlefile', '-', out], {
      input: pdf,
    });
    const extension = { jpeg: 'jpg', png: 'png', tiff: 'tif' }[format];
    return new Uint8Array(readFileSync(`${out}.${extension}`));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const scanOf = (pdf: Uint8Array) => writePdf([{ jpeg: render(pdf, 'jpeg') }]);

// ── What a building firm receives besides invoices ────────────────────────────────────────────────

const title = (text: string) => ({ text, size: 20, bold: true });
const TEXTS = {
  attestation: [
    title('ATTESTATION DE VIGILANCE'),
    { text: 'URSSAF Bourgogne-Franche-Comté' },
    { text: 'Délivrée le 1er octobre 2026 à : Maçonnerie Durand SARL' },
    { text: 'SIREN : 552 100 554 - 12 rue des Tanneurs, 21000 Dijon' },
    { text: "L'entreprise est à jour de ses obligations de déclaration et de paiement" },
    { text: 'auprès de l’organisme de recouvrement à la date du 30 septembre 2026.' },
    { text: 'Effectif salarié déclaré : 12. Code de sécurité : K7Q2-M9XA-44TB.' },
  ],
  kbis: [
    title('EXTRAIT KBIS'),
    { text: 'Greffe du tribunal de commerce de Dijon' },
    { text: 'Dénomination : Maçonnerie Durand SARL' },
    { text: 'Immatriculation au RCS : 552 100 554 R.C.S. Dijon' },
    { text: 'Activité : travaux de maçonnerie générale et gros œuvre de bâtiment' },
    { text: 'Extrait délivré le 2 octobre 2026.' },
  ],
  devis: [
    title('DEVIS N° D-2026-014'),
    { text: 'Chantier : rénovation de la boulangerie, 3 place du Marché, Beaune' },
    { text: 'Démolition de la cloison existante : 1 850,00 € HT' },
    { text: 'Réalisation de la dalle béton 24 m² : 6 240,00 € HT' },
    { text: 'Total HT : 8 090,00 € - TVA 20 % : 1 618,00 € - Total TTC : 9 708,00 €' },
    { text: 'Devis valable trois mois. Bon pour accord, date et signature :' },
  ],
  reception: [
    title('PROCÈS-VERBAL DE RÉCEPTION'),
    { text: 'Chantier CH-12 : rénovation de la boulangerie, Beaune' },
    { text: 'Le maître d’ouvrage déclare recevoir les travaux le 15 octobre 2026' },
    { text: 'avec les réserves suivantes : reprise de l’enduit du mur nord.' },
    { text: 'La retenue de garantie de 5 % sera libérée un an après la réception.' },
  ],
  contrat: [
    title('CONTRAT DE SOUS-TRAITANCE'),
    { text: 'Entre Boulangerie Martin SAS, entreprise principale, et' },
    { text: 'Maçonnerie Durand SARL, sous-traitant, pour le chantier CH-12.' },
    { text: 'Article 1 - Objet : lot gros œuvre, selon le devis D-2026-014.' },
    { text: 'Article 2 - Prix : 8 090,00 € HT, TVA autoliquidée par l’entreprise principale.' },
  ],
  contratSuite: [
    title('CONTRAT DE SOUS-TRAITANCE (SUITE)'),
    { text: 'Article 3 - Paiement direct : selon la loi du 31 décembre 1975.' },
    { text: 'Article 4 - Retenue de garantie : 5 % du montant des travaux.' },
    { text: 'Fait à Beaune, le 5 octobre 2026, en deux exemplaires.' },
  ],
  facture: [
    title('FACTURE N° F-2026-311'),
    { text: 'Quincaillerie du Centre - SIREN 732 829 320' },
    { text: 'Vis inox, chevilles et colle : 412,50 € HT' },
    { text: 'TVA 20 % : 82,50 € - Total TTC : 495,00 € - à payer sous 30 jours' },
  ],
  assurance: [
    title('ATTESTATION D’ASSURANCE DÉCENNALE'),
    { text: 'Assureur : Mutuelle du Bâtiment, contrat n° 88-412-907' },
    { text: 'Assuré : Maçonnerie Durand SARL, SIREN 552 100 554' },
    { text: 'Période de validité : du 1er janvier au 31 décembre 2026' },
  ],
  livraison: [
    title('BON DE LIVRAISON N° BL-8841'),
    { text: 'Négoce Matériaux Bourgogne - livré au chantier CH-12' },
    { text: '40 sacs de ciment 35 kg, 2 palettes de parpaings' },
  ],
} as const;

const textPdf = (key: keyof typeof TEXTS) => writePdf([{ lines: TEXTS[key] }]);

// ── The set ───────────────────────────────────────────────────────────────────────────────────────

const goldenXml = (name: string, syntax: 'cii' | 'ubl') =>
  new Uint8Array(readFileSync(new URL(`golden/${name}.${syntax}.xml`, FIXTURES)));

const purchase = { kind: 'facture_achat', stage: 'validated' } as const;

export async function goldenDocuments(): Promise<GoldenDocument[]> {
  const fonts = bundledFonts();
  const now = new Date('2026-10-20T08:00:00Z');
  const facturX = async (name: string) => toFacturXPdf(computeGolden(golden(name)), { fonts, now });
  const set: GoldenDocument[] = [];
  const doc = (
    id: string,
    name: string,
    bytes: Uint8Array,
    expect: GoldenExpectation,
    to: GoldenDocument['to'] = 'buyer',
  ) => set.push({ id, name, bytes, expect, to });

  // Factur-X PDFs received: read as data, a purchase, checked.
  for (const g of [
    '01-services-standard-rate',
    '02-goods-two-rates',
    '03-mixed-goods-services',
    '05-reverse-charge-construction',
    '09-zero-rated',
    '12-down-payment',
    '14-document-allowance-charge',
    '17-delivery-address',
    '20-purchase-order',
    '26-btp-situation-retenue',
  ]) {
    doc(`facturx-${g.slice(0, 2)}`, `${g}.pdf`, await facturX(g), {
      ...purchase,
      format: 'factur-x',
    });
  }
  // CII and UBL files (a platform, an e-mail).
  for (const g of [
    '11-corrective-invoice',
    '13-final-after-down-payment',
    '15-line-allowance-charge',
    '16-foreign-currency',
    '18-invoice-period',
    '19-line-periods',
    '21-vat-on-debits',
  ]) {
    doc(`cii-${g.slice(0, 2)}`, `${g}.xml`, goldenXml(g, 'cii'), { ...purchase, format: 'cii' });
  }
  doc('cii-10', 'avoir-F2026-0040.xml', goldenXml('10-credit-note', 'cii'), {
    kind: 'avoir',
    stage: 'validated',
    format: 'cii',
  });
  for (const g of [
    '04-franchise-293b',
    '08-out-of-scope-association',
    '22-press-and-books',
    '23-base-quantity-gross-price',
    '24-already-paid',
    '25-many-lines-rounding',
  ]) {
    doc(`ubl-${g.slice(0, 2)}`, `${g}.xml`, goldenXml(g, 'ubl'), { ...purchase, format: 'ubl' });
  }
  // The company's own invoices, read back (from its ERP, its sent folder).
  doc(
    'sale-01',
    'F2026-0042.xml',
    goldenXml('01-services-standard-rate', 'cii'),
    {
      kind: 'facture_vente',
      stage: 'validated',
      format: 'cii',
    },
    'seller',
  );
  doc(
    'sale-07',
    'export.xml',
    goldenXml('07-export-outside-eu', 'ubl'),
    {
      kind: 'facture_vente',
      stage: 'validated',
      format: 'ubl',
    },
    'seller',
  );
  doc(
    'sale-10',
    'avoir.xml',
    goldenXml('10-credit-note', 'ubl'),
    {
      kind: 'avoir',
      stage: 'validated',
      format: 'ubl',
    },
    'seller',
  );
  // Not this company's: between two others.
  doc('other-06', 'facture.xml', goldenXml('06-intra-eu-supply', 'cii'), {
    kind: null,
    stage: 'needs_review',
    reviewReason: 'other_company',
  });
  doc(
    'xml-order',
    'commande.xml',
    new TextEncoder().encode(
      '<?xml version="1.0"?><Order xmlns="urn:example:order"><ID>C-77</ID></Order>',
    ),
    {
      kind: null,
      stage: 'needs_review',
      reviewReason: 'xml',
    },
  );

  // Text PDFs: read, waiting for stage 2's classifier.
  const texts = {
    attestation: ['ATTESTATION DE VIGILANCE', 'Durand'],
    kbis: ['EXTRAIT KBIS', '552 100 554'],
    devis: ['DEVIS', 'D-2026-014'],
    reception: ['RÉCEPTION', 'réserves'],
    facture: ['FACTURE', 'F-2026-311'],
    assurance: ['DÉCENNALE', 'Mutuelle'],
  } as const;
  const pdfs = new Map<string, Uint8Array>();
  for (const [key, words] of Object.entries(texts) as [keyof typeof texts, readonly string[]][]) {
    const bytes = textPdf(key);
    pdfs.set(key, bytes);
    doc(`text-${key}`, `${key}.pdf`, bytes, {
      kind: null,
      stage: 'ingested',
      ocr: false,
      text: words,
    });
  }
  // Scans: a PDF with only a picture of the page.
  doc('scan-attestation', 'scan-attestation.pdf', scanOf(textPdf('attestation')), {
    kind: null,
    stage: 'ingested',
    ocr: true,
    text: ['ATTESTATION DE VIGILANCE'],
  });
  doc('scan-devis', 'scan001.pdf', scanOf(textPdf('devis')), {
    kind: null,
    stage: 'ingested',
    ocr: true,
    text: ['DEVIS', 'Démolition'],
  });
  doc('scan-reception', 'PV.pdf', scanOf(textPdf('reception')), {
    kind: null,
    stage: 'ingested',
    ocr: true,
    text: ['RÉCEPTION', 'retenue de garantie'],
  });
  doc(
    'scan-contrat',
    'contrat-st.pdf',
    writePdf([
      { jpeg: render(textPdf('contrat'), 'jpeg') },
      { jpeg: render(writePdf([{ lines: TEXTS.contratSuite }]), 'jpeg') },
    ]),
    { kind: null, stage: 'ingested', ocr: true, text: ['SOUS-TRAITANCE', 'Paiement direct'] },
  );
  // Photos and faxes.
  doc('image-png', 'IMG_2041.png', render(textPdf('kbis'), 'png'), {
    kind: null,
    stage: 'ingested',
    ocr: true,
    text: ['KBIS'],
  });
  doc('image-jpeg', 'photo.jpg', render(writePdf([{ lines: TEXTS.livraison }]), 'jpeg'), {
    kind: null,
    stage: 'ingested',
    ocr: true,
    text: ['BON DE LIVRAISON', 'BL-8841'],
  });
  doc('image-tiff', 'fax.tif', render(textPdf('assurance'), 'tiff'), {
    kind: null,
    stage: 'ingested',
    ocr: true,
    text: ['ASSURANCE'],
  });
  // Nothing to read, and a file cut short.
  doc('blank', 'scan002.pdf', scanOf(writePdf([{ lines: [] }])), {
    kind: null,
    stage: 'needs_review',
    reviewReason: 'no_text',
  });
  const cut = textPdf('contrat');
  doc('damaged', 'contrat.pdf', cut.subarray(0, Math.floor(cut.length / 3)), {
    kind: null,
    stage: 'needs_review',
    reviewReason: 'damaged',
  });
  // The same files again, under other names.
  const again = (id: string, of: string, name: string) => {
    const first = set.find((d) => d.id === of);
    if (!first) throw new Error(`no golden ${of}`);
    doc(id, name, first.bytes, { duplicateOf: of });
  };
  again('again-facturx', 'facturx-01', 'Facture F2026-0042 (1).pdf');
  again('again-cii', 'cii-13', 'renvoi.xml');
  again('again-text', 'text-attestation', 'attestation-urssaf.pdf');
  again('again-image', 'image-png', 'IMG_2041 copie.png');
  // Refused at the door.
  doc('refused-exe', 'facture.pdf', new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]), {
    refused: { status: 415, code: 'ingest_unsupported' },
  });
  doc('refused-empty', 'vide.pdf', new Uint8Array(), {
    refused: { status: 422, code: 'ingest_empty' },
  });
  return set;
}
