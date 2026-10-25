---
type: facture_vente
title: Facture F-2026-036
sources:
  - invoice:sale-36
updated: 2026-10-25
number: F-2026-036
party: tiers/sci-les-tilleuls
issue_date: 2026-08-31
due_date: 2026-09-30
ht: "44308.40"
tva: "8861.68"
ttc: "53170.08"
chantier: chantiers/2026-residence-les-tilleuls-12-logements
lines:
  - label: "Travaux : isolation des combles perdus"
    amount: "39092.00"
  - label: Tableau électrique 3 rangées
    quantity: 24
    unit_price: "217.35"
    amount: "5216.40"
    code: ART-016
links:
  - kind: belongs_to
    to: chantiers/2026-residence-les-tilleuls-12-logements
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_to
    to: tiers/sci-les-tilleuls
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/tableau-electrique-3-rangees
    confidence: strong
    evidence: Code article « ART-016 » de la ligne « Tableau électrique 3 rangées »
    rule: line_code
---

Facture de isolation des combles perdus pour SCI Les Tilleuls.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-residence-les-tilleuls-12-logements]]
- Adressé à [[tiers/sci-les-tilleuls]]
- Utilise [[catalogue/tableau-electrique-3-rangees]]
