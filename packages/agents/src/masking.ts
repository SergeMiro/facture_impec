// What each agent is allowed to see: an invoice or a sheet with personal data replaced by tokens.
import {
  columnIndex,
  type Invoice,
  normalizeHeader,
  type Party,
  type SheetMapping,
  type SheetSnapshot,
} from '@fi/core';
import type { Pseudonymizer, TokenKind } from './pseudonymize';

/** Fields that never hold personal data: codes, dates, quantities, rates. Everything else is masked. */
const KEEP = new Set([
  'number',
  'issueDate',
  'dueDate',
  'taxPointDate',
  'date',
  'start',
  'end',
  'typeCode',
  'currency',
  'vatCurrency',
  'vatDueOn',
  'specificationId',
  'processType',
  'scheme',
  'subjectCode',
  'category',
  'rate',
  'vatRate',
  'percentage',
  'quantity',
  'unitCode',
  'net',
  'gross',
  'discount',
  'baseQuantity',
  'baseUnitCode',
  'country',
  'postCode',
  'city',
  'meansCode',
  'exemptionCode',
  'reasonCode',
  'nature',
  'originCountry',
]);

function protectParty(p: Pseudonymizer, party: Party | undefined) {
  if (!party) return;
  p.protect('PARTY', party.name).protect('PARTY', party.tradingName);
  for (const id of party.ids) p.protect(id.scheme === '0009' ? 'SIRET' : 'SIREN', id.id);
  p.protect('SIREN', party.legalId?.id).protect('VAT', party.vatId);
  p.protect('VAT', party.taxRegistrationId);
  const address = party.electronicAddress;
  if (address) p.protect(address.scheme === 'EM' ? 'EMAIL' : 'SIREN', address.id);
  p.protect('ADDRESS', party.address?.line1).protect('ADDRESS', party.address?.line2);
  p.protect('ADDRESS', party.address?.line3);
  p.protect('PERSON', party.contact?.name).protect('EMAIL', party.contact?.email);
  p.protect('PHONE', party.contact?.phone);
}

function maskWalk(p: Pseudonymizer, value: unknown, key = ''): unknown {
  if (typeof value === 'string') return KEEP.has(key) ? value : p.mask(value);
  if (Array.isArray(value)) return value.map((v) => maskWalk(p, v, key));
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskWalk(p, v, k)]));
  return value;
}

/** The invoice as a model may see it. Amounts (numbers), dates and descriptions stay readable. */
export function maskInvoice(p: Pseudonymizer, invoice: Invoice): Invoice {
  protectParty(p, invoice.seller);
  protectParty(p, invoice.buyer);
  p.protect('PARTY', invoice.delivery?.name);
  p.protect('ADDRESS', invoice.delivery?.address?.line1);
  for (const a of invoice.payment?.accounts ?? [])
    p.protect('IBAN', a.iban).protect('PARTY', a.name).protect('BIC', a.bic);
  return maskWalk(p, invoice) as Invoice;
}

const PERSONAL_FIELDS: Partial<Record<string, TokenKind>> = {
  buyerName: 'PARTY',
  buyerSiren: 'SIREN',
  buyerSiret: 'SIRET',
  buyerVatId: 'VAT',
  buyerEmail: 'EMAIL',
  buyerAddress: 'ADDRESS',
};

/** Headers that announce personal values even when the heuristic did not map the column. */
const PERSONAL_HEADER =
  /\b(client|cli|clt|qui|nom|raison sociale|rs|destinataire|dest|societe|ste|ets|etablissement|enseigne|entreprise|acheteur|payeur|contact|interlocuteur|adresse|adr|rue|e ?mail|mail|courriel|tel|telephone|portable|mobile|iban|rib|siren|siret|tva intra|customer|client name|buyer|name|address|phone)\b/;

/**
 * The sheet as MappingAgent sees it. Header cells stay as written. Below the header, a column the
 * heuristic maps to a personal field, or whose header announces one, is masked as a whole; other
 * cells go through the pattern detectors.
 */
export function maskSnapshot(
  p: Pseudonymizer,
  snapshot: SheetSnapshot,
  hint: Pick<SheetMapping, 'headerRow' | 'mapping'>,
): SheetSnapshot {
  const personal = new Map<string, TokenKind>();
  for (const [field, m] of Object.entries(hint.mapping)) {
    const kind = PERSONAL_FIELDS[field];
    if (m && kind) personal.set(m.column, kind);
  }
  const header = snapshot.rows.find((r) => r.row === hint.headerRow);
  for (const cell of header?.cells ?? []) {
    if (!personal.has(cell.col) && PERSONAL_HEADER.test(normalizeHeader(cell.text)))
      personal.set(cell.col, 'PARTY');
  }
  return {
    sheet: snapshot.sheet,
    rows: snapshot.rows.map((row) => ({
      row: row.row,
      cells: row.cells.map((cell) => {
        if (row.row <= hint.headerRow) return { ...cell, text: p.mask(cell.text) };
        const kind = personal.get(cell.col);
        const text = kind && cell.text.trim() ? p.token(kind, cell.text) : p.mask(cell.text);
        // Numbers stay numbers (amounts, quantities); text values are replaced by their masked text.
        const value = typeof cell.value === 'string' ? text : kind ? text : cell.value;
        return { ...cell, value, text };
      }),
    })),
  };
}

export const columnOrder = (a: string, b: string) => columnIndex(a) - columnIndex(b);
