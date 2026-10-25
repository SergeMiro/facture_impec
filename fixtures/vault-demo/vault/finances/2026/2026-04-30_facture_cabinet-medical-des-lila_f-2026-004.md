---
type: facture_vente
title: Facture F-2026-004
sources:
  - invoice:sale-4
updated: 2026-10-25
number: F-2026-004
party: tiers/cabinet-medical-des-lilas
issue_date: 2026-04-30
due_date: 2026-05-30
ht: "47975.76"
tva: "9595.15"
ttc: "57570.91"
chantier: chantiers/2026-cabinet-medical-des-lilas
order_ref: D-2026-004
links:
  - kind: belongs_to
    to: chantiers/2026-cabinet-medical-des-lilas
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-04-10_devis_cabinet-medical-des-lila_d-2026-004
    confidence: exact
    evidence: Numéro de devis « D-2026-004 » (BT-13)
    rule: quote_ref
  - kind: issued_to
    to: tiers/cabinet-medical-des-lilas
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Facture de pose du carrelage des sanitaires pour Cabinet Médical des Lilas.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-cabinet-medical-des-lilas]]
- Exécute [[finances/2026/2026-04-10_devis_cabinet-medical-des-lila_d-2026-004]]
- Adressé à [[tiers/cabinet-medical-des-lilas]]
