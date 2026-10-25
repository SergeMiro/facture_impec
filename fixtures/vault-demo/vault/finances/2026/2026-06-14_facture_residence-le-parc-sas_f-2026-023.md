---
type: facture_vente
title: Facture F-2026-023
sources:
  - invoice:sale-23
updated: 2026-10-25
number: F-2026-023
party: tiers/residence-le-parc-sas
issue_date: 2026-06-14
due_date: 2026-07-14
ht: "3348.96"
tva: "669.79"
ttc: "4018.75"
chantier: chantiers/2026-renovation-le-parc-batiment-b
lines:
  - label: "Travaux : raccordement du tableau électrique"
    amount: "3189.00"
  - label: Parpaing creux 20x20x50
    quantity: 86
    unit_price: "1.86"
    amount: "159.96"
    article: catalogue/parpaing-creux-20x20x50
paid_at: 2026-07-11
links:
  - kind: belongs_to
    to: chantiers/2026-renovation-le-parc-batiment-b
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_to
    to: tiers/residence-le-parc-sas
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/parpaing-creux-20x20x50
    confidence: exact
    evidence: Ligne « Parpaing creux 20x20x50 »
    rule: line_article
  - kind: uses
    to: catalogue/tableau-electrique-3-rangees
    confidence: inferred
    evidence: "« Travaux : raccordement du tableau électrique »"
    rule: line_words
---

Facture de réfection de la toiture côté cour pour Résidence Le Parc SAS.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Adressé à [[tiers/residence-le-parc-sas]]
- Utilise [[catalogue/parpaing-creux-20x20x50]]
- Utilise [[catalogue/tableau-electrique-3-rangees]] (à confirmer : « Travaux : raccordement du tableau électrique »)
