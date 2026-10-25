---
type: devis
title: Devis D-2026-018
sources:
  - document:devis-18
updated: 2026-10-25
number: D-2026-018
party: tiers/residence-le-parc-sas
chantier: chantiers/2026-renovation-le-parc-batiment-b
date: 2026-03-20
status: accepte
ht: "12580.00"
ttc: "15096.00"
lines:
  - label: Main-d'œuvre
    quantity: 83
    unit_price: "45.00"
    amount: "3735.00"
  - label: Fournitures et petit matériel
    amount: "3145.00"
  - label: Travaux selon descriptif
    amount: "5700.00"
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
backlinks:
  - kind: fulfils
    from: finances/2026/2026-03-31_facture_residence-le-parc-sas_f-2026-018
---

Devis pour la terrassement et fondations.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Adressé à [[tiers/residence-le-parc-sas]]
- Exécuté par [[finances/2026/2026-03-31_facture_residence-le-parc-sas_f-2026-018]]
