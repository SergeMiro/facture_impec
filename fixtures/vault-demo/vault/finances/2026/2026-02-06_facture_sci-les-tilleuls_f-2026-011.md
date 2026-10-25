---
type: facture_vente
title: Facture F-2026-011
sources:
  - invoice:sale-11
updated: 2026-10-25
number: F-2026-011
party: tiers/sci-les-tilleuls
issue_date: 2026-02-06
due_date: 2026-03-08
ht: "53191.00"
tva: "10638.20"
ttc: "63829.20"
chantier: chantiers/2026-residence-les-tilleuls-12-logements
sales_order_ref: D-2026-011
paid_at: 2026-03-19
links:
  - kind: belongs_to
    to: chantiers/2026-residence-les-tilleuls-12-logements
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-01-02_devis_sci-les-tilleuls_d-2026-011
    confidence: exact
    evidence: Numéro de devis « D-2026-011 » (BT-14)
    rule: quote_ref
  - kind: issued_to
    to: tiers/sci-les-tilleuls
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Facture de pose du carrelage des sanitaires pour SCI Les Tilleuls.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-residence-les-tilleuls-12-logements]]
- Exécute [[finances/2026/2026-01-02_devis_sci-les-tilleuls_d-2026-011]]
- Adressé à [[tiers/sci-les-tilleuls]]
