---
type: facture_achat
title: Facture ÉL-15865 Électro-Distribution Muller
sources:
  - invoice:purchase-15
  - raw/2026/03/facture-el-15865.eml
updated: 2026-10-25
number: ÉL-15865
party: tiers/electro-distribution-muller
issue_date: 2026-03-17
due_date: 2026-05-01
ht: "72.50"
tva: "14.50"
ttc: "87.00"
chantier: chantiers/2026-hotel-du-lac-kir-facade
lines:
  - label: Câble R2V 3G2,5
    quantity: 50
    unit_price: "1.45"
    amount: "72.50"
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

50 ml de Câble R2V 3G2,5.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-hotel-du-lac-kir-facade]]
- Émis par [[tiers/electro-distribution-muller]]
- Utilise [[catalogue/cable-r2v-3g2-5]]
