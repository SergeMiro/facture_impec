//! Couche IA « douce » (LLM) — avertissements sémantiques non bloquants (cf. AGENT_PLAN.md §9).
//!
//! Garde-fous : le LLM ne produit JAMAIS d'erreur dure ; sortie strictement structurée (JSON validé) ;
//! toute réponse non conforme est ignorée (pas d'avertissement fabriqué) ; mode désactivable.
//! RGPD : données minimisées avant envoi, hébergement EU (Mistral) configurable.

use async_trait::async_trait;
use facture_core::{Invoice, Issue};

pub mod mistral;

#[async_trait]
pub trait AiChecker: Send + Sync {
    /// Indique si l'analyse IA est active (clé configurée).
    fn enabled(&self) -> bool;
    /// Renvoie des avertissements DOUX (jaune). Ne bloque jamais ; en cas d'échec → vecteur vide.
    async fn check(&self, invoice: &Invoice) -> Vec<Issue>;
}

/// IA désactivée (aucune clé) : ne renvoie rien.
pub struct DisabledChecker;

#[async_trait]
impl AiChecker for DisabledChecker {
    fn enabled(&self) -> bool {
        false
    }
    async fn check(&self, _invoice: &Invoice) -> Vec<Issue> {
        Vec::new()
    }
}
