---
type: facture_vente
title: Facture F-2026-003
sources:
  - invoice:sale-3
updated: 2026-10-25
number: F-2026-003
party: tiers/residence-le-parc-sas
issue_date: 2026-04-23
due_date: 2026-05-23
ht: "45498.00"
tva: "9099.60"
ttc: "54597.60"
chantier: chantiers/2026-renovation-le-parc-batiment-b
sales_order_ref: D-2026-003
paid_at: 2026-05-28
links:
  - kind: belongs_to
    to: chantiers/2026-renovation-le-parc-batiment-b
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-03-05_devis_residence-le-parc-sas_d-2026-003
    confidence: exact
    evidence: Numéro de devis « D-2026-003 » (BT-14)
    rule: quote_ref
  - kind: issued_to
    to: tiers/residence-le-parc-sas
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Facture de peinture des parties communes pour Résidence Le Parc SAS.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Exécute [[finances/2026/2026-03-05_devis_residence-le-parc-sas_d-2026-003]]
- Adressé à [[tiers/residence-le-parc-sas]]
