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
