//! `facture-core` — cœur de validation de **Facture Impec**.
//!
//! Source de vérité unique, partagée entre le WASM du task pane (Phase 2) et le
//! backend Axum (Phase 3). Contient le modèle `Invoice`, les règles de validation
//! (EN 16931 + règles françaises), le rapport de validation et les messages FR.
//!
//! Le contenu est construit en Phase 1 (cf. `AGENT_PLAN.md` §11).
