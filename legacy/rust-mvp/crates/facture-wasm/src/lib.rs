//! Pont WASM autour de `facture-core`.
//!
//! Expose la validation au task pane (TypeScript) sans dupliquer les règles :
//! le même crate Rust tourne en local dans le navigateur Office et côté backend.

use wasm_bindgen::prelude::*;

/// Valide une facture sérialisée en JSON et renvoie le `ValidationReport` en JSON.
///
/// Côté TS : `const reportJson = validate_json(JSON.stringify(invoice));`
#[wasm_bindgen]
pub fn validate_json(invoice_json: &str) -> Result<String, JsError> {
    facture_core::validate_json(invoice_json).map_err(|e| JsError::new(&e.to_string()))
}

/// Version du cœur de validation (utile pour vérifier le WASM chargé).
#[wasm_bindgen]
pub fn core_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
