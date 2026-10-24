# Facture Impec

L'agent de facturation électronique pour les TPE/PME qui facturent dans Excel ou Google Sheets.
Vous continuez à facturer dans votre tableur ; Facture Impec vérifie chaque facture, la convertit
au format Factur-X, l'envoie par une plateforme agréée, la suit jusqu'au paiement et vous explique
chaque problème en français simple.

> Réception obligatoire pour toutes les entreprises assujetties depuis le 1er septembre 2026 ;
> émission obligatoire pour les TPE/PME au 1er septembre 2027.

**État : M7 — prêt pour un pilote** : on crée son compte depuis Excel avec son SIREN (raison sociale,
siège et numéro de TVA repris de l'annuaire public des entreprises), on vérifie et envoie ses factures,
on les suit jusqu'au paiement, on reçoit celles des fournisseurs et on les exporte pour le comptable.
L'essai dure 30 jours ; ensuite une formule s'achète par Stripe, depuis Réglages. Un cabinet comptable
peut proposer le complément sous son nom. Tout est prouvé par des tests contre des répliques locales
(B2Brouter, Stripe, annuaire) ; l'image Docker de l'API et le dossier de soumission au Microsoft
Marketplace sont prêts. Rien n'est encore hébergé ni publié, sauf le site de présentation
(https://facture-impec-site.vercel.app) : le pilote attend l'hébergement, les clés B2Brouter et Stripe,
un service d'e-mail et les conditions générales du propriétaire (voir `docs/RUNBOOK.md` § Pilot).
L'ancien prototype (Rust + Next.js) reste consultable dans le tag `archive/rust-mvp-v1` et sur
https://facture-impec.vercel.app jusqu'à son remplacement.

## Pour les développeurs

```bash
corepack enable && pnpm install
pnpm dev       # API :4000, PDP simulée :4010, complément https://localhost:3000, site :4321
pnpm verify    # lint + types + tests
pnpm test:e2e  # le parcours du complément dans Chrome
```

Le volet Google Sheets utilise les mêmes écrans et le même serveur que le complément Excel.
Pour préparer son installation dans une feuille :

```bash
pnpm sheets:package --addin https://VOTRE-COMPLEMENT/google-sheets.html
```

Le paquet Apps Script donne accès uniquement à la feuille ouverte. Le parcours est testé contre les
services Google simulés : connexion, envoi en Mode test, retour des statuts, réception et export,
contrôles entre feuilles, correction et annulation. L'installation dans un compte Google réel reste à
vérifier. Les étapes et les limites sont dans `docs/GOOGLE_SHEETS.md`.

Branches : on développe sur `dev`, on fusionne `dev` → `preprod`, puis `preprod` → `prod` quand tout
est vert (voir `CLAUDE.md`).

- `docs/RUNBOOK.md` — installation, commandes, pilote
- `docs/DEPLOY.md` — image Docker de l'API et hébergement
- `docs/APPSOURCE.md` — soumission au Microsoft Marketplace
- `docs/GOOGLE_SHEETS.md` — volet Google Sheets, paquet Apps Script et installation
- `docs/ARCHITECTURE.md` — architecture et décisions
- `docs/PROGRESS.md` — avancement par jalon
- `CLAUDE.md` — règles de travail pour les agents de code

Licence : voir `LICENSE`.
