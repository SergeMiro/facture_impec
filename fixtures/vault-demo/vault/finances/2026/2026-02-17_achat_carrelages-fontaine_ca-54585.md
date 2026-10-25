---
type: facture_achat
title: Facture CA-54585 Carrelages Fontaine
sources:
  - invoice:purchase-8
  - raw/2026/02/facture-ca-54585.eml
updated: 2026-10-25
number: CA-54585
party: tiers/carrelages-fontaine
issue_date: 2026-02-17
due_date: 2026-04-03
ht: "731.00"
tva: "146.20"
ttc: "877.20"
project_ref: CH-2026-03
lines:
  - label: Colle carrelage C2
    quantity: 34
    unit_price: "21.50"
    amount: "731.00"
links:
  - kind: belongs_to
    to: chantiers/2026-renovation-le-parc-batiment-b
    confidence: exact
    evidence: Référence chantier « CH-2026-03 » (BT-11)
    rule: project_ref
  - kind: issued_by
    to: tiers/carrelages-fontaine
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/colle-carrelage-c2
    confidence: strong
    evidence: Ligne « Colle carrelage C2 »
    rule: line_name
---

34 sac de Colle carrelage C2.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Émis par [[tiers/carrelages-fontaine]]
- Utilise [[catalogue/colle-carrelage-c2]]
