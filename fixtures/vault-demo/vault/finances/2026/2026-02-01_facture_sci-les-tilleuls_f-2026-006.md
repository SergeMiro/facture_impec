---
type: facture_vente
title: Facture F-2026-006
sources:
  - invoice:sale-6
updated: 2026-10-25
number: F-2026-006
party: tiers/sci-les-tilleuls
issue_date: 2026-02-01
due_date: 2026-03-03
ht: "14955.84"
tva: "2991.17"
ttc: "17947.01"
project_ref: CH-2026-01
sales_order_ref: D-2026-006
paid_at: 2026-02-22
links:
  - kind: belongs_to
    to: chantiers/2026-residence-les-tilleuls-12-logements
    confidence: exact
    evidence: Référence chantier « CH-2026-01 » (BT-11)
    rule: project_ref
  - kind: fulfils
    to: finances/2025/2025-12-28_devis_sci-les-tilleuls_d-2026-006
    confidence: exact
    evidence: Numéro de devis « D-2026-006 » (BT-14)
    rule: quote_ref
  - kind: issued_to
    to: tiers/sci-les-tilleuls
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Facture de isolation des combles perdus pour SCI Les Tilleuls.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-residence-les-tilleuls-12-logements]]
- Exécute [[finances/2025/2025-12-28_devis_sci-les-tilleuls_d-2026-006]]
- Adressé à [[tiers/sci-les-tilleuls]]
