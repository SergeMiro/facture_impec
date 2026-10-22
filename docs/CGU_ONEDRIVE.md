# CGU_ONEDRIVE.md: draft of the CGU article on the OneDrive connector

**Draft of 2026-10-22, not legal advice.** The CGU are not written yet (`docs/APPSOURCE.md`); this is
the article the connector (R4) needs in them, written from what the code does (`docs/MICROSOFT365.md`,
`docs/RGPD.md` › OneDrive connection, Files read from OneDrive). A lawyer reviews it with the rest of
the CGU before it is published at `TERMS_URL`. Bracketed parts are the owner's to fill or decide
(`docs/TODO.md`). The add-in's wording lives in `packages/shared/i18n/fr.json`; this text must stay
true to it.

---

## Article [X] — Lecture de vos fichiers OneDrive et SharePoint

**[X].1 Un service facultatif.** Facture Impec peut lire, en plus du classeur Excel ouvert, des
fichiers que vous gardez dans OneDrive ou SharePoint, pour les comparer à vos factures même lorsque
Excel est fermé. Ce service n'est activé que si vous choisissez « Connecter OneDrive » dans l'onglet
« Registre » et acceptez la demande d'autorisation affichée par Microsoft. Il est disponible
[dans toutes les formules / à partir de la formule Croissance]. En le connectant, vous déclarez être
autorisé à donner accès à ces fichiers pour le compte de votre entreprise.

**[X].2 Ce que nous lisons.** Nous lisons uniquement les fichiers que vous choisissez dans la fenêtre
de sélection de Microsoft (classeurs .xlsx et .xlsm, fichiers .csv ; vingt fichiers au plus, dix
mégaoctets chacun), et dans chacun uniquement les feuilles que vous confirmez par « Inclure cette
feuille ». L'autorisation demandée à Microsoft (« Files.Read ») permet techniquement de lire les
fichiers de votre compte : nous ne l'utilisons que pour les fichiers que vous avez choisis, jamais pour
parcourir un dossier ni faire une recherche. Nous n'écrivons, ne déplaçons, ne partageons et ne
supprimons jamais un fichier.

**[X].3 Ce que nous conservons.** Le contenu des feuilles incluses est enregistré dans votre registre
de documents (commandes, bons de livraison, achats, tarifs), comme celui des feuilles de votre
classeur ; le fichier lui-même n'est pas conservé. Nous conservons aussi le nom et les identifiants de
chaque fichier, l'adresse ou le nom de votre compte Microsoft tels que Microsoft les transmet, et un
jeton d'accès chiffré, qui ne quitte jamais nos serveurs et ne vous est jamais renvoyé.

**[X].4 Quand nous lisons.** Un fichier n'est relu que si son contenu a changé. Pour un compte
OneDrive personnel, Microsoft nous signale un changement en quelques minutes (ce signal ne contient
aucune donnée de vos fichiers) et nous vérifions en outre chaque heure. Pour un compte professionnel ou
scolaire, nous vérifions toutes les deux minutes.

**[X].5 Ce que nous en faisons.** Les documents lus servent uniquement aux contrôles affichés dans
l'onglet « Contrôles » : montants non facturés, écarts de prix ou de quantités, ventes à perte. Rien
n'est facturé ni envoyé à une plateforme à partir de ces fichiers. Avant tout recours à une
intelligence artificielle, les noms, numéros SIREN, SIRET et TVA, IBAN, adresses, e-mails et
téléphones sont remplacés par des jetons anonymes, comme pour votre classeur.

**[X].6 Arrêter.** « Retirer le fichier » cesse la lecture d'un fichier ; « Déconnecter OneDrive » met
fin au service. Dans les deux cas nous supprimons aussitôt, pour ce qui est concerné, le jeton d'accès,
l'abonnement aux signaux de Microsoft, la liste des fichiers et tous les documents qui en ont été lus ;
les contrôles qui reposaient sur eux sont levés. Vos factures ne sont pas touchées. L'autorisation
donnée à Microsoft reste dans votre compte Microsoft jusqu'à ce que vous la retiriez : pour un compte
personnel, sur la page « Applications et services auxquels vous avez donné accès » de votre compte
Microsoft (account.live.com/consent/Manage) ; pour un compte professionnel, auprès de votre
administrateur. La suppression de votre compte Facture Impec entraîne les mêmes suppressions.

**[X].7 Microsoft.** Vos fichiers restent chez Microsoft, sous le contrat qui vous lie à Microsoft.
Nous ne répondons pas de la disponibilité de ses services. Si Microsoft refuse ou retire l'accès (mot
de passe changé, autorisation retirée, politique de votre entreprise), la lecture s'arrête, les
documents déjà lus restent dans votre registre et le complément vous propose de vous reconnecter. Une
entreprise peut exiger que son administrateur approuve l'application avant que ses salariés puissent la
connecter.

**[X].8 Suggestion de connexion.** Si votre classeur est enregistré dans OneDrive ou SharePoint, ou si
votre messagerie professionnelle est hébergée par Microsoft, le complément peut vous proposer une fois
cette connexion. Pour le savoir, seul le nom de domaine de votre adresse e-mail (jamais l'adresse) est
interrogé dans le DNS public. Le complément ne se connecte jamais de lui-même.

---

Also needed elsewhere in the CGU, from `docs/RGPD.md` (owner decisions): the person who accepts the CGU
declares they may engage the company (decision 6); the subprocessors, Microsoft included for the
companies that connect it.
