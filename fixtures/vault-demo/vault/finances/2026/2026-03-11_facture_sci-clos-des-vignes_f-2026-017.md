---
type: facture_vente
title: Facture F-2026-017
sources:
  - invoice:sale-17
updated: 2026-10-25
number: F-2026-017
party: tiers/sci-clos-des-vignes
issue_date: 2026-03-11
due_date: 2026-04-10
ht: "57654.00"
tva: "11530.80"
ttc: "69184.80"
chantier: chantiers/2026-extension-clos-des-vignes
paid_at: 2026-04-07
links:
  - kind: belongs_to
    to: chantiers/2026-extension-clos-des-vignes
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: fulfils
    to: finances/2026/2026-02-12_devis_sci-clos-des-vignes_d-2026-017
    confidence: strong
    evidence: Même client, 57 654,00 € HT facturés pour 57 654,00 € HT au devis accepté, à moins de 30 jours
    rule: quote_match
  - kind: issued_to
    to: tiers/sci-clos-des-vignes
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
---

Facture de réfection de la toiture côté cour pour SCI Clos des Vignes.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]]
- Exécute [[finances/2026/2026-02-12_devis_sci-clos-des-vignes_d-2026-017]]
- Adressé à [[tiers/sci-clos-des-vignes]]
