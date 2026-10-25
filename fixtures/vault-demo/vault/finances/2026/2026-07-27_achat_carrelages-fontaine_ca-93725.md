---
type: facture_achat
title: Facture CA-93725 Carrelages Fontaine
sources:
  - invoice:purchase-48
updated: 2026-10-25
number: CA-93725
party: tiers/carrelages-fontaine
issue_date: 2026-07-27
due_date: 2026-09-10
ht: "2322.00"
tva: "464.40"
ttc: "2786.40"
project_ref: CH-2026-03
lines:
  - label: Colle carrelage C2
    quantity: 108
    unit_price: "21.50"
    amount: "2322.00"
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

108 sac de Colle carrelage C2.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Émis par [[tiers/carrelages-fontaine]]
- Utilise [[catalogue/colle-carrelage-c2]]
