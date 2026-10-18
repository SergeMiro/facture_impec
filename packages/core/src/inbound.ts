// Supplier invoices received by the company (plan §3 screen 5, §4 `inbound_queue`): their statuses, and
// how a supplier and an IBAN are recognised from one invoice to the next.
import { isSirenShape, isSiretShape } from './ids';
import type { Invoice, Party } from './model';

export const INBOUND_STATES = ['new', 'approved', 'disputed', 'exported'] as const;
export type InboundState = (typeof INBOUND_STATES)[number];
export type InboundEvent = 'approve' | 'dispute' | 'export';

/**
 * Approved invoices can still be disputed until they leave for the accountant; an exported one stays
 * exported (the accountant reverses it in the books, docs/DEFERRED.md).
 */
const MOVES: Readonly<Record<InboundEvent, { from: readonly InboundState[]; to: InboundState }>> = {
  approve: { from: ['new', 'disputed'], to: 'approved' },
  dispute: { from: ['new', 'approved'], to: 'disputed' },
  export: { from: ['approved'], to: 'exported' },
};

/** The status after `event`, or null when the event cannot happen from `from`. */
export function inboundTransition(from: InboundState, event: InboundEvent): InboundState | null {
  const move = MOVES[event];
  return move.from.includes(from) ? move.to : null;
}

/** UNTDID 1001 credit-note codes of the EN 16931 subset (UBL writes them as a CreditNote). */
export const CREDIT_NOTE_CODES: readonly string[] = [
  '81',
  '83',
  '261',
  '262',
  '296',
  '308',
  '381',
  '396',
  '420',
  '458',
  '532',
];

export const isCreditNote = (invoice: Pick<Invoice, 'typeCode'>) =>
  CREDIT_NOTE_CODES.includes(invoice.typeCode ?? '');

const compact = (value: string) => value.replace(/\s+/g, '').toUpperCase();

/** A party's SIREN: its legal id, the first nine digits of its SIRET, or a French VAT number. */
export function partySiren(party: Party): string | undefined {
  const legal = party.legalId && compact(party.legalId.id);
  if (legal && isSirenShape(legal) && (!party.legalId?.scheme || party.legalId.scheme === '0002')) {
    return legal;
  }
  for (const id of party.ids) {
    const value = compact(id.id);
    if (isSiretShape(value) && (!id.scheme || id.scheme === '0009')) return value.slice(0, 9);
  }
  const vat = party.vatId && compact(party.vatId);
  if (vat && /^FR[0-9A-Z]{2}\d{9}$/.test(vat)) return vat.slice(4);
  return undefined;
}

/**
 * What recognises a supplier from one invoice to the next: its SIREN, else its VAT number, else its
 * name. Undefined when the invoice names nothing at all.
 */
export function supplierKey(seller: Party): string | undefined {
  const siren = partySiren(seller);
  if (siren) return `siren:${siren}`;
  if (seller.vatId?.trim()) return `vat:${compact(seller.vatId)}`;
  const name = seller.name
    ?.normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return name ? `name:${name}` : undefined;
}

/** The IBANs an invoice asks to be paid on, without spaces, upper case. */
export function invoiceIbans(invoice: Invoice): string[] {
  const ibans = (invoice.payment?.accounts ?? [])
    .map((a) => (a.iban ? compact(a.iban) : ''))
    .filter((iban) => iban !== '');
  return [...new Set(ibans)];
}

/** « FR76 •••• •••• 0189 »: enough to compare two IBANs on screen, not enough to pay. */
export function maskIban(iban: string): string {
  const value = compact(iban);
  if (value.length < 8) return value;
  return `${value.slice(0, 4)} •••• •••• ${value.slice(-4)}`;
}

/** What the InboundAgent can notice on a supplier invoice (packages/agents/src/inbound.ts). */
export const INBOUND_FLAGS = {
  unreadable: 'block',
  other_buyer: 'block',
  duplicate: 'block',
  amounts: 'block',
  iban_changed: 'alert',
  possible_duplicate: 'warn',
  iban_invalid: 'warn',
  foreign_currency: 'warn',
  rules: 'info',
  new_supplier: 'info',
  credit_note: 'info',
} as const;
export type InboundFlagCode = keyof typeof INBOUND_FLAGS;
/**
 * block: it can only be disputed; alert: it is approved only once the user says they checked;
 * warn and info: shown, nothing more.
 */
export type InboundFlagLevel = (typeof INBOUND_FLAGS)[InboundFlagCode];

export interface InboundFlag {
  code: InboundFlagCode;
  params?: Record<string, string | number>;
  /** The rules' French messages behind `amounts` and `rules`, at most a few. */
  details?: string[];
  /** The earlier invoice a duplicate repeats. */
  relatedId?: string;
}

/** `triage_json`. */
export interface InboundTriage {
  flags: InboundFlag[];
}

export const flagLevel = (flag: Pick<InboundFlag, 'code'>): InboundFlagLevel =>
  INBOUND_FLAGS[flag.code];
