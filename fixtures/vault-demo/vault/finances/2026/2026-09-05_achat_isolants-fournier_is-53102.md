---
type: facture_achat
title: Facture IS-53102 Isolants Fournier
sources:
  - invoice:purchase-58
updated: 2026-10-25
number: IS-53102
party: tiers/isolants-fournier
issue_date: 2026-09-05
due_date: 2026-10-20
ht: "634.80"
tva: "126.96"
ttc: "761.76"
project_ref: CH-2026-03
lines:
  - label: Laine de verre 100 mm
    quantity: 92
    unit_price: "6.90"
    amount: "634.80"
    code: ISO-1017
links:
  - kind: belongs_to
    to: chantiers/2026-renovation-le-parc-batiment-b
    confidence: exact
    evidence: Référence chantier « CH-2026-03 » (BT-11)
    rule: project_ref
  - kind: issued_by
    to: tiers/isolants-fournier
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/laine-de-verre-100-mm
    confidence: strong
    evidence: Code article « ISO-1017 » de la ligne « Laine de verre 100 mm »
    rule: line_code
---

92 m² de Laine de verre 100 mm.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Émis par [[tiers/isolants-fournier]]
- Utilise [[catalogue/laine-de-verre-100-mm]]
