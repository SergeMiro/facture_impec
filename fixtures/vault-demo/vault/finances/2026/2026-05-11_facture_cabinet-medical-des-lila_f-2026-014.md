---
type: facture_vente
title: Facture F-2026-014
sources:
  - invoice:sale-14
updated: 2026-10-25
number: F-2026-014
party: tiers/cabinet-medical-des-lilas
issue_date: 2026-05-11
due_date: 2026-06-10
ht: "33387.00"
tva: "6677.40"
ttc: "40064.40"
project_ref: CH-2026-04
paid_at: 2026-06-20
links:
  - kind: belongs_to
    to: chantiers/2026-cabinet-medical-des-lilas
    confidence: exact
    evidence: Référence chantier « CH-2026-04 » (BT-11)
    rule: project_ref
  - kind: fulfils
    to: finances/2026/2026-04-20_devis_cabinet-medical-des-lila_d-2026-014
    confidence: strong
    evidence: Même client, 33 387,00 € HT facturés pour 33 387,00 € HT au devis accepté, à moins de 30 jours
    rule: quote_match
  - kind: issued_to
    to: tiers/cabinet-medical-des-lilas
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Facture de remplacement de la chaudière pour Cabinet Médical des Lilas.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-cabinet-medical-des-lilas]]
- Exécute [[finances/2026/2026-04-20_devis_cabinet-medical-des-lila_d-2026-014]]
- Adressé à [[tiers/cabinet-medical-des-lilas]]
