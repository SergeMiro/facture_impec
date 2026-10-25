---
type: facture_vente
title: Facture F-2026-008
sources:
  - invoice:sale-8
updated: 2026-10-25
number: F-2026-008
party: tiers/residence-le-parc-sas
issue_date: 2026-04-10
due_date: 2026-05-10
ht: "59779.08"
tva: "11955.82"
ttc: "71734.90"
chantier: chantiers/2026-renovation-le-parc-batiment-b
sales_order_ref: D-2026-008
links:
  - kind: belongs_to
    to: chantiers/2026-renovation-le-parc-batiment-b
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-03-10_devis_residence-le-parc-sas_d-2026-008
    confidence: exact
    evidence: Numéro de devis « D-2026-008 » (BT-14)
    rule: quote_ref
  - kind: issued_to
    to: tiers/residence-le-parc-sas
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Facture de remplacement de la chaudière pour Résidence Le Parc SAS.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Exécute [[finances/2026/2026-03-10_devis_residence-le-parc-sas_d-2026-008]]
- Adressé à [[tiers/residence-le-parc-sas]]
