//! Cohérence des montants : calcul des lignes, totaux (BR-CO-10/13/14/15/16/17) et décimales (BR-DEC).
//!
//! Tous les contrôles sont conditionnés à la présence des champs nécessaires : un champ
//! absent relève des règles de présence (BR-12..15), pas d'une incohérence de calcul.

use super::money_eq;
use crate::i18n;
use crate::model::Invoice;
use crate::report::Issue;
use rust_decimal::Decimal;

pub(crate) fn check(inv: &Invoice, out: &mut Vec<Issue>) {
    line_calculations(inv, out);
    totals(inv, out);
    decimals(inv, out);
}

/// FF-LINE-CALC : montant de ligne (BT-131) = quantité (BT-129) × prix unitaire (BT-146).
fn line_calculations(inv: &Invoice, out: &mut Vec<Issue>) {
    for (i, line) in inv.lines.iter().enumerate() {
        let (Some(qty), Some(price), Some(amount)) =
            (line.quantity, line.unit_price, line.line_amount)
        else {
            continue;
        };
        let expected = (qty * price).round_dp(2);
        if !money_eq(amount, expected) {
            out.push(Issue::hard(
                "FF-LINE-CALC",
                format!("lines[{i}].line_amount"),
                i18n::line_calc(i + 1, amount, expected),
            ));
        }
    }
}

fn totals(inv: &Invoice, out: &mut Vec<Issue>) {
    let t = &inv.totals;

    // BR-CO-10 : Σ montants de ligne = BT-106. (Seulement si toutes les lignes ont un montant.)
    if let Some(bt106) = t.line_extension_amount {
        if !inv.lines.is_empty() && inv.lines.iter().all(|l| l.line_amount.is_some()) {
            let sum: Decimal = inv.lines.iter().filter_map(|l| l.line_amount).sum();
            if !money_eq(sum, bt106) {
                out.push(Issue::hard(
                    "BR-CO-10",
                    "totals.line_extension_amount",
                    i18n::br_co_10(sum, bt106),
                ));
            }
        }
    }

    // BR-CO-13 : BT-109 = BT-106 (MVP : sans remise/charge au niveau document).
    if let (Some(bt106), Some(bt109)) = (t.line_extension_amount, t.tax_exclusive_amount) {
        if !money_eq(bt106, bt109) {
            out.push(Issue::hard(
                "BR-CO-13",
                "totals.tax_exclusive_amount",
                i18n::br_co_13(bt106, bt109),
            ));
        }
    }

    // BR-CO-14 : BT-110 = Σ BT-117 (TVA par catégorie). (Seulement si la ventilation est fournie.)
    if let Some(bt110) = t.tax_amount {
        if !inv.vat_breakdown.is_empty()
            && inv.vat_breakdown.iter().all(|b| b.tax_amount.is_some())
        {
            let sum: Decimal = inv.vat_breakdown.iter().filter_map(|b| b.tax_amount).sum();
            if !money_eq(sum, bt110) {
                out.push(Issue::hard(
                    "BR-CO-14",
                    "totals.tax_amount",
                    i18n::br_co_14(sum, bt110),
                ));
            }
        }
    }

    // BR-CO-15 : BT-112 = BT-109 + BT-110.
    if let (Some(bt109), Some(bt110), Some(bt112)) =
        (t.tax_exclusive_amount, t.tax_amount, t.tax_inclusive_amount)
    {
        if !money_eq(bt112, bt109 + bt110) {
            out.push(Issue::hard(
                "BR-CO-15",
                "totals.tax_inclusive_amount",
                i18n::br_co_15(bt112, bt109, bt110),
            ));
        }
    }

    // BR-CO-16 : BT-115 = BT-112 − BT-113 (payé) + BT-114 (arrondi).
    if let (Some(bt112), Some(bt115)) = (t.tax_inclusive_amount, t.payable_amount) {
        let paid = t.paid_amount.unwrap_or(Decimal::ZERO);
        let rounding = t.rounding_amount.unwrap_or(Decimal::ZERO);
        let expected = bt112 - paid + rounding;
        if !money_eq(bt115, expected) {
            out.push(Issue::hard(
                "BR-CO-16",
                "totals.payable_amount",
                i18n::br_co_16(bt115, expected),
            ));
        }
    }

    // BR-CO-17 : par catégorie, BT-117 = BT-116 × (BT-119 / 100), arrondi 2 décimales.
    for (i, bd) in inv.vat_breakdown.iter().enumerate() {
        if let (Some(base), Some(rate), Some(tax)) = (bd.taxable_amount, bd.rate, bd.tax_amount) {
            let expected = (base * rate / Decimal::ONE_HUNDRED).round_dp(2);
            if !money_eq(tax, expected) {
                out.push(Issue::hard(
                    "BR-CO-17",
                    format!("vat_breakdown[{i}].tax_amount"),
                    i18n::br_co_17(tax, expected, base, rate),
                ));
            }
        }
    }
}

/// BR-DEC-* : les montants monétaires ne doivent pas dépasser 2 décimales.
fn decimals(inv: &Invoice, out: &mut Vec<Issue>) {
    let t = &inv.totals;
    let checks: [(Option<Decimal>, &str, &str); 5] = [
        (t.line_extension_amount, "totals.line_extension_amount", "La somme des montants de ligne"),
        (t.tax_exclusive_amount, "totals.tax_exclusive_amount", "Le total HT"),
        (t.tax_amount, "totals.tax_amount", "Le total de TVA"),
        (t.tax_inclusive_amount, "totals.tax_inclusive_amount", "Le total TTC"),
        (t.payable_amount, "totals.payable_amount", "Le net à payer"),
    ];
    for (value, field, label) in checks {
        if let Some(v) = value {
            if v.normalize().scale() > 2 {
                out.push(Issue::hard("BR-DEC", field, i18n::br_dec(label)));
            }
        }
    }

    for (i, line) in inv.lines.iter().enumerate() {
        if let Some(v) = line.line_amount {
            if v.normalize().scale() > 2 {
                out.push(Issue::hard(
                    "BR-DEC",
                    format!("lines[{i}].line_amount"),
                    i18n::br_dec(&format!("Le montant de la ligne {}", i + 1)),
                ));
            }
        }
    }
}
