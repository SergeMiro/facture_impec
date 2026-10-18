// Dictionary mapping: French (and English) column headers → invoice fields. It is the fallback when
// AI is off or fails, and the hint MappingAgent starts from. It never maps a SIREN column from the
// numbers alone (plan §6 guardrail): only a header that says SIREN or SIRET does.
import { t } from '@fi/shared';
import { FR_RATES } from '../rules/fr';
import { isBlank, type RawCell, type SheetSnapshot } from './cells';
import {
  CONFIRM_BELOW,
  CORE_FIELDS,
  type FieldMapping,
  INVOICE_FIELDS,
  type InvoiceField,
  type SheetMapping,
} from './fields';
import { rateOf, textOf } from './values';

/** Lower case, no accents, punctuation as single spaces: « N° Facture » → "n facture". */
export const normalizeHeader = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();

interface Synonyms {
  /** The whole header is one of these: 0.95. */
  exact: readonly string[];
  /** The header contains one of these words: 0.85. */
  contains?: readonly string[];
  /** A vague word (« date », « montant »): 0.65, to be confirmed. */
  weak?: readonly string[];
}

export const SYNONYMS: Readonly<Record<InvoiceField, Synonyms>> = {
  number: {
    exact: [
      'n facture',
      'n de facture',
      'no facture',
      'numero facture',
      'numero de facture',
      'num facture',
      'facture n',
      'facture',
      'ref facture',
      'reference facture',
      'invoice number',
      'invoice no',
      'invoice',
      'numero',
      'num',
      'n',
    ],
    contains: ['n facture', 'numero de facture', 'numero facture', 'facture n', 'invoice number'],
    weak: ['facture', 'numero'],
  },
  issueDate: {
    exact: [
      'date',
      'date facture',
      'date de facture',
      'date de la facture',
      'date d emission',
      'date emission',
      'emise le',
      'date facturation',
      'date de facturation',
      'invoice date',
    ],
    contains: [
      'date facture',
      'date de facture',
      'date de la facture',
      'date d emission',
      'date de facturation',
    ],
    weak: ['date'],
  },
  dueDate: {
    exact: [
      'echeance',
      'date echeance',
      'date d echeance',
      'date limite',
      'date limite de paiement',
      'a payer avant le',
      'due date',
    ],
    contains: ['echeance', 'due date', 'date limite', 'payer avant'],
  },
  deliveryDate: {
    exact: [
      'date de livraison',
      'date livraison',
      'date de prestation',
      'date prestation',
      'livre le',
      'date d execution',
      'delivery date',
    ],
    contains: ['livraison', 'date de prestation', 'date prestation', 'delivery'],
  },
  buyerName: {
    exact: [
      'client',
      'nom client',
      'nom du client',
      'client nom',
      'raison sociale',
      'raison sociale client',
      'societe',
      'entreprise',
      'denomination',
      'destinataire',
      'acheteur',
      'customer',
      'nom',
    ],
    contains: ['client', 'raison sociale', 'destinataire', 'acheteur', 'customer'],
  },
  buyerSiren: {
    exact: [
      'siren',
      'siren client',
      'n siren',
      'numero siren',
      'siren du client',
      'siren siret',
      'siret siren',
    ],
    contains: ['siren'],
  },
  buyerSiret: {
    exact: ['siret', 'siret client', 'n siret', 'numero siret', 'siret du client'],
    contains: ['siret'],
  },
  buyerVatId: {
    exact: [
      'tva intracom',
      'tva intracommunautaire',
      'n tva',
      'n tva intracommunautaire',
      'numero de tva',
      'numero tva',
      'tva client',
      'n tva client',
      'id tva',
      'vat number',
      'vat id',
    ],
    contains: ['intracom', 'numero de tva', 'n tva', 'vat number', 'vat id'],
  },
  buyerEmail: {
    exact: [
      'email',
      'e mail',
      'courriel',
      'mail',
      'email client',
      'adresse email',
      'adresse e mail',
    ],
    contains: ['email', 'e mail', 'courriel', 'mail'],
  },
  buyerAddress: {
    exact: ['adresse', 'adresse client', 'adresse de facturation', 'rue', 'voie', 'address'],
    contains: ['adresse', 'rue', 'address'],
  },
  buyerPostCode: {
    exact: ['code postal', 'cp', 'code postal client', 'postal code', 'zip'],
    contains: ['code postal', 'postal'],
  },
  buyerCity: {
    exact: ['ville', 'ville client', 'commune', 'localite', 'city'],
    contains: ['ville', 'city'],
  },
  buyerCountry: {
    exact: ['pays', 'pays client', 'code pays', 'country'],
    contains: ['pays', 'country'],
  },
  purchaseOrder: {
    exact: [
      'bon de commande',
      'n commande',
      'n de commande',
      'numero de commande',
      'ref commande',
      'reference commande',
      'commande',
      'n bc',
      'bc',
      'po',
      'purchase order',
    ],
    contains: ['commande', 'purchase order'],
  },
  paymentTerms: {
    exact: [
      'conditions de paiement',
      'conditions de reglement',
      'modalites de paiement',
      'conditions',
      'payment terms',
    ],
    contains: ['conditions de paiement', 'conditions de reglement', 'modalites'],
  },
  currency: { exact: ['devise', 'monnaie', 'currency'], contains: ['devise'] },
  itemName: {
    exact: [
      'designation',
      'description',
      'libelle',
      'article',
      'produit',
      'prestation',
      'objet',
      'detail',
      'intitule',
      'produit service',
      'service',
      'item',
    ],
    contains: ['designation', 'description', 'libelle', 'article', 'prestation', 'produit'],
  },
  quantity: {
    exact: [
      'qte',
      'quantite',
      'qty',
      'quantity',
      'nb',
      'nombre',
      'nb jours',
      'nombre de jours',
      'nb heures',
      'heures',
    ],
    contains: ['quantite', 'qte', 'qty', 'quantity'],
  },
  unitCode: { exact: ['unite', 'unite de mesure', 'unit', 'u'], contains: ['unite'] },
  unitPrice: {
    exact: [
      'prix unitaire',
      'prix unitaire ht',
      'prix u ht',
      'pu',
      'pu ht',
      'p u',
      'p u ht',
      'prix ht',
      'tarif',
      'tarif ht',
      'taux journalier',
      'tjm',
      'unit price',
      'prix',
    ],
    contains: ['prix unitaire', 'unit price', 'pu ht', 'p u'],
    weak: ['prix', 'tarif'],
  },
  lineNet: {
    exact: [
      'montant ht',
      'total ht',
      'ht',
      'montant hors taxe',
      'montant hors taxes',
      'total hors taxe',
      'total hors taxes',
      'net ht',
      'total ligne',
      'montant',
      'amount',
    ],
    contains: ['montant ht', 'total ht', 'hors taxe'],
    weak: ['montant'],
  },
  vatRate: {
    exact: [
      'taux tva',
      'taux de tva',
      '% tva',
      'tva %',
      'tx tva',
      'vat rate',
      'tva',
      'taux',
      'vat',
    ],
    contains: ['taux tva', 'taux de tva', '% tva', 'tva %', 'vat rate'],
    weak: ['tva'],
  },
  vatCategory: {
    exact: ['categorie tva', 'categorie de tva', 'code tva', 'vat category'],
    contains: ['categorie tva', 'code tva'],
  },
  nature: {
    exact: ['nature', 'type', 'bien service', 'type d operation', 'nature de l operation'],
    contains: ['nature'],
  },
  totalInclVat: {
    exact: [
      'ttc',
      'montant ttc',
      'total ttc',
      'net a payer',
      'total a payer',
      'montant total',
      'total',
    ],
    contains: ['ttc', 'net a payer'],
  },
};

