---
type: facture_achat
title: Facture SA-20452 Sanitaires Faure
sources:
  - invoice:purchase-54
updated: 2026-10-25
number: SA-20452
party: tiers/sanitaires-faure
issue_date: 2026-08-20
due_date: 2026-10-04
ht: "19.20"
tva: "3.84"
ttc: "23.04"
project_ref: CH-2026-04
lines:
  - label: Tube PER 16
    quantity: 16
    unit_price: "1.20"
    amount: "19.20"
    code: SAN-1013
links:
  - kind: belongs_to
    to: chantiers/2026-cabinet-medical-des-lilas
    confidence: exact
    evidence: Référence chantier « CH-2026-04 » (BT-11)
    rule: project_ref
  - kind: issued_by
    to: tiers/sanitaires-faure
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/tube-per-16
    confidence: strong
    evidence: Code article « SAN-1013 » de la ligne « Tube PER 16 »
    rule: line_code
---

16 ml de Tube PER 16.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-cabinet-medical-des-lilas]]
- Émis par [[tiers/sanitaires-faure]]
- Utilise [[catalogue/tube-per-16]]
