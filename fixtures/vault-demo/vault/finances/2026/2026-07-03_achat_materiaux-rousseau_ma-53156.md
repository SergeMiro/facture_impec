---
type: facture_achat
title: Facture MA-53156 Matériaux Rousseau
sources:
  - invoice:purchase-42
updated: 2026-10-25
number: MA-53156
party: tiers/materiaux-rousseau
issue_date: 2026-07-03
due_date: 2026-08-17
ht: "3060.00"
tva: "612.00"
ttc: "3672.00"
lines:
  - label: Sable 0/4 big bag
    quantity: 45
    unit_price: "68.00"
    amount: "3060.00"
    code: MAT-1001
links:
  - kind: fulfils
    to: finances/2026/2026-06-23_commande_materiaux-rousseau_bc-2026-012
    confidence: strong
    evidence: Même fournisseur, 3 060,00 € HT facturés pour 3 060,00 € HT commandés, à moins de 30 jours
    rule: order_match
  - kind: issued_by
    to: tiers/materiaux-rousseau
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/sable-0-4-big-bag
    confidence: strong
    evidence: Code article « MAT-1001 » de la ligne « Sable 0/4 big bag »
    rule: line_code
---

45 big bag de Sable 0/4 big bag.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Exécute [[finances/2026/2026-06-23_commande_materiaux-rousseau_bc-2026-012]]
- Émis par [[tiers/materiaux-rousseau]]
- Utilise [[catalogue/sable-0-4-big-bag]]
