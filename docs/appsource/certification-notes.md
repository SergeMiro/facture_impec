# Notes for certification (Partner Center)

Source of the « Notes for certification » box (docs/APPSOURCE.md §5). `pnpm appsource:package` drops this
header, fills `{ADDIN_URL}`, `{SUPPORT_URL}` and `{SAMPLE}`, and writes `dist/appsource/certification-notes.txt`.
`{REVIEW_ACCESS_KEY}` is replaced by hand **in Partner Center only**: the key never goes into the repo, a
file in dist/ or a message. English: the reviewers work in several countries and time zones.

---

Facture Impec: notes for certification

WHAT IT IS
An Excel task-pane add-in for French small businesses that invoice in Excel. It checks the invoices of the active sheet, converts them to Factur-X and transmits them through a French certified e-invoicing platform, then follows them until they are paid. The interface is in French only.

ACCOUNTS (policy 1100.5)
The add-in depends on our own service account.
- Sign up: start screen, « Créer un compte pour mon entreprise ». It needs a French company number (SIREN) and an e-mail address; a link e-mailed to that address confirms the account.
- Sign in: a link e-mailed to the address (« Recevoir un lien de connexion »), or the company's access key (« Se connecter avec la clé »).
- Sign out: « Réglages » tab, « Se déconnecter ».

REVIEW ACCOUNT (no interaction with us needed)
Sign in with this access key. It belongs to a demonstration company prepared for the review: a pilot account, which never needs a purchase. It stays valid during the review.
Access key: {REVIEW_ACCESS_KEY}

STEPS (about 5 minutes)
1. Open a blank workbook in Excel (Windows, Mac or the web). Copy the SAMPLE below and paste it into cell A1: it is tab-separated, so Excel splits it into 12 columns.
2. Home tab, group « Facture Impec », click « Ouvrir ». The task pane opens on the sign-in screen.
3. Paste the access key into « Clé d'accès de l'entreprise » and click « Se connecter avec la clé ».
4. The pane proposes which column holds what (invoice number, date, customer…). Click « Confirmer les colonnes ».
5. Each invoice gets a status in two new columns (FI_Statut, FI_Détail). F2026-101 is ready to send. F2026-102 has a mistyped company number and F2026-103 has no date: open them from the « Factures » tab to read the explanation in plain French.
6. Click « Mode test » in the ribbon: the banner « Mode test : aucune facture n'est envoyée à une vraie plateforme. » appears. Open F2026-101 and click « Envoyer ». In Mode test nothing goes to a real platform; the status changes within a few seconds.
7. « Réglages » shows the company's settings and « Se déconnecter ».

PURCHASES
The add-in is free to install. After a 30-day trial, sending real invoices needs a paid subscription to our service; the listing says so, and « My product requires purchase of a service or offers additional in-app purchases » is ticked. The subscription is bought on Stripe's hosted payment page, only after the user clicks: in the browser on Excel for Windows and Mac (Office.context.ui.openBrowserWindow), in an Office dialog on Excel on the web. The review account is a pilot account and shows no purchase button. Where Office.context.commerceAllowed is false, no purchase button is shown.

PLATFORMS
Excel on Windows, Mac and the web. The manifest requires SharedRuntime 1.1, so Excel on iPad is not supported.

SAMPLE (paste into A1)
{SAMPLE}

Add-in: {ADDIN_URL}
Support: {SUPPORT_URL}
