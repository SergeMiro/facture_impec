---
type: facture_achat
title: Facture MA-23327 Matériaux Rousseau
sources:
  - invoice:purchase-1
  - raw/2026/01/facture-ma-23327.eml
updated: 2026-10-25
number: MA-23327
party: tiers/materiaux-rousseau
issue_date: 2026-01-20
due_date: 2026-03-06
ht: "680.40"
tva: "136.08"
ttc: "816.48"
chantier: chantiers/2026-residence-les-tilleuls-12-logements
lines:
  - label: Ciment CEM II 35 kg
    quantity: 72
    unit_price: "9.45"
    amount: "680.40"
    article: catalogue/ciment-cem-ii-35-kg
links:
  - kind: belongs_to
    to: chantiers/2026-residence-les-tilleuls-12-logements
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
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

72 sac de Ciment CEM II 35 kg.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-residence-les-tilleuls-12-logements]]
- Émis par [[tiers/materiaux-rousseau]]
- Utilise [[catalogue/ciment-cem-ii-35-kg]]
