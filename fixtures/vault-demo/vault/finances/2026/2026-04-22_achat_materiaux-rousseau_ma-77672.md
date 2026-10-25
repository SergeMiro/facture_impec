---
type: facture_achat
title: Facture MA-77672 Matériaux Rousseau
sources:
  - invoice:purchase-24
updated: 2026-10-25
number: MA-77672
party: tiers/materiaux-rousseau
issue_date: 2026-04-22
due_date: 2026-06-06
ht: "1266.70"
tva: "253.34"
ttc: "1520.04"
project_ref: CH-2026-04
lines:
  - label: Enduit de façade 25 kg
    quantity: 53
    unit_price: "23.90"
    amount: "1266.70"
links:
  - kind: belongs_to
    to: chantiers/2026-cabinet-medical-des-lilas
    confidence: exact
    evidence: Référence chantier « CH-2026-04 » (BT-11)
    rule: project_ref
  - kind: issued_by
    to: tiers/materiaux-rousseau
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/enduit-de-facade-25-kg
    confidence: strong
    evidence: Ligne « Enduit de façade 25 kg »
    rule: line_name
---

53 sac de Enduit de façade 25 kg.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-cabinet-medical-des-lilas]]
- Émis par [[tiers/materiaux-rousseau]]
- Utilise [[catalogue/enduit-de-facade-25-kg]]
