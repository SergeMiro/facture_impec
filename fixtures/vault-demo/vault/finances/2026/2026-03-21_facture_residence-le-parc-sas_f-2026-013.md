---
type: facture_vente
title: Facture F-2026-013
sources:
  - invoice:sale-13
updated: 2026-10-25
number: F-2026-013
party: tiers/residence-le-parc-sas
issue_date: 2026-03-21
due_date: 2026-04-20
ht: "24215.00"
tva: "4843.00"
ttc: "29058.00"
chantier: chantiers/2026-renovation-le-parc-batiment-b
paid_at: 2026-04-21
links:
  - kind: belongs_to
    to: chantiers/2026-renovation-le-parc-batiment-b
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-03-15_devis_residence-le-parc-sas_d-2026-013
    confidence: strong
    evidence: Même client, 24 215,00 € HT facturés pour 24 215,00 € HT au devis accepté, à moins de 30 jours
    rule: quote_match
  - kind: issued_to
    to: tiers/residence-le-parc-sas
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Facture de réfection de la toiture côté cour pour Résidence Le Parc SAS.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Exécute [[finances/2026/2026-03-15_devis_residence-le-parc-sas_d-2026-013]]
- Adressé à [[tiers/residence-le-parc-sas]]
