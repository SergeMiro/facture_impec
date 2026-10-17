# Architecture

Voir `AGENT_PLAN.md` §3 pour le schéma complet. Résumé :

- **`crates/facture-core`** (Rust) — modèle `Invoice` + validation EN 16931 + règles FR + rapport + i18n FR.
  Source de vérité unique, partagée WASM ↔ backend.
- **`crates/facture-wasm`** (wasm-bindgen) — expose `validate(json) -> reportJson` au task pane.
  Exécution **locale** dans le navigateur Office → validation instantanée, sans réseau.
- **`crates/facture-backend`** (Rust / Axum) — garde la clé API PDP (jamais côté client),
  revalide, appelle B2Brouter via `PdpProvider`, héberge OCR/import et la couche IA, journalise.
- **`addin/`** (TypeScript / React + Office.js) — UI fr-FR, lecture/écriture cellules,
  surlignage rouge/jaune, modale Corriger / Envoyer quand même.

## Flux de données
Excel (cellules) → `excelBridge.readInvoice()` → JSON → `facture-wasm.validate()` →
`ValidationReport` → surlignage + modale → (si propre) `backendClient.send()` →
backend revalide → `PdpProvider::send()` → B2Brouter → Factur-X + routage + e-reporting DGFiP.

## Décisions clés
- Un seul modèle `Invoice` (pas de duplication divergente Rust/TS).
- Erreur dure = blocage d'envoi ; warning IA = "Envoyer quand même" autorisé.
- Abstraction `PdpProvider` dès le départ (pas de verrouillage B2Brouter).
- Word : extraction uniquement, jamais émission (un .docx n'est pas un format structuré EN 16931).
