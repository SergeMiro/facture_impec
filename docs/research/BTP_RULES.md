# Building-trade rules for the BTP back end (BTP_RULES)

What the BTP rules of `@fi/core` (`packages/core/src/rules/btp.ts`) rest on. Checked on
**2026-10-24**. Nothing in this file is legal advice.

How to read it, as in `docs/research/FR_RULES.md`: **verified** = read in the official text or a
normative standard on that day; **inferred** = a third party or our own deduction, labelled.
**browser: none.** Légifrance answered HTTP 403 (Cloudflare challenge) to WebFetch and curl, as on
2026-10-17; its articles below are cited from the sources named. **browser: local** (BrowserOS neo,
2026-10-24) for the Code du travail: Légifrance asked a human to tick its check, so the articles were
read on the Ministry of Labour's Code du travail numérique (code.travail.gouv.fr), which gives
Légifrance's text with its version date and article id. **browser: local** (neo, 2026-10-25, the
owner ticked Légifrance's check) for loi n° 71-584, read on Légifrance itself.

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

- **Ceiling.** Loi n° 71-584 du 16 juillet 1971 (JORFTEXT000000687670), art. 1, in force since
  2020-01-01 (ordonnance n° 2019-964, art. 35; LEGIARTI000039280616): « Les paiements des acomptes
  sur la valeur définitive des marchés de travaux privés visés à l'article 1779-3° du code civil
  peuvent être amputés d'une retenue égale au plus à 5 p. 100 de leur montant et garantissant
  contractuellement l'exécution des travaux, pour satisfaire, le cas échéant, aux réserves faites à
  la réception par le maître de l'ouvrage. » **verified** (Légifrance, read 2026-10-25). « Leur
  montant » is the amount of the payments, so the ceiling applies to what the invoice asks to be
  paid (BT-112, TTC), not to HT as the BTP plan wrote: the stricter HT base would call a lawful 5 %
  of TTC an error. **inferred** (our reading of « paiements »; the text does not say TTC).
- **Caution instead.** Art. 1, last paragraph: no retenue is made if the entrepreneur gives, for the
  same amount, a « caution personnelle et solidaire » of a financial institution on a list fixed by
  decree; the maître d'ouvrage consigns the sums it holds back (paragraphs 2 and 3). **verified.**
  So an invoice without retenue on a chantier that agreed one is not an error, and no rule says so.
- **Release.** Art. 2, in force since 1971-07-17 (LEGIARTI000006474230): « A l'expiration du délai
  d'une année à compter de la date de réception, faite avec ou sans réserve, des travaux … la caution
  est libérée ou les sommes consignées sont versées à l'entrepreneur, même en l'absence de mainlevée,
  si le maître de l'ouvrage n'a pas notifié à la caution ou au consignataire, par lettre
  recommandée, son opposition motivée par l'inexécution des obligations de l'entrepreneur. »
  **verified.** The deadline `retenue_garantie_liberation` (réception + 1 year) and the letter
  `request.body.demande_liberation_retenue` follow it.
- **Scope.** Art. 3: a clause that defeats art. 1 and 2 is void. Art. 4 (since 1972-12-28): the law
  applies to sous-traitance agreements too. **verified.** It covers private works (C. civ. 1779-3°);
  public contracts have their own retenue in the Code de la commande publique, not read
  (`docs/TODO.md`).
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
- **From the sheet** (2026-10-25, `docs/DECISIONS.md` D11): the chantier is BT-11, the retenue a note
  ABU, the situation a note AAI; the previous situation is the same number in the same BT-11, else
  the highest below. The chantier's agreed retenue comes from its ERP: 0 is « none agreed », an
  unknown rate says nothing.

## Attestation de vigilance (for stage 2 and 3)

- **Who checks.** C. trav. art. L8222-1 (version of 2011-06-18, LEGIARTI000024197683): whoever
  concludes a contract « d'un montant minimum » for works, services or an act of commerce checks, at
  its conclusion « et périodiquement jusqu'à la fin de l'exécution du contrat », that the
  co-contractor fulfils the formalities of L8221-3 and L8221-5 (registration, declarations); the
  ways are « précisées par décret ». **verified** (code.travail.gouv.fr/code-du-travail/l8222-1).
- **Threshold.** C. trav. art. **R**8222-1 (version of 2015-05-01, LEGIARTI000030422273): the checks
  « sont obligatoires pour toute opération d'un montant au moins égal à 5 000 euros hors taxes »:
  5 000 € HT included. This file said D8222-1, which does not exist (the Code du travail numérique
  answers 404). **verified** (code.travail.gouv.fr/code-du-travail/r8222-1).
- **What to get.** C. trav. art. D8222-5 (version of 2023-01-01, décret n° 2022-1015,
  LEGIARTI000046078939): the company is deemed to have checked if it gets « lors de la conclusion et
  tous les six mois jusqu'à la fin de son exécution » (1°) the URSSAF attestation (CSS L243-15)
  « datant de moins de six mois », whose authenticity it checks with the URSSAF, and (2°) where
  registration is compulsory, one of: a K or K bis extract, an RNE extract (métiers et artisanat), a
  quote, advert or letter giving the name, full address and registration number, or the greffe's
  electronic receipt (C. com. R123-6). **verified** (code.travail.gouv.fr/code-du-travail/d8222-5).
- **The deadlines** (`packages/agents/src/obligations.ts`): an attestation is due again six months
  after its date, the text's « moins de six mois » (**verified**). A Kbis: the text asks for one
  every six months, not one under six months old; its date plus six months is our proxy
  (**inferred**). Both are derived whatever the contract's amount: R8222-1 says when the check is
  compulsory, and a company that files an attestation wants it followed (**inferred**). The
  authenticity check with the URSSAF is the person's (`docs/DEFERRED.md`).
