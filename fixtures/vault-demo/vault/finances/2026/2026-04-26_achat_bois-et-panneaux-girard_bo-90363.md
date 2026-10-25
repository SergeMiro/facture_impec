---
type: facture_achat
title: Facture BO-90363 Bois et Panneaux Girard
sources:
  - invoice:purchase-25
updated: 2026-10-25
number: BO-90363
party: tiers/bois-et-panneaux-girard
issue_date: 2026-04-26
due_date: 2026-06-10
ht: "1050.80"
tva: "210.16"
ttc: "1260.96"
chantier: chantiers/2026-hotel-du-lac-kir-facade
lines:
  - label: Panneau OSB 18 mm
    quantity: 71
    unit_price: "14.80"
    amount: "1050.80"
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

71 m² de Panneau OSB 18 mm.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-hotel-du-lac-kir-facade]]
- Émis par [[tiers/bois-et-panneaux-girard]]
- Utilise [[catalogue/panneau-osb-18-mm]]
