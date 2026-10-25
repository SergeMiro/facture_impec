---
type: facture_achat
title: Facture PE-76076 Peintures Roux
sources:
  - invoice:purchase-17
  - raw/2026/03/facture-pe-76076.eml
updated: 2026-10-25
number: PE-76076
party: tiers/peintures-roux
issue_date: 2026-03-25
due_date: 2026-05-09
ht: "7911.20"
tva: "1582.24"
ttc: "9493.44"
chantier: chantiers/2026-extension-clos-des-vignes
lines:
  - label: Peinture acrylique blanche 15 L
    quantity: 88
    unit_price: "89.90"
    amount: "7911.20"
    article: catalogue/peinture-acrylique-blanche-15-l
links:
  - kind: belongs_to
    to: chantiers/2026-extension-clos-des-vignes
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
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

88 pot de Peinture acrylique blanche 15 L.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]]
- Émis par [[tiers/peintures-roux]]
- Utilise [[catalogue/peinture-acrylique-blanche-15-l]]
