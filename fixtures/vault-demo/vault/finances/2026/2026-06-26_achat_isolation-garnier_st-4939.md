---
type: facture_achat
title: Facture ST-4939 Isolation Garnier
sources:
  - invoice:purchase-59
updated: 2026-10-25
number: ST-4939
party: tiers/isolation-garnier
issue_date: 2026-06-26
due_date: 2026-08-10
ht: "19273.00"
tva: "3854.60"
ttc: "23127.60"
chantier: chantiers/2026-cabinet-medical-des-lilas
lines:
  - label: Travaux de isolation des combles perdus
    amount: "19273.00"
links:
  - kind: belongs_to
    to: chantiers/2026-cabinet-medical-des-lilas
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_by
    to: tiers/isolation-garnier
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Travaux de sous-traitance de Isolation Garnier pour Cabinet médical des Lilas.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-cabinet-medical-des-lilas]]
- Émis par [[tiers/isolation-garnier]]
