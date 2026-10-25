---
type: facture_vente
title: Facture F-2026-022
sources:
  - invoice:sale-22
updated: 2026-10-25
number: F-2026-022
party: tiers/sci-clos-des-vignes
issue_date: 2026-06-08
due_date: 2026-07-08
ht: "22923.60"
tva: "4584.72"
ttc: "27508.32"
project_ref: CH-2026-02
lines:
  - label: "Travaux : pose des menuiseries du rez-de-chaussée"
    amount: "14869.00"
  - label: Sable 0/4 big bag
    quantity: 103
    unit_price: "78.20"
    amount: "8054.60"
    article: catalogue/sable-0-4-big-bag
paid_at: 2026-07-16
links:
  - kind: belongs_to
    to: chantiers/2026-extension-clos-des-vignes
    confidence: exact
    evidence: Référence chantier « CH-2026-02 » (BT-11)
    rule: project_ref
  - kind: issued_to
    to: tiers/sci-clos-des-vignes
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/sable-0-4-big-bag
    confidence: exact
    evidence: Ligne « Sable 0/4 big bag »
    rule: line_article
---

Facture de isolation des combles perdus pour SCI Clos des Vignes.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]]
- Adressé à [[tiers/sci-clos-des-vignes]]
- Utilise [[catalogue/sable-0-4-big-bag]]
