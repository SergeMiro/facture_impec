---
type: devis
title: Devis D-2026-002
sources:
  - document:devis-2
updated: 2026-10-25
number: D-2026-002
party: tiers/sci-clos-des-vignes
chantier: chantiers/2026-extension-clos-des-vignes
date: 2026-01-28
status: accepte
ht: "6780.00"
ttc: "8136.00"
lines:
  - label: Main-d'œuvre
    quantity: 45
    unit_price: "45.00"
    amount: "2025.00"
  - label: Fournitures et petit matériel
    amount: "1695.00"
  - label: Travaux selon descriptif
    amount: "3060.00"
links:
  - kind: belongs_to
    to: chantiers/2026-extension-clos-des-vignes
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_to
    to: tiers/sci-clos-des-vignes
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
backlinks:
  - kind: fulfils
    from: finances/2026/2026-03-27_facture_sci-clos-des-vignes_f-2026-002
---

Devis pour la peinture des parties communes.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]]
- Adressé à [[tiers/sci-clos-des-vignes]]
- Exécuté par [[finances/2026/2026-03-27_facture_sci-clos-des-vignes_f-2026-002]]
