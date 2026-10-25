---
type: facture_achat
title: Facture MA-78023 Matériaux Rousseau
sources:
  - invoice:purchase-21
updated: 2026-10-25
number: MA-78023
party: tiers/materiaux-rousseau
issue_date: 2026-04-10
due_date: 2026-05-25
ht: "1096.20"
tva: "219.24"
ttc: "1315.44"
lines:
  - label: Ciment CEM II 35 kg
    quantity: 116
    unit_price: "9.45"
    amount: "1096.20"
    article: catalogue/ciment-cem-ii-35-kg
links:
  - kind: issued_by
    to: tiers/materiaux-rousseau
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/ciment-cem-ii-35-kg
    confidence: exact
    evidence: Ligne « Ciment CEM II 35 kg »
    rule: line_article
---

116 sac de Ciment CEM II 35 kg. Palette consignée, à rendre au fournisseur.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Émis par [[tiers/materiaux-rousseau]]
- Utilise [[catalogue/ciment-cem-ii-35-kg]]
