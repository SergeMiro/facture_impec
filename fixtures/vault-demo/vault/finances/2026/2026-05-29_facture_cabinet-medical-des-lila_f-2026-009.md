---
type: facture_vente
title: Facture F-2026-009
sources:
  - invoice:sale-9
updated: 2026-10-25
number: F-2026-009
party: tiers/cabinet-medical-des-lilas
issue_date: 2026-05-29
due_date: 2026-06-28
ht: "36698.00"
tva: "7339.60"
ttc: "44037.60"
chantier: chantiers/2026-cabinet-medical-des-lilas
sales_order_ref: D-2026-009
paid_at: 2026-06-27
links:
  - kind: belongs_to
    to: chantiers/2026-cabinet-medical-des-lilas
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-04-15_devis_cabinet-medical-des-lila_d-2026-009
    confidence: exact
    evidence: Numéro de devis « D-2026-009 » (BT-14)
    rule: quote_ref
  - kind: issued_to
    to: tiers/cabinet-medical-des-lilas
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Facture de isolation des combles perdus pour Cabinet Médical des Lilas.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-cabinet-medical-des-lilas]]
- Exécute [[finances/2026/2026-04-15_devis_cabinet-medical-des-lila_d-2026-009]]
- Adressé à [[tiers/cabinet-medical-des-lilas]]
