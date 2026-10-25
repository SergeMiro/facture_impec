---
type: facture_vente
title: Facture F-2026-019
sources:
  - invoice:sale-19
updated: 2026-10-25
number: F-2026-019
party: tiers/cabinet-medical-des-lilas
issue_date: 2026-06-22
due_date: 2026-07-22
ht: "15908.10"
tva: "3181.62"
ttc: "19089.72"
chantier: chantiers/2026-cabinet-medical-des-lilas
paid_at: 2026-07-20
links:
  - kind: belongs_to
    to: chantiers/2026-cabinet-medical-des-lilas
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-04-25_devis_cabinet-medical-des-lila_d-2026-019
    confidence: inferred
    evidence: « Acompte de 30 % sur notre devis D-2026-019. »
    rule: text_quote
  - kind: issued_to
    to: tiers/cabinet-medical-des-lilas
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Acompte de 30 % sur notre devis D-2026-019.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-cabinet-medical-des-lilas]]
- Exécute [[finances/2026/2026-04-25_devis_cabinet-medical-des-lila_d-2026-019]] (à confirmer : « Acompte de 30 % sur notre devis D-2026-019. »)
- Adressé à [[tiers/cabinet-medical-des-lilas]]
