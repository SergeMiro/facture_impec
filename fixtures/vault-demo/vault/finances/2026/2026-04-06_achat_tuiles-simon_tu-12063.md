---
type: facture_achat
title: Facture TU-12063 Tuiles Simon
sources:
  - invoice:purchase-20
  - raw/2026/04/facture-tu-12063.eml
updated: 2026-10-25
number: TU-12063
party: tiers/tuiles-simon
issue_date: 2026-04-06
due_date: 2026-05-21
ht: "2001.00"
tva: "400.20"
ttc: "2401.20"
lines:
  - label: Tuile terre cuite romane
    quantity: 58
    unit_price: "34.50"
    amount: "2001.00"
links:
  - kind: belongs_to
    to: chantiers/2026-hotel-du-lac-kir-facade
    confidence: inferred
    evidence: « Livraison sur le chantier Hôtel du Lac Kir façade. »
    rule: text_chantier
  - kind: issued_by
    to: tiers/tuiles-simon
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/tuile-terre-cuite-romane
    confidence: strong
    evidence: Ligne « Tuile terre cuite romane »
    rule: line_name
---

58 m² de Tuile terre cuite romane. Livraison sur le chantier Hôtel du Lac Kir façade.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-hotel-du-lac-kir-facade]] (à confirmer : « Livraison sur le chantier Hôtel du Lac Kir façade. »)
- Émis par [[tiers/tuiles-simon]]
- Utilise [[catalogue/tuile-terre-cuite-romane]]
