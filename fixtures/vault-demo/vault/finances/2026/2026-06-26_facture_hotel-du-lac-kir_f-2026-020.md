---
type: facture_vente
title: Facture F-2026-020
sources:
  - invoice:sale-20
updated: 2026-10-25
number: F-2026-020
party: tiers/hotel-du-lac-kir
issue_date: 2026-06-26
due_date: 2026-07-26
ht: "11515.50"
tva: "2303.10"
ttc: "13818.60"
chantier: chantiers/2026-hotel-du-lac-kir-facade
links:
  - kind: belongs_to
    to: chantiers/2026-hotel-du-lac-kir-facade
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-05-31_devis_hotel-du-lac-kir_d-2026-020
    confidence: inferred
    evidence: « Acompte de 30 % sur notre devis D-2026-020. »
    rule: text_quote
  - kind: issued_to
    to: tiers/hotel-du-lac-kir
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Acompte de 30 % sur notre devis D-2026-020.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-hotel-du-lac-kir-facade]]
- Exécute [[finances/2026/2026-05-31_devis_hotel-du-lac-kir_d-2026-020]] (à confirmer : « Acompte de 30 % sur notre devis D-2026-020. »)
- Adressé à [[tiers/hotel-du-lac-kir]]
