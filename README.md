# Facture Impec

> Assistant de pré-vol pour la facturation électronique française (réforme DGFiP 2026/2027).
> Add-in **Excel / Office 365** qui valide vos factures (règles dures EN 16931 + contrôle IA),
> surligne les erreurs, puis les transmet via une **Plateforme Agréée** (B2Brouter) — sans quitter Excel.

## En une phrase

L'utilisateur remplit sa facture dans Excel, Facture Impec la **vérifie en local** (cœur de validation
en **Rust → WASM**, ultra-rapide), signale les erreurs **en rouge** (bloquantes, EN 16931) et les
suspicions **en jaune** (IA, non bloquantes), puis l'**envoie** à une Plateforme Agréée qui produit
le Factur-X et gère l'e-reporting DGFiP.

## Statut

🚧 En construction par phases (cf. [`AGENT_PLAN.md`](./AGENT_PLAN.md) §11).

- ✅ **Phase 0 — Bootstrap** : Cargo workspace, CI (fmt + clippy + build + test), licence MIT, specs déposées dans `docs/`.
- ✅ **Phase 1 — Cœur de validation** : `crates/facture-core` (modèle `Invoice`, règles EN 16931 + FR, rapport, messages FR, tests).
- ⏭️ **Phase 2** : WASM + add-in Excel (à venir — revue demandée avant de démarrer, cf. §14).

## Positionnement légal

Facture Impec est une **Solution Compatible (SC) / Opérateur de Dématérialisation (OD)** — **pas**
une PDP. Il se connecte par API à une Plateforme Agréée immatriculée (B2Brouter pour le MVP), qui
assure la transmission et l'e-reporting. Pas de certification ISO 27001 ni de tests
d'interopérabilité DGFiP à notre charge.

## Architecture (résumé)

- **Cœur** : `crates/facture-core` (Rust) — modèle `Invoice` + validation EN 16931 + règles FR.
- **Front** : `crates/facture-wasm` (WASM) chargé dans un **Office Add-in** (`addin/`, TypeScript/React).
- **Backend** : `crates/facture-backend` (Rust/Axum) — garde la clé PDP, appelle B2Brouter, OCR, couche IA.

Voir [`AGENT_PLAN.md`](./AGENT_PLAN.md) pour le détail complet.

## Démarrage

Prérequis : Rust stable (cf. `rust-toolchain.toml`).

```bash
cargo build --workspace      # compile le cœur de validation
cargo test  --workspace      # 18 tests (règles EN 16931 + FR, calculs, formats)
cargo clippy --workspace --all-targets -- -D warnings
```

Le cœur (`crates/facture-core`) expose `validate(&Invoice) -> ValidationReport` et
`validate_json(&str) -> Result<String, _>` (point d'entrée partagé WASM/backend des phases suivantes).

## Licence

[MIT](./LICENSE).
