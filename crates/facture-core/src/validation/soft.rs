//! Couche « douce » **déterministe** (heuristiques locales).
//!
//! Produit uniquement des [`Severity::SoftWarning`](crate::report::Severity) — jamais bloquant.
//! Tourne dans le WASM du navigateur : **aucune donnée ne sort** (RGPD-safe), contrairement à la
//! couche LLM (backend, `/api/ai-check`) qui ajoute des avertissements sémantiques par-dessus.
//!
//! Règle d'or (cf. AGENT_PLAN.md §9) : ne jamais reformuler une règle dure en avertissement doux
//! (pas de doublon avec la couche déterministe dure).

use super::formats::parse_iso_date;
use crate::i18n;
use crate::model::Invoice;
use crate::report::Issue;
use rust_decimal::Decimal;

pub(crate) fn check(inv: &Invoice, out: &mut Vec<Issue>) {
    date_logic(inv, out);
    foreign_currency(inv, out);
    vat_rate_unusual(inv, out);
    round_amounts(inv, out);
}

/// AI-DATE-LOGIC : date d'échéance antérieure à la date d'émission.
fn date_logic(inv: &Invoice, out: &mut Vec<Issue>) {
    if let (Some(issue), Some(due)) = (inv.issue_date.as_deref(), inv.due_date.as_deref()) {
        if let (Some(i), Some(d)) = (parse_iso_date(issue), parse_iso_date(due)) {
            if d < i {
                out.push(Issue::soft(
                    "AI-DATE-LOGIC",
                    "due_date",
                    i18n::soft_date_logic(),
                ));
            }
        }
    }
}

/// AI-CURRENCY : devise étrangère bien formée (≠ EUR). Le format invalide relève du dur (FF-CURRENCY-FORMAT).
fn foreign_currency(inv: &Invoice, out: &mut Vec<Issue>) {
    if let Some(cur) = inv.currency.as_deref() {
        let c = cur.trim().to_uppercase();
        if c.len() == 3 && c.bytes().all(|b| b.is_ascii_alphabetic()) && c != "EUR" {
            out.push(Issue::soft(
                "AI-CURRENCY",
                "currency",
                i18n::soft_currency(&c),
            ));
        }
    }
}

/// AI-VAT-RATE : taux de TVA hors des taux français usuels (0 / 2,1 / 5,5 / 10 / 20 %).
fn vat_rate_unusual(inv: &Invoice, out: &mut Vec<Issue>) {
    let usual = [
        Decimal::ZERO,
        Decimal::new(21, 1), // 2,1
        Decimal::new(55, 1), // 5,5
        Decimal::from(10),
        Decimal::from(20),
    ];
    for (i, line) in inv.lines.iter().enumerate() {
        if let Some(rate) = line.vat_rate {
            if !usual.contains(&rate) {
                out.push(Issue::soft(
                    "AI-VAT-RATE",
                    format!("lines[{i}].vat_rate"),
                    i18n::soft_vat_rate(rate),
                ));
            }
        }
    }
}

/// AI-ROUND-AMOUNT : ligne forfaitaire (quantité 1) à un prix multiple exact de 1000 — souvent estimé.
fn round_amounts(inv: &Invoice, out: &mut Vec<Issue>) {
    let thousand = Decimal::from(1000);
    for (i, line) in inv.lines.iter().enumerate() {
        if let (Some(qty), Some(price)) = (line.quantity, line.unit_price) {
            if qty == Decimal::ONE && price > Decimal::ZERO && (price % thousand).is_zero() {
                out.push(Issue::soft(
                    "AI-ROUND-AMOUNT",
                    format!("lines[{i}].unit_price"),
                    i18n::soft_round_amount(i + 1),
                ));
            }
        }
    }
}
