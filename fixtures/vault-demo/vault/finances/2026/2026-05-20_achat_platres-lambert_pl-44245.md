---
type: facture_achat
title: Facture PL-44245 Plâtres Lambert
sources:
  - invoice:purchase-31
updated: 2026-10-25
number: PL-44245
party: tiers/platres-lambert
issue_date: 2026-05-20
due_date: 2026-07-04
ht: "104.00"
tva: "20.80"
ttc: "124.80"
chantier: chantiers/2026-residence-les-tilleuls-12-logements
order_ref: BC-2026-001
lines:
  - label: Plaque de plâtre BA13
    quantity: 20
    unit_price: "5.20"
    amount: "104.00"
links:
  - kind: belongs_to
    to: chantiers/2026-residence-les-tilleuls-12-logements
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-05-17_commande_platres-lambert_bc-2026-001
    confidence: exact
    evidence: Numéro de commande « BC-2026-001 » (BT-13)
    rule: order_ref
  - kind: issued_by
    to: tiers/platres-lambert
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/plaque-de-platre-ba13
    confidence: strong
    evidence: Ligne « Plaque de plâtre BA13 »
    rule: line_name
---

20 m² de Plaque de plâtre BA13. Déchargement par camion-grue.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-residence-les-tilleuls-12-logements]]
- Exécute [[finances/2026/2026-05-17_commande_platres-lambert_bc-2026-001]]
- Émis par [[tiers/platres-lambert]]
- Utilise [[catalogue/plaque-de-platre-ba13]]
