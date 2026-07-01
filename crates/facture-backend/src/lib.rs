//! Backend Facture Impec (Axum).
//!
//! - Revalide la facture côté serveur avec `facture-core` (defense in depth — ne jamais faire
//!   confiance au seul client).
//! - Envoie via une **Plateforme Agréée** derrière le trait [`pdp::PdpProvider`] (B2Brouter au MVP),
//!   pour ne pas se verrouiller sur un fournisseur.
//! - Garde secrète la clé API PDP (jamais exposée au client).

pub mod ai;
pub mod config;
pub mod pdp;
pub mod routes;
