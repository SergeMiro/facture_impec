---
type: facture_achat
title: Facture ÉL-90110 Électro-Distribution Muller
sources:
  - invoice:purchase-55
updated: 2026-10-25
number: ÉL-90110
party: tiers/electro-distribution-muller
issue_date: 2026-08-24
due_date: 2026-10-08
ht: "130.50"
tva: "26.10"
ttc: "156.60"
chantier: chantiers/2026-hotel-du-lac-kir-facade
lines:
  - label: Câble R2V 3G2,5
    quantity: 90
    unit_price: "1.45"
    amount: "130.50"
links:
  - kind: belongs_to
    to: chantiers/2026-hotel-du-lac-kir-facade
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_by
    to: tiers/electro-distribution-muller
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/cable-r2v-3g2-5
    confidence: strong
    evidence: Ligne « Câble R2V 3G2,5 »
    rule: line_name
---

90 ml de Câble R2V 3G2,5.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-hotel-du-lac-kir-facade]]
- Émis par [[tiers/electro-distribution-muller]]
- Utilise [[catalogue/cable-r2v-3g2-5]]
