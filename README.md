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
- ✅ **Phase 5 — Import** : `crates/facture-backend/src/ocr` (extraction PDF via `pdf-extract` + structuration heuristique) + route `/api/import`. Banc d'essai : import de **texte** structuré **localement** (client, RGPD). Task pane : « Importer depuis PDF » (via backend).
- ✅ **Phase 6 — Durcissement** : auth par jeton (`APP_TOKEN`), idempotence des envois, retries réseau, multi-tenant (`X-Account-Id`), `Dockerfile`, doc [`DEPLOIEMENT.md`](./docs/DEPLOIEMENT.md) (sécurité, RGPD, AppSource, Word hors périmètre). **MVP fonctionnel.**

### 🔎 Démo en ligne

- **Banc d'essai** (validation dans le navigateur, sans Excel) : <https://facture-impec.vercel.app/>
- **Task pane Office** : <https://facture-impec.vercel.app/taskpane>
- **Manifeste à sideloader dans Excel** : <https://facture-impec.vercel.app/manifest.xml>
  (Excel sur le web → Insertion → Compléments → Charger mon complément → `manifest.xml`).

Le même moteur Rust (compilé en WASM) valide la facture côté navigateur ; la démo montre le
surlignage rouge/jaune et la modale *Corriger / Envoyer quand même* (§6.4/6.5).

## Tester le complément dans Excel

Le complément est **déjà déployé** (task pane + manifeste servis depuis Vercel) : aucun serveur
local à lancer. Tester en conditions réelles = **sideload** (chargement manuel) du manifeste.
Pas besoin de publier sur AppSource pour cela.

- **Manifeste à charger** : <https://facture-impec.vercel.app/manifest.xml> (téléchargez-le d'abord).
- **Version** : `1.0.0.0` — validée par `office-addin-manifest validate` (*« The manifest is valid »*).
- Excel ne fonctionne **pas sous Linux** : utilisez **Excel sur le web** (n'importe quel OS) ou
  **Excel Desktop** sous Windows / macOS.

### Option A — Excel sur le web (le plus simple)

Nécessite un compte Microsoft 365 prenant en charge les compléments.

1. Ouvrez <https://excel.office.com> → nouveau classeur vierge.
2. Onglet **Insertion** → **Compléments** (*Add-ins*) → **Charger mon complément** (*Upload My Add-in*).
3. Sélectionnez le fichier `manifest.xml` téléchargé → **Charger**.
4. Onglet **Accueil** : le groupe **Facture Impec** apparaît → bouton **« Valider la facture »** ouvre le task pane.

### Option B — Excel Desktop sous Windows (catalogue de dossier partagé)

1. Créez un dossier, ex. `C:\office-addins`.
2. Partagez-le en réseau : clic droit → **Propriétés** → **Partage** → **Partager…** → ajoutez votre
   utilisateur. Notez le chemin **UNC** affiché, du type `\\NOM-PC\office-addins`.
   ⚠️ Excel exige un chemin réseau `\\…`, un chemin local `C:\…` ne fonctionne **pas**.
3. Copiez `manifest.xml` dans ce dossier.
4. Excel → **Fichier** → **Options** → **Centre de gestion de la confidentialité** →
   **Paramètres…** → **Catalogues de compléments approuvés** → collez le chemin UNC →
   **Ajouter le catalogue** → cochez **Afficher dans le menu** → **OK**.
5. **Redémarrez Excel** complètement.
6. **Insertion** → flèche sous **Mes compléments** → onglet **Dossier partagé** (*Shared Folder*) →
   **Facture Impec** → **Ajouter**.

### Option C — Excel Desktop sous macOS

Copiez `manifest.xml` dans le dossier de sideload puis redémarrez Excel :

```
~/Library/Containers/com.microsoft.Excel/Data/Documents/wef/
```

Puis **Insertion** → **Mes compléments** → **Facture Impec**.

### Ce que vous verrez (mode MVP)

- Le task pane (fr-FR) se charge depuis la production Vercel.
- La **validation EN 16931 / FR fonctionne réellement** (moteur Rust → WASM, côté client) :
  surlignage **rouge** (erreurs bloquantes) et **jaune** (suspicions IA, non bloquantes).
- L'**envoi** est en **mode simulation** (`/api/send` → SIM) faute de clé B2Brouter ;
  la couche IA est **désactivée** (`/api/ai-check` → disabled) ; l'import PDF via backend renvoie
  `501` (backend non déployé). Le parcours UX complet passe, mais **aucun envoi réel** vers une
  plateforme payante n'a lieu.

### Vérifier le manifeste avant de charger

```bash
npx --yes office-addin-manifest validate manifest.xml
```

### Dépannage (Windows)

- **Le complément n'apparaît pas dans « Dossier partagé »** → le dossier n'est pas réellement
  partagé (pas de chemin UNC `\\…`), ou Excel n'a pas été redémarré.
- **Task pane blanc** → clic droit dans le panneau → **Inspecter** pour voir la console
  (peu probable : la production répond `200`).
- La découverte réseau doit être activée (réseau privé/professionnel).

### Passer en envoi réel

Voir [`docs/DEPLOIEMENT.md`](./docs/DEPLOIEMENT.md) : déployer `facture-backend` (Docker/VPS) avec
`B2BROUTER_API_KEY` / `_ACCOUNT_ID` / `_BASE_URL`, puis définir `BACKEND_URL` (+ `BACKEND_TOKEN`)
sur Vercel pour que `/api/send` relaie vers la plateforme agréée.

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
