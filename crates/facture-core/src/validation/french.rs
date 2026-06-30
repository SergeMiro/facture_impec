//! Règles françaises : SIREN/SIRET (Luhn), clé TVA intracommunautaire FR, mentions légales.

use super::present;
use crate::i18n;
use crate::model::{Invoice, Party};
use crate::report::Issue;

pub(crate) fn check(inv: &Invoice, out: &mut Vec<Issue>) {
    check_party(&inv.seller, "seller", "du vendeur", true, out);
    check_party(&inv.buyer, "buyer", "de l'acheteur", false, out);
}

fn check_party(
    party: &Party,
    prefix: &str,
    party_fr: &str,
    is_seller: bool,
    out: &mut Vec<Issue>,
) {
    // Mention légale FR : le vendeur doit porter un SIREN ou un SIRET (BR/FR-MENTIONS-ID).
    if is_seller && !present(&party.siren) && !present(&party.siret) {
        out.push(Issue::hard(
            "FR-MENTIONS-ID",
            format!("{prefix}.siret"),
            i18n::mentions_id_missing(),
        ));
    }

    // SIREN : 9 chiffres + Luhn.
    if let Some(siren) = party.siren.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let digits = strip_spaces(siren);
        if digits.len() != 9 || !is_all_digits(&digits) || !luhn_valid(&digits) {
            out.push(Issue::hard(
                "FR-SIREN-LUHN",
                format!("{prefix}.siren"),
                i18n::siren_invalid(party_fr),
            ));
        }
    }

    // SIRET : 14 chiffres + Luhn.
    if let Some(siret) = party.siret.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        let digits = strip_spaces(siret);
        if digits.len() != 14 || !is_all_digits(&digits) || !luhn_valid(&digits) {
            out.push(Issue::hard(
                "FR-SIRET-LUHN",
                format!("{prefix}.siret"),
                i18n::siret_invalid(party_fr),
            ));
        }
    }

    // TVA intracommunautaire FR : FR + clé(2) + SIREN(9), clé = (12 + 3·(SIREN mod 97)) mod 97.
    // On ne contrôle que les numéros FR (un VAT étranger valide ne doit pas être signalé).
    if let Some(vat) = party.vat_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        if is_fr_vat(vat) && !fr_vat_valid(vat) {
            out.push(Issue::hard(
                "FR-TVA-KEY",
                format!("{prefix}.vat_id"),
                i18n::tva_key_invalid(party_fr),
            ));
        }
    }
}

fn strip_spaces(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).collect()
}

fn is_all_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

/// Clé de Luhn : la somme pondérée doit être un multiple de 10.
pub(crate) fn luhn_valid(digits: &str) -> bool {
    let mut sum = 0u32;
    let mut double = false;
    for c in digits.chars().rev() {
        let Some(d) = c.to_digit(10) else {
            return false;
        };
        let mut d = d;
        if double {
            d *= 2;
            if d > 9 {
                d -= 9;
            }
        }
        sum += d;
        double = !double;
    }
    sum % 10 == 0
}

/// Vrai si le numéro semble être un n° de TVA français (préfixe `FR`).
fn is_fr_vat(vat: &str) -> bool {
    vat.chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_uppercase()
        .starts_with("FR")
}

/// Valide un n° de TVA intracommunautaire FR (`FR` + clé 2 car. + SIREN 9 chiffres).
///
/// La clé peut être alphanumérique (ancien format) ; on ne vérifie l'algorithme modulo 97
/// que pour les clés numériques. Le SIREN est toujours contrôlé (9 chiffres + Luhn).
pub(crate) fn fr_vat_valid(vat: &str) -> bool {
    let cleaned: String = vat
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_uppercase();

    let Some(rest) = cleaned.strip_prefix("FR") else {
        return false; // hors périmètre FR ; on n'émet pas pour les TVA étrangères ici.
    };
    if rest.len() != 11 {
        return false;
    }
    let (key, siren) = rest.split_at(2);
    if !is_all_digits(siren) || siren.len() != 9 || !luhn_valid(siren) {
        return false;
    }
    // Clé numérique → vérifier l'algorithme. Clé alphanumérique → SIREN seul fait foi.
    if is_all_digits(key) {
        let siren_num: u64 = siren.parse().unwrap_or(0);
        let expected = (12 + 3 * (siren_num % 97)) % 97;
        let actual: u64 = key.parse().unwrap_or(u64::MAX);
        return actual == expected;
    }
    true
}
