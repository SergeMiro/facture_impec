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

## Article [Y] — Lecture de vos fichiers Google Drive (R5, draft of 2026-10-23)

Same promise as Article [X], written from `docs/GOOGLE.md` and `docs/RGPD.md` › Google Drive
connection. Where it says nothing, Article [X] applies with « Google » for « Microsoft ».

**[Y].1 Un service facultatif.** Facture Impec peut aussi lire des fichiers que vous gardez dans
Google Drive. Ce service n'est activé que si vous choisissez « Connecter Google Drive » dans l'onglet
« Registre », vous connectez dans la fenêtre de Google et y choisissez vos fichiers. Il est disponible
[dans toutes les formules / à partir de la formule Croissance].

**[Y].2 Ce que nous lisons.** Uniquement les fichiers que vous choisissez dans la fenêtre de Google
(feuilles Google Sheets, classeurs .xlsx et .xlsm, fichiers .csv ; vingt fichiers au plus, dix
mégaoctets chacun), et dans chacun uniquement les feuilles que vous confirmez. L'autorisation demandée
à Google (« drive.file ») ne donne accès qu'à ces fichiers : nous ne pouvons ni parcourir votre Drive
ni y chercher. Une feuille Google Sheets est lue au format Excel. Nous n'écrivons, ne déplaçons, ne
partageons et ne supprimons jamais un fichier.

**[Y].3 Quand nous lisons.** Un fichier n'est relu que si sa version a changé. Google nous signale
un changement en quelques minutes (ce signal ne contient aucune donnée de vos fichiers) et nous
vérifions en outre chaque heure.

**[Y].4 Arrêter.** « Retirer le fichier » cesse la lecture d'un fichier et supprime les documents
qu'il a donnés. « Déconnecter Google Drive » met fin au service : nous arrêtons les signaux de Google,
retirons chez Google l'autorisation donnée à Facture Impec et supprimons le jeton d'accès, la liste
des fichiers et les documents qui en ont été lus. Vous n'avez rien à retirer
vous-même dans votre compte Google. La suppression de votre compte Facture Impec entraîne les mêmes
suppressions.

**[Y].5 Google.** Vos fichiers restent chez Google, sous le contrat qui vous lie à Google. Si Google
refuse ou retire l'accès, la lecture s'arrête, les documents déjà lus restent et le complément vous
propose de vous reconnecter. Un administrateur Google Workspace peut interdire l'application à ses
utilisateurs.

## Article [Z] — Fichiers que vous importez (R6, draft of 2026-10-23)

Written from `docs/RGPD.md` › Files uploaded from the pane and `docs/ARCHITECTURE.md` › What R6 added.

**[Z].1 Ce que vous pouvez importer.** Depuis l'onglet « Registre », « Importer un fichier » accepte
un classeur Excel (.xlsx, .xlsm) ou un fichier CSV, et une facture de fournisseur au format Factur-X
(PDF), UBL ou CII (XML), dix mégaoctets au plus. Une facture seulement imprimée en PDF n'est pas lue
[à ce jour].

**[Z].2 Ce que nous en faisons.** Un classeur est conservé pour lire les feuilles que vous confirmez,
comme un fichier OneDrive ou Google Drive. Une facture de fournisseur est lue pour en tirer vos prix
d'achat, que les contrôles comparent à vos prix de vente ; elle n'est ni payée, ni transmise, ni
ajoutée à l'export pour votre comptable. Une facture qui vous est aussi parvenue par votre plateforme
n'est comptée qu'une fois.

**[Z].3 Conservation et suppression.** Un fichier importé est conservé jusqu'à ce que vous le retiriez
(« Retirer le fichier ») ou supprimiez votre compte ; il est alors supprimé avec les documents qu'il a
donnés. Importer un fichier du même nom le remplace.

---

Also needed elsewhere in the CGU, from `docs/RGPD.md` (owner decisions): the person who accepts the CGU
declares they may engage the company (decision 6); the subprocessors, Microsoft and Google included
for the companies that connect them.
