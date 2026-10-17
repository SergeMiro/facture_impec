# Feuille de route

Détail complet : `AGENT_PLAN.md` §11. Synthèse des phases :

- **Phase 0 — Bootstrap** : monorepo, Cargo workspace, CI, récupération specs (B2Brouter llms.txt, schématron EN 16931).
- **Phase 1 — Cœur Rust** : modèle `Invoice`, règles formats FR (Luhn, clé TVA, IBAN), montants (BR-CO-10/13), sous-ensemble EN 16931, messages FR, tests.
- **Phase 2 — WASM + add-in Excel** : `facture-wasm`, manifeste Office, task pane React, `excelBridge`, modèle `.xlsx`, flux Valider→surlignage→modale, i18n FR.
- **Phase 3 — Backend + PDP (sandbox)** : Axum, `PdpProvider` + `b2brouter.rs`, mapping, premier envoi staging de bout en bout, bouton Envoyer + suivi statut, revalidation serveur.
- **Phase 4 — Couche IA douce** : route `ai-check`, LLM EU configurable, schéma + garde-fous, warnings jaunes.
- **Phase 5 — Import OCR/PDF** : route `import`, PDF-texte → LLM → Invoice → validation ; phase 2 OCR images.
- **Phase 6 — Durcissement & sortie** : Word (extraction ou hors périmètre), gestion erreurs/retries/idempotence, RGPD, sécurité/secrets/auth, multi-tenant reseller, pricing PDP, doc utilisateur FR, packaging AppSource / déploiement M365.

## Échéances réglementaires
- **1er sept. 2026** : réception obligatoire (toutes entreprises).
- **1er sept. 2027** : émission obligatoire TPE/PME → cible principale du MVP.

## Definition of Done (MVP) — voir `AGENT_PLAN.md` §13.
