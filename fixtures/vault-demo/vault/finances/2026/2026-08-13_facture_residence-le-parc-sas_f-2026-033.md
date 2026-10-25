---
type: facture_vente
title: Facture F-2026-033
sources:
  - invoice:sale-33
updated: 2026-10-25
number: F-2026-033
party: tiers/residence-le-parc-sas
issue_date: 2026-08-13
due_date: 2026-09-12
ht: "37225.30"
tva: "7445.06"
ttc: "44670.36"
chantier: chantiers/2026-renovation-le-parc-batiment-b
lines:
  - label: "Travaux : raccordement du tableau électrique"
    amount: "30622.00"
  - label: WC suspendu complet
    quantity: 18
    unit_price: "366.85"
    amount: "6603.30"
    article: catalogue/wc-suspendu-complet
links:
  - kind: belongs_to
    to: chantiers/2026-renovation-le-parc-batiment-b
    confidence: exact
    evidence: Chantier du document (champ « chantier »)
    rule: chantier
  - kind: issued_to
    to: tiers/residence-le-parc-sas
    confidence: exact
    evidence: Tiers du document (champ « party »)
    rule: party
  - kind: uses
    to: catalogue/tableau-electrique-3-rangees
    confidence: inferred
    evidence: "« Travaux : raccordement du tableau électrique »"
    rule: line_words
  - kind: uses
    to: catalogue/wc-suspendu-complet
    confidence: exact
    evidence: Ligne « WC suspendu complet »
    rule: line_article
---

Facture de raccordement du tableau électrique pour Résidence Le Parc SAS.

## Liens

Cette section est réécrite par Facture Impec à chaque mise à jour de la page.

- Fait partie de [[chantiers/2026-renovation-le-parc-batiment-b]]
- Adressé à [[tiers/residence-le-parc-sas]]
- Utilise [[catalogue/tableau-electrique-3-rangees]] (à confirmer : « Travaux : raccordement du tableau électrique »)
- Utilise [[catalogue/wc-suspendu-complet]]
