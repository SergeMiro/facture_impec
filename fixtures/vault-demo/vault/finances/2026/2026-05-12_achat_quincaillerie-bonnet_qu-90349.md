---
type: facture_achat
title: Facture QU-90349 Quincaillerie Bonnet
sources:
  - invoice:purchase-29
updated: 2026-10-25
number: QU-90349
party: tiers/quincaillerie-bonnet
issue_date: 2026-05-12
due_date: 2026-06-26
ht: "619.20"
tva: "123.84"
ttc: "743.04"
chantier: chantiers/2026-cabinet-medical-des-lilas
lines:
  - label: Vis à bois 5x60
    quantity: 48
    unit_price: "12.90"
    amount: "619.20"
    article: catalogue/vis-a-bois-5x60
links:
  - kind: belongs_to
    to: chantiers/2026-cabinet-medical-des-lilas
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_by
    to: tiers/quincaillerie-bonnet
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/vis-a-bois-5x60
    confidence: exact
    evidence: Ligne « Vis à bois 5x60 »
    rule: line_article
---

48 boîte de Vis à bois 5x60.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-cabinet-medical-des-lilas]]
- Émis par [[tiers/quincaillerie-bonnet]]
- Utilise [[catalogue/vis-a-bois-5x60]]
