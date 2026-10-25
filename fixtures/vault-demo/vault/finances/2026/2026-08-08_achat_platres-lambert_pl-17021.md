---
type: facture_achat
title: Facture PL-17021 Plâtres Lambert
sources:
  - invoice:purchase-51
updated: 2026-10-25
number: PL-17021
party: tiers/platres-lambert
issue_date: 2026-08-08
due_date: 2026-09-22
ht: "592.80"
tva: "118.56"
ttc: "711.36"
chantier: chantiers/2026-residence-les-tilleuls-12-logements
lines:
  - label: Plaque de plâtre BA13
    quantity: 114
    unit_price: "5.20"
    amount: "592.80"
links:
  - kind: belongs_to
    to: chantiers/2026-residence-les-tilleuls-12-logements
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_by
    to: tiers/platres-lambert
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/plaque-de-platre-ba13
    confidence: strong
    evidence: Ligne « Plaque de plâtre BA13 »
    rule: line_name
---

114 m² de Plaque de plâtre BA13.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-residence-les-tilleuls-12-logements]]
- Émis par [[tiers/platres-lambert]]
- Utilise [[catalogue/plaque-de-platre-ba13]]
