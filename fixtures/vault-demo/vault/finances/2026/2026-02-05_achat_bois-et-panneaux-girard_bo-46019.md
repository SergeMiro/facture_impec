---
type: facture_achat
title: Facture BO-46019 Bois et Panneaux Girard
sources:
  - invoice:purchase-5
  - raw/2026/02/facture-bo-46019.eml
updated: 2026-10-25
number: BO-46019
party: tiers/bois-et-panneaux-girard
issue_date: 2026-02-05
due_date: 2026-03-22
ht: "784.40"
tva: "156.88"
ttc: "941.28"
chantier: chantiers/2026-hotel-du-lac-kir-facade
lines:
  - label: Panneau OSB 18 mm
    quantity: 53
    unit_price: "14.80"
    amount: "784.40"
    article: catalogue/panneau-osb-18-mm
links:
  - kind: belongs_to
    to: chantiers/2026-hotel-du-lac-kir-facade
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_by
    to: tiers/bois-et-panneaux-girard
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/panneau-osb-18-mm
    confidence: exact
    evidence: Ligne « Panneau OSB 18 mm »
    rule: line_article
---

53 m² de Panneau OSB 18 mm.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-hotel-du-lac-kir-facade]]
- Émis par [[tiers/bois-et-panneaux-girard]]
- Utilise [[catalogue/panneau-osb-18-mm]]
