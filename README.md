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
- ✅ **Phase 2 — WASM + add-in** : `crates/facture-wasm` (wasm-bindgen) + `addin/` (Next.js : démo de validation + task pane Office, `manifest.xml`).
- ✅ **Phase 3 — Backend + PDP** : `crates/facture-backend` (Axum) — revalidation serveur + trait `PdpProvider` (impl B2Brouter + simulation), routes `/api/validate`, `/api/send`, `/api/status/:id`. Bouton **Envoyer** câblé (mode simulation par défaut).
- ✅ **Phase 4 — Couche IA douce** : heuristiques déterministes locales (WASM, RGPD-safe) + couche LLM Mistral (backend, `/api/ai-check`, garde-fous, désactivable). Avertissements **jaunes** non bloquants intégrés au rapport et à la modale.
- ⏭️ **Phase 5** : import OCR/PDF → Invoice.

### 🔎 Démo en ligne

- **Banc d'essai** (validation dans le navigateur, sans Excel) : <https://facture-impec.vercel.app/>
- **Task pane Office** : <https://facture-impec.vercel.app/taskpane>
- **Manifeste à sideloader dans Excel** : <https://facture-impec.vercel.app/manifest.xml>
  (Excel sur le web → Insertion → Compléments → Charger mon complément → `manifest.xml`).

Le même moteur Rust (compilé en WASM) valide la facture côté navigateur ; la démo montre le
surlignage rouge/jaune et la modale *Corriger / Envoyer quand même* (§6.4/6.5).

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

### Backend (Phase 3)

```bash
cargo run -p facture-backend          # écoute sur 0.0.0.0:8080 (mode simulation par défaut)
# routes : GET /health · POST /api/validate · POST /api/send · GET /api/status/:id
```

**Envoi réel via B2Brouter** (sinon simulation) — variables d'environnement :

```bash
B2BROUTER_API_KEY=...        # clé sandbox/prod (jamais commitée)
B2BROUTER_ACCOUNT_ID=...     # compte reseller de l'entreprise
B2BROUTER_BASE_URL=https://api-staging.b2brouter.net   # (défaut : staging)
B2BROUTER_API_VERSION=2.0
ALLOWED_ORIGIN=https://facture-impec.vercel.app        # CORS (défaut : *)
```

Côté add-in Vercel, `/api/send` relaie vers ce backend si `BACKEND_URL` est défini (variable
d'environnement Vercel) ; sinon il renvoie une réponse **simulée** pour la démo.

## Licence

[MIT](./LICENSE).
