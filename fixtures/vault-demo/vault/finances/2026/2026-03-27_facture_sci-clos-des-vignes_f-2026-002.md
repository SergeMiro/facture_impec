---
type: facture_vente
title: Facture F-2026-002
sources:
  - invoice:sale-2
updated: 2026-10-25
number: F-2026-002
party: tiers/sci-clos-des-vignes
issue_date: 2026-03-27
due_date: 2026-04-26
ht: "7322.40"
tva: "1464.48"
ttc: "8786.88"
project_ref: CH-2026-02
sales_order_ref: D-2026-002
paid_at: 2026-04-25
links:
  - kind: belongs_to
    to: chantiers/2026-extension-clos-des-vignes
    confidence: exact
    evidence: Référence chantier « CH-2026-02 » (BT-11)
    rule: project_ref
  - kind: fulfils
    to: finances/2026/2026-01-28_devis_sci-clos-des-vignes_d-2026-002
    confidence: exact
    evidence: Numéro de devis « D-2026-002 » (BT-14)
    rule: quote_ref
  - kind: issued_to
    to: tiers/sci-clos-des-vignes
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Facture de peinture des parties communes pour SCI Clos des Vignes.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]]
- Exécute [[finances/2026/2026-01-28_devis_sci-clos-des-vignes_d-2026-002]]
- Adressé à [[tiers/sci-clos-des-vignes]]
