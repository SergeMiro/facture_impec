// Dictionary layouts: what kind of sheet this is (its name, its headers) and which column holds what.
// The fallback when AI is off or fails, and the hint LayoutAgent starts from. Line columns share the
// invoice dictionary (src/sheet/detect.ts); what differs is the document's own number, date and
// company, and how the kind changes a header's meaning: « N° commande » numbers an order, but on a
// delivery note it is the order delivered.
import { t } from '@fi/shared';
import { isBlank, type RawCell, type SheetSnapshot } from '../sheet/cells';
import { hasWords, headerScore, holdsRates, normalizeHeader } from '../sheet/detect';
import { CONFIRM_BELOW, type FieldMapping, type InvoiceField } from '../sheet/fields';
import {
  DOC_KINDS,
  type DocKind,
  fieldAllowed,
  isDocKind,
  KEY_LAYOUT_FIELDS,
  LAYOUT_FIELDS,
  type LayoutField,
  type LayoutKind,
  type LayoutMapping,
} from './fields';

interface Words {
  exact: readonly string[];
  contains?: readonly string[];
  weak?: readonly string[];
  never?: readonly string[];
}

/** The invoice dictionary already knows the line columns. */
const SAME_AS: Partial<Record<LayoutField, InvoiceField>> = {
  itemRef: 'itemRef',
  itemName: 'itemName',
  quantity: 'quantity',
  unit: 'unitCode',
  unitPrice: 'unitPrice',
  lineNet: 'lineNet',
  vatRate: 'vatRate',
};

const ORDER_WORDS = ['commande', 'cde', 'bc', 'order', 'po'];

const OWN: Partial<Record<LayoutField, Words>> = {
  docNumber: {
    exact: [
      'n commande',
      'n de commande',
      'numero de commande',
      'numero commande',
      'n cde',
      'cde',
      'n bc',
      'bon de commande',
      'n bon',
      'n bl',
      'bl',
      'n bon de livraison',
      'numero bl',
      'numero de bl',
      'bon de livraison',
      'n livraison',
      'n piece',
      'numero de piece',
      'piece',
      'n document',
      'n achat',
      'n bon d achat',
      'cde n',
      'commande n',
      'bon n',
      'bl n',
      'achat n',
      'po',
      'po n',
      'po number',
      'purchase order',
      'commande',
      'ref commande',
      'reference commande',
      'order number',
      'order no',
      'numero',
      'num',
      'n',
      'no',
    ],
    contains: [
      'n commande',
      'numero de commande',
      'n cde',
      'n bc',
      'n bl',
      'bon de livraison',
      'bon de commande',
      'n bon',
      'n piece',
      'order number',
    ],
    weak: ['numero', 'bon'],
    never: ['client', 'fournisseur', 'article', 'produit', 'siren', 'siret', 'tva', 'ligne', 'tel'],
  },
  docDate: {
    exact: [
      'date',
      'date commande',
      'date de commande',
      'date de la commande',
      'date cde',
      'date livraison',
      'date de livraison',
      'livre le',
      'date bl',
      'date d expedition',
      'expedie le',
      'date achat',
      'date d achat',
      'date piece',
      'date document',
      'order date',
      'delivery date',
    ],
    weak: ['date', 'le'],
  },
  partyName: {
    exact: [
      'client',
      'nom client',
      'nom du client',
      'client nom',
      'raison sociale',
      'societe',
      'entreprise',
      'fournisseur',
      'nom fournisseur',
      'nom du fournisseur',
      'frs',
      'fourn',
      'nom frs',
      'destinataire',
      'acheteur',
      'tiers',
      'enseigne',
      'customer',
      'supplier',
      'vendor',
      'nom',
    ],
    contains: ['client', 'fournisseur', 'raison sociale', 'destinataire', 'customer', 'supplier'],
    never: [
      'ref',
      'reference',
      'code',
      'n',
      'no',
      'numero',
      'id',
      'siren',
      'siret',
      'tva',
      'adresse',
      'ville',
      'cp',
      'mail',
      'email',
      'tel',
      'contact',
      'commande',
      'pays',
    ],
  },
  partySiren: {
    exact: [
      'siren',
      'n siren',
      'numero siren',
      'siren client',
      'siren fournisseur',
      'siret',
      'n siret',
      'siret client',
      'siret fournisseur',
      'siren siret',
    ],
    contains: ['siren', 'siret'],
  },
  orderRef: {
    exact: [
      'n commande',
      'n de commande',
      'numero de commande',
      'numero commande',
      'commande',
      'ref commande',
      'reference commande',
      'n cde',
      'cde',
      'n bc',
      'bc',
      'bon de commande',
      'n bon de commande',
      'votre commande',
      'commande client',
      'n commande client',
      'order',
      'order number',
      'po',
    ],
    contains: ['commande', 'cde', 'order'],
    never: ['date', 'qte', 'quantite', 'fournisseur', 'montant', 'total'],
  },
};

