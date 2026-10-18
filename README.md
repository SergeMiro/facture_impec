# Facture Impec

L'agent de facturation électronique pour les TPE/PME qui facturent dans Excel.
Vous continuez à facturer dans votre tableur ; Facture Impec vérifie chaque facture, la convertit
au format Factur-X, l'envoie par une plateforme agréée, la suit jusqu'au paiement et vous explique
chaque problème en français simple.

> Réception obligatoire pour toutes les entreprises assujetties depuis le 1er septembre 2026 ;
> émission obligatoire pour les TPE/PME au 1er septembre 2027.

**État : M5 — relances et encaissements** : le complément Excel (connexion, détection des colonnes,
tableau de bord dans la feuille, fiche facture avec « Corriger dans la feuille », répétition, mode test)
envoie par l'adaptateur B2Brouter, et le statut revient seul dans la feuille. Une fois la facture chez
le client, un plan de relances suit l'échéance (brouillons à envoyer soi-même, ou pilote automatique
avec plafond ; la mise en demeure reste toujours un brouillon), « Encaissée » clôt la facture et
prévient la plateforme, et un point hebdomadaire résume la semaine. C'est prouvé contre une réplique
locale de l'API B2Brouter ; l'essai sur le bac à sable B2Brouter attend la clé du propriétaire. Rien
n'est encore hébergé ni publié, sauf le site de présentation (https://facture-impec-site.vercel.app) :
on charge le complément depuis sa machine (voir `docs/RUNBOOK.md`). L'ancien
prototype (Rust + Next.js) reste consultable dans le tag `archive/rust-mvp-v1` et sur
https://facture-impec.vercel.app jusqu'à son remplacement.

## Pour les développeurs

```bash
corepack enable && pnpm install
pnpm dev       # API :4000, PDP simulée :4010, complément https://localhost:3000, site :4321
pnpm verify    # lint + types + tests
pnpm test:e2e  # le parcours du complément dans Chrome
```

Branches : on développe sur `dev`, on fusionne `dev` → `preprod`, puis `preprod` → `prod` quand tout
est vert (voir `CLAUDE.md`).

- `docs/RUNBOOK.md` — installation et commandes
- `docs/ARCHITECTURE.md` — architecture et décisions
- `docs/PROGRESS.md` — avancement par jalon
- `CLAUDE.md` — règles de travail pour les agents de code

Licence : voir `LICENSE`.
