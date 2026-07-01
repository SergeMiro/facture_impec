//! Abstraction de la Plateforme Agréée (ex-PDP).
//!
//! Toute la communication passe derrière [`PdpProvider`] pour pouvoir brancher B2Brouter,
//! SEQINO, Tenor… sans réécrire le produit (cf. AGENT_PLAN.md §2, §10).

use async_trait::async_trait;
use facture_core::Invoice;
use serde::Serialize;

pub mod b2brouter;
pub mod mock;

/// Résultat d'un envoi.
#[derive(Debug, Clone, Serialize)]
pub struct SendResult {
    /// Identifiant de la facture chez la plateforme.
    pub id: String,
    /// État renvoyé (ex. "submitted", "accepted", "rejected").
    pub status: String,
    /// Fournisseur ayant traité l'envoi ("b2brouter", "simulation"…).
    pub provider: String,
    /// `true` si l'envoi est simulé (aucune clé PDP configurée).
    pub simulated: bool,
}

/// État courant d'une facture chez la plateforme.
#[derive(Debug, Clone, Serialize)]
pub struct StatusResult {
    pub id: String,
    pub status: String,
    pub provider: String,
}

#[derive(Debug, thiserror::Error)]
pub enum PdpError {
    #[error("erreur réseau vers la plateforme agréée : {0}")]
    Http(String),
    #[error("réponse invalide de la plateforme agréée : {0}")]
    Response(String),
}

#[async_trait]
pub trait PdpProvider: Send + Sync {
    /// Nom lisible du fournisseur.
    fn name(&self) -> &'static str;
    /// Envoie une facture (déjà revalidée côté serveur).
    async fn send(&self, invoice: &Invoice) -> Result<SendResult, PdpError>;
    /// Récupère l'état d'une facture précédemment envoyée.
    async fn status(&self, id: &str) -> Result<StatusResult, PdpError>;
}
