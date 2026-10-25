---
type: facture_achat
title: Facture MA-52856 Matériaux Rousseau
sources:
  - invoice:purchase-2
  - raw/2026/01/facture-ma-52856.eml
updated: 2026-10-25
number: MA-52856
party: tiers/materiaux-rousseau
issue_date: 2026-01-24
due_date: 2026-03-10
ht: "7004.00"
tva: "1400.80"
ttc: "8404.80"
project_ref: CH-2026-02
lines:
  - label: Sable 0/4 big bag
    quantity: 103
    unit_price: "68.00"
    amount: "7004.00"
    code: MAT-1001
links:
  - kind: belongs_to
    to: chantiers/2026-extension-clos-des-vignes
    confidence: exact
    evidence: Référence chantier « CH-2026-02 » (BT-11)
    rule: project_ref
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

103 big bag de Sable 0/4 big bag.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]]
- Émis par [[tiers/materiaux-rousseau]]
- Utilise [[catalogue/sable-0-4-big-bag]]
