---
type: facture_achat
title: Facture MA-34838 Matériaux Rousseau
sources:
  - invoice:purchase-41
updated: 2026-10-25
number: MA-34838
party: tiers/materiaux-rousseau
issue_date: 2026-06-29
due_date: 2026-08-13
ht: "245.70"
tva: "49.14"
ttc: "294.84"
chantier: chantiers/2026-residence-les-tilleuls-12-logements
order_ref: BC-2026-011
lines:
  - label: Ciment CEM II 35 kg
    quantity: 26
    unit_price: "9.45"
    amount: "245.70"
    article: catalogue/ciment-cem-ii-35-kg
links:
  - kind: belongs_to
    to: chantiers/2026-residence-les-tilleuls-12-logements
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-06-18_commande_materiaux-rousseau_bc-2026-011
    confidence: exact
    evidence: Numéro de commande « BC-2026-011 » (BT-13)
    rule: order_ref
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

26 sac de Ciment CEM II 35 kg.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-residence-les-tilleuls-12-logements]]
- Exécute [[finances/2026/2026-06-18_commande_materiaux-rousseau_bc-2026-011]]
- Émis par [[tiers/materiaux-rousseau]]
- Utilise [[catalogue/ciment-cem-ii-35-kg]]
