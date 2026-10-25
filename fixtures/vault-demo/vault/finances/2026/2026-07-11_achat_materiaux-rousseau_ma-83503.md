---
type: facture_achat
title: Facture MA-83503 Matériaux Rousseau
sources:
  - invoice:purchase-44
updated: 2026-10-25
number: MA-83503
party: tiers/materiaux-rousseau
issue_date: 2026-07-11
due_date: 2026-08-25
ht: "1529.60"
tva: "305.92"
ttc: "1835.52"
project_ref: CH-2026-04
lines:
  - label: Enduit de façade 25 kg
    quantity: 64
    unit_price: "23.90"
    amount: "1529.60"
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

64 sac de Enduit de façade 25 kg.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-cabinet-medical-des-lilas]]
- Émis par [[tiers/materiaux-rousseau]]
- Utilise [[catalogue/enduit-de-facade-25-kg]]
