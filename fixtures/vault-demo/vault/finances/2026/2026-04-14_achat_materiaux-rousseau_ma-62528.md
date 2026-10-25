---
type: facture_achat
title: Facture MA-62528 Matériaux Rousseau
sources:
  - invoice:purchase-22
updated: 2026-10-25
number: MA-62528
party: tiers/materiaux-rousseau
issue_date: 2026-04-14
due_date: 2026-05-29
ht: "3944.00"
tva: "788.80"
ttc: "4732.80"
project_ref: CH-2026-02
lines:
  - label: Sable 0/4 big bag
    quantity: 58
    unit_price: "68.00"
    amount: "3944.00"
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

58 big bag de Sable 0/4 big bag.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]]
- Émis par [[tiers/materiaux-rousseau]]
- Utilise [[catalogue/sable-0-4-big-bag]]
