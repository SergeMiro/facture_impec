---
type: facture_vente
title: Facture F-2026-012
sources:
  - invoice:sale-12
updated: 2026-10-25
number: F-2026-012
party: tiers/sci-clos-des-vignes
issue_date: 2026-03-29
due_date: 2026-04-28
ht: "27451.44"
tva: "5490.29"
ttc: "32941.73"
chantier: chantiers/2026-extension-clos-des-vignes
sales_order_ref: D-2026-012
links:
  - kind: belongs_to
    to: chantiers/2026-extension-clos-des-vignes
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-02-07_devis_sci-clos-des-vignes_d-2026-012
    confidence: exact
    evidence: Numéro de devis « D-2026-012 » (BT-14)
    rule: quote_ref
  - kind: issued_to
    to: tiers/sci-clos-des-vignes
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Facture de raccordement du tableau électrique pour SCI Clos des Vignes.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]]
- Exécute [[finances/2026/2026-02-07_devis_sci-clos-des-vignes_d-2026-012]]
- Adressé à [[tiers/sci-clos-des-vignes]]
