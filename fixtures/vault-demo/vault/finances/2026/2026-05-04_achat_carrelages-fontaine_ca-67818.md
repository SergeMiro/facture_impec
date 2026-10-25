---
type: facture_achat
title: Facture CA-67818 Carrelages Fontaine
sources:
  - invoice:purchase-27
updated: 2026-10-25
number: CA-67818
party: tiers/carrelages-fontaine
issue_date: 2026-05-04
due_date: 2026-06-18
ht: "3520.30"
tva: "704.06"
ttc: "4224.36"
chantier: chantiers/2026-extension-clos-des-vignes
lines:
  - label: Carrelage grès cérame 60x60
    quantity: 107
    unit_price: "32.90"
    amount: "3520.30"
links:
  - kind: belongs_to
    to: chantiers/2026-extension-clos-des-vignes
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_by
    to: tiers/carrelages-fontaine
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/carrelage-gres-cerame-60x60
    confidence: strong
    evidence: Ligne « Carrelage grès cérame 60x60 »
    rule: line_name
---

107 m² de Carrelage grès cérame 60x60.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]]
- Émis par [[tiers/carrelages-fontaine]]
- Utilise [[catalogue/carrelage-gres-cerame-60x60]]
