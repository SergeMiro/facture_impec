---
type: facture_achat
title: Facture TU-94171 Tuiles Simon
sources:
  - invoice:purchase-40
updated: 2026-10-25
number: TU-94171
party: tiers/tuiles-simon
issue_date: 2026-06-25
due_date: 2026-08-09
ht: "3519.00"
tva: "703.80"
ttc: "4222.80"
lines:
  - label: Tuile terre cuite romane
    quantity: 102
    unit_price: "34.50"
    amount: "3519.00"
links:
  - kind: belongs_to
    to: chantiers/2026-hotel-du-lac-kir-facade
    confidence: inferred
    evidence: « Livraison sur le chantier Hôtel du Lac Kir façade. »
    rule: text_chantier
  - kind: fulfils
    to: finances/2026/2026-06-17_commande_tuiles-simon_bc-2026-010
    confidence: strong
    evidence: Même fournisseur, 3 519,00 € HT facturés pour 3 519,00 € HT commandés, à moins de 30 jours
    rule: order_match
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

102 m² de Tuile terre cuite romane. Livraison sur le chantier Hôtel du Lac Kir façade.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-hotel-du-lac-kir-facade]] (à confirmer : « Livraison sur le chantier Hôtel du Lac Kir façade. »)
- Exécute [[finances/2026/2026-06-17_commande_tuiles-simon_bc-2026-010]]
- Émis par [[tiers/tuiles-simon]]
- Utilise [[catalogue/tuile-terre-cuite-romane]]
