---
type: facture_achat
title: Facture IS-76902 Isolants Fournier
sources:
  - invoice:purchase-18
  - raw/2026/03/facture-is-76902.eml
updated: 2026-10-25
number: IS-76902
party: tiers/isolants-fournier
issue_date: 2026-03-29
due_date: 2026-05-13
ht: "103.50"
tva: "20.70"
ttc: "124.20"
project_ref: CH-2026-03
lines:
  - label: Laine de verre 100 mm
    quantity: 15
    unit_price: "6.90"
    amount: "103.50"
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

15 m² de Laine de verre 100 mm.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Émis par [[tiers/isolants-fournier]]
- Utilise [[catalogue/laine-de-verre-100-mm]]
