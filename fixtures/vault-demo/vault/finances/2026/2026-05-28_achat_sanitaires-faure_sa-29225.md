---
type: facture_achat
title: Facture SA-29225 Sanitaires Faure
sources:
  - invoice:purchase-33
updated: 2026-10-25
number: SA-29225
party: tiers/sanitaires-faure
issue_date: 2026-05-28
due_date: 2026-07-12
ht: "34133.00"
tva: "6826.60"
ttc: "40959.60"
chantier: chantiers/2026-renovation-le-parc-batiment-b
order_ref: BC-2026-003
lines:
  - label: WC suspendu complet
    quantity: 107
    unit_price: "319.00"
    amount: "34133.00"
    article: catalogue/wc-suspendu-complet
links:
  - kind: belongs_to
    to: chantiers/2026-renovation-le-parc-batiment-b
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-05-10_commande_sanitaires-faure_bc-2026-003
    confidence: exact
    evidence: Numéro de commande « BC-2026-003 » (BT-13)
    rule: order_ref
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

107 unité de WC suspendu complet.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Exécute [[finances/2026/2026-05-10_commande_sanitaires-faure_bc-2026-003]]
- Émis par [[tiers/sanitaires-faure]]
- Utilise [[catalogue/wc-suspendu-complet]]
