---
type: facture_vente
title: Facture F-2026-018
sources:
  - invoice:sale-18
updated: 2026-10-25
number: F-2026-018
party: tiers/residence-le-parc-sas
issue_date: 2026-03-31
due_date: 2026-04-30
ht: "12580.00"
tva: "2516.00"
ttc: "15096.00"
project_ref: CH-2026-03
paid_at: 2026-05-02
links:
  - kind: belongs_to
    to: chantiers/2026-renovation-le-parc-batiment-b
    confidence: exact
    evidence: Référence chantier « CH-2026-03 » (BT-11)
    rule: project_ref
  - kind: fulfils
    to: finances/2026/2026-03-20_devis_residence-le-parc-sas_d-2026-018
    confidence: strong
    evidence: Même client, 12 580,00 € HT facturés pour 12 580,00 € HT au devis accepté, à moins de 30 jours
    rule: quote_match
  - kind: issued_to
    to: tiers/residence-le-parc-sas
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Facture de terrassement et fondations pour Résidence Le Parc SAS.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Exécute [[finances/2026/2026-03-20_devis_residence-le-parc-sas_d-2026-018]]
- Adressé à [[tiers/residence-le-parc-sas]]