/** « Total », « Sous-total », « Net à payer » rows sum the invoices above; they are not invoices. */
export function isTotalRow(row: SheetSnapshot['rows'][number]): boolean {
  return row.cells.some((c) =>
    /^(sous )?total\b|^net a payer\b/.test(
      normalizeHeader(typeof c.value === 'string' ? c.value : ''),
    ),
  );
}

const hasWords = (header: string, words: string) => ` ${header} `.includes(` ${words} `);

/** How well one header names one field: 0 when it does not. */
export function headerScore(header: string, field: InvoiceField): number {
  const h = normalizeHeader(header);
  if (h === '') return 0;
  const s = SYNONYMS[field];
  if (s.exact.includes(h)) return 0.95;
  if (s.contains?.some((w) => hasWords(h, w))) return 0.85;
  if (s.weak?.some((w) => hasWords(h, w))) return 0.65;
  return 0;
}

const HEADER_SCAN_ROWS = 30;
const SAMPLE_ROWS = 50;

/** A row of labels: the one where most cells name a field. */
function findHeaderRow(snapshot: SheetSnapshot): number | undefined {
  let best: { row: number; score: number } | undefined;
  for (const row of snapshot.rows.slice(0, HEADER_SCAN_ROWS)) {
    const score = row.cells.filter((c) => {
      const text = typeof c.value === 'string' ? c.value : '';
      return text !== '' && INVOICE_FIELDS.some((f) => headerScore(text, f) > 0);
    }).length;
    if (score >= 2 && (!best || score > best.score)) best = { row: row.row, score };
  }
  return best?.row;
}

