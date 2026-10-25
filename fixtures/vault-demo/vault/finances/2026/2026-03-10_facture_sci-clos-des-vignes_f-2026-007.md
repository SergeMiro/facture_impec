---
type: facture_vente
title: Facture F-2026-007
sources:
  - invoice:sale-7
updated: 2026-10-25
number: F-2026-007
party: tiers/sci-clos-des-vignes
issue_date: 2026-03-10
due_date: 2026-04-09
ht: "10922.00"
tva: "2184.40"
ttc: "13106.40"
chantier: chantiers/2026-extension-clos-des-vignes
order_ref: D-2026-007
paid_at: 2026-03-31
links:
  - kind: belongs_to
    to: chantiers/2026-extension-clos-des-vignes
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-02-02_devis_sci-clos-des-vignes_d-2026-007
    confidence: exact
    evidence: Numéro de devis « D-2026-007 » (BT-13)
    rule: quote_ref
  - kind: issued_to
    to: tiers/sci-clos-des-vignes
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Facture de création des cloisons du premier étage pour SCI Clos des Vignes.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]]
- Exécute [[finances/2026/2026-02-02_devis_sci-clos-des-vignes_d-2026-007]]
- Adressé à [[tiers/sci-clos-des-vignes]]
