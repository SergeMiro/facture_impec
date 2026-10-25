// What every invoice the company makes carries, whether a sheet's rows or the memory (memory M6)
// gave its lines: the seller and the payment from the company's profile, the legal notes, the terms,
// and the notes a retenue de garantie or a situation adds. One place, so both make the same invoice.
import { t } from '@fi/shared';
import { computeInvoice } from '../compute';
import type { BtpFacts, InvoiceDraft, Note, Party } from '../model';
import { frDecimal, frMoney } from '../pdf/format';
import type { InvoiceDefaults, SellerProfile } from './fields';

/** BT-23 from the company's « catégorie de l'opération ». */
export const PROCESS_TYPE = { goods: 'B1', services: 'S1', mixed: 'M1' } as const;

/** The seller (BG-4): the tenant, its SIRET from its settings. */
export function sellerParty(seller: SellerProfile, defaults: InvoiceDefaults): Party {
  return {
    name: seller.name,
    ids: defaults.siret ? [{ id: defaults.siret, scheme: '0009' }] : [],
    legalId: { id: seller.siren, scheme: '0002' },
    ...(seller.vatId && { vatId: seller.vatId }),
    electronicAddress: { id: seller.siren, scheme: '0225' },
    ...(seller.address && { address: seller.address }),
  };
}

/** BG-16: the means and the company's account. */
export function paymentOf(seller: SellerProfile, defaults: InvoiceDefaults) {
  return {
    meansCode: defaults.paymentMeansCode,
    accounts: defaults.iban ? [{ iban: defaults.iban, name: seller.name, bic: defaults.bic }] : [],
  };
}

/** The mentions every invoice between companies carries (PMT, PMD, AAB), the company's or the law's. */
export function legalNotes(defaults: InvoiceDefaults): Note[] {
  return [
    { subjectCode: 'PMT', text: defaults.recoveryFeeNote ?? t('invoice.default.note.PMT') },
    { subjectCode: 'PMD', text: defaults.latePenaltyNote ?? t('invoice.default.note.PMD') },
    { subjectCode: 'AAB', text: defaults.discountNote ?? t('invoice.default.note.AAB') },
  ];
}

/** BT-20 from the company's settings. */
export const paymentTermsOf = (defaults: InvoiceDefaults) =>
  defaults.paymentTerms ??
  (defaults.paymentDays !== undefined
    ? t('invoice.default.paymentTerms', { days: defaults.paymentDays })
    : undefined);

/** BT-9 when nothing gives it: the issue date plus the company's payment days. */
export function dueDateOf(issueDate: string | undefined, defaults: InvoiceDefaults) {
  if (defaults.paymentDays === undefined || issueDate?.length !== 10) return undefined;
  const ms = Date.parse(`${issueDate}T00:00:00Z`) + defaults.paymentDays * 86_400_000;
  return Number.isFinite(ms) ? new Date(ms).toISOString().slice(0, 10) : undefined;
}

export function taxInclusive(draft: InvoiceDraft): number | undefined {
  try {
    return computeInvoice(draft).totals.taxInclusive;
  } catch {
    return undefined;
  }
}

/**
 * The building-trade facts on `draft`: a retenue given as a rate alone is computed on the TTC, and
 * the retenue and the situation are written as notes.
 */
export function withBtp(draft: InvoiceDraft, btp: BtpFacts): void {
  const { retenue, situation } = btp;
  const notes = draft.notes ?? [];
  draft.notes = notes;
  // A rate alone holds that share of the TTC (loi n° 71-584, art. 1: « leur montant »), rounded
  // down: half a cent up would hold more than the 5 % the law allows (BTP-RG-01).
  const ttc = retenue?.rateBps && retenue.amount === undefined ? taxInclusive(draft) : undefined;
  if (retenue && ttc !== undefined)
    retenue.amount = Math.floor((ttc * (retenue.rateBps ?? 0)) / 10_000);
  // XP Z12-014 annexe A cas n°26: the retenue is a note ABU; a situation has no field at all, so a
  // note AAI. TODO(verify) that a PDP passes AAI through unchanged (docs/TODO.md).
  if (retenue) notes.push({ subjectCode: 'ABU', text: retenueNote(retenue, draft.currency) });
  if (situation) {
    const number = String(situation.number);
    notes.push({
      subjectCode: 'AAI',
      text:
        situation.cumulative === undefined
          ? t('invoice.default.note.AAI.situation', { number })
          : t('invoice.default.note.AAI.cumulative', {
              number,
              cumulative: frMoney(situation.cumulative, draft.currency),
            }),
    });
  }
  draft.btp = btp;
}

function retenueNote(retenue: NonNullable<BtpFacts['retenue']>, currency: string | undefined) {
  const amount = retenue.amount === undefined ? undefined : frMoney(retenue.amount, currency);
  if (!retenue.rateBps) return t('invoice.default.note.ABU.amount', { amount: amount ?? '' });
  const rate = frDecimal(String(retenue.rateBps / 100));
  return amount === undefined
    ? t('invoice.default.note.ABU.rateOnly', { rate })
    : t('invoice.default.note.ABU.rate', { rate, amount });
}
