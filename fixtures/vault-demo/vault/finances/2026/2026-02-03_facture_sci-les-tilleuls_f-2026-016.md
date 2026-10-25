---
type: facture_vente
title: Facture F-2026-016
sources:
  - invoice:sale-16
updated: 2026-10-25
number: F-2026-016
party: tiers/sci-les-tilleuls
issue_date: 2026-02-03
due_date: 2026-03-05
ht: "26867.00"
tva: "5373.40"
ttc: "32240.40"
chantier: chantiers/2026-residence-les-tilleuls-12-logements
links:
  - kind: belongs_to
    to: chantiers/2026-residence-les-tilleuls-12-logements
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-01-07_devis_sci-les-tilleuls_d-2026-016
    confidence: strong
    evidence: Même client, 26 867,00 € HT facturés pour 26 867,00 € HT au devis accepté, à moins de 30 jours
    rule: quote_match
  - kind: issued_to
    to: tiers/sci-les-tilleuls
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Facture de raccordement du tableau électrique pour SCI Les Tilleuls.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-residence-les-tilleuls-12-logements]]
- Exécute [[finances/2026/2026-01-07_devis_sci-les-tilleuls_d-2026-016]]
- Adressé à [[tiers/sci-les-tilleuls]]
