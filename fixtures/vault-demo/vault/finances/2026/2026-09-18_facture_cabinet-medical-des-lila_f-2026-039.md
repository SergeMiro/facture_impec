---
type: facture_vente
title: Facture F-2026-039
sources:
  - invoice:sale-39
updated: 2026-10-25
number: F-2026-039
party: tiers/cabinet-medical-des-lilas
issue_date: 2026-09-18
due_date: 2026-10-18
ht: "40617.97"
tva: "8123.59"
ttc: "48741.56"
chantier: chantiers/2026-cabinet-medical-des-lilas
lines:
  - label: "Travaux : reprise des fissures en façade nord"
    amount: "39161.00"
  - label: "Fourniture : Enduit de façade 25 kg"
    quantity: 53
    unit_price: "27.49"
    amount: "1456.97"
links:
  - kind: belongs_to
    to: chantiers/2026-cabinet-medical-des-lilas
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_to
    to: tiers/cabinet-medical-des-lilas
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/enduit-de-facade-25-kg
    confidence: strong
    evidence: "Ligne « Fourniture : Enduit de façade 25 kg »"
    rule: line_name
---

Facture de isolation des combles perdus pour Cabinet Médical des Lilas.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-cabinet-medical-des-lilas]]
- Adressé à [[tiers/cabinet-medical-des-lilas]]
- Utilise [[catalogue/enduit-de-facade-25-kg]]
