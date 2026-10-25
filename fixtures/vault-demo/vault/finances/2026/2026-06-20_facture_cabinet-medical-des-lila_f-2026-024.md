---
type: facture_vente
title: Facture F-2026-024
sources:
  - invoice:sale-24
updated: 2026-10-25
number: F-2026-024
party: tiers/cabinet-medical-des-lilas
issue_date: 2026-06-20
due_date: 2026-07-20
ht: "10028.39"
tva: "2005.68"
ttc: "12034.07"
chantier: chantiers/2026-cabinet-medical-des-lilas
lines:
  - label: "Travaux : réfection de la toiture côté cour"
    amount: "9726.00"
  - label: Enduit de façade 25 kg
    quantity: 11
    unit_price: "27.49"
    amount: "302.39"
    code: ART-004
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
    evidence: Code article « ART-004 » de la ligne « Enduit de façade 25 kg »
    rule: line_code
---

Facture de pose des menuiseries du rez-de-chaussée pour Cabinet Médical des Lilas.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-cabinet-medical-des-lilas]]
- Adressé à [[tiers/cabinet-medical-des-lilas]]
- Utilise [[catalogue/enduit-de-facade-25-kg]]
