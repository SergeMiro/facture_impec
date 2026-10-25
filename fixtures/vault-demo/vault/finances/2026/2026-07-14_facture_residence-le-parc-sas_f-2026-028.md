---
type: facture_vente
title: Facture F-2026-028
sources:
  - invoice:sale-28
updated: 2026-10-25
number: F-2026-028
party: tiers/residence-le-parc-sas
issue_date: 2026-07-14
due_date: 2026-08-13
ht: "24874.82"
tva: "4974.96"
ttc: "29849.78"
chantier: chantiers/2026-renovation-le-parc-batiment-b
lines:
  - label: "Travaux : peinture des parties communes"
    amount: "24034.00"
  - label: "Fourniture : Colle carrelage C2"
    quantity: 34
    unit_price: "24.73"
    amount: "840.82"
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
    to: catalogue/colle-carrelage-c2
    confidence: strong
    evidence: "Ligne « Fourniture : Colle carrelage C2 »"
    rule: line_name
---

Facture de réfection de la toiture côté cour pour Résidence Le Parc SAS.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Adressé à [[tiers/residence-le-parc-sas]]
- Utilise [[catalogue/colle-carrelage-c2]]
