---
type: facture_achat
title: Facture MA-48212 Matériaux Rousseau
sources:
  - invoice:purchase-43
updated: 2026-10-25
number: MA-48212
party: tiers/materiaux-rousseau
issue_date: 2026-07-07
due_date: 2026-08-21
ht: "53.46"
tva: "10.69"
ttc: "64.15"
chantier: chantiers/2026-renovation-le-parc-batiment-b
lines:
  - label: Parpaing creux 20x20x50
    quantity: 33
    unit_price: "1.62"
    amount: "53.46"
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

33 unité de Parpaing creux 20x20x50.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Émis par [[tiers/materiaux-rousseau]]
- Utilise [[catalogue/parpaing-creux-20x20x50]]
