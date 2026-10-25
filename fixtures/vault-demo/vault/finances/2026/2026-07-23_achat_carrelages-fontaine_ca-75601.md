---
type: facture_achat
title: Facture CA-75601 Carrelages Fontaine
sources:
  - invoice:purchase-47
updated: 2026-10-25
number: CA-75601
party: tiers/carrelages-fontaine
issue_date: 2026-07-23
due_date: 2026-09-06
ht: "2401.70"
tva: "480.34"
ttc: "2882.04"
chantier: chantiers/2026-extension-clos-des-vignes
lines:
  - label: Carrelage grès cérame 60x60
    quantity: 73
    unit_price: "32.90"
    amount: "2401.70"
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

73 m² de Carrelage grès cérame 60x60.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]]
- Émis par [[tiers/carrelages-fontaine]]
- Utilise [[catalogue/carrelage-gres-cerame-60x60]]
