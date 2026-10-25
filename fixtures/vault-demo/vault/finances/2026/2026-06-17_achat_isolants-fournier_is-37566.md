---
type: facture_achat
title: Facture IS-37566 Isolants Fournier
sources:
  - invoice:purchase-38
updated: 2026-10-25
number: IS-37566
party: tiers/isolants-fournier
issue_date: 2026-06-17
due_date: 2026-08-01
ht: "765.90"
tva: "153.18"
ttc: "919.08"
project_ref: CH-2026-03
lines:
  - label: Laine de verre 100 mm
    quantity: 111
    unit_price: "6.90"
    amount: "765.90"
    code: ISO-1017
links:
  - kind: belongs_to
    to: chantiers/2026-renovation-le-parc-batiment-b
    confidence: exact
    evidence: Référence chantier « CH-2026-03 » (BT-11)
    rule: project_ref
  - kind: fulfils
    to: finances/2026/2026-05-28_commande_isolants-fournier_bc-2026-008
    confidence: strong
    evidence: Même fournisseur, 765,90 € HT facturés pour 765,90 € HT commandés, à moins de 30 jours
    rule: order_match
  - kind: issued_by
    to: tiers/isolants-fournier
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/laine-de-verre-100-mm
    confidence: strong
    evidence: Code article « ISO-1017 » de la ligne « Laine de verre 100 mm »
    rule: line_code
---

111 m² de Laine de verre 100 mm.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Exécute [[finances/2026/2026-05-28_commande_isolants-fournier_bc-2026-008]]
- Émis par [[tiers/isolants-fournier]]
- Utilise [[catalogue/laine-de-verre-100-mm]]
