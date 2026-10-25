---
type: devis
title: Devis D-2026-005
sources:
  - document:devis-5
updated: 2026-10-25
number: D-2026-005
party: tiers/hotel-du-lac-kir
chantier: chantiers/2026-hotel-du-lac-kir-facade
date: 2026-05-16
status: accepte
ht: "45337.00"
ttc: "54404.40"
lines:
  - label: Main-d'œuvre
    quantity: 302
    unit_price: "45.00"
    amount: "13590.00"
  - label: Fournitures et petit matériel
    amount: "11334.25"
  - label: Travaux selon descriptif
    amount: "20412.75"
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
backlinks:
  - kind: fulfils
    from: finances/2026/2026-06-13_facture_hotel-du-lac-kir_f-2026-005
---

Devis pour la pose des menuiseries du rez-de-chaussée.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-hotel-du-lac-kir-facade]]
- Adressé à [[tiers/hotel-du-lac-kir]]
- Exécuté par [[finances/2026/2026-06-13_facture_hotel-du-lac-kir_f-2026-005]]
