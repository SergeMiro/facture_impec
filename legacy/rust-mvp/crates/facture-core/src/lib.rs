//! `facture-core` — cœur de validation de **Facture Impec**.
//!
//! Source de vérité unique, partagée entre le WASM du task pane (Phase 2) et le
//! backend Axum (Phase 3). Contient le modèle [`Invoice`], les règles de validation
//! (EN 16931 + règles françaises), le [`ValidationReport`] et les messages FR.
//!
//! Point d'entrée : [`validate`] (ou [`validate_json`] pour le binding WASM / TS).

pub mod i18n;
pub mod model;
pub mod report;
pub mod validation;

pub use model::Invoice;
pub use report::{Issue, Severity, ValidationReport};

/// Valide une facture et renvoie le rapport (erreurs dures + avertissements doux).
///
/// Couche dure uniquement à ce stade (Phase 1) ; la couche douce (IA) est ajoutée
/// en Phase 4 côté backend et fusionnée dans le même `ValidationReport`.
pub fn validate(invoice: &Invoice) -> ValidationReport {
    validation::validate(invoice)
}

/// Variante JSON : désérialise une `Invoice`, valide, et renvoie le rapport en JSON.
///
/// Utilisée par `facture-wasm` (Phase 2) — `validate(invoiceJson) -> reportJson` — et
/// par le backend. Garde une seule implémentation des règles entre front et serveur.
pub fn validate_json(invoice_json: &str) -> Result<String, serde_json::Error> {
    let invoice: Invoice = serde_json::from_str(invoice_json)?;
    let report = validate(&invoice);
    serde_json::to_string(&report)
}
