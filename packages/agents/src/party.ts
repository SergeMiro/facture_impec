// PartyAgent (plan §6 phase 2 ENRICH): finds a customer in the public company directory and asks the
// platform's directory whether it can deliver there. Deterministic on purpose: whether a company exists
// is the directory's answer, never a model's guess, and no customer name goes to a model. The API
// injects the tools (the Annuaire des entreprises, the PDP's lookupRecipient) and saves what the user
// confirms; this file only decides what may be confirmed (guardrail: never an unverified SIREN).
import { type Address, isValidSiren, partyKey } from '@fi/core';
import { t } from '@fi/shared';

/** One company as the public directory describes it (docs/ONBOARDING.md §1.2). */
export interface DirectoryCompany {
  siren: string;
  name: string | null;
  address: Address | null;
  /** From DGFiP's list of active numbers; else the usual key computed from the SIREN, to confirm. */
  vatId: string | null;
  vatSource: 'dgfip' | 'computed';
  /** The company has ceased trading. */
  closed: boolean;
  /** This SIREN is a duplicate; the one to use instead. */
  keptSiren: string | null;
  /** Some fields were withheld at the company's request (partial diffusion). */
  masked: boolean;
}

export interface PartyTools {
  /** Null: no company has this SIREN. Throws when the directory cannot answer. */
  lookup(siren: string): Promise<DirectoryCompany | null>;
  /** Companies matching a name, the directory's best first. Throws when it cannot answer. */
  search(query: { name: string; postCode?: string }, limit: number): Promise<DirectoryCompany[]>;
  /** Can the platform deliver to this SIREN? Null: no platform to ask, or it could not answer. */
  routing(siren: string): Promise<boolean | null>;
}

export interface PartyQuery {
  name?: string | undefined;
  siren?: string | undefined;
  /** Narrows a search by name to companies with an establishment there. */
  postCode?: string | undefined;
}

/** Why a candidate cannot be confirmed. */
export type PartyRefusal = 'closed' | 'duplicate';

export interface PartyCandidate extends DirectoryCompany {
  routing: boolean | null;
  refusal: PartyRefusal | null;
  /** The legal name is the searched name (case, accents and punctuation aside). */
  exactName: boolean;
}

export interface PartyFinding {
  candidates: PartyCandidate[];
  /** Plain French: what the user does next. */
  question: string;
}

/** Candidates shown for a search by name. */
export const PARTY_CANDIDATES = 5;

const refusalOf = (c: DirectoryCompany): PartyRefusal | null =>
  c.closed ? 'closed' : c.keptSiren ? 'duplicate' : null;

async function routingOf(tools: PartyTools, siren: string): Promise<boolean | null> {
  try {
    return await tools.routing(siren);
  } catch {
    return null;
  }
}

/**
 * « Chercher dans l'annuaire »: by SIREN when one is given, else by name (at least 3 letters), retried
 * without the post code when it narrows to nothing (it may be a delivery site's). Companies that cannot
 * be confirmed (closed, duplicate) are listed last, with the reason.
 */
export async function findParty(query: PartyQuery, tools: PartyTools): Promise<PartyFinding> {
  const siren = query.siren?.replace(/\s/g, '');
  let found: DirectoryCompany[];
  if (siren) {
    if (!isValidSiren(siren)) return { candidates: [], question: t('party.question.badSiren') };
    const one = await tools.lookup(siren);
    found = one ? [one] : [];
  } else {
    const name = query.name?.trim() ?? '';
    if (partyKey(name).replace(/ /g, '').length < 3) {
      return { candidates: [], question: t('party.question.tooShort') };
    }
    const postCode = query.postCode?.trim();
    found = await tools.search({ name, ...(postCode && { postCode }) }, PARTY_CANDIDATES);
    if (found.length === 0 && postCode) found = await tools.search({ name }, PARTY_CANDIDATES);
  }
  const key = query.name ? partyKey(query.name) : '';
  const candidates = await Promise.all(
    found.slice(0, PARTY_CANDIDATES).map(
      async (c): Promise<PartyCandidate> => ({
        ...c,
        refusal: refusalOf(c),
        exactName: key !== '' && c.name !== null && partyKey(c.name) === key,
        routing: refusalOf(c) ? null : await routingOf(tools, c.siren),
      }),
    ),
  );
  const rank = (c: PartyCandidate) => (c.refusal ? 2 : c.exactName ? 0 : 1);
  candidates.sort((a, b) => rank(a) - rank(b));
  const question =
    candidates.length === 0
      ? t(siren ? 'party.question.noSiren' : 'party.question.none')
      : candidates.length === 1
        ? t('party.question.one')
        : t('party.question.many', { count: candidates.length });
  return { candidates, question };
}

export type PartyConfirmation =
  | { ok: true; company: DirectoryCompany; routing: boolean | null }
  | { ok: false; reason: 'invalid' | 'unknown' | PartyRefusal; keptSiren?: string };

/**
 * The guardrail of plan §6: a customer is saved only as the directory describes it now, looked up
 * again by SIREN whatever the pane showed. Unknown, closed or duplicate: refused.
 */
export async function confirmParty(siren: string, tools: PartyTools): Promise<PartyConfirmation> {
  if (!isValidSiren(siren)) return { ok: false, reason: 'invalid' };
  const company = await tools.lookup(siren);
  if (!company) return { ok: false, reason: 'unknown' };
  const refusal = refusalOf(company);
  if (refusal === 'duplicate' && company.keptSiren) {
    return { ok: false, reason: refusal, keptSiren: company.keptSiren };
  }
  if (refusal) return { ok: false, reason: refusal };
  return { ok: true, company, routing: await routingOf(tools, siren) };
}
