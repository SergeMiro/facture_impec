---
type: facture_vente
title: Facture F-2026-035
sources:
  - invoice:sale-35
updated: 2026-10-25
number: F-2026-035
party: tiers/hotel-du-lac-kir
issue_date: 2026-08-25
due_date: 2026-09-24
ht: "5291.42"
tva: "1058.28"
ttc: "6349.70"
chantier: chantiers/2026-hotel-du-lac-kir-facade
lines:
  - label: "Travaux : création des cloisons du premier étage"
    amount: "4083.00"
  - label: Panneau OSB 18 mm
    quantity: 71
    unit_price: "17.02"
    amount: "1208.42"
    code: ART-005
links:
  - kind: belongs_to
    to: chantiers/2026-hotel-du-lac-kir-facade
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_to
    to: tiers/hotel-du-lac-kir
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/panneau-osb-18-mm
    confidence: strong
    evidence: Code article « ART-005 » de la ligne « Panneau OSB 18 mm »
    rule: line_code
---

Facture de réfection de la toiture côté cour pour Hôtel du Lac Kir.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-hotel-du-lac-kir-facade]]
- Adressé à [[tiers/hotel-du-lac-kir]]
- Utilise [[catalogue/panneau-osb-18-mm]]
