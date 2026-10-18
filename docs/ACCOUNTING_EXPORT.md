# Accountant export (M6)

« Exporter vers le comptable » on the Réception screen (plan §3 screen 5) turns the supplier invoices
marked « Bon pour paiement » and not exported yet into two files. Code: `packages/core/src/export.ts`
(`buildFec`, `buildCsv`), called by `POST /inbound/export` (`apps/api/src/inbound.ts`).

- **`SirenFECAAAAMMJJ.txt`**: a purchase journal in the layout of the FEC, the « fichier des écritures
  comptables » of article A47 A-1 of the Livre des procédures fiscales. It is **a file to import into the
  company's accounting software, not its legal FEC**: the legal FEC holds every journal of a closed year,
  and only that software can produce it.
- **`factures-fournisseurs-AAAA-MM-JJ.csv`**: one line per invoice, for a spreadsheet.

Test invoices (Mode test) are exported only from Mode test, in their own sequence, and their files start
with `TEST-`.

## Sources (read 2026-10-18)

- Article A47 A-1 LPF (arrêté du 29 juillet 2013), in the LPF compiled by codes.droit.org from Légifrance,
  edition 2026-10-01: <https://codes.droit.org/PDF/Livre%20des%20proc%C3%A9dures%20fiscales.pdf>, p. 250–254.
