---
type: facture_achat
title: Facture LO-99906 Location Engins Michel
sources:
  - invoice:purchase-19
  - raw/2026/04/facture-lo-99906.eml
updated: 2026-10-25
number: LO-99906
party: tiers/location-engins-michel
issue_date: 2026-04-02
due_date: 2026-05-17
ht: "7980.00"
tva: "1596.00"
ttc: "9576.00"
chantier: chantiers/2026-cabinet-medical-des-lilas
lines:
  - label: Mini-pelle à la journée
    quantity: 38
    unit_price: "210.00"
    amount: "7980.00"
links:
  - kind: belongs_to
    to: chantiers/2026-cabinet-medical-des-lilas
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_by
    to: tiers/location-engins-michel
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/mini-pelle-a-la-journee
    confidence: strong
    evidence: Ligne « Mini-pelle à la journée »
    rule: line_name
---

38 jour de Mini-pelle à la journée.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-cabinet-medical-des-lilas]]
- Émis par [[tiers/location-engins-michel]]
- Utilise [[catalogue/mini-pelle-a-la-journee]]
