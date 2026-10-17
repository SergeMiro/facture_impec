# Déploiement & durcissement (Phase 6)

## Architecture de déploiement
- **Add-in / démo** : app Next.js (`addin/`) hébergée sur **Vercel** (statique + routes serverless `/api/*`).
- **Backend** : `crates/facture-backend` (Axum) — service long, **non hébergeable sur Vercel** → VPS (Docker ou binaire).
  Les routes Vercel `/api/send`, `/api/import`, `/api/ai-check` relaient vers le backend si `BACKEND_URL` est défini,
  sinon fonctionnent en **mode simulation / local** (démo).

```
Excel / Navigateur ──> Vercel (Next.js, /api/*) ──(BACKEND_URL + BACKEND_TOKEN)──> Backend Axum (VPS)
                                                                                     ├─ PdpProvider → B2Brouter (PA)
                                                                                     └─ AiChecker  → Mistral (EU)
```

## Backend — variables d'environnement
| Variable | Rôle | Défaut |
|----------|------|--------|
| `BIND_ADDR` | adresse d'écoute | `0.0.0.0:8080` |
| `ALLOWED_ORIGIN` | origine CORS autorisée | `*` (à restreindre en prod : URL Vercel) |
| `APP_TOKEN` | jeton Bearer exigé sur les routes mutantes | *(vide = ouvert, dev)* |
| `B2BROUTER_API_KEY` / `B2BROUTER_ACCOUNT_ID` | active l'envoi réel via B2Brouter | *(vide = simulation)* |
| `B2BROUTER_BASE_URL` | endpoint PA | `https://api-staging.b2brouter.net` |
| `B2BROUTER_API_VERSION` | version d'API | `2.0` |
| `MISTRAL_API_KEY` / `MISTRAL_MODEL` | active la couche IA LLM (EU) | *(vide = désactivée)* |
| `AI_ENABLED` | `false` pour couper l'IA même avec clé | `true` |

> Les secrets ne sont **jamais** commités ni exposés au client. `.env` est gitignoré ; utilisez le
> gestionnaire de secrets de l'hébergeur.

## Lancer le backend

### Docker
```bash
docker build -t facture-backend .
docker run -p 8080:8080 \
  -e APP_TOKEN=... -e ALLOWED_ORIGIN=https://facture-impec.vercel.app \
  -e B2BROUTER_API_KEY=... -e B2BROUTER_ACCOUNT_ID=... \
  facture-backend
```

### Binaire (systemd)
`cargo build --release -p facture-backend` → `target/release/facture-backend` ; placez-le derrière un
reverse proxy TLS (Caddy/Nginx) et un service systemd portant les variables d'environnement.

## Câbler Vercel au backend
Dans le projet Vercel (`facture-impec`), définir :
- `BACKEND_URL` = URL HTTPS publique du backend ;
- `BACKEND_TOKEN` = même valeur que `APP_TOKEN` (les routes Vercel l'envoient en `Authorization: Bearer`).

Sans ces variables, la démo reste en simulation (aucun envoi réel).

## Sécurité
- **Auth** : `APP_TOKEN` → toute route mutante (`/api/send`, `/api/import`, `/api/ai-check`, `/api/status/*`)
  exige `Authorization: Bearer <APP_TOKEN>`. `/health` et `/api/validate` restent ouverts (purs).
- **CORS** : fixer `ALLOWED_ORIGIN` à l'URL Vercel en prod.
- **Idempotence** : `/api/send` déduplique via `Idempotency-Key` (ou le numéro de facture) → pas de double
  émission. Store en mémoire au MVP ; en prod, brancher un store persistant (Postgres/Redis).
- **Retries** : les appels sortants (B2Brouter) réessaient les erreurs réseau transitoires (backoff).

## RGPD
- **Minimisation** : la couche IA n'envoie qu'un extrait (pas d'adresse ni d'IBAN) ; les heuristiques
  douces tournent **localement** dans le navigateur (WASM) — aucune donnée ne sort.
- **Hébergement EU** : LLM Mistral (UE) ; héberger le backend et la PA dans l'UE.
- **Logs** : ne jamais journaliser le corps des factures ; niveau de log via `RUST_LOG` (défaut `info`).
- **Consentement** : signaler à l'utilisateur l'envoi à un LLM ; mode `AI_ENABLED=false` disponible.

## Multi-tenant (reseller B2Brouter)
Chaque entreprise cliente = un `account` B2Brouter. La route `/api/send` accepte l'en-tête
`X-Account-Id` pour cibler le bon compte ; à défaut, le compte configuré est utilisé. Le mapping
`client → account_id` sera stocké en base (Phase ultérieure).

## Word — hors périmètre
Un `.docx` **n'est pas** un format structuré au sens EN 16931 : Word n'émet pas de facture électronique.
Au mieux, un import Word passerait par le pipeline d'extraction (`/api/import`) comme un texte. Émission
depuis Word = **hors périmètre**.

## Tarification (à clarifier)
Le prix par transaction (plans B2Brouter « editor » sur devis) et les conditions reseller pour 100+ comptes
restent à confirmer avec B2Brouter (cf. `PDP_INTEGRATION.md` §« À CLARIFIER ») avant de figer le pricing produit.

## Checklist Microsoft AppSource (émission de l'add-in)
- [ ] Compte **Partner Center** (Microsoft) validé.
- [ ] `manifest.xml` pointant sur les URLs de prod (HTTPS) — validé (`npx office-addin-manifest validate addin/public/manifest.xml`).
- [ ] Icônes 16/32/64/80 px, pages Support/Confidentialité (RGPD) accessibles.
- [ ] Tests de certification Office (task pane, permissions `ReadWriteDocument`).
- [ ] Soumission + revue Microsoft, ou déploiement centralisé via l'admin M365 (Integrated Apps).
