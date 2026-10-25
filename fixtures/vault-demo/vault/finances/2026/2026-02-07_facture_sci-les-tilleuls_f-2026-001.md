---
type: facture_vente
title: Facture F-2026-001
sources:
  - invoice:sale-1
updated: 2026-10-25
number: F-2026-001
party: tiers/sci-les-tilleuls
issue_date: 2026-02-07
due_date: 2026-03-09
ht: "42746.00"
tva: "8549.20"
ttc: "51295.20"
chantier: chantiers/2026-residence-les-tilleuls-12-logements
order_ref: D-2026-001
paid_at: 2026-03-16
links:
  - kind: belongs_to
    to: chantiers/2026-residence-les-tilleuls-12-logements
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2025/2025-12-23_devis_sci-les-tilleuls_d-2026-001
    confidence: exact
    evidence: Numéro de devis « D-2026-001 » (BT-13)
    rule: quote_ref
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
- Exécute [[finances/2025/2025-12-23_devis_sci-les-tilleuls_d-2026-001]]
- Adressé à [[tiers/sci-les-tilleuls]]
