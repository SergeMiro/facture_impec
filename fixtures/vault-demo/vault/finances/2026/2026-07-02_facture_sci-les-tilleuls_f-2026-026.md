---
type: facture_vente
title: Facture F-2026-026
sources:
  - invoice:sale-26
updated: 2026-10-25
number: F-2026-026
party: tiers/sci-les-tilleuls
issue_date: 2026-07-02
due_date: 2026-08-01
ht: "31727.56"
tva: "6345.51"
ttc: "38073.07"
project_ref: CH-2026-01
lines:
  - label: "Travaux : terrassement et fondations"
    amount: "31293.00"
  - label: Chevron sapin 63x75
    quantity: 64
    unit_price: "6.79"
    amount: "434.56"
    code: ART-006
paid_at: 2026-07-26
links:
  - kind: belongs_to
    to: chantiers/2026-residence-les-tilleuls-12-logements
    confidence: exact
    evidence: Référence chantier « CH-2026-01 » (BT-11)
    rule: project_ref
  - kind: issued_to
    to: tiers/sci-les-tilleuls
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/chevron-sapin-63x75
    confidence: strong
    evidence: Code article « ART-006 » de la ligne « Chevron sapin 63x75 »
    rule: line_code
---

Facture de peinture des parties communes pour SCI Les Tilleuls.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-residence-les-tilleuls-12-logements]]
- Adressé à [[tiers/sci-les-tilleuls]]
- Utilise [[catalogue/chevron-sapin-63x75]]
