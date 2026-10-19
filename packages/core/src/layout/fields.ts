// The company's other sheets (R1): customer orders, delivery notes, purchases, price lists. They are
// read into the registry, never turned into invoices. LayoutAgent (or the dictionary) says which kind
// a sheet is and which column holds what; nothing is read before the user confirms it.
import { z } from 'zod';
import { FieldMapping } from '../sheet/fields';

/** The kinds the registry reads from a sheet. */
export const DOC_KINDS = ['order', 'delivery', 'purchase', 'price_list'] as const;
export type DocKind = (typeof DOC_KINDS)[number];

/** A sheet may also hold invoices (they have their own path) or nothing the registry reads. */
export const LAYOUT_KINDS = [...DOC_KINDS, 'invoice', 'other'] as const;
export type LayoutKind = (typeof LAYOUT_KINDS)[number];

export const isDocKind = (kind: LayoutKind): kind is DocKind =>
  (DOC_KINDS as readonly string[]).includes(kind);

/** Orders, delivery notes and price lists are the company's sales; purchases come from suppliers. */
export const DIRECTION: Readonly<Record<DocKind, 'out' | 'in'>> = {
  order: 'out',
  delivery: 'out',
  purchase: 'in',
  price_list: 'out',
};

export const LAYOUT_FIELDS = [
  'docNumber',
  'docDate',
  'partyName',
  'partySiren',
  'orderRef',
  'itemRef',
  'itemName',
  'quantity',
  'unit',
  'unitPrice',
  'lineNet',
  'vatRate',
] as const;
export type LayoutField = (typeof LAYOUT_FIELDS)[number];

/** The fields the LayoutAgent eval scores, with the kind (R1: ≥ 95 %). */
export const KEY_LAYOUT_FIELDS = [
  'docNumber',
  'docDate',
  'partyName',
  'itemRef',
  'itemName',
  'quantity',
  'unitPrice',
] as const satisfies readonly LayoutField[];

/** Read once per document, from the first row of its group that has it. */
export const DOC_LEVEL_FIELDS: ReadonlySet<LayoutField> = new Set([
  'docNumber',
  'docDate',
  'partyName',
  'partySiren',
  'orderRef',
]);

/** A price list is one document, the company's own: it has no number, date or other company. */
export const PRICE_LIST_FIELDS: ReadonlySet<LayoutField> = new Set([
  'itemRef',
  'itemName',
  'unit',
  'unitPrice',
  'vatRate',
]);

/** Only a delivery note says which order it delivers. */
export function fieldAllowed(kind: LayoutKind, field: LayoutField): boolean {
  if (kind === 'price_list') return PRICE_LIST_FIELDS.has(field);
  if (field === 'orderRef') return kind === 'delivery';
  return true;
}

export const LayoutMapping = z.object({
  sheet: z.string().min(1),
  kind: z.enum(LAYOUT_KINDS),
  /** How sure the proposer is of the kind: below 0.8 the pane asks. */
  kindConfidence: z.number().min(0).max(1).default(1),
  headerRow: z.number().int().positive(),
  /** Rows sharing a number are one document; a blank number continues the one above. */
  mapping: z.partialRecord(z.enum(LAYOUT_FIELDS), FieldMapping),
  /** Plain French notes for the user. */
  warnings: z.array(z.string()).default([]),
  /** The agent, the dictionary, a profile the company confirmed before, or the user after editing. */
  source: z.enum(['agent', 'heuristic', 'profile', 'user']).default('heuristic'),
});
export type LayoutMapping = z.infer<typeof LayoutMapping>;
export type LayoutMappingInput = z.input<typeof LayoutMapping>;
