---
type: facture_vente
title: Facture F-2026-005
sources:
  - invoice:sale-5
updated: 2026-10-25
number: F-2026-005
party: tiers/hotel-du-lac-kir
issue_date: 2026-06-13
due_date: 2026-07-13
ht: "45337.00"
tva: "9067.40"
ttc: "54404.40"
chantier: chantiers/2026-hotel-du-lac-kir-facade
sales_order_ref: D-2026-005
paid_at: 2026-07-23
links:
  - kind: belongs_to
    to: chantiers/2026-hotel-du-lac-kir-facade
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-05-16_devis_hotel-du-lac-kir_d-2026-005
    confidence: exact
    evidence: Numéro de devis « D-2026-005 » (BT-14)
    rule: quote_ref
  - kind: issued_to
    to: tiers/hotel-du-lac-kir
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Facture de isolation des combles perdus pour Hôtel du Lac Kir.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-hotel-du-lac-kir-facade]]
- Exécute [[finances/2026/2026-05-16_devis_hotel-du-lac-kir_d-2026-005]]
- Adressé à [[tiers/hotel-du-lac-kir]]
