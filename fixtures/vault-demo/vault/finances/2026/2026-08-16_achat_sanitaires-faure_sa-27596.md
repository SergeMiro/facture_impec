---
type: facture_achat
title: Facture SA-27596 Sanitaires Faure
sources:
  - invoice:purchase-53
updated: 2026-10-25
number: SA-27596
party: tiers/sanitaires-faure
issue_date: 2026-08-16
due_date: 2026-09-30
ht: "34452.00"
tva: "6890.40"
ttc: "41342.40"
chantier: chantiers/2026-renovation-le-parc-batiment-b
lines:
  - label: WC suspendu complet
    quantity: 108
    unit_price: "319.00"
    amount: "34452.00"
    article: catalogue/wc-suspendu-complet
links:
  - kind: belongs_to
    to: chantiers/2026-renovation-le-parc-batiment-b
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_by
    to: tiers/sanitaires-faure
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/wc-suspendu-complet
    confidence: exact
    evidence: Ligne « WC suspendu complet »
    rule: line_article
---

108 unité de WC suspendu complet.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Émis par [[tiers/sanitaires-faure]]
- Utilise [[catalogue/wc-suspendu-complet]]
