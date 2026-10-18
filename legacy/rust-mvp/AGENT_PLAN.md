# Facture Impec — Plan de construction pour agent IA

> **Document destiné à un agent IA de développement** (Claude Code ou équivalent).
> Langue de l'interface produit : **français**. Langue de ce document : français/anglais technique.
> Nom de projet provisoire : **Facture Impec**. Alternatives : `Facture Simple`, `Facturation Nationale`, `PreFlight Facture`.
> Pour renommer : changer la valeur `PROJECT_NAME` au §1.4 et faire un rechercher/remplacer global.

---

## 0. Résumé exécutif (lire en premier)

Facture Impec est un **add-in Microsoft Office (Excel en priorité, Word optionnel)** qui agit comme un **assistant de pré-vol** ("pre-flight checker") pour la facturation électronique française obligatoire (réforme DGFiP, sept. 2026 / sept. 2027).

L'utilisateur remplit sa facture dans un classeur Excel familier. L'add-in :

1. **Lit** les données de la feuille.
2. **Valide** la facture en deux couches :
   - **Couche dure (déterministe, EN 16931)** — champs obligatoires, cohérence des montants, TVA, format SIREN/SIRET/TVA intracom, dates. Moteur écrit en **Rust** compilé en **WebAssembly (WASM)** pour la rapidité et l'exécution locale.
   - **Couche douce (IA / LLM)** — anomalies sémantiques : taux de TVA improbable pour le type de service, adresse douteuse, montants ronds suspects, incohérence description/prix.
3. **Surligne en rouge** les cellules avec erreurs dures, **en jaune** les avertissements IA.
4. **Affiche une fenêtre modale** listant les problèmes, avec options : *Corriger* / *Envoyer quand même* (uniquement pour les avertissements doux ; les erreurs dures EN 16931 bloquent l'envoi car la PDP les rejettera).
5. **Envoie** la facture validée via l'API REST d'une **Plateforme Agréée (PA, ex-PDP)** — partenaire technique **B2Brouter** retenu pour le MVP — qui gère la génération Factur-X/UBL/CII, la transmission au client et l'e-reporting DGFiP.

**Positionnement légal** : Facture Impec est une **Solution Compatible (SC) / Opérateur de Dématérialisation (OD)**, PAS une PDP. Il ne transmet jamais directement à l'administration ; il délègue à une PA immatriculée. Cela évite la certification ISO 27001 et les tests d'interopérabilité DGFiP.

**Valeur unique** : attraper les erreurs *dans Excel, au moment de la création*, en français, AVANT que la PDP ne les rejette. Le "shift-left" de la conformité.

---

## 1. Contexte réglementaire et technique (à connaître)

### 1.1 La réforme française
- **1er sept. 2026** : toutes les entreprises assujetties à la TVA doivent pouvoir **recevoir** des factures électroniques. Grandes entreprises et ETI doivent **émettre**.
- **1er sept. 2027** : PME, TPE et micro-entreprises doivent **émettre**.
- Le **PPF** (Portail Public de Facturation) gratuit pour l'émission a été **abandonné** (oct. 2024). Le PPF ne sert plus que d'annuaire central. → Toute émission passe **obligatoirement** par une **Plateforme Agréée (PA)**.
- Formats socles : **Factur-X** (PDF/A-3 + XML CII embarqué), **UBL**, **CII**. Norme sémantique : **EN 16931**.
- Modèle en "Y" : émetteur → PA émettrice → PA réceptrice → destinataire, avec extraction de données vers la DGFiP.

### 1.2 Le marché cible
- 60–80 % des TPE/PME françaises facturent encore via **Excel/Word → PDF → email**. Cette pratique devient **non conforme**.
- Seules ~20 % des entreprises émettent déjà en format structuré.
- → Énorme base d'utilisateurs habitués à Excel, à qui on retire leur méthode actuelle. Facture Impec leur permet de **garder Excel** tout en devenant conformes.

### 1.3 Notre rôle dans l'écosystème
- **PDP / PA** : immatriculée par l'État. Peut transmettre. (PAS nous.)
- **OD / Solution Compatible (SC)** : prépare les factures, se connecte à une PA via API. (← **NOUS**.)
- Conséquence : on ne génère PAS soi-même le Factur-X final ni la transmission. On peut le faire en local pour validation/aperçu, mais l'artefact légal est produit et routé par la PA.

### 1.4 Constantes du projet
```
PROJECT_NAME      = "Facture Impec"
UI_LANGUAGE       = "fr-FR"
PA_PARTNER_MVP    = "B2Brouter"
PA_API_BASE_PROD  = "https://api.b2brouter.net"
PA_API_BASE_STAGE = "https://api-staging.b2brouter.net"
EINVOICE_STANDARD = "EN 16931"
TARGET_FORMATS    = ["Factur-X", "UBL", "CII"]
```

---

## 2. Choix du partenaire PDP (MVP : B2Brouter)

Raisons du choix pour le MVP :
- API **REST** self-service avec **sandbox** (clé de test → sandbox automatiquement, même URL de base).
- B2Brouter **est lui-même** une PA immatriculée DGFiP (pas un relais vers une autre PA).
- Une seule intégration couvre : enregistrement PPF, génération UBL/CII/Factur-X, routage client, e-reporting DGFiP.
- Documentation orientée agents IA : index Markdown + OpenAPI sur `https://developer.b2brouter.net/llms.txt`.
- Modèle "reseller" : ajouter chaque entreprise cliente comme `account` dans un groupe d'intégration, **une seule clé API** partagée (jusqu'à des dizaines de comptes ; plan dédié au-delà de 100).
- Modes **marque blanche** (B2Brouter invisible) et **marque grise** (B2Brouter visible comme PA).
- SDK officiel **PHP** uniquement pour l'instant → on appelle l'API **REST directement** depuis TypeScript/Rust.

