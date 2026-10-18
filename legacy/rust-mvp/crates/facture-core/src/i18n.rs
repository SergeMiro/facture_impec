//! Messages d'erreur en français, centralisés (cf. `AGENT_PLAN.md` §7.4).
//!
//! Ton clair et non culpabilisant. Les montants sont formatés à la française
//! (séparateur décimal `,`, espace fine pour les milliers, suffixe ` €`).

use rust_decimal::Decimal;

/// Formate un montant en euros, style français : `1 234,50 €`.
pub fn fmt_eur(value: Decimal) -> String {
    format!("{} €", fmt_decimal(value, 2))
}

/// Formate un pourcentage : `20 %` ou `5,5 %` (décimales superflues retirées).
pub fn fmt_pct(value: Decimal) -> String {
    let normalized = value.normalize();
    let decimals = normalized.scale().min(4);
    format!("{} %", fmt_decimal(normalized, decimals))
}

/// Formate un `Decimal` avec `decimals` décimales, séparateur `,` et espace fine (` `) pour les milliers.
fn fmt_decimal(value: Decimal, decimals: u32) -> String {
    let rounded = value.round_dp(decimals);
    let negative = rounded.is_sign_negative();
    let s = rounded.abs().to_string();

    let (int_part, frac_part) = match s.split_once('.') {
        Some((i, f)) => (i.to_string(), f.to_string()),
        None => (s, String::new()),
    };

    // Groupage des milliers par espace fine insécable.
    let grouped = group_thousands(&int_part);

    let mut out = String::new();
    if negative {
        out.push('-');
    }
    out.push_str(&grouped);
    if decimals > 0 {
        let mut frac = frac_part;
        while (frac.len() as u32) < decimals {
            frac.push('0');
        }
        out.push(',');
        out.push_str(&frac);
    }
    out
}

fn group_thousands(int_part: &str) -> String {
    let bytes = int_part.as_bytes();
    let mut out = String::new();
    let len = bytes.len();
    for (idx, b) in bytes.iter().enumerate() {
        if idx > 0 && (len - idx) % 3 == 0 {
            out.push('\u{202F}'); // espace fine insécable
        }
        out.push(*b as char);
    }
    out
}

// ── Présence (EN 16931 BR-*) ────────────────────────────────────────────────

/// Information obligatoire absente.
pub fn missing(label_fr: &str) -> String {
    format!("Information obligatoire absente : {label_fr}.")
}

/// Il faut au moins une ligne de facture (BR-16).
pub fn no_lines() -> String {
    "La facture doit comporter au moins une ligne.".to_string()
}

// ── Cohérence des montants (BR-CO-*) ─────────────────────────────────────────

pub fn br_co_10(sum_lines: Decimal, declared: Decimal) -> String {
    format!(
        "La somme des montants de ligne ({}) ne correspond pas au sous-total HT déclaré ({}).",
        fmt_eur(sum_lines),
        fmt_eur(declared)
    )
}

pub fn br_co_13(line_extension: Decimal, tax_exclusive: Decimal) -> String {
    format!(
        "Le total HT ({}) ne correspond pas à la somme des lignes ({}).",
        fmt_eur(tax_exclusive),
        fmt_eur(line_extension)
    )
}

pub fn br_co_14(sum_breakdown: Decimal, declared: Decimal) -> String {
    format!(
        "Le total de TVA ({}) ne correspond pas à la somme des TVA par catégorie ({}).",
        fmt_eur(declared),
        fmt_eur(sum_breakdown)
    )
}

pub fn br_co_15(ttc: Decimal, ht: Decimal, tva: Decimal) -> String {
    format!(
        "Le total TTC ({}) ne correspond pas à HT + TVA ({} + {} = {}).",
        fmt_eur(ttc),
        fmt_eur(ht),
        fmt_eur(tva),
        fmt_eur(ht + tva)
    )
}

pub fn br_co_16(payable: Decimal, expected: Decimal) -> String {
    format!(
        "Le net à payer ({}) ne correspond pas à TTC − payé + arrondi ({}).",
        fmt_eur(payable),
        fmt_eur(expected)
    )
}

