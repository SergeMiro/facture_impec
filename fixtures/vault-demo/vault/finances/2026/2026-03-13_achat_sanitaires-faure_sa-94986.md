---
type: facture_achat
title: Facture SA-94986 Sanitaires Faure
sources:
  - invoice:purchase-14
  - raw/2026/03/facture-sa-94986.eml
updated: 2026-10-25
number: SA-94986
party: tiers/sanitaires-faure
issue_date: 2026-03-13
due_date: 2026-04-27
ht: "136.80"
tva: "27.36"
ttc: "164.16"
lines:
  - label: Tube PER 16
    quantity: 114
    unit_price: "1.20"
    amount: "136.80"
    code: SAN-1013
links:
  - kind: belongs_to
    to: chantiers/2026-cabinet-medical-des-lilas
    confidence: inferred
    evidence: "« code du portail du chantier Cabinet médical des Lilas : 4512. »"
    rule: text_chantier
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

114 ml de Tube PER 16. Livraison au dépôt ; code du portail du chantier Cabinet médical des Lilas : 4512.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-cabinet-medical-des-lilas]] (à confirmer : « code du portail du chantier Cabinet médical des Lilas : 4512. »)
- Émis par [[tiers/sanitaires-faure]]
- Utilise [[catalogue/tube-per-16]]
