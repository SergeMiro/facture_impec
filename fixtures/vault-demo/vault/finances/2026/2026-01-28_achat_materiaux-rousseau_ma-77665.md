---
type: facture_achat
title: Facture MA-77665 Matériaux Rousseau
sources:
  - invoice:purchase-3
  - raw/2026/01/facture-ma-77665.eml
updated: 2026-10-25
number: MA-77665
party: tiers/materiaux-rousseau
issue_date: 2026-01-28
due_date: 2026-03-14
ht: "139.32"
tva: "27.86"
ttc: "167.18"
chantier: chantiers/2026-renovation-le-parc-batiment-b
lines:
  - label: Parpaing creux 20x20x50
    quantity: 86
    unit_price: "1.62"
    amount: "139.32"
links:
  - kind: belongs_to
    to: chantiers/2026-renovation-le-parc-batiment-b
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_by
    to: tiers/materiaux-rousseau
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/parpaing-creux-20x20x50
    confidence: strong
    evidence: Ligne « Parpaing creux 20x20x50 »
    rule: line_name
---

86 unité de Parpaing creux 20x20x50.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Émis par [[tiers/materiaux-rousseau]]
- Utilise [[catalogue/parpaing-creux-20x20x50]]
