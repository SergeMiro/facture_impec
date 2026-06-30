//! Règles EN 16931 : présence/contenu (BR-02..16) et catégories de TVA (extrait).
//!
//! Codes BR exacts conservés pour la traçabilité (cf. `docs/VALIDATION_RULES.md`).
//! BR-01 (identifiant de spécification, BT-24) est posé par la PA, hors saisie Excel : non vérifié ici.

use super::present;
use crate::i18n;
use crate::model::{Address, Invoice, VatBreakdown, VatCategory};
use crate::report::Issue;
use rust_decimal::Decimal;

pub(crate) fn check(inv: &Invoice, out: &mut Vec<Issue>) {
    presence(inv, out);
    vat_categories(inv, out);
}

fn presence(inv: &Invoice, out: &mut Vec<Issue>) {
    if !present(&inv.invoice_number) {
        out.push(Issue::hard(
            "BR-02",
            "invoice_number",
            i18n::missing("le numéro de facture"),
        ));
    }
    if !present(&inv.issue_date) {
        out.push(Issue::hard(
            "BR-03",
            "issue_date",
            i18n::missing("la date d'émission"),
        ));
    }
    if !present(&inv.type_code) {
        out.push(Issue::hard(
            "BR-04",
            "type_code",
            i18n::missing("le code type de facture"),
        ));
    }
    if !present(&inv.currency) {
        out.push(Issue::hard(
            "BR-05",
            "currency",
            i18n::missing("la devise"),
        ));
    }

    // Vendeur (BR-06, BR-08, BR-09).
    if !present(&inv.seller.name) {
        out.push(Issue::hard(
            "BR-06",
            "seller.name",
            i18n::missing("le nom du vendeur"),
        ));
    }
    if !address_present(&inv.seller.address) {
        out.push(Issue::hard(
            "BR-08",
            "seller.address",
            i18n::missing("l'adresse du vendeur"),
        ));
    }
    if !present(&inv.seller.address.country_code) {
        out.push(Issue::hard(
            "BR-09",
            "seller.address.country_code",
            i18n::missing("le code pays du vendeur"),
        ));
    }

    // Acheteur (BR-07, BR-10, BR-11).
    if !present(&inv.buyer.name) {
        out.push(Issue::hard(
            "BR-07",
            "buyer.name",
            i18n::missing("le nom de l'acheteur"),
        ));
    }
    if !address_present(&inv.buyer.address) {
        out.push(Issue::hard(
            "BR-10",
            "buyer.address",
            i18n::missing("l'adresse de l'acheteur"),
        ));
    }
    if !present(&inv.buyer.address.country_code) {
        out.push(Issue::hard(
            "BR-11",
            "buyer.address.country_code",
            i18n::missing("le code pays de l'acheteur"),
        ));
    }

    // Totaux (BR-12..15).
    if inv.totals.line_extension_amount.is_none() {
        out.push(Issue::hard(
            "BR-12",
            "totals.line_extension_amount",
            i18n::missing("la somme des montants de ligne (HT)"),
        ));
    }
    if inv.totals.tax_exclusive_amount.is_none() {
        out.push(Issue::hard(
            "BR-13",
            "totals.tax_exclusive_amount",
            i18n::missing("le total HT"),
        ));
    }
    if inv.totals.tax_inclusive_amount.is_none() {
        out.push(Issue::hard(
            "BR-14",
            "totals.tax_inclusive_amount",
            i18n::missing("le total TTC"),
        ));
    }
    if inv.totals.payable_amount.is_none() {
        out.push(Issue::hard(
            "BR-15",
            "totals.payable_amount",
            i18n::missing("le net à payer"),
        ));
    }

    // Au moins une ligne (BR-16).
    if inv.lines.is_empty() {
        out.push(Issue::hard("BR-16", "lines", i18n::no_lines()));
    }
}

/// Une adresse est « présente » si au moins une composante de voie/ville/CP est renseignée.
fn address_present(addr: &Address) -> bool {
    present(&addr.line1) || present(&addr.city) || present(&addr.postal_code)
}

/// Règles par catégorie de TVA (BR-S-05, BR-Z-05, BR-E-05/10, BR-AE-05/10).
fn vat_categories(inv: &Invoice, out: &mut Vec<Issue>) {
    let zero = Decimal::ZERO;

    // Au niveau ligne : cohérence taux ↔ catégorie.
    for (i, line) in inv.lines.iter().enumerate() {
        let (Some(category), Some(rate)) = (line.vat_category.as_ref(), line.vat_rate) else {
            continue;
        };
        let field = format!("lines[{i}].vat_rate");
        match category {
            VatCategory::Standard if rate <= zero => {
                out.push(Issue::hard("BR-S-05", field, i18n::vat_standard_rate(rate)));
            }
            VatCategory::ZeroRated if rate != zero => {
                out.push(Issue::hard("BR-Z-05", field, i18n::vat_zero_rate(rate)));
            }
            VatCategory::Exempt if rate != zero => {
                out.push(Issue::hard("BR-E-05", field, i18n::vat_exempt_rate(rate)));
            }
            VatCategory::ReverseCharge if rate != zero => {
                out.push(Issue::hard(
                    "BR-AE-05",
                    field,
                    i18n::vat_reverse_charge_rate(rate),
                ));
            }
            _ => {}
        }
    }

    // Au niveau ventilation : motif requis pour exonéré / autoliquidation.
    for (i, bd) in inv.vat_breakdown.iter().enumerate() {
        match bd.category.as_ref() {
            Some(VatCategory::Exempt) if !has_exemption_reason(bd) => {
                out.push(Issue::hard(
                    "BR-E-10",
                    format!("vat_breakdown[{i}].exemption_reason"),
                    i18n::vat_exempt_reason(),
                ));
            }
            Some(VatCategory::ReverseCharge) if !has_exemption_reason(bd) => {
                out.push(Issue::hard(
                    "BR-AE-10",
                    format!("vat_breakdown[{i}].exemption_reason"),
                    i18n::vat_reverse_charge_reason(),
                ));
            }
            _ => {}
        }
    }
}

fn has_exemption_reason(bd: &VatBreakdown) -> bool {
    present(&bd.exemption_reason_code) || present(&bd.exemption_reason_text)
}
