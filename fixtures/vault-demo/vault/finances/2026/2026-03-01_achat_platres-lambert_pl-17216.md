---
type: facture_achat
title: Facture PL-17216 Plâtres Lambert
sources:
  - invoice:purchase-11
  - raw/2026/03/facture-pl-17216.eml
updated: 2026-10-25
number: PL-17216
party: tiers/platres-lambert
issue_date: 2026-03-01
due_date: 2026-04-15
ht: "156.00"
tva: "31.20"
ttc: "187.20"
chantier: chantiers/2026-residence-les-tilleuls-12-logements
lines:
  - label: Plaque de plâtre BA13
    quantity: 30
    unit_price: "5.20"
    amount: "156.00"
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

30 m² de Plaque de plâtre BA13.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-residence-les-tilleuls-12-logements]]
- Émis par [[tiers/platres-lambert]]
- Utilise [[catalogue/plaque-de-platre-ba13]]
