---
type: facture_vente
title: Facture F-2026-027
sources:
  - invoice:sale-27
updated: 2026-10-25
number: F-2026-027
party: tiers/sci-clos-des-vignes
issue_date: 2026-07-08
due_date: 2026-08-07
ht: "26016.30"
tva: "5203.26"
ttc: "31219.56"
chantier: chantiers/2026-extension-clos-des-vignes
lines:
  - label: "Travaux : pose des menuiseries du rez-de-chaussée"
    amount: "25695.00"
  - label: "Fourniture : Rail métallique R48"
    quantity: 90
    unit_price: "3.57"
    amount: "321.30"
paid_at: 2026-08-05
links:
  - kind: belongs_to
    to: chantiers/2026-extension-clos-des-vignes
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_to
    to: tiers/sci-clos-des-vignes
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/rail-metallique-r48
    confidence: strong
    evidence: "Ligne « Fourniture : Rail métallique R48 »"
    rule: line_name
---

Facture de terrassement et fondations pour SCI Clos des Vignes.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]]
- Adressé à [[tiers/sci-clos-des-vignes]]
- Utilise [[catalogue/rail-metallique-r48]]
