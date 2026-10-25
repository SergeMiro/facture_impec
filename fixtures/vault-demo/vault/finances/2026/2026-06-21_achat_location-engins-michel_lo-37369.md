---
type: facture_achat
title: Facture LO-37369 Location Engins Michel
sources:
  - invoice:purchase-39
updated: 2026-10-25
number: LO-37369
party: tiers/location-engins-michel
issue_date: 2026-06-21
due_date: 2026-08-05
ht: "8400.00"
tva: "1680.00"
ttc: "10080.00"
chantier: chantiers/2026-cabinet-medical-des-lilas
order_ref: BC-2026-009
lines:
  - label: Mini-pelle à la journée
    quantity: 40
    unit_price: "210.00"
    amount: "8400.00"
links:
  - kind: belongs_to
    to: chantiers/2026-cabinet-medical-des-lilas
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-06-17_commande_location-engins-michel_bc-2026-009
    confidence: exact
    evidence: Numéro de commande « BC-2026-009 » (BT-13)
    rule: order_ref
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

40 jour de Mini-pelle à la journée.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-cabinet-medical-des-lilas]]
- Exécute [[finances/2026/2026-06-17_commande_location-engins-michel_bc-2026-009]]
- Émis par [[tiers/location-engins-michel]]
- Utilise [[catalogue/mini-pelle-a-la-journee]]
