# Building-trade rules for the BTP back end (BTP_RULES)

What the BTP rules of `@fi/core` (`packages/core/src/rules/btp.ts`) rest on. Checked on
**2026-10-24**. Nothing in this file is legal advice.

How to read it, as in `docs/research/FR_RULES.md`: **verified** = read in the official text or a
normative standard on that day; **inferred** = a third party or our own deduction, labelled.
**browser: none.** Légifrance answered HTTP 403 (Cloudflare challenge) to WebFetch and curl, as on
2026-10-17; its articles below are cited from the sources named.

## Sous-traitance: reverse charge (autoliquidation)

- **Rule.** Construction works a sous-traitant performs for an entreprise principale that is
  liable to VAT: the VAT is paid by the entreprise principale, the sous-traitant invoices without VAT
  (CGI art. 283, 2 nonies; BOI-TVA-DECLA-10-10-20,
  https://bofip.impots.gouv.fr/bofip/3218-PGP.html/identifiant=BOI-TVA-DECLA-10-10-20-20200311).
  The invoice carries the mention « Autoliquidation » (CGI annexe II art. 242 nonies A, I-13°).
  **verified** (BOFiP, read 2026-10-24 for docs/DECISIONS.md D4).
- **In the XML.** XP Z12-014 annexe A V1.2 (2025-10-31, FNFE-MPE,
  https://fnfe-mpe.org/wp-content/uploads/2025/11/XP_Z12-014_CAS_USAGE_Annexe_A_V1.2.pdf), §3.2.12.2
  p. 61, normative: « le sous-traitant doit utiliser le code VATEX « VATEX-FR-AE » en BT-121 … ainsi
  que la mention AUTOLIQUIDATION DE TVA en BT-120 »; its example: total VAT (BT-110) 0, category AE.
  The entreprise principale's own invoice to the maître d'ouvrage carries the whole VAT, sous-traitant's
  share included. **verified.**
- **Already in `@fi/core`:** FF-TVA-02 (a category AE without the VATEX code or the word
  « Autoliquidation »). What only the company knows, and the BTP rules add: the other party is its
  sous-traitant or its donneur d'ordre, so the invoice must be under AE with no VAT.
- **Limits** (inferred): the reverse charge covers *travaux de construction* only; a sous-traitant
  that only sells materials invoices with VAT. The company marks the relationship, not each invoice;
  the rule's message says to ignore it for a supply of goods only.

## Retenue de garantie

- **Ceiling.** Loi n° 71-584 du 16 juillet 1971, art. 1: payments on account of private works
  contracts « peuvent être amputés d'une retenue égale au plus à 5 % de leur montant », guaranteeing
  the works and the reserves made at the réception. **inferred** from secondary sources quoting the
  article (bjavocat.com 2023-02-01; Dalloz actualité on Cass. 3e civ. 17 juin 2015 n° 14-19.863);
  Légifrance could not be read. `TODO(verify)` the official text. « Leur montant » is the amount of
  the payments, so the ceiling applies to what the invoice asks to be paid (BT-112, TTC), not to HT
  as the BTP plan wrote: the stricter HT base would call a lawful 5 % of TTC an error.
- **Release.** Art. 2: the sums are released one year after the réception, with or without reserves,
  unless the maître d'ouvrage notified a reasoned opposition. **inferred**, same sources.
- **In the XML.** XP Z12-014 annexe A V1.2, cas n°26 « Factures avec clause de réserve
  contractuelle », p. 104, normative: the invoice bills the whole amount; « Les profils EN16931 et
  EXTENDED-CTC-FR ne permettent pas de renseigner un échéancier de paiement avec un montant sous clause
  de réserve. La retenue de garantie peut donc juste être exprimée dans une note : Code sujet (BT-21)
  : ABU, Texte (BT-22) : clause de réserve ». When the retenue becomes final, the seller issues a
  credit note. **verified.** So the retenue's amount is not a structured field: it comes from the
  sheet, the ERP or the PDF. Writing the retenue as BT-113 (« montant déjà payé »), as some vendor
  sites advise, is wrong: annexe A uses BT-113 for the sous-traitant paid directly (cas n°13, p. 63).

## Situations de travaux

- XP Z12-014 annexe A has no case for « facture de situation »; a situation is an ordinary invoice
  (type 380) whose numbering follows the invoices' (docs/DECISIONS.md D4). The situation number and
  the cumulative amount are not structured fields either: from the sheet, the ERP or the PDF.
  **verified** (no such case in the annex's table of cases, §3.1 pp. 30–31; the words « situation de
  travaux » appear nowhere in it) / **inferred** (that a situation is a 380).
- BTP-SIT-01 (the number follows the previous one of the same chantier) and BTP-SIT-02 (the
  cumulative amount does not go down) are our own consistency checks, not legal rules: an error,
  because a situation out of sequence or below the previous cumulative is a mistake to fix (or an
  avoir to issue) before it leaves.

## Attestation de vigilance (for stage 2 and 3)

- C. trav. art. D8222-5 (https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000046078939): the
  company checks, at the contract and every six months until it ends, that its co-contractor gave an
  URSSAF attestation under six months old, and an extract of its registration (Kbis, RNE). The
  threshold of L8222-1 / D8222-1 (5 000 € HT) is `TODO(verify)`. **inferred** (Légifrance unread).
