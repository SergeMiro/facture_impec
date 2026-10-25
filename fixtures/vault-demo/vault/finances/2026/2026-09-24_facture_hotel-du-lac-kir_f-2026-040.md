---
type: facture_vente
title: Facture F-2026-040
sources:
  - invoice:sale-40
updated: 2026-10-25
number: F-2026-040
party: tiers/hotel-du-lac-kir
issue_date: 2026-09-24
due_date: 2026-10-24
ht: "36177.94"
tva: "7235.59"
ttc: "43413.53"
chantier: chantiers/2026-hotel-du-lac-kir-facade
lines:
  - label: "Travaux : réfection de la toiture côté cour"
    amount: "35378.00"
  - label: Fourniture Panneau OSB 18
    quantity: 47
    unit_price: "17.02"
    amount: "799.94"
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
    confidence: inferred
    evidence: « Fourniture Panneau OSB 18 »
    rule: line_words
---

Facture de raccordement du tableau électrique pour Hôtel du Lac Kir.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-hotel-du-lac-kir-facade]]
- Adressé à [[tiers/hotel-du-lac-kir]]
- Utilise [[catalogue/panneau-osb-18-mm]] (à confirmer : « Fourniture Panneau OSB 18 »)