const any = (h: string, words: readonly string[]) => words.some((w) => hasWords(h, w));

function wordsScore(h: string, w: Words | undefined): number {
  if (!w || (w.never && any(h, w.never))) return 0;
  if (w.exact.includes(h)) return 0.95;
  if (w.contains && any(h, w.contains)) return 0.85;
  if (w.weak && any(h, w.weak)) return 0.65;
  return 0;
}

const SALE_PRICE = ['vente', 'pv', 'public', 'tarif'];
const COST_PRICE = ['achat', 'pa', 'cout', 'revient', 'cost'];
const SUPPLIER_WORDS = ['fournisseur', 'frs', 'fourn', 'supplier', 'vendor'];

/** What the kind changes in a header's meaning. */
function forKind(field: LayoutField, h: string, kind: DocKind, score: number): number {
  switch (field) {
    case 'docNumber':
      // On a delivery note the order is another document; on any document, an invoice is.
      if (kind === 'delivery' && any(h, ORDER_WORDS)) return 0;
      if (kind !== 'delivery' && any(h, ['bl', 'livraison'])) return 0;
      if (any(h, ['facture', 'devis'])) return 0;
      return score;
    case 'docDate': {
      const later = any(h, ['livraison', 'livre', 'echeance', 'souhaitee', 'prevue', 'expedition']);
      if (kind === 'delivery') {
        if (any(h, ORDER_WORDS)) return Math.min(score, 0.6);
        return score;
      }
      return later ? Math.min(score, 0.6) : score;
    }
    case 'partyName': {
      const supplier = any(h, SUPPLIER_WORDS);
      const customer = any(h, ['client', 'customer', 'acheteur', 'destinataire']);
      if (kind === 'purchase') return customer && !supplier ? Math.min(score, 0.6) : score;
      return supplier ? 0 : score;
    }
    case 'quantity': {
      if (score === 0 || any(h, ['reliquat', 'restant', 'reste'])) return 0;
      const delivered = any(h, ['livree', 'livrees', 'livre', 'livres']);
      const ordered = any(h, ['commandee', 'commandees', 'commande', 'cde', 'cdee', 'cdees']);
      if (kind === 'delivery') return delivered ? 0.95 : ordered ? 0.6 : score;
      if (kind === 'order') return ordered ? 0.95 : delivered ? 0.6 : score;
      return score;
    }
    case 'unitPrice': {
      const sale = any(h, SALE_PRICE);
      const cost = any(h, COST_PRICE);
      if (kind === 'purchase') return sale ? 0 : cost && score > 0 ? 0.95 : score;
      if (cost) return 0;
      if (kind === 'price_list' && sale && score > 0) return 0.95;
      return score;
    }
    case 'itemRef':
      if (score === 0 && h === 'code') return 0.65;
      if (kind === 'purchase' && score > 0 && any(h, ['fournisseur', 'frs'])) return 0.9;
      return score;
    default:
      return score;
  }
}

/** How well one header names one field on a sheet of that kind: 0 when it does not. */
export function layoutHeaderScore(header: string, field: LayoutField, kind: DocKind): number {
  if (!fieldAllowed(kind, field)) return 0;
  const h = normalizeHeader(header);
  if (h === '') return 0;
  const same = SAME_AS[field];
  // « Prix de vente HT », « Prix d'achat » say « prix » and more: the invoice dictionary calls them weak.
  let base = same ? headerScore(header, same) : wordsScore(h, OWN[field]);
  if (field === 'unitPrice' && base === 0 && hasWords(h, 'prix')) base = 0.65;
  if (field === 'unitPrice' && base === 0 && (h === 'pv ht' || h === 'pa ht')) base = 0.85;
  // « PU achat HT », « Unit cost »: a unit price that names what it costs.
  if (field === 'unitPrice' && base === 0 && (hasWords(h, 'pu') || h === 'unit cost')) base = 0.85;
  return forKind(field, h, kind, base);
}

