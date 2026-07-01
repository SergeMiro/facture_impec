//! Import / structuration (cf. AGENT_PLAN.md §8) : PDF/texte → `Invoice`.
//!
//! Pipeline : extraction texte (PDF via `pdf-extract`, ou texte brut) → structuration →
//! le résultat repasse dans le moteur de validation, et l'utilisateur corrige/complète.
//! L'extraction est derrière le trait [`InvoiceExtractor`] pour pouvoir changer de moteur
//! (heuristique déterministe ici ; LLM/OCR image en extension — même patron que `ai::mistral`).

use std::sync::LazyLock;

use facture_core::model::{Party, Totals};
use facture_core::Invoice;
use regex::Regex;
use rust_decimal::Decimal;

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("extraction PDF impossible : {0}")]
    Pdf(String),
}

/// Extrait le texte d'un PDF (PDF « texte » ; les scans image relèvent d'un OCR — extension).
pub fn pdf_to_text(bytes: &[u8]) -> Result<String, ImportError> {
    pdf_extract::extract_text_from_mem(bytes).map_err(|e| ImportError::Pdf(e.to_string()))
}

/// Vrai si les octets ressemblent à un PDF (magie `%PDF`).
pub fn looks_like_pdf(bytes: &[u8]) -> bool {
    bytes.starts_with(b"%PDF")
}

pub trait InvoiceExtractor: Send + Sync {
    /// Structure un texte brut en `Invoice` (champs non trouvés → `None`).
    fn structure(&self, text: &str) -> Invoice;
}

/// Extracteur heuristique déterministe (regex). Couvre l'en-tête et les totaux ; les lignes
/// restent à compléter par l'utilisateur (extraction fiable des lignes = LLM, extension).
pub struct HeuristicExtractor;

static RE_NUMBER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(?:facture|invoice)\s*(?:n[°ºo]|no|num[ée]ro)?\s*[:#]?\s*([A-Z0-9][A-Z0-9\-/]{1,})",
    )
    .unwrap()
});
static RE_DATE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})").unwrap());
static RE_SIRET: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b(\d{14})\b").unwrap());
static RE_SIREN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"\b(\d{9})\b").unwrap());
static RE_VAT: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b(FR\s?[0-9A-Z]{2}\s?\d{9})\b").unwrap());

impl InvoiceExtractor for HeuristicExtractor {
    fn structure(&self, text: &str) -> Invoice {
        let invoice_number = RE_NUMBER
            .captures(text)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().trim().to_string());

        let issue_date = RE_DATE.captures(text).and_then(|c| {
            let d: u32 = c.get(1)?.as_str().parse().ok()?;
            let m: u32 = c.get(2)?.as_str().parse().ok()?;
            let y: i32 = c.get(3)?.as_str().parse().ok()?;
            Some(format!("{y:04}-{m:02}-{d:02}"))
        });

        let siret = RE_SIRET
            .captures(text)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().to_string());
        let siren = if siret.is_none() {
            RE_SIREN
                .captures(text)
                .and_then(|c| c.get(1))
                .map(|m| m.as_str().to_string())
        } else {
            None
        };
        let vat_id = RE_VAT
            .captures(text)
            .and_then(|c| c.get(1))
            .map(|m| m.as_str().replace(' ', ""));

        let ht = find_amount(text, &["total ht", "montant ht", "hors taxes"]);
        let tva = find_amount(text, &["total tva", "montant tva", "tva"]);
        let ttc = find_amount(
            text,
            &["total ttc", "montant ttc", "net à payer", "total à payer"],
        );

        Invoice {
            invoice_number,
            issue_date,
            currency: detect_currency(text),
            type_code: Some("380".to_string()), // par défaut : facture commerciale
            seller: Party {
                siret,
                siren,
                vat_id,
                ..Default::default()
            },
            totals: Totals {
                line_extension_amount: ht,
                tax_exclusive_amount: ht,
                tax_amount: tva,
                tax_inclusive_amount: ttc,
                payable_amount: ttc,
                ..Default::default()
            },
            ..Default::default()
        }
    }
}

fn detect_currency(text: &str) -> Option<String> {
    let lower = text.to_lowercase();
    if text.contains('€') || lower.contains("eur") {
        Some("EUR".to_string())
    } else if text.contains('$') || lower.contains("usd") {
        Some("USD".to_string())
    } else {
        None
    }
}

/// Cherche le premier montant qui suit l'un des libellés donnés.
fn find_amount(text: &str, labels: &[&str]) -> Option<Decimal> {
    let lower = text.to_lowercase();
    for label in labels {
        if let Some(pos) = lower.find(label) {
            let after = &text[pos + label.len()..];
            if let Some(amount) = first_amount(after) {
                return Some(amount);
            }
        }
    }
    None
}

/// Extrait et parse le premier nombre (format FR ou EN) d'un fragment.
fn first_amount(fragment: &str) -> Option<Decimal> {
    static RE_AMOUNT: LazyLock<Regex> =
        LazyLock::new(|| Regex::new(r"([0-9][0-9\u{00a0}\u{202f} .,]*[0-9]|[0-9])").unwrap());
    let cap = RE_AMOUNT.captures(fragment)?.get(1)?.as_str();
    parse_amount(cap)
}

/// Parse un montant en tolérant les formats FR (« 1 320,00 ») et EN (« 1,320.00 »).
pub fn parse_amount(raw: &str) -> Option<Decimal> {
    let cleaned: String = raw
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '\u{00a0}' && *c != '\u{202f}')
        .collect();
    let normalized = if cleaned.contains(',') && cleaned.contains('.') {
        // Les deux présents : le dernier séparateur est le décimal.
        if cleaned.rfind(',') > cleaned.rfind('.') {
            cleaned.replace('.', "").replace(',', ".")
        } else {
            cleaned.replace(',', "")
        }
    } else {
        cleaned.replace(',', ".")
    };
    normalized.parse::<Decimal>().ok().map(|d| d.round_dp(2))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_french_amounts() {
        assert_eq!(parse_amount("1 320,00"), Some("1320.00".parse().unwrap()));
        assert_eq!(parse_amount("1.320,50"), Some("1320.50".parse().unwrap()));
        assert_eq!(parse_amount("1,320.50"), Some("1320.50".parse().unwrap()));
        assert_eq!(parse_amount("42"), Some("42".parse().unwrap()));
    }

    #[test]
    fn structures_header_and_totals() {
        let text = "FACTURE n° F-2026-042\nDate : 01/09/2026\nVendeur SARL  SIRET 73282932000074\n\
                    TVA FR44 732829320\nTotal HT : 1 100,00 €\nTotal TVA : 220,00 €\nTotal TTC : 1 320,00 €";
        let inv = HeuristicExtractor.structure(text);
        assert_eq!(inv.invoice_number.as_deref(), Some("F-2026-042"));
        assert_eq!(inv.issue_date.as_deref(), Some("2026-09-01"));
        assert_eq!(inv.currency.as_deref(), Some("EUR"));
        assert_eq!(inv.seller.siret.as_deref(), Some("73282932000074"));
        assert_eq!(inv.seller.vat_id.as_deref(), Some("FR44732829320"));
        assert_eq!(
            inv.totals.tax_inclusive_amount,
            Some("1320.00".parse().unwrap())
        );
        assert_eq!(inv.totals.tax_amount, Some("220.00".parse().unwrap()));
    }
}
