---
type: facture_achat
title: Facture PL-15966 Plâtres Lambert
sources:
  - invoice:purchase-52
updated: 2026-10-25
number: PL-15966
party: tiers/platres-lambert
issue_date: 2026-08-12
due_date: 2026-09-26
ht: "167.40"
tva: "33.48"
ttc: "200.88"
project_ref: CH-2026-02
lines:
  - label: Rail métallique R48
    quantity: 54
    unit_price: "3.10"
    amount: "167.40"
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

54 ml de Rail métallique R48.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]]
- Émis par [[tiers/platres-lambert]]
- Utilise [[catalogue/rail-metallique-r48]]
