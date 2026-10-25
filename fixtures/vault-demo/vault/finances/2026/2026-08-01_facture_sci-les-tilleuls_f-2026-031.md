---
type: facture_vente
title: Facture F-2026-031
sources:
  - invoice:sale-31
updated: 2026-10-25
number: F-2026-031
party: tiers/sci-les-tilleuls
issue_date: 2026-08-01
due_date: 2026-08-31
ht: "4651.40"
tva: "930.28"
ttc: "5581.68"
chantier: chantiers/2026-residence-les-tilleuls-12-logements
lines:
  - label: "Travaux : pose des menuiseries du rez-de-chaussée"
    amount: "4472.00"
  - label: Plaque de plâtre BA13
    quantity: 30
    unit_price: "5.98"
    amount: "179.40"
    article: catalogue/plaque-de-platre-ba13
paid_at: 2026-09-10
links:
  - kind: belongs_to
    to: chantiers/2026-residence-les-tilleuls-12-logements
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_to
    to: tiers/sci-les-tilleuls
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/plaque-de-platre-ba13
    confidence: exact
    evidence: Ligne « Plaque de plâtre BA13 »
    rule: line_article
---

Facture de pose des menuiseries du rez-de-chaussée pour SCI Les Tilleuls.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-residence-les-tilleuls-12-logements]]
- Adressé à [[tiers/sci-les-tilleuls]]
- Utilise [[catalogue/plaque-de-platre-ba13]]
