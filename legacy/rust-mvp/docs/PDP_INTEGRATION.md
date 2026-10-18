# Intégration PDP / Plateforme Agréée

> Partenaire MVP : **B2Brouter** (Plateforme Agréée immatriculée DGFiP).
> Ce document doit être complété par l'agent avec la spec OpenAPI courante.

## Première action (obligatoire)
Récupérer l'index machine de la doc B2Brouter et le déposer ici :
- `https://developer.b2brouter.net/llms.txt` (index Markdown + OpenAPI)
- Ne PAS coder en dur les champs depuis le plan : se référer à la spec courante.

## Environnements
- Production : `https://api.b2brouter.net`
- Staging / sandbox : `https://api-staging.b2brouter.net` (clé de test → sandbox automatiquement)
- Auth : header `X-B2B-API-Key` + `X-B2B-API-Version`

## Endpoints clés (à vérifier dans l'OpenAPI)
- `POST /accounts/{ACCOUNT_ID}/invoices` — créer + émettre (`send_after_import: true`)
- `GET  /accounts/{ACCOUNT_ID}/invoices/{id}` — statut / cycle de vie
- `GET  /accounts/{ACCOUNT_ID}/invoices?type=ReceivedInvoice` — réception
- Directory API — résolution destinataire (pays + identifiant + schéma EAS)
- Webhooks — changements de statut (préférer au polling)

## Abstraction PdpProvider
Toute la communication PDP passe derrière le trait `PdpProvider` (voir `crates/facture-backend/src/pdp/mod.rs`).
Implémentation `b2brouter.rs`. Objectif : pouvoir brancher SEQINO / Tenor plus tard sans réécrire le produit.

## Mapping Invoice → B2Brouter
- `invoice_lines_attributes` : quantity, description, price, unit
- `taxes_attributes` : name ("TVA"), percent, category (S/Z/E/AE), comment (VATEX-FR-* pour exonérations)
- contact (inline ou `contact_id`), payment_method, payment_terms, remittance_information

## Modèle reseller (multi-tenant)
- Chaque entreprise cliente = un `account` dans le groupe d'intégration.
- Une seule clé API partagée jusqu'à des dizaines de comptes ; plan dédié au-delà de 100.

