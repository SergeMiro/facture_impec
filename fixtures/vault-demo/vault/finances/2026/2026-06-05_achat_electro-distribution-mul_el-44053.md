---
type: facture_achat
title: Facture ÉL-44053 Électro-Distribution Muller
sources:
  - invoice:purchase-35
updated: 2026-10-25
number: ÉL-44053
party: tiers/electro-distribution-muller
issue_date: 2026-06-05
due_date: 2026-07-20
ht: "130.50"
tva: "26.10"
ttc: "156.60"
order_ref: BC-2026-005
lines:
  - label: Câble R2V 3G2,5
    quantity: 90
    unit_price: "1.45"
    amount: "130.50"
links:
  - kind: fulfils
    to: finances/2026/2026-05-23_commande_electro-distribution-mul_bc-2026-005
    confidence: exact
    evidence: Numéro de commande « BC-2026-005 » (BT-13)
    rule: order_ref
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

- Exécute [[finances/2026/2026-05-23_commande_electro-distribution-mul_bc-2026-005]]
- Émis par [[tiers/electro-distribution-muller]]
- Utilise [[catalogue/cable-r2v-3g2-5]]
