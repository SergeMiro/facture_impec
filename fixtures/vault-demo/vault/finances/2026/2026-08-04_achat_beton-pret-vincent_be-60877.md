---
type: facture_achat
title: Facture BÉ-60877 Béton Prêt Vincent
sources:
  - invoice:purchase-50
updated: 2026-10-25
number: BÉ-60877
party: tiers/beton-pret-vincent
issue_date: 2026-08-04
due_date: 2026-09-18
ht: "4031.00"
tva: "806.20"
ttc: "4837.20"
lines:
  - label: Béton C25/30
    quantity: 29
    unit_price: "139.00"
    amount: "4031.00"
    code: BET-1009
links:
  - kind: belongs_to
    to: chantiers/2026-hotel-du-lac-kir-facade
    confidence: inferred
    evidence: « Livraison sur le chantier Hôtel du Lac Kir façade. »
    rule: text_chantier
  - kind: issued_by
    to: tiers/beton-pret-vincent
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/beton-c25-30
    confidence: strong
    evidence: Code article « BET-1009 » de la ligne « Béton C25/30 »
    rule: line_code
---

29 m³ de Béton C25/30. Livraison sur le chantier Hôtel du Lac Kir façade.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-hotel-du-lac-kir-facade]] (à confirmer : « Livraison sur le chantier Hôtel du Lac Kir façade. »)
- Émis par [[tiers/beton-pret-vincent]]
- Utilise [[catalogue/beton-c25-30]]
