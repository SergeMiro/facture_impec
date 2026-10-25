---
type: facture_vente
title: Facture F-2026-015
sources:
  - invoice:sale-15
updated: 2026-10-25
number: F-2026-015
party: tiers/hotel-du-lac-kir
issue_date: 2026-06-22
due_date: 2026-07-22
ht: "39027.00"
tva: "7805.40"
ttc: "46832.40"
chantier: chantiers/2026-hotel-du-lac-kir-facade
paid_at: 2026-07-15
links:
  - kind: belongs_to
    to: chantiers/2026-hotel-du-lac-kir-facade
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-05-26_devis_hotel-du-lac-kir_d-2026-015
    confidence: strong
    evidence: "Même client, 39 027,00 € HT facturés : au centime près, un seul des 2 devis acceptés à 2 % près et à moins de 30 jours"
    rule: quote_match
  - kind: issued_to
    to: tiers/hotel-du-lac-kir
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Facture de peinture des parties communes pour Hôtel du Lac Kir.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-hotel-du-lac-kir-facade]]
- Exécute [[finances/2026/2026-05-26_devis_hotel-du-lac-kir_d-2026-015]]
- Adressé à [[tiers/hotel-du-lac-kir]]
