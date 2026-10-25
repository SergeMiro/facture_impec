---
type: facture_achat
title: Facture PE-97149 Peintures Roux
sources:
  - invoice:purchase-37
updated: 2026-10-25
number: PE-97149
party: tiers/peintures-roux
issue_date: 2026-06-13
due_date: 2026-07-28
ht: "2697.00"
tva: "539.40"
ttc: "3236.40"
chantier: chantiers/2026-extension-clos-des-vignes
order_ref: BC-2026-007
lines:
  - label: Peinture acrylique blanche 15 L
    quantity: 30
    unit_price: "89.90"
    amount: "2697.00"
    article: catalogue/peinture-acrylique-blanche-15-l
links:
  - kind: belongs_to
    to: chantiers/2026-extension-clos-des-vignes
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-06-04_commande_peintures-roux_bc-2026-007
    confidence: exact
    evidence: Numéro de commande « BC-2026-007 » (BT-13)
    rule: order_ref
  - kind: issued_by
    to: tiers/peintures-roux
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/peinture-acrylique-blanche-15-l
    confidence: exact
    evidence: Ligne « Peinture acrylique blanche 15 L »
    rule: line_article
---

30 pot de Peinture acrylique blanche 15 L.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]]
- Exécute [[finances/2026/2026-06-04_commande_peintures-roux_bc-2026-007]]
- Émis par [[tiers/peintures-roux]]
- Utilise [[catalogue/peinture-acrylique-blanche-15-l]]
