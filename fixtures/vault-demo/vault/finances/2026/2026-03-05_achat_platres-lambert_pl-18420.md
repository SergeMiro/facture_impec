---
type: facture_achat
title: Facture PL-18420 Plâtres Lambert
sources:
  - invoice:purchase-12
  - raw/2026/03/facture-pl-18420.eml
updated: 2026-10-25
number: PL-18420
party: tiers/platres-lambert
issue_date: 2026-03-05
due_date: 2026-04-19
ht: "279.00"
tva: "55.80"
ttc: "334.80"
project_ref: CH-2026-02
lines:
  - label: Rail métallique R48
    quantity: 90
    unit_price: "3.10"
    amount: "279.00"
links:
  - kind: belongs_to
    to: chantiers/2026-extension-clos-des-vignes
    confidence: exact
    evidence: Référence chantier « CH-2026-02 » (BT-11)
    rule: project_ref
  - kind: issued_by
    to: tiers/platres-lambert
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/rail-metallique-r48
    confidence: strong
    evidence: Ligne « Rail métallique R48 »
    rule: line_name
---

90 ml de Rail métallique R48.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]]
- Émis par [[tiers/platres-lambert]]
- Utilise [[catalogue/rail-metallique-r48]]
