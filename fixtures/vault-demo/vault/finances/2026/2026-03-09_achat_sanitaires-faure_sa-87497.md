---
type: facture_achat
title: Facture SA-87497 Sanitaires Faure
sources:
  - invoice:purchase-13
  - raw/2026/03/facture-sa-87497.eml
updated: 2026-10-25
number: SA-87497
party: tiers/sanitaires-faure
issue_date: 2026-03-09
due_date: 2026-04-23
ht: "5742.00"
tva: "1148.40"
ttc: "6890.40"
chantier: chantiers/2026-renovation-le-parc-batiment-b
lines:
  - label: WC suspendu complet
    quantity: 18
    unit_price: "319.00"
    amount: "5742.00"
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

18 unité de WC suspendu complet.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Émis par [[tiers/sanitaires-faure]]
- Utilise [[catalogue/wc-suspendu-complet]]
