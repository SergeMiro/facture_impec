---
type: facture_vente
title: Facture F-2026-038
sources:
  - invoice:sale-38
updated: 2026-10-25
number: F-2026-038
party: tiers/residence-le-parc-sas
issue_date: 2026-09-12
due_date: 2026-10-12
ht: "36585.95"
tva: "7317.19"
ttc: "43903.14"
project_ref: CH-2026-03
lines:
  - label: "Travaux : pose du carrelage des sanitaires"
    amount: "36467.00"
  - label: "Fourniture : Laine de verre 100 mm"
    quantity: 15
    unit_price: "7.93"
    amount: "118.95"
links:
  - kind: belongs_to
    to: chantiers/2026-renovation-le-parc-batiment-b
    confidence: exact
    evidence: Référence chantier « CH-2026-03 » (BT-11)
    rule: project_ref
  - kind: issued_to
    to: tiers/residence-le-parc-sas
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/laine-de-verre-100-mm
    confidence: strong
    evidence: "Ligne « Fourniture : Laine de verre 100 mm »"
    rule: line_name
---

Facture de pose du carrelage des sanitaires pour Résidence Le Parc SAS.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Adressé à [[tiers/residence-le-parc-sas]]
- Utilise [[catalogue/laine-de-verre-100-mm]]
