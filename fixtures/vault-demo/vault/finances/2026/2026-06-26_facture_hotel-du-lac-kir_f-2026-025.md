---
type: facture_vente
title: Facture F-2026-025
sources:
  - invoice:sale-25
updated: 2026-10-25
number: F-2026-025
party: tiers/hotel-du-lac-kir
issue_date: 2026-06-26
due_date: 2026-07-26
ht: "34997.06"
tva: "6999.41"
ttc: "41996.47"
chantier: chantiers/2026-hotel-du-lac-kir-facade
lines:
  - label: "Travaux : terrassement et fondations"
    amount: "34095.00"
  - label: Panneau OSB 18 mm
    quantity: 53
    unit_price: "17.02"
    amount: "902.06"
    code: ART-005
paid_at: 2026-07-31
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
  - kind: uses
    to: catalogue/panneau-osb-18-mm
    confidence: strong
    evidence: Code article « ART-005 » de la ligne « Panneau OSB 18 mm »
    rule: line_code
---

Facture de reprise des fissures en façade nord pour Hôtel du Lac Kir.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-hotel-du-lac-kir-facade]]
- Adressé à [[tiers/hotel-du-lac-kir]]
- Utilise [[catalogue/panneau-osb-18-mm]]
