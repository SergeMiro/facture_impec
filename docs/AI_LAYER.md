# Couche IA "douce"

> Rôle : détecter ce qui passe la validation dure mais "sent" l'erreur. JAMAIS bloquant.

## Principes
- Sortie strictement structurée (JSON validé contre un schéma). Ignorer toute sortie non conforme.
- Le LLM ne produit JAMAIS d'erreur dure → uniquement des `SoftWarning` (jaune).
- Mode "IA désactivée" disponible.
- RGPD : hébergement LLM en UE configurable (Mistral) ; signaler l'envoi de données au LLM ; minimiser les données ; journaliser le minimum.

## Entrée / sortie
- Entrée : un `Invoice` déjà valide formellement (JSON).
- Sortie : liste d'`Issue` de sévérité `SoftWarning`, chacune avec `code`, `field`, `message_fr`.

## Schéma de sortie (exemple)
```json
{
  "warnings": [
    { "code": "AI-VAT-RATE", "field": "lines[2].vat_rate",
      "message_fr": "Le taux de TVA (20 %) semble inhabituel pour une prestation de formation (souvent exonérée)." }
  ]
}
```

## Garde-fous de prompt
- Instruction stricte : "Réponds UNIQUEMENT en JSON conforme au schéma, sans préambule."
- Valider la réponse ; en cas d'échec de parsing → ignorer (pas de warning fabriqué).
- Ne jamais reformuler une règle dure en warning IA (éviter les doublons avec la couche déterministe).

## Signaux à détecter (liste vivante)
TVA atypique, raison sociale ↔ SIRET, montants ronds suspects, logique de dates,
devise inattendue, écart description ↔ prix.

---

## Implémentation Phase 4 — deux couches complémentaires

### 1. Heuristiques déterministes (locales, `facture-core/src/validation/soft.rs`)
Exécutées **dans le WASM du navigateur** → aucune donnée ne sort (RGPD-idéal), instantané, actif même
« IA LLM désactivée ». Produisent des `SoftWarning` (jaune) :

| Code | Détection |
|------|-----------|
| `AI-DATE-LOGIC` | date d'échéance antérieure à la date d'émission |
| `AI-CURRENCY` | devise étrangère bien formée (≠ EUR) |
| `AI-VAT-RATE` | taux de TVA hors des taux FR usuels (0 / 2,1 / 5,5 / 10 / 20 %) |
| `AI-ROUND-AMOUNT` | ligne forfaitaire (quantité 1) à un prix multiple exact de 1000 |

### 2. Couche LLM (backend, `facture-backend/src/ai/`)
Trait **`AiChecker`** → `MistralChecker` (Mistral, **EU**) ou `DisabledChecker` (défaut).
Route **`POST /api/ai-check`** → `{ "enabled": bool, "warnings": [Issue soft] }`.

Garde-fous appliqués (`MistralChecker::parse_warnings`, testé) :
- réponse **strictement JSON** (`response_format: json_object`), sinon **ignorée** (aucun warning fabriqué) ;
- tout code non `AI-*` est normalisé en `AI-LLM` ; sévérité **forcée** à `SoftWarning` (jamais bloquant) ;
- **RGPD** : on n'envoie qu'une version **minimisée** (pas d'adresse ni d'IBAN), hébergement EU, `temperature` basse.

Config (env) : `MISTRAL_API_KEY`, `MISTRAL_MODEL` (défaut `mistral-small-latest`), `AI_ENABLED` (`false` pour couper).

### Intégration UI
Les avertissements jaunes des deux couches sont fusionnés dans le même `ValidationReport`
(`is_sendable` reste vrai — ils ne bloquent pas) et listés dans la modale. Côté démo, « Valider »
appelle `/api/ai-check` (relayé au backend si `BACKEND_URL` est défini sur Vercel) et fusionne les
avertissements LLM avec les heuristiques locales (dédup par code + champ).
