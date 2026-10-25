---
type: facture_vente
title: Facture F-2026-034
sources:
  - invoice:sale-34
updated: 2026-10-25
number: F-2026-034
party: tiers/cabinet-medical-des-lilas
issue_date: 2026-08-19
due_date: 2026-09-18
ht: "35954.00"
tva: "7190.80"
ttc: "43144.80"
project_ref: CH-2026-04
lines:
  - label: "Travaux : création des cloisons du premier étage"
    amount: "26777.00"
  - label: Mini-pelle à la journée
    quantity: 38
    unit_price: "241.50"
    amount: "9177.00"
    code: ART-019
links:
  - kind: belongs_to
    to: chantiers/2026-cabinet-medical-des-lilas
    confidence: exact
    evidence: Référence chantier « CH-2026-04 » (BT-11)
    rule: project_ref
  - kind: issued_to
    to: tiers/cabinet-medical-des-lilas
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/mini-pelle-a-la-journee
    confidence: strong
    evidence: Code article « ART-019 » de la ligne « Mini-pelle à la journée »
    rule: line_code
---

Facture de terrassement et fondations pour Cabinet Médical des Lilas.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-cabinet-medical-des-lilas]]
- Adressé à [[tiers/cabinet-medical-des-lilas]]
- Utilise [[catalogue/mini-pelle-a-la-journee]]
