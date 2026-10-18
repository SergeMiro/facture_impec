# Facture Impec

L'agent de facturation électronique pour les TPE/PME qui facturent dans Excel.
Vous continuez à facturer dans votre tableur ; Facture Impec vérifie chaque facture, la convertit
au format Factur-X, l'envoie par une plateforme agréée, la suit jusqu'au paiement et vous explique
chaque problème en français simple.

> Réception obligatoire pour toutes les entreprises assujetties depuis le 1er septembre 2026 ;
> émission obligatoire pour les TPE/PME au 1er septembre 2027.

**État : M2 — le moteur et l'API sont prêts** (règles EN 16931 et françaises, Factur-X, UBL ; API,
envoi et suivi des statuts contre une plateforme simulée). Le complément Excel n'est pas encore
utilisable. L'ancien prototype (Rust + Next.js) reste consultable dans le tag `archive/rust-mvp-v1`
et sur https://facture-impec.vercel.app jusqu'à son remplacement.

## Pour les développeurs

```bash
corepack enable && pnpm install
pnpm dev       # API :4000, PDP simulée :4010, complément :3000, site :4321
pnpm verify    # lint + types + tests
```

Branches : on développe sur `dev`, on fusionne `dev` → `preprod`, puis `preprod` → `prod` quand tout
est vert (voir `CLAUDE.md`).

- `docs/RUNBOOK.md` — installation et commandes
- `docs/ARCHITECTURE.md` — architecture et décisions
- `docs/PROGRESS.md` — avancement par jalon
- `CLAUDE.md` — règles de travail pour les agents de code

Licence : voir `LICENSE`.
