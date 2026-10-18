// A confirmed customer completes the buyer of a sheet invoice (plan §6 phase 2 ENRICH). The sheet always
// wins: only what it leaves empty is filled, and a sheet SIREN other than the customer's means another
// customer, so nothing is filled at all.
import type { Address, InvoiceDraft } from './model';

/** What the directory confirmed about a customer (the API's `parties` row). */
export interface KnownParty {
  legalName: string;
  siren: string;
  /** A number DGFiP lists, else null. */
  vatId: string | null;
  address: Address | null;
  email: string | null;
}

/** The buyer fields a customer can fill, in the words of the timeline. */
export type FilledField = 'name' | 'siren' | 'vatId' | 'address' | 'email';

/** How a customer's name is matched: case, accents, punctuation and spacing do not count. */
export function partyKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const filled = (v: string | undefined) => (v?.trim() ? v.trim() : undefined);

/** The buyer's SIREN as the sheet gives it. */
export const buyerSirenOf = (draft: InvoiceDraft) => filled(draft.buyer.legalId?.id);

const hasAddress = (a: Address | undefined) =>
  Boolean(a && (filled(a.line1) || filled(a.postCode) || filled(a.city)));

/** The draft with the buyer completed from the customer, and what was filled. */
export function completeBuyer(
  draft: InvoiceDraft,
  party: KnownParty,
): { draft: InvoiceDraft; filled: FilledField[] } {
  const buyer = draft.buyer;
  const siren = buyerSirenOf(draft);
  if (siren !== undefined && siren !== party.siren) return { draft, filled: [] };
  const done: FilledField[] = [];
  const next = { ...buyer };
  if (!filled(buyer.name)) {
    next.name = party.legalName;
    done.push('name');
  }
  if (siren === undefined) {
    next.legalId = { id: party.siren, scheme: '0002' };
    next.electronicAddress = { id: party.siren, scheme: '0225' };
    done.push('siren');
  }
  if (!filled(buyer.vatId) && party.vatId) {
    next.vatId = party.vatId;
    done.push('vatId');
  }
  if (!hasAddress(buyer.address) && party.address) {
    // The sheet may give the country alone (a column with « France »): the customer's address replaces it.
    next.address = { ...party.address };
    done.push('address');
  }
  if (!filled(buyer.contact?.email) && party.email) {
    next.contact = { ...buyer.contact, email: party.email };
    done.push('email');
  }
  return done.length === 0
    ? { draft, filled: [] }
    : { draft: { ...draft, buyer: next }, filled: done };
}
