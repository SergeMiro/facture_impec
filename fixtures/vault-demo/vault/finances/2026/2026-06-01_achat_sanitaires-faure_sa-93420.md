---
type: facture_achat
title: Facture SA-93420 Sanitaires Faure
sources:
  - invoice:purchase-34
updated: 2026-10-25
number: SA-93420
party: tiers/sanitaires-faure
issue_date: 2026-06-01
due_date: 2026-07-16
ht: "106.80"
tva: "21.36"
ttc: "128.16"
project_ref: CH-2026-04
lines:
  - label: Tube PER 16
    quantity: 89
    unit_price: "1.20"
    amount: "106.80"
    code: SAN-1013
links:
  - kind: belongs_to
    to: chantiers/2026-cabinet-medical-des-lilas
    confidence: exact
    evidence: Référence chantier « CH-2026-04 » (BT-11)
    rule: project_ref
  - kind: fulfils
    to: finances/2026/2026-05-24_commande_sanitaires-faure_bc-2026-004
    confidence: strong
    evidence: Même fournisseur, 106,80 € HT facturés pour 106,80 € HT commandés, à moins de 30 jours
    rule: order_match
  - kind: issued_by
    to: tiers/sanitaires-faure
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/tube-per-16
    confidence: strong
    evidence: Code article « SAN-1013 » de la ligne « Tube PER 16 »
    rule: line_code
---

89 ml de Tube PER 16.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-cabinet-medical-des-lilas]]
- Exécute [[finances/2026/2026-05-24_commande_sanitaires-faure_bc-2026-004]]
- Émis par [[tiers/sanitaires-faure]]
- Utilise [[catalogue/tube-per-16]]