const KIND_NAMES: readonly (readonly [LayoutKind, readonly string[]])[] = [
  [
    'purchase',
    [
      'achat',
      'achats',
      'fournisseur',
      'fournisseurs',
      'approvisionnement',
      'approvisionnements',
      'appro',
      'purchases',
      'purchase',
    ],
  ],
  [
    'delivery',
    ['bl', 'bls', 'livraison', 'livraisons', 'expedition', 'expeditions', 'delivery', 'deliveries'],
  ],
  ['order', ['commande', 'commandes', 'cde', 'cdes', 'bc', 'orders', 'order']],
  [
    'price_list',
    [
      'tarif',
      'tarifs',
      'prix',
      'catalogue',
      'grille',
      'price list',
      'prices',
      'articles',
      'produits',
    ],
  ],
  ['invoice', ['facture', 'factures', 'facturation', 'invoices', 'invoice']],
];

/** The kind a sheet's name says, purchases first: « Commandes fournisseurs » are purchases. */
export function kindFromName(sheet: string): LayoutKind | null {
  const h = normalizeHeader(sheet);
  for (const [kind, words] of KIND_NAMES) if (any(h, words)) return kind;
  return null;
}

/** The kind the headers say, from the columns only one kind of document has. */
function kindFromHeaders(headers: readonly string[]): LayoutKind | null {
  const hs = headers.map(normalizeHeader).filter((h) => h !== '');
  const has = (test: (h: string) => boolean) => hs.some(test);
  if (has((h) => any(h, SUPPLIER_WORDS))) return 'purchase';
  if (
    has(
      (h) =>
        any(h, ['bl', 'livree', 'livrees', 'bon de livraison', 'n livraison', 'transporteur']) &&
        !any(h, ['date']),
    )
  )
    return 'delivery';
  if (has((h) => any(h, ['facture', 'echeance']) && !any(h, ['date de livraison'])))
    return 'invoice';
  const numbered = has((h) => wordsScore(h, OWN.docNumber) >= 0.85);
  if (has((h) => any(h, ['commande', 'cde', 'bc'])) && numbered) return 'order';
  const dated = has((h) => wordsScore(h, OWN.docDate) > 0);
  const priced = has((h) => any(h, ['prix', 'tarif', 'pv', 'pu']));
  if (!numbered && !dated && priced) return 'price_list';
  return null;
}

/** The kind of the sheet and how sure: name and headers agree 0.95, one of them 0.85 or 0.8. */
export function detectKind(
  snapshot: SheetSnapshot,
  headerRow: number,
): { kind: LayoutKind; confidence: number } {
  const header = snapshot.rows.find((r) => r.row === headerRow);
  const texts = (header?.cells ?? []).map((c) => (typeof c.value === 'string' ? c.value : c.text));
  const byName = kindFromName(snapshot.sheet);
  const byHeaders = kindFromHeaders(texts);
  if (byName && byHeaders) {
    // The name is the user's own word for the sheet; the pane asks when the headers say otherwise.
    return { kind: byName, confidence: byName === byHeaders ? 0.95 : 0.6 };
  }
  if (byName) return { kind: byName, confidence: 0.85 };
  if (byHeaders) return { kind: byHeaders, confidence: 0.8 };
  return { kind: 'other', confidence: 0.5 };
}

const HEADER_SCAN_ROWS = 30;
const SAMPLE_ROWS = 50;

const textOfHeader = (c: RawCell) => (typeof c.value === 'string' ? c.value : '');

/** The row of labels: the one where most cells name a field of some kind of document. */
function findHeaderRow(snapshot: SheetSnapshot): number | undefined {
  let best: { row: number; score: number } | undefined;
  for (const row of snapshot.rows.slice(0, HEADER_SCAN_ROWS)) {
    const score = row.cells.filter((c) => {
      const text = textOfHeader(c);
      return (
        text !== '' &&
        DOC_KINDS.some((k) => LAYOUT_FIELDS.some((f) => layoutHeaderScore(text, f, k) > 0))
      );
    }).length;
    if (score >= 2 && (!best || score > best.score)) best = { row: row.row, score };
  }
  return best?.row;
}

