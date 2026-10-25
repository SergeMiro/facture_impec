---
type: situation
title: Situation n°2 Rénovation Le Parc bâtiment B
sources:
  - sheet:situation-renovation-le-parc-batiment-b-2
updated: 2026-10-25
chantier: chantiers/2026-renovation-le-parc-batiment-b
number: 2
cumul_ht: "48680.00"
party: tiers/residence-le-parc-sas
issue_date: 2026-05-22
due_date: 2026-07-06
ht: "17031.00"
ttc: "20437.20"
retenue: "851.55"
links:
  - kind: belongs_to
    to: chantiers/2026-renovation-le-parc-batiment-b
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_to
    to: tiers/residence-le-parc-sas
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: succeeds
    to: finances/situations/2026-renovation-le-parc-batiment-b_sit-1
    confidence: exact
    evidence: Situation n° 1 du même chantier
    rule: previous_situation
backlinks:
  - kind: succeeds
    from: finances/situations/2026-renovation-le-parc-batiment-b_sit-3
---

Situation de travaux n°2 : avancement 44 %.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Adressé à [[tiers/residence-le-parc-sas]]
- Suit [[finances/situations/2026-renovation-le-parc-batiment-b_sit-1]]
- Suivie par [[finances/situations/2026-renovation-le-parc-batiment-b_sit-3]]