- BOFiP BOI-CF-IOR-60-40-20-20131213 (the administration's reading of the format), §§ 70 and 210:
  <https://bofip.impots.gouv.fr/bofip/9028-PGP.html/identifiant=BOI-CF-IOR-60-40-20-20131213>.

What the export relies on, quoted:

- **VI 1°**: « Fichiers à plat, à organisation séquentielle et structure zonée […] a. Les enregistrements sont
  séparés par le caractère de contrôle Retour chariot et/ ou Fin de ligne ; b. La longueur des enregistrements
  peut être fixe ou variable ; c. Les zones sont obligatoirement séparées par une tabulation ou le caractère
  " | " ».
- **VII 1°**: the file's records are « classées par ordre chronologique de validation » and « les dix-huit
  premières informations [doivent] obligatoirement correspondre, dans l'ordre, à celles listées dans le
  tableau » : JournalCode, JournalLib, EcritureNum (« Le numéro sur une séquence continue de l'écriture
  comptable »), EcritureDate, CompteNum (« dont les trois premiers caractères doivent correspondre à des
  chiffres respectant les normes du plan comptable français »), CompteLib, CompAuxNum, CompAuxLib, PieceRef,
  PieceDate, EcritureLib, Debit, Credit, EcritureLet, DateLet, ValidDate, Montantdevise, Idevise. The
  auxiliary account, lettering and currency fields are « à blanc si non utilisé ».
- **VII 4°**: « Pour les fichiers à plat, la première ligne du fichier comporte le nom des champs ».
- **IX**: « SirenFECAAAAMMJJ, où " Siren " est le Siren du contribuable […] et AAAAMMJJ la date de clôture de
  l'exercice comptable ».
- **XII**: « 1° Les caractères utilisés appartiennent à l'un des jeux de caractères ASCII, norme ISO 8859-15 ou
  jeu de caractères unicode, norme ISO/ CEI 10646, de type UTF-8 ; 2° […] La virgule sépare la fraction
  entière de la partie décimale. Aucun séparateur de millier n'est accepté. Les valeurs numériques peuvent
  être signées. […] 4° Les dates sont exprimées au format AAAAMMJJ sans séparateur. »
- BOFiP § 70: an unused field stays empty; § 210: Debit and Credit both hold a number, the unused one zero.

## Choices

| Point | Choice | Why |
|---|---|---|
| Separator, line end, charset | Tab, CRLF, UTF-8 without BOM | VI 1° c, VI 1° a, XII 1° |
| Journal | `ACH`, « Achats » | The usual purchase journal code; the file holds supplier invoices only |
| Accounts | Charge `606000` « Achats non stockés de matières et fournitures », deductible VAT `445660` « TVA déductible sur autres biens et services », supplier `401000` « Fournisseurs » with the supplier as auxiliary account (`F` + SIREN, else VAT number, else name) | Plan comptable général; one charge account for every supplier is the smallest version. The accountant re-assigns charges in their software (per-supplier accounts: `docs/DEFERRED.md`) |
| One entry per invoice | One debit line per VAT rate for the charge, one per rate for the VAT, one credit line for the supplier (the total including VAT); a credit note swaps the sides | Each entry balances; lines with a zero amount are left out |
| EcritureNum | Continues from the previous export of the company (test exports have their own sequence), starting at 1 | VII 1°: a continuous sequence |
| EcritureDate, PieceDate | The invoice's issue date | The date of the document booked |
| ValidDate | The export day | The day the user handed the entries over |
| File name | `SirenFECAAAAMMJJ` with the buyer's SIREN and the export day (`TEST-` prefix in Mode test) | IX's pattern; an extract has no closing date, so the export day stands in |
| What stays out of the FEC | Invoices not in euros (the export has no exchange rate) and invoices whose VAT lines do not add up to the total (the entry would not balance); they stay in the CSV, and the pane says how many | An entry the software would refuse, or a wrong amount in euros, is worse than none |
| Text fields | Tabs, line breaks and `|` in supplier names become a space | A field never holds a separator |
| CSV | `;`, UTF-8 with BOM, CRLF, decimal comma, dates JJ/MM/AAAA, credit notes negative; text starting with `=`, `+`, `-`, `@` gets a leading apostrophe | What French Excel opens with accents and numbers right; the names come from suppliers' files, so no formula may run |

## Checks

- `pnpm verify`: `packages/core/test/export-check.ts` (`checkFec`, `checkFecName`, `readCsv`) checks every rule
  above that a flat file can break; `export.test.ts` and `apps/api/src/inbound.test.ts` run it on the files
  the export writes.
- `pnpm accounting:check [file]` (§ Paheko): the import into real accounting software.

## Paheko

[Paheko](https://paheko.cloud) is free accounting software made in France, with a FEC import. The check
runs the pinned image `paheko/paheko:1.3.23-8.5.10-apache-trixie` (published 2026-09-11) without network:
`bin/paheko init` creates an organisation, then `scripts/accounting/paheko-import.php` does what the screen
« Comptabilité → Exercices → Importer » does (`www/admin/acc/years/import.php` in the image): a financial
year on « Plan comptable général, pour entreprises (révision 2025) », format « FEC », the columns matched
from the header as the screen pre-selects them, « Créer toutes les écritures », « Créer les comptes qui
n'existent pas dans le plan comptable », the dry run the screen shows, then the import. The script then
compares the books with the file read independently: number of entries, total debit and credit, the
balance of each account, no unbalanced entry.

By hand in Paheko: same screen, type « FEC », tick « Créer toutes les écritures » and « Créer les comptes
qui n'existent pas dans le plan comptable ». `DateLet` is left as « Ne pas importer » (Paheko cannot import
lettering), so are the fields it has no column for.

Results (2026-10-18):

- The FEC built from the 25 golden invoices read as received ones: 24 entries (the USD invoice
  F2026-0053 stays in the CSV), 78 lines, 59 723,23 € on each side; Paheko's preview creates 24 entries
  and modifies none, creates accounts 606000, 445660 and 401000; balances 606000 = 54 290,28 € debit,
  445660 = 4 352,95 € debit, 401000 = 58 643,23 € credit, as in the file.
- The test export downloaded from the pane in the E2E run (`TEST-100000009FEC20261018.txt`, 2 entries,
  6 lines, 284,16 €): imported the same way, no error.
- A copy with one amount changed: refused, « Erreur sur la ligne 4 : Écriture non équilibrée :
  déséquilibre (-886,49) entre débits et crédits », exit code 1.
