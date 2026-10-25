---
type: facture_achat
title: Facture PL-46873 Plâtres Lambert
sources:
  - invoice:purchase-32
updated: 2026-10-25
number: PL-46873
party: tiers/platres-lambert
issue_date: 2026-05-24
due_date: 2026-07-08
ht: "18.60"
tva: "3.72"
ttc: "22.32"
project_ref: CH-2026-02
lines:
  - label: Rail métallique R48
    quantity: 6
    unit_price: "3.10"
    amount: "18.60"
links:
  - kind: belongs_to
    to: chantiers/2026-extension-clos-des-vignes
    confidence: exact
    evidence: Référence chantier « CH-2026-02 » (BT-11)
    rule: project_ref
  - kind: fulfils
    to: finances/2026/2026-05-09_commande_platres-lambert_bc-2026-002
    confidence: strong
    evidence: Même fournisseur, 18,60 € HT facturés pour 18,60 € HT commandés, à moins de 30 jours
    rule: order_match
  - kind: issued_by
    to: tiers/platres-lambert
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/rail-metallique-r48
    confidence: strong
    evidence: Ligne « Rail métallique R48 »
    rule: line_name
---

6 ml de Rail métallique R48.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-extension-clos-des-vignes]]
- Exécute [[finances/2026/2026-05-09_commande_platres-lambert_bc-2026-002]]
- Émis par [[tiers/platres-lambert]]
- Utilise [[catalogue/rail-metallique-r48]]
