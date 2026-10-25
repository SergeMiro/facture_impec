---
type: facture_vente
title: Facture F-2026-029
sources:
  - invoice:sale-29
updated: 2026-10-25
number: F-2026-029
party: tiers/cabinet-medical-des-lilas
issue_date: 2026-07-20
due_date: 2026-08-19
ht: "26020.71"
tva: "5204.14"
ttc: "31224.85"
chantier: chantiers/2026-cabinet-medical-des-lilas
lines:
  - label: "Travaux : reprise des fissures en façade nord"
    amount: "25472.00"
  - label: "Fourniture : Vis à bois 5x60"
    quantity: 37
    unit_price: "14.83"
    amount: "548.71"
paid_at: 2026-08-31
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
    to: catalogue/vis-a-bois-5x60
    confidence: strong
    evidence: "Ligne « Fourniture : Vis à bois 5x60 »"
    rule: line_name
---

Facture de réfection de la toiture côté cour pour Cabinet Médical des Lilas.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-cabinet-medical-des-lilas]]
- Adressé à [[tiers/cabinet-medical-des-lilas]]
- Utilise [[catalogue/vis-a-bois-5x60]]
