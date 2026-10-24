// The dates and companies a document names, read by patterns (`docs/DECISIONS.md` D7: these dates
// make legal deadlines, so a missed one is a question to a person, never a model's guess). Every
// date must follow its label (« délivrée le », « à jour au », « valable du … au … », « réception
// prononcée le »); a SIREN counts only with a valid check digit. The labels come from public
// templates of each document, not from pilots' real ones: TODO(verify) once pilots send theirs.
import { isIsoDate, isValidSiren, isValidSiret } from '@fi/core';
import { normalizeText } from './classify';

export interface DocumentFields {
  /** When it was issued or last updated (an attestation's « délivrée le », a Kbis' « à jour au »). */
  issuedOn: string | null;
  validFrom: string | null;
  /** When it stops being valid (an insurance's end of cover). */
  validTo: string | null;
  /** When the work was received (a PV de réception). */
  receptionOn: string | null;
  /** The SIRENs it names, in order of appearance, once each (from a SIREN, a SIRET or a VAT number). */
  sirens: string[];
}

const MONTHS = [
  'janvier',
  'fevrier',
  'mars',
  'avril',
  'mai',
  'juin',
  'juillet',
  'aout',
  'septembre',
  'octobre',
  'novembre',
  'decembre',
];

const DATE = String.raw`(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{1,2}(?:er)? (?:${MONTHS.join('|')}) \d{4}|\d{4}-\d{2}-\d{2})`;

/** « 05/03/2026 », « 5.3.2026 », « 1er mars 2026 », « 2026-03-05 » (normalized) → ISO, or null. */
export function parseFrenchDate(text: string): string | null {
  let y: number;
  let m: number;
  let d: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const numeric = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(text);
  const written = /^(\d{1,2})(?:er)? ([a-z]+) (\d{4})$/.exec(text);
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (numeric) [d, m, y] = [Number(numeric[1]), Number(numeric[2]), Number(numeric[3])];
  else if (written) {
    [d, m, y] = [Number(written[1]), MONTHS.indexOf(written[2] ?? '') + 1, Number(written[3])];
  } else return null;
  const out = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isIsoDate(out) ? out : null;
}

const re = (source: string) => new RegExp(source, 'g');

const ISSUED = [
  re(`(?:delivree?|etablie?|editee?|emise?|generee?|imprimee?) le ?:? ?${DATE}`),
  re(`date (?:de |d')?(?:delivrance|emission|edition|etablissement) ?:? ?${DATE}`),
  re(`a jour au ?:? ?${DATE}`),
  re(`fait a [a-z' -]{2,40},? le ?${DATE}`),
  re(`fait le ?${DATE}`),
];
const VALIDITY = re(
  String.raw`(?:validite|valable|valide|periode|garantie|couverture|effet)[\s\S]{0,60}?du ?${DATE} ?(?:au|jusqu'au) ?${DATE}`,
);
const VALID_TO = [
  re(`(?:valable|valide) jusqu'(?:au|a) ?${DATE}`),
  re(`(?:date de )?fin de (?:validite|garantie|couverture) ?:? ?${DATE}`),
  re(`date d'(?:echeance|expiration) ?:? ?${DATE}`),
  // « du 1er janvier au 31 décembre 2026 »: the start without its year.
  re(
    `(?:validite|periode|garantie|couverture)[^.]{0,40}?\\bdu \\d{1,2}(?:er)? (?:${MONTHS.join('|')}) au ?${DATE}`,
  ),
];
const RECEPTION = [
  re(
    String.raw`reception[\s\S]{0,80}?(?:prononcee|effectuee|intervenue|acceptee)[\s\S]{0,40}?(?:le|au|du|date du) ?${DATE}`,
  ),
  re(`date de (?:la )?reception(?: des travaux)? ?:? ?${DATE}`),
  re(`avec effet (?:au|du|a la date du) ?${DATE}`),
  re(
    `(?:declare|decide de) (?:recevoir|accepter) (?:les travaux|l'ouvrage|les ouvrages)[^.]{0,40}?(?:le|au|a la date du) ?${DATE}`,
  ),
  re(`prononce la reception[^.]{0,60}?(?:le|au|du|date du) ?${DATE}`),
];

/** The first date any of these labels gives, in the text's order. */
function first(text: string, patterns: readonly RegExp[]): string | null {
  let best: { at: number; date: string } | null = null;
  for (const p of patterns) {
    for (const m of text.matchAll(p)) {
      const date = parseFrenchDate(m[1] ?? '');
      if (date && (!best || m.index < best.at)) best = { at: m.index, date };
      if (date) break;
    }
  }
  return best?.date ?? null;
}

/** A SIREN, a SIRET (its first nine digits) or a French VAT number (its last nine). */
const IDENTIFIER = /\b(?:FR ?[0-9A-Z]{2} ?)?\d{3}[ .]?\d{3}[ .]?\d{3}(?:[ .]?\d{5})?\b/g;

export function sirensIn(text: string): string[] {
  const found: string[] = [];
  for (const m of text.replace(/[  ]/g, ' ').matchAll(IDENTIFIER)) {
    const raw = m[0].toUpperCase();
    const digits = raw.replace(/^FR ?[0-9A-Z]{2} ?/, '').replace(/\D/g, '');
    let siren: string | null = null;
    if (raw.startsWith('FR') && digits.length === 9) siren = isValidSiren(digits) ? digits : null;
    else if (digits.length === 14 && isValidSiret(digits)) siren = digits.slice(0, 9);
    // A SIREN followed by a postcode reads as fourteen digits: its first nine still count.
    else if (isValidSiren(digits.slice(0, 9))) siren = digits.slice(0, 9);
    if (siren && !found.includes(siren)) found.push(siren);
  }
  return found;
}

export function readFields(text: string): DocumentFields {
  const t = normalizeText(text).replace(/\s+/g, ' ');
  const validity = [...t.matchAll(VALIDITY)][0];
  const from = validity ? parseFrenchDate(validity[1] ?? '') : null;
  const to = validity ? parseFrenchDate(validity[2] ?? '') : null;
  return {
    issuedOn: first(t, ISSUED),
    validFrom: from,
    validTo: to ?? first(t, VALID_TO),
    receptionOn: first(t, RECEPTION),
    sirens: sirensIn(text),
  };
}
