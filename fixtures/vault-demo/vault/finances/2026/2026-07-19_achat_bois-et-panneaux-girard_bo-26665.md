---
type: facture_achat
title: Facture BO-26665 Bois et Panneaux Girard
sources:
  - invoice:purchase-46
updated: 2026-10-25
number: BO-26665
party: tiers/bois-et-panneaux-girard
issue_date: 2026-07-19
due_date: 2026-09-02
ht: "454.30"
tva: "90.86"
ttc: "545.16"
project_ref: CH-2026-01
lines:
  - label: Chevron sapin 63x75
    quantity: 77
    unit_price: "5.90"
    amount: "454.30"
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

77 ml de Chevron sapin 63x75.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-residence-les-tilleuls-12-logements]]
- Émis par [[tiers/bois-et-panneaux-girard]]
- Utilise [[catalogue/chevron-sapin-63x75]]