**Abstraction obligatoire** : encapsuler toute la communication PDP derrière une interface `PdpProvider` (trait Rust + interface TS) pour pouvoir brancher SEQINO, Tenor ou une autre PA plus tard sans réécrire le produit.

**À CLARIFIER avec B2Brouter avant prod** (l'agent doit créer un ticket / placeholder, pas inventer) :
- Tarification par transaction (plans "editor" sur devis) → impacte le pricing final.
- Conditions du plan reseller / eDocSync pour 100+ comptes.
- Périmètre exact de validation EN 16931 côté B2Brouter (pour savoir ce qu'on duplique en local).

### 2.1 Endpoints B2Brouter à utiliser (vérifier dans l'OpenAPI courant)
- `POST /accounts/{ACCOUNT_ID}/invoices` — créer + émettre une facture (`send_after_import: true`).
- `GET  /accounts/{ACCOUNT_ID}/invoices/{id}` — statut / cycle de vie.
- `GET  /accounts/{ACCOUNT_ID}/invoices?type=ReceivedInvoice` — réception.
- Directory API — résolution du destinataire (pays + identifiant).
- Webhooks — changements de statut (au lieu de polling).
- Auth : header `X-B2B-API-Key`, plus `X-B2B-API-Version`.

> L'agent DOIT récupérer la spec OpenAPI à jour depuis `https://developer.b2brouter.net/llms.txt` au début du travail d'intégration plutôt que de coder en dur ces champs depuis ce document.

---

## 3. Architecture cible

```
┌─────────────────────────────────────────────────────────────┐
│  Microsoft Excel / Word (Desktop, Online, Microsoft 365)      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Office Add-in (Office.js) — Task Pane                  │  │
│  │  UI : React + TypeScript (fr-FR)                        │  │
│  │   - lecture/écriture cellules, surlignage              │  │
│  │   - modale erreurs/avertissements                      │  │
│  │   - boutons : Valider / Corriger / Envoyer / Envoyer    │  │
│  │     quand même                                          │  │
│  └───────────────┬───────────────────────────────────────┘  │
│                  │ appelle (JS bindings)                       │
│  ┌───────────────▼───────────────────────────────────────┐  │
│  │  CORE WASM (Rust → wasm-bindgen)                        │  │
│  │   - parsing modèle Invoice                             │  │
│  │   - validation EN 16931 (règles dures)                 │  │
│  │   - validations format : SIREN/SIRET, TVA, IBAN, dates │  │
│  │   - calculs montants/TVA (source de vérité)            │  │
│  │   - mapping cellules ↔ champs (rapport d'erreurs)      │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────┬───────────────────────────────────────┘
                       │ HTTPS (fetch)
        ┌──────────────▼───────────────┐   ┌────────────────────┐
        │  Backend Facture Impec         │   │  Service IA (LLM)   │
        │  (Rust : Axum)                │──▶│  couche douce       │
        │   - proxy/secret PDP API key  │   │  (Claude/Mistral)   │
        │   - PdpProvider (B2Brouter)   │   │  anomalies sémant.  │
        │   - OCR/import PDF→Invoice     │   └────────────────────┘
        │   - persistance (audit/log)   │
        └──────────────┬───────────────┘
                       │ REST (X-B2B-API-Key)
        ┌──────────────▼───────────────┐
        │  B2Brouter (PA immatriculée)  │
        │   Factur-X/UBL/CII + routage  │
        │   + e-reporting DGFiP         │
        └───────────────────────────────┘
```

### 3.1 Pourquoi Rust + WASM
- Le **core de validation** (le plus critique pour la rapidité ressentie : il tourne à chaque frappe/clic) est en **Rust compilé en WASM**, exécuté **localement dans le navigateur du task pane**. Aucune latence réseau pour la validation dure.
- Le **backend** est en **Rust (Axum)** pour : (a) garder secrète la clé API PDP (ne JAMAIS l'exposer côté client), (b) centraliser l'appel PDP, (c) héberger l'import OCR, (d) journaliser pour l'audit.
- Le **même crate Rust** (`facture-core`) est partagé entre WASM (front) et backend (serveur) → une seule source de vérité pour le modèle `Invoice` et les règles. C'est l'avantage clé d'avoir choisi Rust.

### 3.2 Ce qui n'est PAS en Rust
- L'UI du task pane : **TypeScript + React** (obligatoire, Office.js est JS).
- Le manifeste Office : XML.
- Glue Office.js (lecture cellules) : TypeScript.

---

## 4. Structure du monorepo

```
facture_impec/
├── README.md
├── AGENT_PLAN.md                 # ce document
├── LICENSE                       # voir §12
├── .gitignore
├── .github/
│   └── workflows/
│       ├── ci.yml                # build+test Rust, build add-in, lint
│       └── deploy.yml            # déploiement backend + hébergement add-in
├── crates/
│   ├── facture-core/             # CŒUR partagé (lib Rust)
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── model.rs          # struct Invoice, Party, Line, Tax...
│   │       ├── validation/
│   │       │   ├── mod.rs
│   │       │   ├── en16931.rs    # règles dures EN 16931
│   │       │   ├── french.rs     # SIREN/SIRET, TVA FR, mentions légales
│   │       │   ├── formats.rs    # IBAN, dates, devises
│   │       │   └── amounts.rs    # cohérence lignes/totaux/TVA
│   │       ├── report.rs         # ValidationReport, Severity, CellRef
│   │       └── i18n.rs           # messages d'erreur en français
│   ├── facture-wasm/             # wrapper wasm-bindgen autour de facture-core
│   │   ├── Cargo.toml
│   │   └── src/lib.rs            # expose validate(invoiceJson) -> reportJson
│   └── facture-backend/          # serveur Axum
│       ├── Cargo.toml
│       └── src/
│           ├── main.rs
│           ├── routes/
│           │   ├── validate.rs   # /api/validate (revalide côté serveur)
│           │   ├── send.rs       # /api/send -> PdpProvider
│           │   ├── import.rs     # /api/import (OCR PDF/scan -> Invoice)
│           │   └── health.rs
│           ├── pdp/
│           │   ├── mod.rs        # trait PdpProvider
│           │   └── b2brouter.rs  # implémentation B2Brouter
│           ├── ai/
│           │   └── mod.rs        # couche douce : appel LLM
│           ├── ocr/
│           │   └── mod.rs        # extraction PDF/scan
│           └── config.rs         # secrets via env (clé PDP, clé LLM)
├── addin/                        # Office Add-in
│   ├── package.json
│   ├── tsconfig.json
│   ├── webpack.config.js
│   ├── manifest.xml              # manifeste Office (Excel + Word)
│   ├── public/
│   │   └── assets/               # icônes 16/32/64/80px
│   └── src/
│       ├── taskpane/
│       │   ├── taskpane.html
│       │   ├── index.tsx
│       │   ├── App.tsx
│       │   ├── components/
│       │   │   ├── ValidationPanel.tsx
│       │   │   ├── ErrorModal.tsx        # modale Corriger/Envoyer quand même
│       │   │   ├── SendButton.tsx
│       │   │   └── StatusBadge.tsx
│       │   ├── office/
│       │   │   ├── excelBridge.ts        # lecture/écriture/surlignage cellules
│       │   │   └── wordBridge.ts         # (optionnel) extraction Word
│       │   ├── core/
│       │   │   └── wasmLoader.ts         # charge facture-wasm
│       │   ├── api/
│       │   │   └── backendClient.ts      # fetch vers facture-backend
│       │   └── i18n/
│       │       └── fr.ts                 # toutes les chaînes UI en français
│       └── commands/
│           └── commands.ts
├── templates/
│   └── facture_modele.xlsx       # modèle Excel avec cellules nommées (voir §6.1)
└── docs/
    ├── ARCHITECTURE.md
    ├── PDP_INTEGRATION.md        # détails B2Brouter + abstraction
    ├── VALIDATION_RULES.md       # catalogue des règles EN 16931 + FR
    ├── AI_LAYER.md               # prompts & garde-fous LLM
    └── ROADMAP.md
```

---

## 5. Modèle de données (`facture-core/src/model.rs`)

Définir un modèle `Invoice` neutre, indépendant de B2Brouter et de Factur-X, que l'on mappe ensuite vers le format PDP. S'aligner sur les champs **BT-** de la norme EN 16931 (Business Terms) pour faciliter le mapping.

Champs minimaux (profil EN 16931 / Factur-X "Basic") :
- **Émetteur (Seller)** : nom (BT-27), SIREN/SIRET, n° TVA intracom (BT-31), adresse complète (BT-35..40), code pays.
- **Acheteur (Buyer)** : nom (BT-44), SIREN/SIRET (BT-47), TVA intracom (BT-48), adresse.
- **Facture** : numéro (BT-1), date d'émission (BT-2), type (BT-3, ex. 380), devise (BT-5), date d'échéance.
- **Lignes (≥1)** : description (BT-153), quantité (BT-129), unité (BT-130), prix unitaire net (BT-146), montant ligne (BT-131), taux TVA (BT-152), catégorie TVA (BT-151).
- **Totaux** : total HT (BT-109), ventilation TVA par taux (BG-23), total TVA (BT-110), total TTC (BT-112), net à payer (BT-115).
- **Mentions** : code catégorie/raison d'exonération TVA si applicable (BT-121, VATEX), conditions de paiement, IBAN/BIC.

> ⚠️ Attention au piège connu : un modèle Excel "minimaliste" (~15 champs) ne suffit PAS pour le profil EN 16931 avec détail des lignes (50+ champs). Le modèle Excel (§6.1) doit couvrir tous les champs requis par le profil visé, sinon la PDP rejette. Documenter clairement le profil supporté (commencer par **Basic WL** puis monter vers **EN 16931**).

Implémenter `serde` (Serialize/Deserialize) sur tout le modèle pour passer en JSON entre WASM ↔ TS ↔ backend.

---

## 6. Spécification de l'add-in Office

### 6.1 Modèle Excel (`templates/facture_modele.xlsx`)
- Utiliser des **plages nommées** (Named Ranges) pour chaque champ : `seller_name`, `seller_siret`, `buyer_siret`, `invoice_number`, `invoice_date`, etc. → l'add-in lit par nom, pas par coordonnée, robuste aux déplacements.
- Une zone tabulaire pour les lignes (`lines_table`) en tant que Table Excel structurée.
- Cellules de totaux en **formules** (l'add-in vérifie qu'elles concordent avec son propre calcul Rust ; divergence = erreur).
- Feuille cachée "FF_meta" : profil visé, version du modèle, ID compte PDP.

### 6.2 Bridge Excel (`excelBridge.ts`)
Fonctions :
- `readInvoice(): InvoiceDTO` — lit toutes les plages nommées + la table de lignes → DTO JSON.
- `highlightCells(report: ValidationReport)` — applique `range.format.fill.color`:
  - rouge `#F8C9C9` pour `Severity::HardError`,
  - jaune `#FCE9B8` pour `Severity::SoftWarning`,
  - efface (`clear`) les surlignages précédents avant de réappliquer.
- `addCellComment(cellRef, message)` — commentaire avec le message d'erreur français.
- Tout passe par `Excel.run(async ctx => { ... ctx.sync() })`.

### 6.3 Word (optionnel, phase ultérieure)
⚠️ **Word ne peut PAS être la source d'une facture électronique** : un .docx n'est pas un format structuré machine-lisible au sens EN 16931. Donc, pour Word :
- soit **désactivé au MVP** (recommandé),
- soit l'add-in Word sert uniquement à **extraire** des données d'une facture Word existante (via OCR/parsing texte) pour les convertir → réutilise le pipeline d'import §8. Ne jamais laisser croire qu'on "émet depuis Word".

### 6.4 Flux UI (exact, tel que demandé)
1. L'utilisateur clique **« Valider »**.
2. `excelBridge.readInvoice()` → JSON → `factureWasm.validate(json)` (local, instantané) → `ValidationReport`.
3. Si le rapport contient des **erreurs dures** ou **avertissements doux** :
   - surligner les cellules (rouge / jaune),
   - **ouvrir la modale** `ErrorModal` listant chaque problème en français, groupé par sévérité.
   - La modale demande : *« Des problèmes ont été détectés. Voulez-vous les corriger ? »* avec :
     - bouton **« Corriger »** → ferme la modale, l'utilisateur édite les cellules surlignées, puis re-clique « Valider ».
     - bouton **« Envoyer quand même »** → **activé uniquement si AUCUNE erreur dure** (seulement des avertissements doux). Si erreurs dures présentes, ce bouton est **désactivé** avec infobulle : *« La plateforme rejettera cette facture : corrigez les erreurs en rouge d'abord. »*
4. Re-validation après corrections : si **propre**, le bouton **« Envoyer »** devient actif.
5. **« Envoyer »** :
   - appelle `backendClient.send(invoice)` → backend → `PdpProvider::send()` → B2Brouter.
   - affiche le statut (envoyée, acceptée, rejetée) via webhooks/polling, badge `StatusBadge`.
6. Toujours appeler une **validation côté serveur** avant l'envoi réel (ne jamais faire confiance au seul client). Le backend revalide avec `facture-core` (même crate) → cohérence garantie.

### 6.5 Distinction dure / douce (essentielle)
- **Erreur dure (rouge, bloquante)** : violation EN 16931 / format invalide → la PDP rejettera. `Envoyer quand même` interdit.
- **Avertissement doux (jaune, non bloquant)** : suspicion IA (TVA inhabituelle, etc.) → `Envoyer quand même` autorisé. C'est une force produit : on dit honnêtement à l'utilisateur ce qui *cassera* vs ce qui *semble* douteux.

---

## 7. Moteur de validation (`facture-core/src/validation/`)

### 7.1 Règles dures EN 16931 (`en16931.rs`)
Implémenter au minimum les règles BR (Business Rules) clés :
- BR-1 : la facture a un numéro.
- BR-2 : date d'émission présente.
- BR-3..: vendeur/acheteur noms présents.
- BR-CO-10 : somme des montants de ligne = total HT.
- BR-CO-13 : total HT + total TVA = total TTC.
- BR-S/Z/E/AE… : règles par catégorie de TVA (standard, taux zéro, exonéré, autoliquidation).
- BR-DEC-* : nombre de décimales.
- Cohérence devise unique.
> Source de vérité des règles : le schématron officiel EN 16931. L'agent doit récupérer la liste des règles BR depuis la spec officielle EN 16931 et NON les inventer. Encoder chaque règle avec son code (ex. "BR-CO-10") pour traçabilité.

### 7.2 Règles françaises (`french.rs`)
- **SIREN** : 9 chiffres, validation par algorithme de **Luhn**.
- **SIRET** : 14 chiffres (SIREN + NIC), Luhn.
- **TVA intracommunautaire FR** : format `FR` + clé (2 car.) + SIREN ; vérifier la clé : `clé = (12 + 3 * (SIREN mod 97)) mod 97`.
- **Mentions légales obligatoires** sur facture FR (numéro, date, identité, etc.).
- Codes d'exonération TVA (VATEX-FR-*).

### 7.3 Rapport (`report.rs`)
```rust
pub enum Severity { HardError, SoftWarning }
pub struct Issue {
    pub code: String,        // "BR-CO-10", "FR-SIRET-LUHN", "AI-VAT-RATE"
    pub severity: Severity,
    pub field: String,       // "buyer_siret"
    pub cell_ref: Option<String>, // "C7" pour surlignage
    pub message_fr: String,  // message utilisateur en français
}
pub struct ValidationReport { pub issues: Vec<Issue>, pub is_sendable: bool }
```
`is_sendable = issues.iter().all(|i| i.severity != HardError)`.

### 7.4 i18n (`i18n.rs`)
Tous les `message_fr` centralisés, ton clair et non culpabilisant. Ex. : *« Le total TTC (1 200,00 €) ne correspond pas à HT + TVA (1 180,00 €). Vérifiez la ligne 3. »*

---

## 8. Import / OCR (PDF, scan, papier → Invoice)

Objectif demandé : convertir factures papier/PDF/scan → électronique.

Pipeline backend (`facture-backend/src/ocr/`) :
1. Entrée : PDF (texte ou scanné) ou image.
2. **PDF texte** : extraction directe (crate Rust `pdf-extract` / `lopdf`, ou appel à un service).
3. **PDF scanné / image** : OCR. Options :
   - Tesseract (via binding) pour rester local/EU.
   - ou un **VLM / LLM multimodal** (Claude, Mistral, Qwen2.5-VL) pour les mises en page variables → meilleure robustesse mais coût/latence GPU.
4. **Structuration** : LLM transforme le texte OCR brut → JSON `Invoice` (prompt strict "réponds uniquement en JSON, schéma X").
5. Le JSON repasse dans le **moteur de validation** (§7) → l'utilisateur voit/corrige dans Excel avant envoi.

Stratégie recommandée MVP : commencer par PDF-texte + un LLM pour la structuration ; ajouter l'OCR image en phase 2. Garder l'extraction derrière une interface `InvoiceExtractor` pour pouvoir changer de moteur.

---

## 9. Couche IA "douce" (`facture-backend/src/ai/`)

- Rôle : détecter ce qui passe la validation dure mais "sent" l'erreur.
- Entrée : l'`Invoice` (déjà valide formellement) → LLM → liste d'`Issue` en `SoftWarning`.
- Exemples de signaux : taux de TVA atypique pour la nature du bien/service ; SIRET valide Luhn mais raison sociale incohérente ; montants ronds inhabituels ; date d'échéance < date d'émission ; devise étrangère inattendue.
- **Garde-fous** :
  - Le LLM ne produit JAMAIS d'erreur dure (jamais bloquant) ; il ne fait qu'avertir.
  - Sortie strictement structurée (JSON validé contre un schéma) ; ignorer toute sortie non conforme.
  - Ne pas envoyer de données client au LLM sans le signaler (RGPD) ; prévoir un mode "IA désactivée" et un hébergement LLM EU (Mistral) configurable.
  - Données sensibles : journaliser le minimum.
- Prompt et schéma documentés dans `docs/AI_LAYER.md`.

---

## 10. Backend (`facture-backend`, Axum)

- **Pourquoi un backend** : la clé API PDP ne doit JAMAIS être dans le client (un add-in est du JS inspectable). Le backend la détient via variable d'environnement.
- Routes :
  - `POST /api/validate` — revalidation serveur (defense in depth).
  - `POST /api/send` — mappe `Invoice` → payload B2Brouter → `POST /accounts/{id}/invoices` (`send_after_import:true`) → renvoie l'ID + statut.
  - `POST /api/import` — OCR/extraction.
  - `POST /api/ai-check` — couche douce.
  - `GET  /api/status/{id}` — proxy statut PDP.
  - `POST /api/webhooks/pdp` — réception des webhooks B2Brouter (mise à jour de statut).
  - `GET  /health`.
- **Trait `PdpProvider`** (`pdp/mod.rs`) :
  ```rust
  #[async_trait]
  pub trait PdpProvider {
      async fn send(&self, inv: &Invoice) -> Result<SendResult, PdpError>;
      async fn status(&self, id: &str) -> Result<InvoiceStatus, PdpError>;
      async fn lookup_recipient(&self, country: &str, id: &str) -> Result<Recipient, PdpError>;
  }
  ```
  Implémentation `b2brouter.rs`. Récupérer l'OpenAPI courant via `developer.b2brouter.net/llms.txt`.
- **Mapping** `Invoice` → B2Brouter : `invoice_lines_attributes`, `taxes_attributes` (`name`, `percent`, `category` S/Z/E/AE, `comment` VATEX pour exonérations), `contact_id` ou contact inline, `payment_method`, etc.
- **Multi-tenant** : modèle reseller B2Brouter → chaque client = un `account` ; stocker le mapping client→account_id.
- Secrets via env : `B2BROUTER_API_KEY`, `B2BROUTER_API_VERSION`, `LLM_API_KEY`. Jamais commités.
- Persistance (Postgres, optionnelle MVP) : journal d'audit des envois, statuts, mapping comptes.

---

## 11. Plan d'exécution par phases (pour l'agent)

> Travailler par phases, commit à chaque étape, tests à chaque phase. Ne pas tout faire d'un coup.

### Phase 0 — Bootstrap
- [ ] Initialiser le monorepo (structure §4), `Cargo workspace`, `.gitignore`, licence, README.
- [ ] CI minimale : `cargo build`/`cargo test`, build add-in.
- [ ] Récupérer la spec OpenAPI B2Brouter (`llms.txt`) dans `docs/`.

### Phase 1 — Cœur de validation (Rust)
- [ ] `facture-core` : modèle `Invoice` (serde) + `ValidationReport`.
- [ ] Règles formats FR : Luhn SIREN/SIRET, clé TVA FR, IBAN, dates.
- [ ] Règles montants (`amounts.rs`) : BR-CO-10, BR-CO-13, décimales.
- [ ] Sous-ensemble de règles EN 16931 (récupérées de la spec officielle).
- [ ] Messages français (`i18n.rs`).
- [ ] Tests unitaires exhaustifs (cas valides + chaque type d'erreur).

### Phase 2 — WASM + add-in Excel (squelette)
- [ ] `facture-wasm` : `wasm-bindgen`, exposer `validate(json) -> json`.
- [ ] Add-in : manifeste (Excel), task pane React, chargeur WASM.
- [ ] `excelBridge.ts` : `readInvoice`, `highlightCells`, commentaires.
- [ ] Modèle `facture_modele.xlsx` avec plages nommées + table lignes.
- [ ] Flux : Valider → surlignage rouge/jaune → modale (Corriger / Envoyer quand même selon §6.4/6.5).
- [ ] i18n UI complète en français.

### Phase 3 — Backend + intégration PDP (sandbox)
- [ ] `facture-backend` Axum : routes `validate`, `send`, `status`, `health`, webhooks.
- [ ] Trait `PdpProvider` + impl `b2brouter.rs`.
- [ ] Mapping `Invoice` → payload B2Brouter ; gestion catégories TVA + VATEX.
- [ ] Compte sandbox B2Brouter, clé de test, premier envoi de bout en bout en staging.
- [ ] `backendClient.ts` côté add-in ; bouton Envoyer fonctionnel ; suivi de statut.
- [ ] Revalidation serveur avant envoi.

### Phase 4 — Couche IA douce
- [ ] Route `ai-check` + intégration LLM (EU/Mistral configurable).
- [ ] Schéma JSON de sortie + garde-fous + mode désactivable.
- [ ] Avertissements jaunes intégrés au rapport et à la modale.
- [ ] `docs/AI_LAYER.md`.

### Phase 5 — Import OCR/PDF
- [ ] Route `import` : PDF-texte → LLM structuration → `Invoice` → validation.
- [ ] Bouton « Importer depuis PDF » dans le task pane.
- [ ] Phase 2 import : OCR images (Tesseract/VLM).

### Phase 6 — Durcissement & sortie
- [ ] Word (optionnel) en mode extraction uniquement, OU explicitement hors périmètre.
- [ ] Gestion d'erreurs réseau/PDP, retries, idempotence des envois.
- [ ] RGPD : minimisation des données, hébergement EU, politique de logs.
- [ ] Sécurité : secrets, CORS, auth de l'add-in vers le backend (token).
- [ ] Multi-tenant reseller (mapping comptes).
- [ ] Tarification PDP clarifiée → modèle de prix produit.
- [ ] Doc utilisateur FR + guide d'installation de l'add-in (sideload + AppSource).
- [ ] Empaqueter pour Microsoft AppSource / déploiement centralisé M365.

---

## 12. Contraintes, non-négociables et pièges

1. **Ne jamais exposer la clé API PDP côté client.** Toujours via le backend.
2. **Ne jamais prétendre être une PDP.** Facture Impec est une SC/OD connectée à une PA.
3. **Erreurs dures EN 16931 = blocage d'envoi.** « Envoyer quand même » uniquement pour avertissements IA.
4. **Word n'émet pas de factures.** Au mieux extraction → conversion.
5. **Ne pas inventer les règles EN 16931 ni les champs B2Brouter** : les récupérer des specs officielles (schématron EN 16931 ; OpenAPI B2Brouter via `llms.txt`).
6. **Profil supporté explicite** : commencer Basic, viser EN 16931 ; couvrir tous les champs du profil (piège des "15 champs").
7. **Un seul `Invoice` model** partagé Rust (WASM + backend) — pas de duplication divergente.
8. **RGPD** : données de facturation = données personnelles ; hébergement EU, consentement pour l'envoi au LLM, minimisation.
9. **Abstraction PDP** dès le départ (trait + interface) pour ne pas se verrouiller sur B2Brouter.
10. **Licence** : choisir avant le premier commit public. Suggestion : code applicatif sous licence permissive (MIT/Apache-2.0) ; vérifier la compatibilité des dépendances. (Décision du propriétaire du repo.)
11. **Calendrier** : viser la conformité émission TPE/PME au **1er sept. 2027**, réception au **1er sept. 2026**.

---

## 13. Critères de "Definition of Done" du MVP

- Un utilisateur ouvre le modèle Excel, remplit une facture, clique « Valider ».
- Les erreurs de format/EN 16931 apparaissent en rouge avec messages français ; les suspicions IA en jaune.
- La modale propose Corriger / (Envoyer quand même si seulement jaune).
- Après correction, « Envoyer » transmet via B2Brouter **staging** et le statut revient (accepté/rejeté).
- Le cœur de validation tourne en WASM, localement, en < 50 ms pour une facture typique.
- La clé PDP n'est jamais visible côté client.
- Tests Rust verts ; CI verte.

---

## 14. Première action concrète pour l'agent

1. Lire ce document en entier.
2. Récupérer la spec OpenAPI B2Brouter via `https://developer.b2brouter.net/llms.txt` et la déposer dans `docs/PDP_INTEGRATION.md`.
3. Récupérer la liste officielle des règles BR EN 16931 (schématron) → `docs/VALIDATION_RULES.md`.
4. Exécuter **Phase 0** puis **Phase 1**. Committer à chaque sous-étape.
5. S'arrêter après Phase 1 et demander revue avant d'attaquer l'add-in.

*(Fin du plan.)*
