---
type: facture_achat
title: Facture MA-37784 Matériaux Rousseau
sources:
  - invoice:purchase-4
  - raw/2026/02/facture-ma-37784.eml
updated: 2026-10-25
number: MA-37784
party: tiers/materiaux-rousseau
issue_date: 2026-02-01
due_date: 2026-03-18
ht: "262.90"
tva: "52.58"
ttc: "315.48"
project_ref: CH-2026-04
lines:
  - label: Enduit de façade 25 kg
    quantity: 11
    unit_price: "23.90"
    amount: "262.90"
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

11 sac de Enduit de façade 25 kg.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-cabinet-medical-des-lilas]]
- Émis par [[tiers/materiaux-rousseau]]
- Utilise [[catalogue/enduit-de-facade-25-kg]]