## À CLARIFIER avec B2Brouter (ne pas inventer)
- [ ] Tarification par transaction (plans "editor" sur devis) → impacte le pricing produit.
- [ ] Conditions reseller / eDocSync pour 100+ comptes.
- [ ] Périmètre exact de la validation EN 16931 côté B2Brouter (pour calibrer ce qu'on duplique en local).

---

## Spec récupérée le 2026-06-30 (Phase 0)

Index machine consulté : `https://developer.b2brouter.net/llms.txt` → redirige vers la
référence interactive `https://b2brouter.readme.io/reference/`. **À refaire en début de Phase 3**
pour récupérer l'OpenAPI à jour (les champs ci-dessous sont indicatifs, à confirmer).

### Ressources exposées (familles d'endpoints)
- **Accounts** : create / get / list / update / archive / unarchive, logo. *(modèle reseller : 1 account = 1 entreprise cliente)*
- **Bank accounts** : CRUD.
- **Contacts** (clients/fournisseurs) : CRUD, unités organisationnelles (offices, parent).
- **Invoices** : create, get, list (paginé), update, delete, **send**, import, **bulk import** (max 100 fichiers), **validate** (XSD + Schematron + règles métier), acknowledge, changement d'état, pièces jointes, génération de tax report.
- **Tax reports** (e-reporting) : create simple/batch (jusqu'à 5000), get/list/modify/annulate, téléchargement des accusés DGFiP, import XML, traitement async.
- **Orders** : get / list / changement d'état.
- **Directory / Lookup** : recherche entreprise par pays + schéma (codes EAS), intégration Peppol SML.
- **Transport config** : méthodes de livraison (B2Brouter, email, Peppol, EDI).
- **Document validation** : UBL, CII, Peppol BIS, ZUGFeRD, **Factur-X** (XSD + Schematron).
- **Reference data** : pays, devises, types de document, statuts, langues, schémas, transports.
- **TIN verification** : vérification de n° fiscaux (batch, async, cache 24 h).
- **Webhooks** : CRUD, abonnement aux événements (invoices, tax reports, ledgers) → notifications de changement d'état.
- **Events** : journal d'événements du compte (paginé).

### Divergences à lever avec l'OpenAPI courant (avant de coder le mapping en Phase 3)
> ⚠️ La réf. publique documente des chemins **plats** (`POST /invoices`, `POST /invoices/{id}/send`),
> alors que le plan (§2.1) cite des chemins **scopés au compte** (`POST /accounts/{ACCOUNT_ID}/invoices`
> avec `send_after_import: true`). Ne PAS coder en dur : récupérer l'OpenAPI réel et trancher au début de la Phase 3.
- [ ] Confirmer le préfixe exact (`/invoices` vs `/accounts/{id}/invoices`).
- [ ] Confirmer le nom du header de clé (`X-B2B-API-Key`) et du header de version (`X-B2B-API-Version`).
- [ ] Confirmer les base URLs prod/staging (non explicitées dans la réf. publique).
- [ ] Confirmer create+send en un appel (`send_after_import`) vs deux appels (`create` puis `/send`).
- [ ] Récupérer le fichier OpenAPI (JSON/YAML) et le versionner dans `docs/` ou `crates/facture-backend/`.

> Réponses async : opérations bulk renvoient `202 Accepted` + URL de polling ; dédup par digest SHA-256.

---

## Implémentation Phase 3 (`crates/facture-backend`)

Le backend Axum encapsule la PDP derrière le trait **`PdpProvider`** (`src/pdp/mod.rs`) :

```rust
async fn send(&self, invoice: &Invoice) -> Result<SendResult, PdpError>;
async fn status(&self, id: &str)         -> Result<StatusResult, PdpError>;
```

Deux implémentations :
- **`MockProvider`** (`pdp/mock.rs`) — par défaut si aucune clé n'est configurée : accepte toute facture
  déjà valide et renvoie un id `SIM-<numéro>` (`simulated: true`). Permet de tester le flux de bout en bout.
- **`B2BrouterProvider`** (`pdp/b2brouter.rs`) — actif dès que `B2BROUTER_API_KEY` + `B2BROUTER_ACCOUNT_ID`
  sont présents. En-têtes `X-B2B-API-Key` / `X-B2B-API-Version`.

`/api/send` **revalide d'abord** avec `facture-core` (defense in depth) et refuse en **422** si des
erreurs dures subsistent — la clé PDP n'est jamais exposée au client.

### Mapping Invoice → payload B2Brouter (à confirmer via OpenAPI)
| Invoice (BT-)                | Payload B2Brouter (best-effort)                    |
|-----------------------------|----------------------------------------------------|
| `invoice_number` (BT-1)     | `invoice.number`                                   |
| `issue_date` (BT-2)         | `invoice.date`                                      |
| `due_date` (BT-9)           | `invoice.due_date`                                  |
| `currency` (BT-5)           | `invoice.currency`                                  |
| lignes                      | `invoice.invoice_lines_attributes[]` (`description`, `quantity`, `price`, `unit`, `tax_percent`, `tax_category`) |
| ventilation TVA             | `invoice.taxes_attributes[]` (`name`, `percent`, `category`, `comment`=VATEX) |
| acheteur                    | `invoice.contact` (`name`, `vat_number`, `country`) |
| —                           | `invoice.send_after_import: true`                  |

> ⚠️ Ce mapping et le chemin `POST /accounts/{id}/invoices` sont **provisoires** : recouper avec
> l'OpenAPI courant avant la prod (cf. divergences ci-dessus). Le mapping est isolé dans
> `B2BrouterProvider::map_invoice` (testé unitairement) pour être ajusté sans toucher au reste.

### Passer de la simulation au réel
1. Obtenir une clé sandbox B2Brouter + un `account_id` (à demander à B2Brouter — cf. « À CLARIFIER »).
2. Déployer `facture-backend` (VPS) avec les variables d'env ci-dessus + `ALLOWED_ORIGIN`.
3. Définir `BACKEND_URL` dans le projet Vercel → `/api/send` relaie vers le backend réel.
