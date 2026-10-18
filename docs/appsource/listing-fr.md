# Fiche Microsoft Marketplace (fr-FR)

Source of the listing pasted into Partner Center (docs/APPSOURCE.md §2). `pnpm appsource:package` checks the
limits (name 50, summary 100, description 4 000 characters) and refuses while a ⟨…⟩ blank is left: the
prices are the owner's decision (Stripe prices, docs/BILLING.md §11). Plain text: Partner Center takes HTML
without a preview, so line breaks only.

## Nom
Facture Impec

## Résumé
Vérifiez, envoyez et suivez vos factures électroniques sans quitter Excel.

## Description
Vous facturez dans Excel ? Facture Impec ajoute un volet à votre classeur : il lit vos factures là où elles sont, les vérifie, les transmet en facture électronique par une plateforme agréée et suit leur paiement.

Ce que fait Facture Impec
• Reconnaît les colonnes de votre tableau (numéro, date, client, SIREN, montants…), sans changer votre façon de travailler.
• Vérifie chaque facture avant l'envoi et explique chaque problème en français simple : SIREN mal recopié, date manquante, mention obligatoire absente.
• Produit la facture au format Factur-X et la transmet par une plateforme agréée par l'administration fiscale, seulement quand vous cliquez sur « Envoyer ».
• Écrit le statut de chaque facture dans votre feuille : déposée, reçue, acceptée, refusée, encaissée.
• Prépare les relances de paiement, que vous relisez avant de les envoyer.
• Reçoit vos factures fournisseurs, signale un doublon ou un changement d'IBAN, et prépare l'export pour votre comptable (FEC).
• Le Mode test, visible en permanence, permet de tout essayer sans rien envoyer pour de vrai.

Compte et abonnement
Facture Impec demande un compte. Vous le créez depuis le volet avec le SIREN de votre entreprise : son nom et son adresse sont retrouvés dans l'annuaire public des entreprises.
L'essai dure 30 jours, sans carte bancaire : Mode test illimité et 10 factures envoyées pour de vrai.
Ensuite, un abonnement payant est nécessaire pour envoyer des factures (achat supplémentaire, réglé sur la page de paiement sécurisée de Stripe) :
• Essentiel : 30 factures envoyées par mois, ⟨prix mensuel Essentiel, en euros HT⟩ ; au-delà, ⟨prix par facture supplémentaire, en euros HT⟩.
• Croissance : 100 factures envoyées par mois, ⟨prix Croissance, en euros HT, et sa périodicité⟩.
Sans abonnement, vos factures, leur suivi et le Mode test restent accessibles.

Où l'utiliser
Excel pour Windows, Excel pour Mac et Excel sur le web (Microsoft 365). Facture Impec n'est pas disponible sur iPad.

This application is available in French.

## Mots-clés
facture électronique
Factur-X
facturation électronique
relance de paiement
TPE PME
