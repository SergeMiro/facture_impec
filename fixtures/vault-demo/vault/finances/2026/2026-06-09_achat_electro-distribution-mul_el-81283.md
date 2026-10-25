---
type: facture_achat
title: Facture ÉL-81283 Électro-Distribution Muller
sources:
  - invoice:purchase-36
updated: 2026-10-25
number: ÉL-81283
party: tiers/electro-distribution-muller
issue_date: 2026-06-09
due_date: 2026-07-24
ht: "8127.00"
tva: "1625.40"
ttc: "9752.40"
project_ref: CH-2026-01
lines:
  - label: Tableau électrique 3 rangées
    quantity: 43
    unit_price: "189.00"
    amount: "8127.00"
links:
  - kind: belongs_to
    to: chantiers/2026-residence-les-tilleuls-12-logements
    confidence: exact
    evidence: Référence chantier « CH-2026-01 » (BT-11)
    rule: project_ref
  - kind: fulfils
    to: finances/2026/2026-05-21_commande_electro-distribution-mul_bc-2026-006
    confidence: strong
    evidence: Même fournisseur, 8 127,00 € HT facturés pour 8 127,00 € HT commandés, à moins de 30 jours
    rule: order_match
  - kind: issued_by
    to: tiers/electro-distribution-muller
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/tableau-electrique-3-rangees
    confidence: strong
    evidence: Ligne « Tableau électrique 3 rangées »
    rule: line_name
---

43 unité de Tableau électrique 3 rangées.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-residence-les-tilleuls-12-logements]]
- Exécute [[finances/2026/2026-05-21_commande_electro-distribution-mul_bc-2026-006]]
- Émis par [[tiers/electro-distribution-muller]]
- Utilise [[catalogue/tableau-electrique-3-rangees]]