/** Proposes the kind and the columns from the sheet name and headers alone; `source: 'heuristic'`. */
export function detectLayout(snapshot: SheetSnapshot): LayoutMapping {
  const headerRow = findHeaderRow(snapshot) ?? snapshot.rows[0]?.row ?? 1;
  const { kind, confidence: kindConfidence } = detectKind(snapshot, headerRow);
  const mapping = detectColumns(snapshot, headerRow, kind);
  return {
    sheet: snapshot.sheet,
    kind,
    kindConfidence,
    headerRow,
    mapping,
    warnings: layoutWarnings(kind, mapping),
    source: 'heuristic',
  };
}

/** The columns of a sheet of that kind: best pairs first, one column per field, one field per column. */
export function detectColumns(
  snapshot: SheetSnapshot,
  headerRow: number,
  kind: LayoutKind,
): LayoutMapping['mapping'] {
  // An invoice sheet or an unknown one is still read as an order: the user may say what it is.
  const as: DocKind = isDocKind(kind) ? kind : 'order';
  const header = snapshot.rows.find((r) => r.row === headerRow);
  const below = snapshot.rows.filter((r) => r.row > headerRow).slice(0, SAMPLE_ROWS);
  const values = (col: string) =>
    below.map((r) => r.cells.find((c) => c.col === col)).filter((c): c is RawCell => !isBlank(c));
  const candidates: { field: LayoutField; col: string; confidence: number }[] = [];
  for (const cell of header?.cells ?? []) {
    const text = textOfHeader(cell);
    for (const field of LAYOUT_FIELDS) {
      const confidence = layoutHeaderScore(text, field, as);
      if (confidence === 0) continue;
      const bare = ['tva', 'vat', 'taux'].includes(normalizeHeader(text)) || confidence < 0.85;
      if (field === 'vatRate' && bare && !holdsRates(values(cell.col))) continue;
      candidates.push({ field, col: cell.col, confidence });
    }
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  const mapping: Partial<Record<LayoutField, FieldMapping>> = {};
  const used = new Set<string>();
  for (const c of candidates) {
    if (mapping[c.field] || used.has(c.col)) continue;
    mapping[c.field] = {
      column: c.col,
      confidence: c.confidence,
      needsConfirmation: c.confidence < CONFIRM_BELOW,
    };
    used.add(c.col);
  }
  return mapping;
}

/** « Colonne introuvable » for the key fields that kind of document has. */
export function layoutWarnings(kind: LayoutKind, mapping: LayoutMapping['mapping']): string[] {
  if (!isDocKind(kind)) return [t(`layout.warning.${kind}`)];
  return KEY_LAYOUT_FIELDS.filter((f) => fieldAllowed(kind, f) && f !== 'itemRef' && !mapping[f])
    .filter((f) => !(f === 'unitPrice' && fieldAllowed(kind, 'lineNet') && mapping.lineNet))
    .filter((f) => !((f === 'itemName' || f === 'quantity') && kind === 'price_list'))
    .map((f) => t('sheet.warning.missing', { field: t(`layout.field.${f}`) }));
}

/**
 * The header row's labels as one line, column by column: what a layout profile is recognized by.
 * Null when fewer than two labels (nothing to recognize).
 */
export function headerSignature(snapshot: SheetSnapshot, headerRow: number): string | null {
  const header = snapshot.rows.find((r) => r.row === headerRow);
  const labels = (header?.cells ?? [])
    .map((c) => ({ col: c.col, text: normalizeHeader(c.text) }))
    .filter((c) => c.text !== '');
  if (labels.length < 2) return null;
  return labels.map((c) => `${c.col}=${c.text}`).join('|');
}

/** Every row that could be the header, with its signature: a known profile may start on any. */
export function headerSignatures(snapshot: SheetSnapshot): { row: number; signature: string }[] {
  return snapshot.rows.slice(0, HEADER_SCAN_ROWS).flatMap((r) => {
    const signature = headerSignature(snapshot, r.row);
    return signature ? [{ row: r.row, signature }] : [];
  });
}
