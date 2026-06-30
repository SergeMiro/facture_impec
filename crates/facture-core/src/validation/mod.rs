//! Orchestration de la validation.
//!
//! Chaque sous-module ajoute ses `Issue` à un vecteur partagé ; `validate` résout
//! ensuite les références de cellule depuis `Invoice::cells` et construit le rapport.

mod amounts;
mod en16931;
mod formats;
mod french;

use crate::model::Invoice;
use crate::report::{Issue, ValidationReport};
use rust_decimal::Decimal;

/// Valide une facture (couche dure déterministe — Phase 1).
pub fn validate(invoice: &Invoice) -> ValidationReport {
    let mut issues: Vec<Issue> = Vec::new();

    en16931::check(invoice, &mut issues);
    french::check(invoice, &mut issues);
    formats::check(invoice, &mut issues);
    amounts::check(invoice, &mut issues);

    // Renseigner cell_ref depuis la cartographie fournie par l'add-in (Phase 2).
    if !invoice.cells.is_empty() {
        for issue in &mut issues {
            if issue.cell_ref.is_none() {
                if let Some(cell) = invoice.cells.get(&issue.field) {
                    issue.cell_ref = Some(cell.clone());
                }
            }
        }
    }

    ValidationReport::new(issues)
}

// ── Helpers partagés entre sous-modules ─────────────────────────────────────

/// Un champ texte est « présent » s'il existe et n'est pas vide une fois trimé.
pub(crate) fn present(s: &Option<String>) -> bool {
    s.as_deref().is_some_and(|x| !x.trim().is_empty())
}

/// Tolérance de comparaison monétaire : un demi-centime.
pub(crate) fn money_eq(a: Decimal, b: Decimal) -> bool {
    (a - b).abs() <= Decimal::new(5, 3) // 0.005
}
