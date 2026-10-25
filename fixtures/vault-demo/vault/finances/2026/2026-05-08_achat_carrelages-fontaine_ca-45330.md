---
type: facture_achat
title: Facture CA-45330 Carrelages Fontaine
sources:
  - invoice:purchase-28
updated: 2026-10-25
number: CA-45330
party: tiers/carrelages-fontaine
issue_date: 2026-05-08
due_date: 2026-06-22
ht: "1397.50"
tva: "279.50"
ttc: "1677.00"
lines:
  - label: Colle carrelage C2
    quantity: 65
    unit_price: "21.50"
    amount: "1397.50"
links:
  - kind: belongs_to
    to: chantiers/2026-extension-clos-des-vignes
    confidence: inferred
    evidence: « Pour le chantier Extension Clos des Vignes, la benne à gravats passe le lundi matin. »
    rule: text_chantier
  - kind: issued_by
    to: tiers/carrelages-fontaine
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/colle-carrelage-c2
    confidence: strong
    evidence: Ligne « Colle carrelage C2 »
    rule: line_name
---

65 sac de Colle carrelage C2. Pour le chantier Extension Clos des Vignes, la benne à gravats passe le lundi matin.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]] (à confirmer : « Pour le chantier Extension Clos des Vignes, la benne à gravats passe le lundi matin. »)
- Émis par [[tiers/carrelages-fontaine]]
- Utilise [[catalogue/colle-carrelage-c2]]