/** A « TVA » column holds rates when nearly all its values are French rates; else it is an amount. */
function holdsRates(values: readonly RawCell[]): boolean {
  const filled = values.filter((c) => !isBlank(c));
  if (filled.length === 0) return true;
  const rates = filled.filter((c) => {
    const r = rateOf(c);
    return r !== undefined && FR_RATES.includes(String(Number(r)));
  });
  return rates.length / filled.length >= 0.8;
}

/** SIREN has 9 digits, SIRET 14: a « SIREN/SIRET » column goes where most of its values fit. */
function sirenOrSiret(values: readonly RawCell[]): 'buyerSiren' | 'buyerSiret' {
  const digits = values.map((c) => (textOf(c) ?? '').replace(/\D/g, '').length);
  const siret = digits.filter((n) => n === 14).length;
  const siren = digits.filter((n) => n === 9).length;
  return siret > siren ? 'buyerSiret' : 'buyerSiren';
}

/** Proposes a mapping from the headers alone; `source: 'heuristic'`. */
export function detectMapping(snapshot: SheetSnapshot): SheetMapping {
  const headerRow = findHeaderRow(snapshot) ?? snapshot.rows[0]?.row ?? 1;
  const header = snapshot.rows.find((r) => r.row === headerRow);
  const below = snapshot.rows.filter((r) => r.row > headerRow).slice(0, SAMPLE_ROWS);
  const columnValues = (col: string) =>
    below.map((r) => r.cells.find((c) => c.col === col)).filter((c): c is RawCell => !!c);

  const candidates: { field: InvoiceField; col: string; confidence: number }[] = [];
  for (const cell of header?.cells ?? []) {
    const text = typeof cell.value === 'string' ? cell.value : '';
    for (const field of INVOICE_FIELDS) {
      let confidence = headerScore(text, field);
      if (confidence === 0) continue;
      // « TVA » alone may be the VAT amount: the values decide. « Taux TVA » is a rate whatever it holds.
      const bare = ['tva', 'vat', 'taux'].includes(normalizeHeader(text)) || confidence < 0.85;
      if (field === 'vatRate' && bare && !holdsRates(columnValues(cell.col))) continue;
      if (field === 'buyerSiren' || field === 'buyerSiret') {
        const h = normalizeHeader(text);
        if (hasWords(h, 'siren') && hasWords(h, 'siret')) {
          if (sirenOrSiret(columnValues(cell.col)) !== field) continue;
          confidence = 0.9;
        }
      }
      candidates.push({ field, col: cell.col, confidence });
    }
  }

  // Best pairs first; one column per field and one field per column.
  candidates.sort((a, b) => b.confidence - a.confidence);
  const mapping: Partial<Record<InvoiceField, FieldMapping>> = {};
  const usedCols = new Set<string>();
  for (const c of candidates) {
    if (mapping[c.field] || usedCols.has(c.col)) continue;
    mapping[c.field] = {
      column: c.col,
      confidence: c.confidence,
      needsConfirmation: c.confidence < CONFIRM_BELOW,
    };
    usedCols.add(c.col);
  }

  const warnings = CORE_FIELDS.filter((f) => !mapping[f] && !(f === 'unitPrice' && mapping.lineNet))
    .filter((f) => !(f === 'quantity' && mapping.lineNet))
    .map((f) => t('sheet.warning.missing', { field: t(`sheet.field.${f}`) }));

  return {
    sheet: snapshot.sheet,
    headerRow,
    mapping,
    grouping: groupingFor(mapping.number?.column, below),
    warnings,
    source: 'heuristic',
  };
}

/** Group by the number column when a number repeats or a line row leaves it blank. */
function groupingFor(
  col: string | undefined,
  rows: SheetSnapshot['rows'],
): SheetMapping['grouping'] {
  if (!col) return null;
  const seen = new Set<string>();
  let started = false;
  for (const row of rows) {
    const cell = row.cells.find((c) => c.col === col);
    const filled = row.cells.some((c) => !isBlank(c));
    if (!filled || isTotalRow(row)) continue;
    const number = textOf(cell);
    if (number === undefined) {
      if (started) return { by: col };
      continue;
    }
    if (seen.has(number)) return { by: col };
    seen.add(number);
    started = true;
  }
  return null;
}
