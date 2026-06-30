//! Contrôles de format : dates (`AAAA-MM-JJ`), devise (ISO 4217), IBAN (mod-97 ISO 13616).

use super::present;
use crate::i18n;
use crate::model::Invoice;
use crate::report::Issue;

pub(crate) fn check(inv: &Invoice, out: &mut Vec<Issue>) {
    // Dates : ne contrôler le format que si le champ est présent (la présence est gérée par BR-03).
    if present(&inv.issue_date) && parse_iso_date(inv.issue_date.as_deref().unwrap()).is_none() {
        out.push(Issue::hard(
            "FF-DATE-FORMAT",
            "issue_date",
            i18n::date_format("la date d'émission"),
        ));
    }
    if present(&inv.due_date) && parse_iso_date(inv.due_date.as_deref().unwrap()).is_none() {
        out.push(Issue::hard(
            "FF-DATE-FORMAT",
            "due_date",
            i18n::date_format("la date d'échéance"),
        ));
    }

    // Devise : 3 lettres ASCII.
    if let Some(cur) = inv
        .currency
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        if !is_iso4217_shape(cur) {
            out.push(Issue::hard(
                "FF-CURRENCY-FORMAT",
                "currency",
                i18n::currency_format(cur),
            ));
        }
    }

    // IBAN (si fourni).
    if let Some(payment) = &inv.payment {
        if let Some(iban) = payment
            .iban
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            if !iban_valid(iban) {
                out.push(Issue::hard("FR-IBAN", "payment.iban", i18n::iban_invalid()));
            }
        }
    }
}

fn is_iso4217_shape(code: &str) -> bool {
    code.len() == 3 && code.bytes().all(|b| b.is_ascii_alphabetic())
}

/// Parse une date `AAAA-MM-JJ` et en vérifie la validité calendaire. Renvoie `(année, mois, jour)`.
pub(crate) fn parse_iso_date(s: &str) -> Option<(i32, u32, u32)> {
    let s = s.trim();
    let mut parts = s.split('-');
    let y = parts.next()?;
    let m = parts.next()?;
    let d = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    if y.len() != 4 || m.len() != 2 || d.len() != 2 {
        return None;
    }
    let year: i32 = y.parse().ok()?;
    let month: u32 = m.parse().ok()?;
    let day: u32 = d.parse().ok()?;
    if !(1..=12).contains(&month) {
        return None;
    }
    if day < 1 || day > days_in_month(year, month) {
        return None;
    }
    Some((year, month, day))
}

fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if is_leap(year) => 29,
        2 => 28,
        _ => 0,
    }
}

fn is_leap(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || year % 400 == 0
}

/// Valide un IBAN (ISO 13616) : longueur 15..=34, déplacement des 4 premiers caractères,
/// conversion lettres → nombres (A=10..Z=35), reste modulo 97 == 1.
pub(crate) fn iban_valid(iban: &str) -> bool {
    let cleaned: String = iban
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect::<String>()
        .to_uppercase();

    if cleaned.len() < 15 || cleaned.len() > 34 {
        return false;
    }
    if !cleaned.bytes().all(|b| b.is_ascii_alphanumeric()) {
        return false;
    }
    // Les deux premiers caractères doivent être un code pays (lettres).
    if !cleaned.as_bytes()[..2]
        .iter()
        .all(|b| b.is_ascii_alphabetic())
    {
        return false;
    }

    // Déplacer les 4 premiers caractères à la fin.
    let (head, tail) = cleaned.split_at(4);
    let rearranged = format!("{tail}{head}");

    // Calcul du modulo 97 par accumulation (évite les grands entiers).
    let mut remainder: u32 = 0;
    for c in rearranged.chars() {
        let value = if c.is_ascii_digit() {
            c.to_digit(10).unwrap()
        } else {
            (c as u32) - ('A' as u32) + 10
        };
        // Concaténation décimale : chaque lettre vaut 2 chiffres.
        if value >= 10 {
            remainder = (remainder * 100 + value) % 97;
        } else {
            remainder = (remainder * 10 + value) % 97;
        }
    }
    remainder == 1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iban_accepts_valid() {
        assert!(iban_valid("FR1420041010050500013M02606")); // exemple FR canonique (lettre M)
        assert!(iban_valid("DE89 3704 0044 0532 0130 00")); // espaces tolérés
    }

    #[test]
    fn iban_rejects_invalid() {
        assert!(!iban_valid("FR1420041010050500013M02607")); // dernier chiffre cassé (valide: ...606)
        assert!(!iban_valid("FR14")); // trop court
        assert!(!iban_valid("1420041010050500013M02606")); // pas de code pays
    }

    #[test]
    fn date_parses_valid_and_leap_year() {
        assert_eq!(parse_iso_date("2026-09-01"), Some((2026, 9, 1)));
        assert_eq!(parse_iso_date("2024-02-29"), Some((2024, 2, 29))); // bissextile
    }

    #[test]
    fn date_rejects_invalid() {
        assert!(parse_iso_date("2026-13-01").is_none()); // mois 13
        assert!(parse_iso_date("2025-02-29").is_none()); // 2025 non bissextile
        assert!(parse_iso_date("2026-9-1").is_none()); // non zéro-paddé
        assert!(parse_iso_date("01/09/2026").is_none()); // mauvais séparateur
    }

    #[test]
    fn currency_shape() {
        assert!(is_iso4217_shape("EUR"));
        assert!(!is_iso4217_shape("EU"));
        assert!(!is_iso4217_shape("EU1"));
    }
}
