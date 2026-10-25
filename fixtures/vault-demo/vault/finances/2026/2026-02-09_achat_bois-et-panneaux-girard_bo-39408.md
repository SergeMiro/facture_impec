---
type: facture_achat
title: Facture BO-39408 Bois et Panneaux Girard
sources:
  - invoice:purchase-6
  - raw/2026/02/facture-bo-39408.eml
updated: 2026-10-25
number: BO-39408
party: tiers/bois-et-panneaux-girard
issue_date: 2026-02-09
due_date: 2026-03-26
ht: "377.60"
tva: "75.52"
ttc: "453.12"
project_ref: CH-2026-01
lines:
  - label: Chevron sapin 63x75
    quantity: 64
    unit_price: "5.90"
    amount: "377.60"
    code: BOI-1005
links:
  - kind: belongs_to
    to: chantiers/2026-residence-les-tilleuls-12-logements
    confidence: exact
    evidence: Référence chantier « CH-2026-01 » (BT-11)
    rule: project_ref
  - kind: issued_by
    to: tiers/bois-et-panneaux-girard
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/chevron-sapin-63x75
    confidence: strong
    evidence: Code article « BOI-1005 » de la ligne « Chevron sapin 63x75 »
    rule: line_code
---

64 ml de Chevron sapin 63x75.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-residence-les-tilleuls-12-logements]]
- Émis par [[tiers/bois-et-panneaux-girard]]
- Utilise [[catalogue/chevron-sapin-63x75]]
