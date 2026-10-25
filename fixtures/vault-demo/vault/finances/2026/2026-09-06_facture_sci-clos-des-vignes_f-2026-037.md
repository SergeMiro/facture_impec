---
type: facture_vente
title: Facture F-2026-037
sources:
  - invoice:sale-37
updated: 2026-10-25
number: F-2026-037
party: tiers/sci-clos-des-vignes
issue_date: 2026-09-06
due_date: 2026-10-06
ht: "26395.60"
tva: "5279.12"
ttc: "31674.72"
chantier: chantiers/2026-extension-clos-des-vignes
lines:
  - label: "Travaux : création des cloisons du premier étage"
    amount: "21860.00"
  - label: "Fourniture : Sable 0/4 big bag"
    quantity: 58
    unit_price: "78.20"
    amount: "4535.60"
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
  - kind: uses
    to: catalogue/sable-0-4-big-bag
    confidence: strong
    evidence: "Ligne « Fourniture : Sable 0/4 big bag »"
    rule: line_name
---

Facture de isolation des combles perdus pour SCI Clos des Vignes.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]]
- Adressé à [[tiers/sci-clos-des-vignes]]
- Utilise [[catalogue/sable-0-4-big-bag]]
