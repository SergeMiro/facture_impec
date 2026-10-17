# Catalogue des règles de validation

> À compléter par l'agent à partir des sources officielles. NE PAS inventer les règles.

## Source de vérité
- Règles **EN 16931** : récupérer la liste officielle des Business Rules (BR-*) depuis le schématron EN 16931.
- Encoder chaque règle avec son code exact (ex. `BR-CO-10`) pour la traçabilité.

> **Source utilisée (Phase 0, 2026-06-30)** : liste publique des règles EN 16931 telle qu'implémentée
> par Peppol BIS Billing 3.0 (`https://docs.peppol.eu/poacc/billing/3.0/rules/`), qui reprend le
> schématron EN 16931. **À recouper avec le schématron officiel** (référentiel `ConnectingEurope/eInvoicing-EN16931`)
> avant la prod. La colonne **Phase 1** indique ce qui est implémenté dans `facture-core` à ce stade.

## Couche dure (déterministe) — bloquante (rouge)

### EN 16931 — présence / contenu (BR-01..16)
| Code | Description | Champ (BT/BG) | Phase 1 |
|------|-------------|---------------|:------:|
| BR-01 | Identifiant de spécification (profil) présent | BT-24 | ⏭️ (posé par la PA, hors saisie Excel) |
| BR-02 | Numéro de facture présent | BT-1 | ✅ |
| BR-03 | Date d'émission présente | BT-2 | ✅ |
| BR-04 | Code type de facture présent | BT-3 | ✅ |
| BR-05 | Code devise présent | BT-5 | ✅ |
| BR-06 | Nom du vendeur présent | BT-27 | ✅ |
| BR-07 | Nom de l'acheteur présent | BT-44 | ✅ |
| BR-08 | Adresse postale du vendeur présente | BG-5 | ✅ |
| BR-09 | Code pays du vendeur présent | BT-40 | ✅ |
| BR-10 | Adresse postale de l'acheteur présente | BG-8 | ✅ |
| BR-11 | Code pays de l'acheteur présent | BT-55 | ✅ |
| BR-12 | Somme des montants nets de ligne présente | BT-106 | ✅ |
| BR-13 | Total HT présent | BT-109 | ✅ |
| BR-14 | Total TTC présent | BT-112 | ✅ |
| BR-15 | Net à payer présent | BT-115 | ✅ |
| BR-16 | Au moins une ligne de facture | BG-25 | ✅ |

### EN 16931 — calcul / cohérence (BR-CO-*)
| Code | Description | Phase 1 |
|------|-------------|:------:|
| BR-CO-10 | Σ montants nets de ligne (BT-131) = BT-106 | ✅ |
| BR-CO-13 | BT-109 = Σ lignes − remises + charges (MVP : sans remise/charge ⇒ = BT-106) | ✅ |
| BR-CO-14 | BT-110 (total TVA) = Σ BT-117 (TVA par catégorie) | ✅ |
| BR-CO-15 | BT-112 = BT-109 + BT-110 | ✅ |
| BR-CO-16 | BT-115 = BT-112 − BT-113 (payé) + BT-114 (arrondi) | ✅ |
| BR-CO-17 | BT-117 = BT-116 (base) × (BT-119/100), arrondi 2 décimales | ✅ |

### EN 16931 — catégories de TVA (extrait implémenté)
| Code | Description | Phase 1 |
|------|-------------|:------:|
| BR-S-05 | Taux TVA standard (S) > 0 | ✅ |
| BR-Z-05 | Taux TVA taux-zéro (Z) = 0 | ✅ |
| BR-E-05 | Taux TVA exonéré (E) = 0 | ✅ |
| BR-E-10 | Ventilation exonérée (E) : motif d'exonération requis (code/texte) | ✅ |
| BR-AE-05 | Taux TVA autoliquidation (AE) = 0 | ✅ |
| BR-AE-10 | Ventilation autoliquidation (AE) : motif requis | ✅ |
| BR-S-*/Z-*/E-*/AE-* (02..04, 08, 09…) | Reste des règles par catégorie | ⏭️ Phases ultérieures |

### EN 16931 — décimales (BR-DEC-*)
| Code | Description | Phase 1 |
|------|-------------|:------:|
| BR-DEC-* | Montants documentaires / TVA / ligne : **max 2 décimales** | ✅ (check générique par champ ; n° de règle exact par BT à confirmer au schématron) |

> ⚠️ Le schématron détaille BR-DEC-01..28 (un code par champ monétaire). Phase 1 applique un
> contrôle "≤ 2 décimales" sur les champs clés et émet le code `BR-DEC` + le champ visé ; le mapping
> exact BT → BR-DEC-NN reste à figer depuis le schématron officiel.

### Règles françaises
| Code | Description | Algorithme | Phase 1 |
|------|-------------|-----------|:------:|
| FR-SIREN-LUHN | SIREN = 9 chiffres, clé de Luhn | Luhn | ✅ |
| FR-SIRET-LUHN | SIRET = 14 chiffres, clé de Luhn | Luhn | ✅ |
| FR-TVA-KEY | TVA intracom FR : clé = (12 + 3·(SIREN mod 97)) mod 97 | modulo 97 | ✅ |
| FR-IBAN | IBAN valide (longueur par pays + clé) | mod-97 ISO 13616 | ✅ |
| FR-MENTIONS-ID | Identifiant légal vendeur (SIREN/SIRET) présent | présence | ✅ |

### Contrôles de calcul propres au produit (préfixe `FF-`, honnêtes vs codes officiels)
| Code | Description | Sévérité |
|------|-------------|----------|
| FF-LINE-CALC | Montant de ligne (BT-131) ≠ quantité × prix unitaire | dure (rouge) |
| FF-DATE-FORMAT | Date non parsable (format attendu `AAAA-MM-JJ`) | dure (rouge) |
| FF-CURRENCY-FORMAT | Code devise ≠ 3 lettres ISO 4217 | dure (rouge) |

## Couche douce (IA) — non bloquante (jaune)
| Code | Description |
|------|-------------|
| AI-VAT-RATE | Taux de TVA atypique pour la nature du bien/service |
| AI-NAME-MISMATCH | SIRET valide mais raison sociale incohérente |
| AI-ROUND-AMOUNT | Montants ronds inhabituels |
| AI-DATE-LOGIC | Date d'échéance < date d'émission |
| AI-CURRENCY | Devise étrangère inattendue |

## Profils supportés
- Démarrer : **Basic WL**.
- Cible : **EN 16931**.
- ⚠️ Couvrir TOUS les champs du profil visé (piège des "15 champs" insuffisants).
