---
type: facture_achat
title: Facture ST-7270 Carrelage Chevalier
sources:
  - invoice:purchase-60
updated: 2026-10-25
number: ST-7270
party: tiers/carrelage-chevalier
issue_date: 2026-07-31
due_date: 2026-09-14
ht: "14339.00"
tva: "2867.80"
ttc: "17206.80"
chantier: chantiers/2026-hotel-du-lac-kir-facade
lines:
  - label: Travaux de raccordement du tableau électrique
    amount: "14339.00"
links:
  - kind: belongs_to
    to: chantiers/2026-hotel-du-lac-kir-facade
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_by
    to: tiers/carrelage-chevalier
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/tableau-electrique-3-rangees
    confidence: inferred
    evidence: « Travaux de raccordement du tableau électrique »
    rule: line_words
---

Travaux de sous-traitance de Carrelage Chevalier pour Hôtel du Lac Kir façade.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-hotel-du-lac-kir-facade]]
- Émis par [[tiers/carrelage-chevalier]]
- Utilise [[catalogue/tableau-electrique-3-rangees]] (à confirmer : « Travaux de raccordement du tableau électrique »)