pub fn br_co_17(tax: Decimal, expected: Decimal, base: Decimal, rate: Decimal) -> String {
    format!(
        "La TVA d'une catégorie ({}) ne correspond pas à base × taux ({} × {} = {}).",
        fmt_eur(tax),
        fmt_eur(base),
        fmt_pct(rate),
        fmt_eur(expected)
    )
}

pub fn br_dec(label_fr: &str) -> String {
    format!("{label_fr} : un montant ne doit pas dépasser 2 décimales.")
}

// ── Catégories de TVA ────────────────────────────────────────────────────────

pub fn vat_standard_rate(rate: Decimal) -> String {
    format!(
        "Catégorie TVA « standard » : le taux doit être strictement positif (trouvé {}).",
        fmt_pct(rate)
    )
}

pub fn vat_zero_rate(rate: Decimal) -> String {
    format!(
        "Catégorie TVA « taux zéro » : le taux doit être 0 (trouvé {}).",
        fmt_pct(rate)
    )
}

pub fn vat_exempt_rate(rate: Decimal) -> String {
    format!(
        "Catégorie TVA « exonéré » : le taux doit être 0 (trouvé {}).",
        fmt_pct(rate)
    )
}

pub fn vat_reverse_charge_rate(rate: Decimal) -> String {
    format!(
        "Catégorie TVA « autoliquidation » : le taux doit être 0 (trouvé {}).",
        fmt_pct(rate)
    )
}

pub fn vat_exempt_reason() -> String {
    "Catégorie TVA « exonéré » : un motif d'exonération (code ou texte) est requis.".to_string()
}

pub fn vat_reverse_charge_reason() -> String {
    "Catégorie TVA « autoliquidation » : la mention d'autoliquidation est requise.".to_string()
}

// ── Règles françaises ────────────────────────────────────────────────────────

pub fn siren_invalid(party_fr: &str) -> String {
    format!("Le SIREN {party_fr} est invalide (9 chiffres, clé de Luhn).")
}

pub fn siret_invalid(party_fr: &str) -> String {
    format!("Le SIRET {party_fr} est invalide (14 chiffres, clé de Luhn).")
}

pub fn tva_key_invalid(party_fr: &str) -> String {
    format!(
        "Le numéro de TVA intracommunautaire {party_fr} est invalide (clé de contrôle FR incorrecte)."
    )
}

pub fn mentions_id_missing() -> String {
    "Mention légale manquante : le SIREN ou le SIRET du vendeur est obligatoire.".to_string()
}

pub fn iban_invalid() -> String {
    "L'IBAN est invalide (clé de contrôle internationale incorrecte).".to_string()
}

// ── Formats ──────────────────────────────────────────────────────────────────

pub fn date_format(label_fr: &str) -> String {
    format!("{label_fr} : date invalide (format attendu AAAA-MM-JJ).")
}

pub fn currency_format(found: &str) -> String {
    format!("La devise « {found} » est invalide (code ISO 4217 à 3 lettres attendu, ex. EUR).")
}

// ── Couche douce (avertissements jaunes) ─────────────────────────────────────

pub fn soft_date_logic() -> String {
    "La date d'échéance est antérieure à la date d'émission.".to_string()
}

pub fn soft_currency(currency: &str) -> String {
    format!("Devise étrangère ({currency}) : inhabituel pour une facture domestique — à vérifier.")
}

pub fn soft_vat_rate(rate: Decimal) -> String {
    format!(
        "Le taux de TVA ({}) ne correspond pas à un taux français usuel (0 / 2,1 / 5,5 / 10 / 20 %).",
        fmt_pct(rate)
    )
}

pub fn soft_round_amount(line_no: usize) -> String {
    format!("Ligne {line_no} : montant forfaitaire très rond — à vérifier.")
}

// ── Contrôle de calcul de ligne (FF-) ────────────────────────────────────────

pub fn line_calc(line_no: usize, declared: Decimal, expected: Decimal) -> String {
    format!(
        "Ligne {line_no} : le montant ({}) ne correspond pas à quantité × prix unitaire ({}).",
        fmt_eur(declared),
        fmt_eur(expected)
    )
}
