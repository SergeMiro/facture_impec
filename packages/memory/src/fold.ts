// Text as full-text and keys read it (docs/DECISIONS.md D12): lower case, accents folded by code
// (PGlite has no `unaccent`), French small words dropped (its `french` configuration ships without
// a stop-word list, checked on 2026-10-25), so « l'attestation de Marc Élec » and « attestation marc
// elec » find each other the same way in PGlite and in Postgres.

/** « L'Électricité & Cœur » → « l electricite coeur ». */
export function fold(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** An identifier as a key compares it: « F 2026-114 » and « f2026114 » are the same number. */
export const keyOf = (value: string) => fold(value).replace(/ /g, '');

// Folded; the words a question is made of, not what it is about.
const STOP = new Set(
  `a ai au aux avec avez avons c ce ces cet cette d dans de des du elle elles en est et etait ete
  etre eu il ils j je l la le les leur leurs lui m ma mais me mes moi mon n ne ni nos notre nous on
  ont ou par pas plus pour qu quand que quel quelle quelles quels qui quoi s sa sans se ses si son
  sont sur t ta te tes toi ton tu un une vos votre vous y combien comment est-ce`.split(/\s+/),
);

/** The words of `text` worth searching for, folded, once each. */
export function terms(text: string): string[] {
  return [...new Set(fold(text).split(' '))].filter((w) => w.length > 1 && !STOP.has(w));
}
