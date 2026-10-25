---
type: facture_achat
title: Facture ÉL-15101 Électro-Distribution Muller
sources:
  - invoice:purchase-16
  - raw/2026/03/facture-el-15101.eml
updated: 2026-10-25
number: ÉL-15101
party: tiers/electro-distribution-muller
issue_date: 2026-03-21
due_date: 2026-05-05
ht: "4536.00"
tva: "907.20"
ttc: "5443.20"
project_ref: CH-2026-01
lines:
  - label: Tableau électrique 3 rangées
    quantity: 24
    unit_price: "189.00"
    amount: "4536.00"
links:
  - kind: belongs_to
    to: chantiers/2026-residence-les-tilleuls-12-logements
    confidence: exact
    evidence: Référence chantier « CH-2026-01 » (BT-11)
    rule: project_ref
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

24 unité de Tableau électrique 3 rangées.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-residence-les-tilleuls-12-logements]]
- Émis par [[tiers/electro-distribution-muller]]
- Utilise [[catalogue/tableau-electrique-3-rangees]]
