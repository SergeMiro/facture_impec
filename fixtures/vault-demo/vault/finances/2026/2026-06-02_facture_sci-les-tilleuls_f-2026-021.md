---
type: facture_vente
title: Facture F-2026-021
sources:
  - invoice:sale-21
updated: 2026-10-25
number: F-2026-021
party: tiers/sci-les-tilleuls
issue_date: 2026-06-02
due_date: 2026-07-02
ht: "40580.64"
tva: "8116.13"
ttc: "48696.77"
chantier: chantiers/2026-residence-les-tilleuls-12-logements
lines:
  - label: "Travaux : terrassement et fondations"
    amount: "39798.00"
  - label: Ciment CEM II 35 kg
    quantity: 72
    unit_price: "10.87"
    amount: "782.64"
    article: catalogue/ciment-cem-ii-35-kg
paid_at: 2026-06-25
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
    to: catalogue/ciment-cem-ii-35-kg
    confidence: exact
    evidence: Ligne « Ciment CEM II 35 kg »
    rule: line_article
---

Facture de réfection de la toiture côté cour pour SCI Les Tilleuls.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-residence-les-tilleuls-12-logements]]
- Adressé à [[tiers/sci-les-tilleuls]]
- Utilise [[catalogue/ciment-cem-ii-35-kg]]
