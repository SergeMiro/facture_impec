---
type: facture_vente
title: Facture F-2026-030
sources:
  - invoice:sale-30
updated: 2026-10-25
number: F-2026-030
party: tiers/hotel-du-lac-kir
issue_date: 2026-07-26
due_date: 2026-08-25
ht: "10743.50"
tva: "2148.70"
ttc: "12892.20"
project_ref: CH-2026-05
lines:
  - label: "Travaux : réfection de la toiture côté cour"
    amount: "10660.00"
  - label: Fourniture Câble R2V
    quantity: 50
    unit_price: "1.67"
    amount: "83.50"
paid_at: 2026-08-23
links:
  - kind: belongs_to
    to: chantiers/2026-hotel-du-lac-kir-facade
    confidence: exact
    evidence: Référence chantier « CH-2026-05 » (BT-11)
    rule: project_ref
  - kind: issued_to
    to: tiers/hotel-du-lac-kir
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/cable-r2v-3g2-5
    confidence: inferred
    evidence: « Fourniture Câble R2V »
    rule: line_words
---

Facture de réfection de la toiture côté cour pour Hôtel du Lac Kir.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-hotel-du-lac-kir-facade]]
- Adressé à [[tiers/hotel-du-lac-kir]]
- Utilise [[catalogue/cable-r2v-3g2-5]] (à confirmer : « Fourniture Câble R2V »)
