//! Rapport de validation : sévérité, problème individuel, agrégat.
//!
//! Le contrat clé du produit (cf. `AGENT_PLAN.md` §6.5) :
//! - **erreur dure** (`HardError`, rouge) → la PDP rejettera → envoi bloqué ;
//! - **avertissement doux** (`SoftWarning`, jaune) → suspicion → « Envoyer quand même » autorisé.

use serde::{Deserialize, Serialize};

/// Sévérité d'un problème détecté.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Severity {
    /// Bloquant : violation EN 16931 / format invalide. Surligné en rouge.
    #[serde(rename = "hard")]
    HardError,
    /// Non bloquant : suspicion (couche IA, Phase 4). Surligné en jaune.
    #[serde(rename = "soft")]
    SoftWarning,
}

/// Un problème de validation, rattaché à un champ et (si connu) à une cellule.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Issue {
    /// Code traçable (ex. `"BR-CO-10"`, `"FR-SIRET-LUHN"`, `"AI-VAT-RATE"`).
    pub code: String,
    pub severity: Severity,
    /// Chemin du champ concerné (ex. `"buyer.siret"`, `"lines[2].vat_rate"`).
    pub field: String,
    /// Référence de cellule pour le surlignage (ex. `"C7"`), résolue depuis `Invoice::cells`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cell_ref: Option<String>,
    /// Message utilisateur en français.
    pub message_fr: String,
}

impl Issue {
    /// Crée une erreur dure (bloquante).
    pub fn hard(
        code: impl Into<String>,
        field: impl Into<String>,
        message_fr: impl Into<String>,
    ) -> Self {
        Issue {
            code: code.into(),
            severity: Severity::HardError,
            field: field.into(),
            cell_ref: None,
            message_fr: message_fr.into(),
        }
    }

    /// Crée un avertissement doux (non bloquant).
    pub fn soft(
        code: impl Into<String>,
        field: impl Into<String>,
        message_fr: impl Into<String>,
    ) -> Self {
        Issue {
            code: code.into(),
            severity: Severity::SoftWarning,
            field: field.into(),
            cell_ref: None,
            message_fr: message_fr.into(),
        }
    }
}

/// Résultat agrégé d'une validation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationReport {
    pub issues: Vec<Issue>,
    /// `true` si aucune erreur dure (seuls des avertissements doux, voire rien).
    pub is_sendable: bool,
}

impl ValidationReport {
    /// Construit le rapport et en déduit `is_sendable`.
    pub fn new(issues: Vec<Issue>) -> Self {
        let is_sendable = issues.iter().all(|i| i.severity != Severity::HardError);
        ValidationReport {
            issues,
            is_sendable,
        }
    }

    /// Itère sur les seules erreurs dures.
    pub fn hard_errors(&self) -> impl Iterator<Item = &Issue> {
        self.issues
            .iter()
            .filter(|i| i.severity == Severity::HardError)
    }

    /// Itère sur les seuls avertissements doux.
    pub fn soft_warnings(&self) -> impl Iterator<Item = &Issue> {
        self.issues
            .iter()
            .filter(|i| i.severity == Severity::SoftWarning)
    }
}
