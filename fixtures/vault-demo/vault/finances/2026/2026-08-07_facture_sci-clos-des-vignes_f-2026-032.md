---
type: facture_vente
title: Facture F-2026-032
sources:
  - invoice:sale-32
updated: 2026-10-25
number: F-2026-032
party: tiers/sci-clos-des-vignes
issue_date: 2026-08-07
due_date: 2026-09-06
ht: "36510.32"
tva: "7302.06"
ttc: "43812.38"
chantier: chantiers/2026-extension-clos-des-vignes
lines:
  - label: "Travaux : reprise des fissures en façade nord"
    amount: "27412.00"
  - label: Peinture acrylique blanche 15 L
    quantity: 88
    unit_price: "103.39"
    amount: "9098.32"
    article: catalogue/peinture-acrylique-blanche-15-l
links:
  - kind: belongs_to
    to: chantiers/2026-extension-clos-des-vignes
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_to
    to: tiers/sci-clos-des-vignes
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/peinture-acrylique-blanche-15-l
    confidence: exact
    evidence: Ligne « Peinture acrylique blanche 15 L »
    rule: line_article
---

Facture de reprise des fissures en façade nord pour SCI Clos des Vignes.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]]
- Adressé à [[tiers/sci-clos-des-vignes]]
- Utilise [[catalogue/peinture-acrylique-blanche-15-l]]
