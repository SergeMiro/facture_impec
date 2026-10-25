---
type: facture_vente
title: Facture F-2026-010
sources:
  - invoice:sale-10
updated: 2026-10-25
number: F-2026-010
party: tiers/hotel-du-lac-kir
issue_date: 2026-07-15
due_date: 2026-08-14
ht: "29377.08"
tva: "5875.42"
ttc: "35252.50"
project_ref: CH-2026-05
order_ref: D-2026-010
paid_at: 2026-08-10
links:
  - kind: belongs_to
    to: chantiers/2026-hotel-du-lac-kir-facade
    confidence: exact
    evidence: Référence chantier « CH-2026-05 » (BT-11)
    rule: project_ref
  - kind: fulfils
    to: finances/2026/2026-05-21_devis_hotel-du-lac-kir_d-2026-010
    confidence: exact
    evidence: Numéro de devis « D-2026-010 » (BT-13)
    rule: quote_ref
  - kind: issued_to
    to: tiers/hotel-du-lac-kir
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Facture de terrassement et fondations pour Hôtel du Lac Kir.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-hotel-du-lac-kir-facade]]
- Exécute [[finances/2026/2026-05-21_devis_hotel-du-lac-kir_d-2026-010]]
- Adressé à [[tiers/hotel-du-lac-kir]]
