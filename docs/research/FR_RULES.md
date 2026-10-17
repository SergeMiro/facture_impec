# French e-invoicing rules for `packages/core` (FR_RULES)

Research for the TypeScript validator. Scope: a French SME seller (TPE/PME) issuing B2B invoices and
credit notes in the **EN 16931 profile with the French CIUS** (XP Z12-012 "EN16931" profile, the one the
DGFiP calls *DEMARRAGE / Base* for flux 1), in CII (Factur-X) and UBL.

Checked on **2026-10-17**. Author: research agent. Nothing in this file is legal advice.

## How to read this file

- **verified**: read on 2026-10-17 in an official publication: DGFiP / impots.gouv.fr, BOFiP, AFNOR
  annexes (as distributed by FNFE-MPE), FNFE-MPE schematrons, CEN validation artefacts, INSEE.
- **verified (official summary)**: read on service-public.gouv.fr. That site is run by the French
  government (DILA), so it is official, but it summarises the law rather than reproducing the legal
  text.
- **inferred**: comes from a third party (a blog, a vendor or a library), or is my own deduction from
  verified facts. Every inference is labelled.
- **browser: none**. No browser was used.
  - **Légifrance could not be read.** WebFetch and curl both got HTTP 403 (Cloudflare challenge).
  - **The Browserbase cloud browser was unavailable.** Session creation failed with HTTP 402, and the
    account shows 81 browser-minutes used, which suggests the plan quota is used up.
  - **No fallback to a local browser** was made, per the server rules.
  - **Consequence:** no article text below was read on Légifrance. Where the law matters, I quote
    BOFiP, impots.gouv.fr or service-public, which cite the articles.

### Sources (all checked 2026-10-17)

| key | document | URL |
|---|---|---|
| DGFIP | DGFiP « Spécifications externes B2B » **v3.2** (zip). Inside: Dossier général v3.2 (30/04/2026), **Annexe 7 « Règles de gestion » V1.9** (30/04/2026) and Annexe 1 « Flux 1 » v1.2 | https://www.impots.gouv.fr/specifications-externes-b2b — zip: https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/specification_externes_b2b/specifications-externes-v3.2.zip |
| AFN-A | AFNOR **XP Z12-012 Annexe A V1.4** (30/06/2026), xlsx (sheets: semantic model, « BR-France CTC », code lists dated 15/05/26) | https://github.com/fnfempe/France_RFE/blob/97ba0f3/FNFE_RFE_INVOICE/Z.notes_%26_docs/XP_Z12_012_Annex/XP_Z12-012_Annexe_A_2026_V1.4_VF.xlsx |
| AFN-B | AFNOR **XP Z12-012 Annexe B V1.4** (normative examples) + commented example UC1 (UBL and CII) | https://github.com/fnfempe/France_RFE/blob/97ba0f3/FNFE_RFE_INVOICE/Z.example/XP_Z12-012_Annexe_B_EXEMPLES_V1.4.pdf , https://github.com/fnfempe/France_RFE/blob/97ba0f3/FNFE_RFE_INVOICE/Z.example/TEST/UBL/EN16931/UC1_F202500003_00-INV_20250701_EN16931_UBL_Commentee.xml , https://github.com/fnfempe/France_RFE/blob/97ba0f3/FNFE_RFE_INVOICE/Z.example/TEST/CII/EN16931/UC1_F202500003_00-INV_20250701_EN16931_FX_CII_Commentee.xml |
| AFN-14 | AFNOR **XP Z12-014 Annexe A V1.4** (30/06/2026), « Description des principaux cas d'usage spécifiques » (normative) | https://github.com/fnfempe/France_RFE/blob/97ba0f3/FNFE_RFE_INVOICE/Z.notes_%26_docs/XP_Z12_014_Annex/ |
| SCH | FNFE-MPE schematrons **BR-FR-Flux2 v1.4.0.04** ("last fix04 2026 09 04"), CII + UBL, fatal and `_WARNING` variants; repo commit `97ba0f3` (2026-09-04) | https://github.com/fnfempe/France_RFE/tree/97ba0f3/FNFE_RFE_INVOICE |
| NOTE | FNFE-MPE « Note explicative » schematrons **V1.4.0** (30/06/2026) | https://github.com/fnfempe/France_RFE/blob/97ba0f3/FNFE_RFE_INVOICE/Z.notes_%26_docs/FNFE_NOTE_EXPLICATIVE_V1.4.0_FR.pdf |
| CEN | CEN EN 16931 validation artefacts **v1.3.16** (2026-04-10), as shipped in the FNFE repo (`EN16931-CII-validation-preprocessed.sch`, UBL likewise) | https://github.com/fnfempe/France_RFE/tree/97ba0f3/FNFE_RFE_INVOICE/CII/EN16931/schematron |
| FAQ | impots.gouv.fr « Foire aux questions – Je découvre la facturation électronique », **version du 01/09/2026** | https://www.impots.gouv.fr/foire-aux-questions-je-decouvre-la-facturation-electronique |
| DATA | impots.gouv.fr « Tableau récapitulatif des données de facture (art. 41 septies D ann. IV CGI) », **MAJ août 2026** | https://www.impots.gouv.fr/facturation-electronique-donnees-de-facture |
| BOFIP-NUM | BOFiP **BOI-TVA-DECLA-30-20-20-10-20131018** (mentions obligatoires générales). Current: « Version en vigueur du 18/10/2013 à aujourd'hui » | https://bofip.impots.gouv.fr/bofip/140-PGP.html/identifiant=BOI-TVA-DECLA-30-20-20-10-20131018 |
| BOFIP-RECT | BOFiP **BOI-TVA-DECLA-30-20-20-20-20220119** (simplifications; factures rectificatives, avoirs). Current: « Version en vigueur du 19/01/2022 à aujourd'hui » | https://bofip.impots.gouv.fr/bofip/142-PGP.html/identifiant=BOI-TVA-DECLA-30-20-20-20-20220119 |
| SP-MENT | service-public « Mentions obligatoires sur une facture » (F31808), « Vérifié le 11 août 2026 » | https://entreprendre.service-public.gouv.fr/vosdroits/F31808 |
| SP-PAY | service-public « Délais de paiement entre professionnels et pénalités de retard » (F23211), « Vérifié le 07 août 2026 » | https://entreprendre.service-public.gouv.fr/vosdroits/F23211 |
| INSEE | INSEE « Identifiants économiques : SIREN, NIC et SIRET », §8 « Contrôles de clés » | https://xml.insee.fr/schema/siret.html |
| RE | API Recherche d'entreprises (DINUM, data from the INSEE Sirene register) | https://recherche-entreprises.api.gouv.fr/search?q=35600000069588 |
| STDNUM | python-stdnum `stdnum/fr/siret.py` (third party) | https://arthurdejong.org/git/python-stdnum/tree/stdnum/fr/siret.py |
| VATCALC | Third-party French VAT number calculators (e.g. eurofiscalis) | https://www.eurofiscalis.com/calculateur-numero-tva-intracommunautaire/ |
| D677 | Décret n° 2026-677 du 27 juillet 2026 (JO du 28/07/2026, texte 26), PDF copy hosted by a third party | https://www.associatheque.fr/fr/fichiers/actualite/decret-2026-677-NOR-CPPE2610307D.pdf |

**Légifrance links I could not open** (HTTP 403). The links themselves are quoted from SP-MENT, SP-PAY
and the DGFIP dossier général:

- CGI ann. II art. 242 nonies A, current version: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000050811276
  (the DGFIP dossier links an older version, LEGIARTI000046086694).
- Code de commerce L441-9: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038411053
- L441-10: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000038414392
- D441-5: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000043197457
- Décret 2022-1299: https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000046383394
- Arrêté du 7 octobre 2022: https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000046383471
- Loi 2023-1322 art. 91: https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000048727444
- CGI 293 B: https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000048826700/
- CGI 289-0 and 289: https://www.legifrance.gouv.fr/codes/id/LEGISCTA000006191855

---

## Q1. The four new mandatory mentions

**Legal source (verified, FAQ §3.4):**

> « Le décret n° 2022-1299 du 7 octobre 2022 relatif à la généralisation de la facturation
> électronique […] modifie l'article 242 nonies A de l'annexe II au Code général des impôts pour
> rendre obligatoires ces nouvelles mentions à compter du 1er septembre 2026. Il s'agit des mentions
> suivantes : le SIREN du client ; la catégorie de l'opération : livraison de biens, prestation de
> service ou double […] ; l'option de paiement de la TVA sur les débits, le cas échéant ; l'adresse de
> livraison des biens, si elle est différente de l'adresse de facturation, le cas échéant. »

**What is still unknown:**

- **Item numbers (`n°`) inside 242 nonies A are not known.** I could not read Légifrance, so I give
  none.
- **Effective date: the official sources disagree.**
  - FAQ says the mentions apply « à compter du 1er septembre 2026 », for everyone.
  - SP-MENT (official summary) presents them with the e-invoicing calendar: 1/9/2026 for large
    companies and ETI, 1/9/2027 for PME and micro.
  - See Open question 1.
- **Décret 2026-677 does not touch 242 nonies A.** It is the only 2026 décret I found. Its notice
  says it modifies « les articles 242 nonies B et suivants » (D677, inferred: third-party copy of the
  JO).

**Data sent to the DGFiP (DATA, verified, art. 41 septies D ann. IV):**

| data | expected from |
|---|---|
| SIREN du client | 1/09/2026 |
| Catégorie de l'opération (LB / PS / LBPS) | 1/09/2026 |
| Option pour le paiement de la taxe d'après les débits | 1/09/2026 |
| Adresse de livraison des biens, si différente | 1/09/2027 |

### 1a. Customer SIREN

| | |
|---|---|
| EN 16931 | **BT-47** Buyer legal registration identifier, scheme **BT-47-1 = `0002`** (AFN-A semantic sheet, verified) |
| CII | `/rsm:CrossIndustryInvoice/rsm:SupplyChainTradeTransaction/ram:ApplicableHeaderTradeAgreement/ram:BuyerTradeParty/ram:SpecifiedLegalOrganization/ram:ID[@schemeID='0002']` (AFN-A, AFN-B UC1, verified) |
| UBL | `/cac:AccountingCustomerParty/cac:Party/cac:PartyLegalEntity/cbc:CompanyID[@schemeID='0002']` (AFN-A, AFN-B UC1, verified) |
| Rules | **BR-FR-11**: mandatory, 9 digits, when the invoice is in e-invoicing scope (note `BAR` = `B2B`). **BR-FR-32**: any `0002` id has 9 digits. **G1.63**: BT-30 and BT-47 mandatory in flux 1 and present in the annuaire (AFN-A, SCH, DGFIP; verified) |
| Linked | **BR-FR-21**: for B2B (except self-billing), the buyer electronic address BT-49 must start with that SIREN and use scheme `0225` (SCH, verified) |
| Cardinality note | The CIUS FR cardinality of BT-47 stays 0..1. The BR-FR rules are what make it mandatory (AFN-A, verified) |

### 1b. Delivery address, if different from the buyer's address

| | |
|---|---|
| EN 16931 | **BG-15** Deliver-to address: BT-75 line 1, BT-77 city, BT-78 post code, BT-80 country |
| CII | `…/ram:ApplicableHeaderTradeDelivery/ram:ShipToTradeParty/ram:PostalTradeAddress/` with `ram:LineOne`, `ram:CityName`, `ram:PostcodeCode`, `ram:CountryID` (AFN-A, verified) |
| UBL | `/cac:Delivery/cac:DeliveryLocation/cac:Address/` with `cbc:StreetName`, `cbc:CityName`, `cbc:PostalZone`, `cac:Country/cbc:IdentificationCode` (AFN-A, verified) |
| Rules | **BR-FR-14** (= G6.16), *not machine-checkable*: « Certaines données liées à l'adresse de livraison BG-15 sont obligatoires si l'adresse est différente de l'adresse de facturation (Acheteur - Bloc BG-8) et seulement à partir du 01/09/2027 » (this date is for flux 1 data). Mandatory fields: BT-75, BT-77, BT-78, BT-80. « Ces données ne sont pas à transmettre pour les prestations de service ». **CEN BR-57**: every BG-15 has BT-80 (AFN-A, CEN; verified) |
| Flux 1 mapping | BR-FR-MAP-10/11 fill missing parts with "-" when flux 1 is built (AFN-A, verified). That is the platform's job, not ours |

### 1c. Category of operation (goods / services / both)

| | |
|---|---|
| EN 16931 | **BT-23** Business process type (the French « cadre de facturation »). Its **first letter** carries the category (DGFIP G1.02, AFN-A BR-FR-08, verified) |
| CII | `/rsm:CrossIndustryInvoice/rsm:ExchangedDocumentContext/ram:BusinessProcessSpecifiedDocumentContextParameter/ram:ID` (AFN-A, verified) |
| UBL | `/cbc:ProfileID`, e.g. `<cbc:ProfileID>S1</cbc:ProfileID>` (AFN-A, AFN-B UC1, verified) |
| Rule | **BR-FR-08**: mandatory; values from the list below (SCH fatal, verified) |

BT-23 values (BR-FR-08, AFN-A V1.4, verified):

| code | meaning (summarised from AFN-A) | relevant for a TPE? |
|---|---|---|
| **B1** | invoice for goods | yes |
| **S1** | invoice for services | yes |
| **M1** | « facture double » (goods and services, neither accessory to the other) | yes |
| B2 / S2 / M2 | same as 1, but already paid | yes (cash sale) |
| S3 | B2G subcontracting with direct payment | no |
| B4 / S4 / M4 | final invoice after advance payments | yes |
| S5 | services invoice filed by a subcontractor | rare |
| S6 | services invoice filed by a co-contractor | rare |
| B7 / S7 | invoice already e-reported (VAT already collected) | rare |
| B8 / S8 / M8 | multi-vendor invoice | no |
| B9 / S9 / M9 | bidirectional invoice | no |

The data table uses LB / PS / LBPS (DATA). These map to the first letter of BT-23: B / S / M (DGFIP
G1.02; mapping inferred from the two verified lists).

**Visible mention (inferred recommendation).** Print the category in words on the PDF too, for
example « Nature des opérations : prestations de services ». The law asks for the mention on the
invoice, and a reader of the PDF cannot see BT-23.

### 1d. Option for paying VAT on debits

| | |
|---|---|
| EN 16931 | **BT-8** Value added tax point date code |
| CII | `…/ram:ApplicableHeaderTradeSettlement/ram:ApplicableTradeTax/ram:DueDateTypeCode`. It sits inside BG-23, so it must carry the same value in every BG-23 occurrence (DGFIP S1.13, AFN-B). **Debits = `5`**, cash basis (encaissement) = `72` (UNTDID 2475 subset; AFN-A code list, AFN-B) |
| UBL | `/cac:InvoicePeriod/cbc:DescriptionCode`. **Debits = `3`**, encaissement = `432` (UNTDID 2005 subset; AFN-A code list, AFN-B) |
| Rule | **DGFIP G1.43**, verbatim: « L'option pour la TVA sur les débits est indiquée au travers du BT-8. Le BT-8 ne sera obligatoire que si l'entreprise a opté pour la TVA sur les débits et le spécifie au moyen du code 5 (CII) ou 3 (UBL). » It is a business rule that software cannot check. **BR-FR-MAP-03**: « BT-8 est obligatoire pour les factures de service dès lors que l'assujetti Vendeur a opté pour les débits. » **BR-FR-MAP-29**: `29` (CII) / `35` (UBL) are tolerated but mapped to 5 / 3 for the PPF. **P1.11**: code list (verified) |
| CEN | **BR-CO-03**: BT-7 and BT-8 are mutually exclusive (CEN, verified) |
| Example | AFN-B UC1, a services invoice (S1) with no debit option, carries `72` in CII and `432` in UBL (verified). Recommendation (inferred): for S/M invoices, emit `5`/`3` when the seller opted, otherwise `72`/`432`. For B invoices, omit BT-8 |
| Visible text | « Option pour le paiement de la taxe d'après les débits » (DATA wording, verified; SP-MENT gives the same wording). Print it on the PDF when the option is set (inferred recommendation) |

---

## Q2. Existing mentions (Code de commerce + CGI) and how French practice encodes them

| mention | legal basis (as cited by the source) | EN 16931 / encoding | status |
|---|---|---|---|
| Invoice number, unique, from a chronological and continuous sequence | CGI ann. II 242 nonies A **I-7°** (BOFIP-NUM §70) | **BT-1**. CII `rsm:ExchangedDocument/ram:ID`; UBL `/cbc:ID`. Rules: BR-FR-01 (at most 35 characters), BR-FR-02 (characters) | verified |
| Issue date (the date the invoice is delivered or, for e-invoices, issued) | 242 nonies A **I-6°** (BOFIP-NUM §140) | **BT-2**. CII `ram:IssueDateTime/udt:DateTimeString` (format `102` = AAAAMMJJ); UBL `/cbc:IssueDate` (AAAA-MM-JJ) (DGFIP G1.09) | verified |
| Date of delivery or end of service, if different from the issue date | 242 nonies A, item cited by AFN-A as « 10° » (BR-FR-CO-17); BOFIP-NUM §150+ | **BT-72**, or invoicing period **BG-14** (BT-73/BT-74) for periodic invoices | verified (AFN-A) |
| Payment due date | C. com. L441-9 (SP-MENT); SP-PAY: « Le délai de paiement doit obligatoirement figurer sur la facture » | **BT-9**. CII `ram:SpecifiedTradePaymentTerms/ram:DueDateDateTime/udt:DateTimeString`; UBL Invoice `/cbc:DueDate`, CreditNote `/cac:PaymentMeans/cbc:PaymentDueDate` (AFN-A). Free text in **BT-20** (`ram:SpecifiedTradePaymentTerms/ram:Description` / `cac:PaymentTerms/cbc:Note`) | verified (official summary) |
| Late-payment penalty rate | C. com. L441-9 and L441-10 (SP-PAY): at least 3 × the legal interest rate; the default is the ECB refinancing rate + 10 points; due without a reminder | **Note BT-21 = `PMD`**, text in BT-22 (BR-FR-05) | rule verified (AFN-A, SCH); law: verified (official summary) |
| 40 € fixed recovery indemnity | C. com. D441-5 (SP-PAY): « Son montant est égal à 40 € »; « doit être mentionnée dans les CGV du fournisseur et sur les factures qu'il émet »; B2B only | **Note BT-21 = `PMT`**, text in BT-22 (BR-FR-05) | same as above |
| Early-payment discount, or « néant » | C. com. L441-9 (SP-MENT); SP-MENT: if none, write « Escompte pour paiement anticipé : néant » | **Note BT-21 = `AAB`**, text in BT-22 (BR-FR-05; DGFIP G1.52: AAB is « la mention de l'escompte », not its amount) | verified |
| Payment terms (free text) | — | BT-20 | verified (AFN-A) |
| Seller identity: name, address, SIREN, legal form, share capital (companies) | SP-MENT (C. com. R123-237 is not cited there; not verified) | BT-27, BG-5, BT-30 (`0002`). The AFN-B UC1 example puts capital and RCS in notes: `REG` « VENDEUR SARL au capital de 50 000 EUR », `ABL` « RCS MAVILLE 100 000 009 », plus `AAI` for footer info. BR-FR-07 lists ABL = information légale (RCS, RM) | verified (AFN-B, AFN-A) |
| VAT numbers of seller and buyer (not required at or below 150 € excl. VAT, per SP-MENT) | 242 nonies A I-2° (BOFIP-NUM I-B) | BT-31 / BT-48 (see Q5) | verified |

### Note encoding (verified: SCH tests, AFN-B UC1)

**CII.** One `ram:IncludedNote` per note, with `ram:SubjectCode` (BT-21) and `ram:Content` (BT-22).

**UBL.** One `cbc:Note` per note, written as **`#CODE#text`**. The UBL schematron tests
`contains($allNotes, '#PMT#')`. Example from UC1:

```xml
<cbc:Note>#PMD#Tout retard de paiement engendre une pénalité exigible à compter de la date d'échéance, calculée sur la base de trois fois le taux d'intérêt légal. </cbc:Note>
<cbc:Note>#PMT#Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 €.</cbc:Note>
<cbc:Note>#AAB#Les réglements reçus avant la date d'échéance ne donneront pas lieu à escompte.</cbc:Note>
```

**BR-FR-05** (AFN-A V1.4, verbatim):

> « Toute facture DOIT comporter au moins 3 notes (BG-1) avec les codes suivants : BT-21 = PMT, pour
> la mention de pénalité de 40 EUROS forfaitaire pour frais de recouvrement (en BT-22) ; BT-21 = PMD,
> Mention de pénalités qui correspond aux conditions de paiement propres à chaque entreprise ;
> BT21 = AAB, mention d'escompte ou d'absence d'escompte »

The schematron applies BR-FR-05 to **every** Invoice and CreditNote, as **fatal**. It does not depend
on the buyer type or the document type (SCH, verified).

**BR-FR-06**: the codes PMD, PMT, AAB and TXD each appear **at most once** (fatal).

**Other useful codes** (BR-FR-07 and DGFIP G1.52; UNTDID 4451 names from AFN-A code list):

| code | use |
|---|---|
| `REG` | regulatory information (UC1 uses it for capital) |
| `ABL` | legal information (RCS, RM) |
| `AAI` | general information |
| `SUR` | supplier remarks |
| `ACC` | factoring clause |
| `BLU` | « Eco-participation (L. 541-10 du code de l'environnement) » |
| `TXD` | « Membre d'un assujetti unique » |
| `CUS` | customs |
| `BAR` | expected processing: `B2B`, `B2BINT`, `B2C`, `OUTOFSCOPE`, `ARCHIVEONLY` (BR-FR-20); BR-FR-31 adds `B2CINT` and allows only one value |

### Payment periods (verified, official summary, SP-PAY)

- **Default:** 30 days after receipt of the goods or completion of the service.
- **Agreed maximum:** 60 days from the invoice date, or 45 days end of month.
- **Periodic invoices:** 45 days.
- **Sector exceptions** exist (transport: 30 days).

This supports a *warning*, never an error.

---

## Q3. VAT special cases

**Allowed categories in France** (BR-FR-15 = DGFIP G2.31, verified): **S, E, AE, K, G, O, Z**.
L and M are « pas pertinents en France ».

**Allowed rates** (BR-FR-16 = G1.24, verified): 0, 0.9, 1.05, 1.75, 2.1, 5.5, 7, 8.5, 9.2, 9.6, 10,
13, 19.6, 20, 20.6. Variants such as `20.0` and `20.00` are accepted.

Mention texts come from BOFIP-NUM III-B. Category and VATEX mapping come from AFN-A code lists
(15/05/2026) and AFN-14 §3.2.42.2 / §3.2.12.2.

| case | legal mention on the invoice | BT-118 / BT-151 | BT-121 (VATEX) | BT-120 (text) | extra EN rules (CEN, verified) | status |
|---|---|---|---|---|---|---|
| **Franchise en base** (CGI 293 B) | « TVA non applicable, art. 293 B du CGI » (BOFIP-NUM §450, verbatim). No VAT may be shown: showing it would make the seller liable (§460) | **E** (BR-FR-CO-16). DGFiP also allows **Z** for franchise sellers without a VAT number (G1.47), and the flux 1 / flux 10 mapping turns E + FRANCHISE into Z (BR-FR-MAP-08/09) | **`VATEX-FR-FRANCHISE`** (BR-FR-CO-16) | the 293 B sentence (inferred: BT-120 is the natural place) | BR-E-02: BT-31, BT-32 or BT-63 present. **BR-FR-CO-16**: « Si le Vendeur n'a pas de n° de TVA, il doit répéter son n° de SIREN en BT-32 » (CII scheme `FC`). BR-E-05: rate 0. BR-E-10 and G1.41: reason code and text (G1.41 waives this for corrective invoices and invoices under 150 €) | verified |
| **Domestic reverse charge** (e.g. construction subcontracting, CGI 283-2 nonies) | « Autoliquidation » (BOFIP-NUM §520, 242 nonies A I-13°). Citing the article is **not** required (§530) | **AE** | **`VATEX-FR-AE`**. Code list: « Exempt based on 2 of article 283 of the CGI […] Only for domestic invoicing in France ». AFN-14 §3.2.12.2 subcontracting example: BT-121 `VATEX-FR-AE`, BT-120 `AUTOLIQUIDATION` | « Autoliquidation » | BR-AE-02: seller VAT (or BT-32 / BT-63) **and** buyer VAT BT-48 or buyer legal id BT-47. BR-AE-05: rate 0. BR-AE-09: tax 0. BR-AE-10: reason code or text | verified (283-2 nonies wording itself not read) |
| **Intra-EU supply of goods** (CGI 262 ter I) | Reference to the exempting provision of the CGI or of directive 2006/112/CE, e.g. 262 ter I (BOFIP-NUM §490). A clear description of the operation is tolerated (§500). **No** « Autoliquidation » mention (§540) | **K** | **`VATEX-EU-IC`** (AFN-14: « et / ou une raison d'exemption TVA en texte « Livraison Intracommunautaire » ») | e.g. « Exonération de TVA, article 262 ter, I du CGI » (wording inferred; BOFiP fixes no wording) | BR-IC-02: seller VAT and buyer VAT. BR-IC-05: rate 0. BR-IC-10: reason. **BR-IC-11**: BT-72 or BG-14 present. **BR-IC-12**: BT-80 deliver-to country present | verified |
| **Intra-EU B2B services** (place of supply in the customer's state; the user mentioned 283-2 / 259) | « Autoliquidation » (BOFIP-NUM §540: required when the operation is located in another member state and the customer pays the tax) | **AE** (AFN-14 §3.2.42.2: « avec l'utilisation du code catégorie TVA « AE » et du code motif d'exemption « VATEX-EU-AE ». Cette règle doit être confirmée à l'échelle UE ») | **`VATEX-EU-AE`** | « Autoliquidation » | BR-AE-02, -05, -09, -10 | verified (AFN-14 flags it as provisional). Articles 259 / 283-2 not read |
| **Export of goods outside the EU** (CGI 262 I) | Reference to the exempting provision (BOFIP-NUM §490 principle) | **G** | **`VATEX-EU-G`** (AFN-14: text « Export ») | e.g. « Exonération de TVA, article 262 I du CGI » (wording inferred) | BR-G-02: seller VAT (or BT-63). BR-G-05: rate 0. BR-G-10: reason | category and code verified; article 262 I not read |
| Services sold outside the EU | — | **G** (AFN-14: « il convient aussi d'utiliser le code catégorie TVA « G » ») | `VATEX-EU-G` | text saying it is a sale of services outside the EU | as above | verified |
| Outside the scope of VAT | — | **O** | `VATEX-EU-O` | — | BR-O-02: **no** BT-31 / BT-48. BR-O-11: no other categories on the invoice | verified |
| Credit note net of VAT (e.g. discount granted « net de taxes », BOFIP-RECT §270) | « net de taxes » mention on the credit note (BOFIP-RECT §270) | **E** | **`VATEX-FR-CNWVAT`**, only on types 261 / 381 / 396 (G6.21; AFN-14 §avoir d'escompte) | — | — | verified |

**Flux 1 rejection to know about (DGFIP G2.32, verified).** Flux 1 is rejected when the invoice
carries only `O`, or only `E` with one of these 19 exemption codes: VATEX-FR-CGI261-1, -2, -3, -4,
-5, -7, -8, VATEX-FR-CGI261A, VATEX-FR-CGI261B, VATEX-FR-CGI261C-1, -2, -3, VATEX-FR-CGI261D-1,
VATEX-FR-CGI261D-1BIS, VATEX-FR-CGI261D-2, -3, -4, VATEX-FR-CGI261E-1, -2. The rule does not apply
when the buyer is a public entity (B2G). Such an invoice falls outside e-invoicing.

**International sales are e-reported, not e-invoiced (AFN-14 §3.2.42).** Intra-EU and export
invoices fall under e-reporting (note `BAR` = `B2BINT`). BR-FR-11 (buyer SIREN) and BR-FR-21 only
fire for `BAR` = `B2B`.

---

## Q4. French business rules (BR-FR-xx)

### Where the rules live and their licence

- **Authoritative list:** AFNOR XP Z12-012 Annexe A V1.4, sheet « BR-France CTC » (AFN-A).
- **Executable form:** FNFE-MPE schematrons in https://github.com/fnfempe/France_RFE (commit
  `97ba0f3`, 2026-09-04):
  - `FNFE_RFE_INVOICE/CII/EN16931/schematron/BR-FR-Flux2-Schematron-CII.sch` (+ `_WARNING.sch`)
  - `FNFE_RFE_INVOICE/UBL/EN16931/schematron/BR-FR-Flux2-Schematron-UBL.sch` (+ `_WARNING.sch`)
  - `FNFE_RFE_INVOICE/Factur-X/EN16931/schematron/` (same CII rules)
  - XSLT builds in `2xslt/`
- **The repo also contains:**
  - the CEN EN 16931 artefacts v1.3.16;
  - the EXTENDED-CTC-FR and Factur-X 1.09.2 (BASICWL / EN16931 / EXTENDED) schematrons;
  - the CDAR (lifecycle) and Flux 10 schematrons.
- **Schematron header** (verified):
  > « Mode "FATAL" APPLICABLE EN RECEPTION AU PLUS TARD LE 1ER OCTOBRE 2026 ET EN EMISSION A COMPTER
  > DU 1ER OCTOBRE 2026 »

  The `_WARNING` variant has the same asserts with `flag="warning"`.
- **Licence: Apache-2.0, with one caveat.**
  - The repo `LICENSE` is **Apache-2.0** (GitHub API `spdx_id`, verified).
  - NOTE (V1.4.0) says « L'utilisation des schematrons […] est libre de droits, sur une base « TEL
    QUEL » […] et relève des dispositions de licence Apache 2.0 » (verified).
  - **But** the `.sch` header says « Licensed under European Union Public Licence (EUPL) version
    1.4.0 ». No EUPL v1.4.0 exists; this looks like the schematron version number pasted by mistake.
    See Open question 4.
- **Coverage gap** (NOTE, verified): the schematrons do **not** cover BR-FR-MV (multi-vendor; partly
  added in 1.3) or BR-FR-CPRO (B2G).

### Rule list (AFN-A V1.4, verified)

"Sch" = present in the v1.4.0.04 schematron as **fatal**. "not checkable" = the business rule is
flagged `nonverif` / `metier`.

**Identifiers and dates**

| id | what it says (short) | Sch |
|---|---|---|
| BR-FR-01 | BT-1, BT-25 (and the line-level reference EXT-FR-FE-136) at most 35 characters | yes |
| BR-FR-02 | Same fields: only `A-Z a-z 0-9 - + _ /`, **no space** (regex `^[A-Za-z0-9+\-_/]+$`) | yes |
| BR-FR-03 | Dates (BT-2, BT-7, BT-9, BT-26, BT-72, BT-73, BT-74 …) have a year between 2000 and 2099 | yes |
| BR-FR-04 | BT-3 ∈ {380, 389, 393, 501, 386, 500, 384, 471, 472, 473, 261, **262** (avoir pour remise globale), 381, 396, 502, 503} | yes |

**Notes and billing frame**

| id | what it says (short) | Sch |
|---|---|---|
| BR-FR-05 | Notes PMT, PMD, AAB mandatory | yes |
| BR-FR-06 | PMD, PMT, AAB, TXD at most once each | yes |
| BR-FR-07 | Subject codes for other notes (ACC, AAI, ADN, SUR, ABL, CUS, BLU, BAR) | not checkable |
| BR-FR-08 | BT-23 mandatory, values B1 … M9 | yes |

**Parties and electronic addresses**

| id | what it says (short) | Sch |
|---|---|---|
| BR-FR-09 | A SIRET (`0009`) has 14 digits and its first 9 equal the party's SIREN (`0002`). Applies to BT-29, BT-46, BT-60, BT-71 and the EXT party ids. **No Luhn check** | yes |
| BR-FR-10 | Seller SIREN BT-30 mandatory, 9 digits (the "active in the PPF annuaire" part is business only) | yes |
| BR-FR-11 | Buyer SIREN BT-47 mandatory when `BAR` = `B2B` | yes |
| BR-FR-12 | Buyer electronic address BT-49 mandatory. In scope: `SIREN` or `SIREN_xxx`, scheme `0225`. Out of scope: any EAS scheme, `EM` allowed, `noreply@…` for portal invoices | yes (presence only) |
| BR-FR-13 | Seller electronic address BT-34 mandatory | yes (presence only) |
| BR-FR-14 | Delivery address when different (from 01/09/2027 in flux 1) | not checkable |
| BR-FR-20 | `BAR` values | yes |
| BR-FR-21 | B2B, not self-billed: BT-49 starts with the BT-47 SIREN and BT-49-1 = `0225` | yes |
| BR-FR-22 | Same for self-billing on BT-34 / BT-30 | yes |
| BR-FR-23 | `0225` address characters: `A-Z a-z 0-9 - _ .` (V1.3.1 removed `/` and added `.`) | yes |
| BR-FR-24 | Allowed characters of `0224` routing codes | yes |
| BR-FR-25 | Electronic address at most 125 characters | yes |
| BR-FR-26 | `0224` routing code at most 100 characters | yes |
| BR-FR-31 | Only one `BAR` value | yes |
| BR-FR-32 | Any id with scheme `0002` or `0231` has exactly 9 digits | yes |

**VAT, attachments and item data**

| id | what it says (short) | Sch |
|---|---|---|
| BR-FR-15 | VAT categories S, E, AE, K, G, O, Z | yes |
| BR-FR-16 | VAT rate list | yes |
| BR-FR-17 | Attachment type codes: RIB, LISIBLE, FEUILLE_DE_STYLE, PJA, BORDEREAU_SUIVI, DOCUMENT_ANNEXE, BON_LIVRAISON, BON_COMMANDE, BORDEREAU_SUIVI_VALIDATION, ETAT_ACOMPTE, FACTURE_PAIEMENT_DIRECT, RECAPITULATIF_COTRAITANCE | yes |
| BR-FR-18 | At most one `LISIBLE` attachment | yes |
| BR-FR-19 | Platforms must accept files up to 100 MB | not checkable |
| BR-FR-27 / 28 | Item attribute group BG-32: a name or a code; a value or a value with unit, not both | yes |
| BR-FR-29 / 30 | Invoiced-object identifier (BT-18 header, BT-128 line): schemes AFL and AVV at most once each | yes |

**Document coherence (BR-FR-CO)**

| id | what it says (short) | Sch |
|---|---|---|
| BR-FR-CO-01 | BT-2 not in the future (G1.07) | not checkable (business) |
| BR-FR-CO-02 | Uniqueness of BT-1 + year of BT-2 + BT-30; « systématiquement bloquant »; refers to BOFiP « BOI-TVA-DECLA-30-20-20-10 du 18/10/2023 » (see Q6) | not checkable (business) |
| BR-FR-CO-03 | Type 262 needs BT-12 (contract) and BG-14 (period) | yes |
| BR-FR-CO-04 | Types 384, 471, 472, 473: exactly one BT-25 with BT-26 | yes |
| BR-FR-CO-05 | Types 261, 381, 396, 502, 503: ≥ 1 header BT-25 + BT-26, or a reference on every DETAIL line (EXTENDED only) | yes |
| BR-FR-CO-06 | Advance payment date | not checkable |
| BR-FR-CO-07 | BT-9 ≥ BT-2, except types 386 / 500 / 503 and frames B2 / S2 / M2 | yes |
| BR-FR-CO-08 | Frames B4 / S4 / M4 are not allowed with types 386 / 500 / 503 | yes |
| BR-FR-CO-09 | Frames B2 / S2 / M2: BT-113 = BT-112, BT-115 = 0, BT-9 = payment date | yes |
| BR-FR-CO-10 | Each private-id scheme at most once per party, and a scheme is required | yes |
| BR-FR-CO-11 | Private-id schemes: `0009` SIRET, `0224` routing code, `0231` (BT-29 only) | not checkable |
| BR-FR-CO-12 | BT-5 ≠ EUR ⇒ BT-6 = EUR and BT-111 in EUR | yes |
| BR-FR-CO-13 | Assujetti unique | not checkable (business) |
| BR-FR-CO-14 / 15 | Assujetti unique: TXD note, BG-11 with BT-63 | yes |
| BR-FR-CO-16 | Franchise: E + `VATEX-FR-FRANCHISE`; BT-32 = SIREN if no VAT number | **no** (flagged `nonverif,inSch`, but no assert exists in v1.4.0.04) |
| BR-FR-CO-17 | BT-72 or BG-14 when it differs from BT-2 | not checkable |

**Decimals (BR-FR-DEC)**

| id | what it says (short) | Sch |
|---|---|---|
| BR-FR-DEC-01 | Amounts: at most 19 digits, 2 decimals | yes |
| BR-FR-DEC-02 | Quantities: 19 digits, 4 decimals | yes |
| BR-FR-DEC-03 | Unit prices: 19 digits, 6 decimals, positive (except S9 / M9 / B9) | yes |
| BR-FR-DEC-04 | VAT rate: at most 4 digits, 2 decimals, positive | yes |

**Mapping and out-of-scope families**

- **BR-FR-MAP-01 … 31** describe how platforms build flux 1 and flux 10. They are informative for
  us. Notable ones:
  - MAP-01: an ID longer than 20 characters is cut to `T` + its last 19 characters.
  - MAP-03 / MAP-29: debit option codes.
  - MAP-08 / 09: franchise turned into Z.
- **BR-FR-MV-01 … 14 and BR-FR-BD-xx** concern multi-vendor and bidirectional invoices (frames 8 and
  9): **out of scope** for us. BR-FR-CPRO concerns B2G.

### Conflict between the DGFiP and AFNOR on spaces in invoice numbers

- **DGFiP allows spaces:** DGFIP G1.05 accepts letters, digits, space, `-`, `+`, `_` and `/` (no
  leading, trailing or double space).
- **AFNOR and the schematron forbid them:** AFN-A BR-FR-02 V1.4 and SCH do not allow the space.
- **We follow the stricter rule** (no space), because the platform runs the schematron.

---

## Q5. Identifiers

### SIREN and SIRET check digit

| fact | source | status |
|---|---|---|
| SIREN = 9 digits, SIRET = SIREN + 5-digit NIC = 14 digits | INSEE; AFN-A ICD list (« 9 character number designates an organization, the 14 character number designates a specific establishment ») | verified |
| « Les numéros SIREN, NIC et SIRET intègrent le mécanisme de contrôle de parité connu sous le nom de formule (ou clé) de Luhn » … « Le contrôle de parité est correct si le résultat obtenu est un multiple de 10 » | INSEE §8.1 | verified |
| Implementation: standard Luhn. Starting from the rightmost digit (the check digit), double every second digit, subtract 9 if the result is above 9, sum all digits; valid if sum mod 10 = 0. INSEE's wording ("chiffres de rang impair") does not say which end it counts from; the standard Luhn rule is unambiguous and accepts every sample SIREN tested here | inferred, tested | inferred |
| **La Poste exception exists.** Two **active** La Poste establishments, SIRET `35600000069588` and `35600000009075` (SIREN `356000000`), **fail Luhn**. Their digit sums are 50 and 35 | RE (official register data) + local computation | verified (existence); computation mine |
| The rule for La Poste SIRETs: "digit sum is a multiple of 5" (the head office `35600000000048` passes ordinary Luhn) | STDNUM | **inferred** (no INSEE text found) |
| The SIREN `356000000` itself passes Luhn | local computation | verified |
| BR-FR-09 checks only the length and the SIREN prefix, **not Luhn** | SCH `check-siret-siren-coherence` | verified |

### French VAT number

| fact | source | status |
|---|---|---|
| Format `FR` + 2-character key + 9-digit SIREN | VATCALC; prefix rule CEN **BR-CO-09** (ISO 3166-1 alpha-2 prefix) | prefix verified; structure inferred |
| Key = `(12 + 3 × (SIREN mod 97)) mod 97`, written on 2 digits | VATCALC | **inferred**. Consistent with the official AFN-B examples: SIREN 100000009 gives `FR88100000009`, 200000008 gives `FR37200000008`, 500000005 gives `FR78500000005` (my computation matches all three) |
| Some French VAT numbers have a letter key (entities without a SIREN) | general knowledge | **inferred**. Skip the key check when the key is not numeric |
| Assujetti unique: BT-31 carries the **group's** VAT number, so its 9 digits may differ from the member's BT-30. The member's SIREN goes in BT-29 with scheme `0231`, and the note TXD « Membre d'un assujetti unique » is added | DGFIP G1.52, S1.14; AFN-A BR-FR-CO-13/14/15 | verified |
| VAT id qualifier: CII `ram:SpecifiedTaxRegistration/ram:ID/@schemeID="VA"` for BT-31 / BT-48 / BT-63. UBL: `cac:PartyTaxScheme/cbc:CompanyID` with `cac:TaxScheme/cbc:ID = VAT`. Seller fiscal id BT-32: `FC` in CII, TaxScheme `LOC` in UBL | DGFIP S1.17 (VA / VAT); AFN-A row BT-32-0 (FC / LOC) | verified |

### Which scheme goes in which BT (AFN-A, SCH, AFN-B; verified)

| BT | element (CII / UBL) | scheme | notes |
|---|---|---|---|
| BT-29 seller id | `ram:SellerTradeParty/ram:GlobalID/@schemeID` / `cac:PartyIdentification/cbc:ID/@schemeID` | **`0009`** SIRET (BT-29b), **`0224`** routing code (BT-29c), **`0231`** SIREN of the assujetti unique (BT-29d); other ISO 6523 codes allowed (UC1 uses `0088` GLN) | each scheme at most once (BR-FR-CO-10) |
| BT-30 seller legal id | `ram:SpecifiedLegalOrganization/ram:ID` / `cac:PartyLegalEntity/cbc:CompanyID` | **`0002`** SIREN | mandatory (BR-FR-10) |
| BT-31 seller VAT | see above | `VA` / `VAT` | needed for S, E (or BT-32), AE, K, G |
| BT-32 seller fiscal id | CII `ram:SpecifiedTaxRegistration/ram:ID/@schemeID="FC"` / UBL `cac:PartyTaxScheme` with `cac:TaxScheme/cbc:ID = LOC` | — | franchise seller without VAT number: SIREN here (BR-FR-CO-16). AFN-A: an auto-entrepreneur without a VAT number puts the SIREN here |
| BT-34 seller e-address | `ram:URIUniversalCommunication/ram:URIID` / `cbc:EndpointID` | **`0225`** (EAS « FRCTC ELECTRONIC ADDRESS ») with `SIREN` or `SIREN_xxx` (UC1: `100000009_STATUTS`); `EM` only out of scope | BR-62: scheme mandatory |
| BT-46 buyer id | `ram:BuyerTradeParty/ram:GlobalID` / `cac:PartyIdentification/cbc:ID` | `0009` SIRET, `0224` routing code | cardinality **0..1** in CIUS FR |
| BT-47 buyer legal id | as BT-30, buyer side | **`0002`** | see Q1a |
| BT-48 buyer VAT | | `VA` / `VAT` | needed for K (BR-IC-02); for AE, BT-48 or BT-47 is enough |
| BT-49 buyer e-address | as BT-34, buyer side | **`0225`**, value starts with the BT-47 SIREN (BR-FR-21) | BR-63: scheme mandatory |

`9957` (« French VAT number ») is in the EAS list, but no French rule asks for it.

---

## Q6. Invoice numbering

**Legal basis (BOFIP-NUM, verified):**

> §70 « Le 7° du I de l'article 242 nonies A de l'annexe II au CGI prévoit que la facture doit
> comporter un numéro unique basé sur une séquence chronologique et continue. »

> §80 « La numérotation des factures peut être établie dans ces conditions par séries distinctes
> lorsque les conditions d'exercice de l'activité de l'assujetti le justifient. »

> §90 For each series: « que la numérotation soit effectuée chronologiquement au fur et à mesure de
> l'émission des factures ; qu'elle soit continue ; et que le dispositif retenu au sein de
> l'entreprise garantisse que deux factures émises la même année ne puissent pas porter le même
> numéro. Il est conseillé à cet égard d'utiliser pour chaque série de factures un préfixe de
> numérotation distinct ».

**What justifies a separate series, and what does not:**

- §100, valid reasons: several billing sites; several customer categories with different rules (for
  example businesses vs private customers); several issuing methods (self-billing, e-invoicing,
  paper…).
- §110, not a valid reason on its own: customers established in several states.
- §60: down-payment invoices are numbered too, and the final invoice refers to them.

**Platform-side uniqueness (DGFIP G1.45 = AFN-A BR-FR-CO-02, verified).** The key is BT-1 + year of
BT-2 + BT-30 SIREN. A duplicate is rejected (« systématiquement bloquant »).

**DGFiP date typo (inferred).** DGFiP and AFN-A cite the BOFiP as « BOI-TVA-DECLA-30-20-20-10 du
18/10/2023 ». BOFiP shows no 2023 version: the version in force runs « du 18/10/2013 à aujourd'hui ».
So « 2023 » is very likely a typo for 2013.

**Practical limits:**

- At most 35 characters (BR-FR-01).
- No spaces and no dots (BR-FR-02).
- **Keep it at 20 characters or fewer.** Flux 1 shortens longer IDs to `T` + their last 19
  characters (BR-FR-MAP-01), and two long numbers can then collide in the DGFiP's data. This is an
  inference from MAP-01.

---

## Q7. Credit notes

| fact | source | status |
|---|---|---|
| Type codes: **381** credit note (also 261 self-billed, 396 factored, 502, 503 prepayment credit note, 262 global-discount credit note, the last mapped to 381 in flux 1 by BR-FR-MAP-02). Corrective invoice: **384** | AFN-A BR-FR-04, UNTDID 1001 list | verified |
| UBL uses a separate `CreditNote` document (`cbc:CreditNoteTypeCode`); its due date is `cac:PaymentMeans/cbc:PaymentDueDate` | AFN-B (« en UBL, il y a un message dédié pour les avoirs »), AFN-A BT-3 / BT-9 paths | verified |
| **Reference mandatory**: types 261 / 381 / 396 / 502 / 503 need at least one header **BT-25 + BT-26** (BG-3), or a reference on every line in EXTENDED only (**BR-FR-CO-05**, fatal). Type 384 needs **exactly one** BT-25 + BT-26 (**BR-FR-CO-04**) | AFN-A, SCH | verified |
| DGFiP flux 1: in BASE (2026) a credit note carries BT-25; in FULL (from 2027) BT-26 too (G1.31) | DGFIP | verified |
| Law: « Conformément au 5 du I de l'article 289 du CGI, la facture rectificative ou la note d'avoir doit, d'une part, faire référence de manière explicite à la facture initiale (numéro et date de la facture), d'autre part, comporter l'ensemble des mentions prévues par la réglementation en vigueur, à l'exception toutefois de celles visées aux 2° et 12° du I de l'article 242 nonies A » | BOFIP-RECT §220 | verified |
| Credit notes must show the excl.-VAT amount of the reduction and the matching VAT. A global credit note (e.g. year-end rebates) may reference a set of invoices or the contract **and the period** (§260). This maps to type 262 + BT-12 + BG-14 (BR-FR-CO-03) | BOFIP-RECT §260; AFN-A | verified (mapping to 262 inferred) |
| A credit note « net de taxes » needs that mention and `VATEX-FR-CNWVAT` with category E | BOFIP-RECT §270; DGFIP G6.21; AFN-14 | verified |
| BR-FR-05 (PMT / PMD / AAB notes) also applies to credit notes in the schematron | SCH context `Invoice \| CreditNote` | verified |
| Sign convention (positive amounts on a 381) | not found in the French texts I read | **not verified**. Follow the EN 16931 core rules; see Open question 6 |

---

## Implementable rule table

Conventions:

- **Ids.** Official ids where they exist: BR-FR-… (AFNOR); CEN core ids (BR-xx, BR-AE-xx, …) for
  EN 16931 rules; G… for DGFiP rules with no BR-FR equivalent. **FF-** marks our own checks.
- **Messages.** `message_fr` says what is wrong. The UI should add the reassurance line (for example
  « Rien n'a été envoyé. ») so every message also answers "is my invoice safe" (project CLAUDE.md
  rule 10).
- **auto_fixable = yes** only for pure formatting that cannot change the meaning.

| id | severity | what it checks (BT fields) | message_fr | fix_hint_fr | auto_fixable |
|---|---|---|---|---|---|
| FF-FMT-01 | error | Leading or trailing spaces in identifiers and codes (BT-1, BT-23, BT-25, BT-29…BT-49, BT-118, BT-121) | Un champ contient des espaces en trop au début ou à la fin. | Nous pouvons les retirer pour vous. | yes |
| FF-FMT-02 | error | SIREN, SIRET or VAT number typed with spaces, dots or lower case (BT-29, BT-30, BT-31, BT-46, BT-47, BT-48) | Le numéro « {valeur} » est écrit avec des espaces, des points ou des minuscules. | Nous pouvons le réécrire au bon format, sans rien changer aux chiffres. | yes |
| FF-FMT-03 | error | Date cell is an Excel serial or ISO text that must be written as a date (BT-2, BT-9, BT-26, BT-72, BT-73, BT-74) | La date « {champ} » n'est pas dans le bon format. | Nous pouvons la convertir. Si elle est ambiguë, saisissez-la au format JJ/MM/AAAA. | yes, only when unambiguous |
| BR-FR-01 | error | BT-1, BT-25 at most 35 characters | Le numéro de facture dépasse 35 caractères. | Raccourcissez le numéro, par exemple F2026-0042. | no |
| BR-FR-02 | error | BT-1, BT-25 match `^[A-Za-z0-9+\-_/]+$` | Le numéro de facture contient un caractère refusé (espace, point, accent ou autre signe). | Gardez seulement des lettres sans accent, des chiffres et les signes - + _ /. | no |
| FF-ID-01 | warning | BT-1 longer than 20 characters (BR-FR-MAP-01 truncation) | Votre numéro de facture fait plus de 20 caractères : l'administration n'en gardera que la fin. | Choisissez des numéros plus courts pour vos prochaines factures. | no |
| BR-FR-03 | error | Year between 2000 and 2099 in BT-2, BT-7, BT-9, BT-26, BT-72, BT-73, BT-74 | L'année de la date « {champ} » semble fausse. | Vérifiez l'année saisie. | no |
| BR-FR-CO-01 | error | BT-2 ≤ today (Europe/Paris) | La date de la facture est dans le futur. | Mettez la date du jour où vous émettez la facture. | no |
| BR-FR-04 | error | BT-3 in the allowed list (we emit 380, 381, 384, 386) | Ce type de document n'est pas accepté. | Choisissez : facture, avoir, facture rectificative ou facture d'acompte. | no |
| BR-FR-CO-02 | error | BT-1 + year(BT-2) + BT-30 not already used (local history) | Vous avez déjà émis une facture avec ce numéro cette année. | Donnez-lui le numéro suivant de votre série. | no |
| FF-NUM-01 | warning | Same series: number follows the last one issued, with no gap (BOFIP-NUM §70–90) | Ce numéro ne suit pas le dernier numéro de votre série ({dernier}). | Vérifiez qu'aucune facture ne manque. La numérotation doit être continue. | no |
| FF-NUM-02 | warning | Same series: a higher number never carries an earlier BT-2 | Cette facture porte une date plus ancienne qu'une facture au numéro plus petit. | Vérifiez la date ou le numéro : la numérotation doit suivre l'ordre des dates. | no |
| BR-FR-05 (PMT) | error | Note PMT present (CII SubjectCode / UBL `#PMT#`) | La mention de l'indemnité forfaitaire de 40 € pour frais de recouvrement manque. | Ajoutez-la à vos mentions légales, par exemple « Indemnité forfaitaire pour frais de recouvrement en cas de retard de paiement : 40 € ». | no |
| BR-FR-05 (PMD) | error | Note PMD present | Le taux des pénalités de retard n'est pas indiqué. | Ajoutez-le à vos mentions légales, par exemple « Pénalités de retard : trois fois le taux d'intérêt légal ». | no |
| BR-FR-05 (AAB) | error | Note AAB present | La mention sur l'escompte manque, même si vous n'en accordez pas. | Ajoutez « Escompte pour paiement anticipé : néant » ou vos conditions d'escompte. | no |
| BR-FR-06 | error | PMT, PMD, AAB, TXD at most once each | La mention « {mention} » apparaît plusieurs fois. | Gardez-en une seule. | no |
| FF-PMD-01 | warning | PMD text contains a rate (a number with « % ») or « taux d'intérêt légal » | Le texte des pénalités de retard ne donne pas de taux. | Précisez le taux. Il ne peut pas être inférieur à trois fois le taux d'intérêt légal. | no |
| FF-DUE-01 | error | BT-9 present on 380 / 384 when the amount due BT-115 > 0 (C. com. L441-9, SP-PAY) | La date d'échéance du paiement manque. | Indiquez la date à laquelle votre client doit payer. | no |
| BR-FR-CO-07 | error | BT-9 ≥ BT-2, except 386 and frames B2 / S2 / M2 | La date d'échéance est avant la date de la facture. | Corrigez la date d'échéance. | no |
| FF-DUE-02 | warning | BT-9 − BT-2 > 60 days (SP-PAY; sector exceptions exist) | Le délai de paiement dépasse 60 jours. | Vérifiez qu'un délai aussi long est permis dans votre secteur. | no |
| BR-FR-08 | error | BT-23 present and in the list | Vous n'avez pas indiqué si cette facture concerne des biens, des services ou les deux. | Choisissez « Biens », « Services » ou « Biens et services ». | no |
| FF-CAT-01 | error | First letter of BT-23 matches the lines: all goods = B, all services = S, both = M | Le type d'opération choisi ne correspond pas aux lignes de la facture. | Vérifiez pour chaque ligne s'il s'agit d'un bien ou d'un service. | no |
| FF-DEB-01 | error | Seller opted for debits and BT-23 starts with S or M ⇒ BT-8 = 5 (CII) / 3 (UBL), BT-7 absent, and the visible mention « Option pour le paiement de la taxe d'après les débits » (G1.43, BR-FR-MAP-03, BR-CO-03) | Vous avez opté pour la TVA sur les débits, mais la facture ne l'indique pas. | Vérifiez l'option « TVA sur les débits » dans les informations de votre entreprise. | no |
| BR-FR-10 | error | BT-30 present, 9 digits, scheme 0002 | Votre numéro SIREN manque ou n'a pas 9 chiffres. | Renseignez votre SIREN dans les informations de votre entreprise. | no |
| FF-SIREN-01 | error | Luhn on BT-30 and BT-47 | Le numéro SIREN « {valeur} » semble mal recopié. | Vérifiez les 9 chiffres. Vous pouvez les retrouver sur annuaire-entreprises.data.gouv.fr. | no |
| BR-FR-11 | error | BT-47 present, 9 digits, scheme 0002, when the buyer is a business established in France (our `BAR` = `B2B`) | Le SIREN de votre client manque. Il doit figurer sur vos factures depuis le 1er septembre 2026. | Ajoutez-le dans la fiche du client. Vous le trouvez sur annuaire-entreprises.data.gouv.fr. | no |
| BR-FR-09 | error | A SIRET (0009) in BT-29 / BT-46 has 14 digits and starts with the same party's SIREN | Le SIRET ne correspond pas au SIREN de la même entreprise. | Les 9 premiers chiffres du SIRET doivent être le SIREN. Vérifiez les deux numéros. | no |
| FF-SIRET-01 | warning | Luhn on SIRET (BT-29 / BT-46). If it starts with 356000000 (La Poste), accept a digit sum that is a multiple of 5 instead | Le numéro SIRET « {valeur} » semble mal recopié. | Vérifiez les 14 chiffres sur annuaire-entreprises.data.gouv.fr. | no |
| BR-FR-12 | error | BT-49 present with a scheme (BR-63) | L'adresse de réception électronique de votre client manque. | Recherchez votre client dans l'annuaire pour la compléter. | no |
| BR-FR-21 | error | B2B, not self-billed: BT-49 starts with the BT-47 SIREN, scheme 0225 | L'adresse de réception électronique ne correspond pas au SIREN de votre client. | Recherchez à nouveau votre client dans l'annuaire. | no |
| BR-FR-23 | error | 0225 address characters `A-Z a-z 0-9 - _ .` | L'adresse de réception électronique contient un caractère refusé. | Recherchez à nouveau votre client dans l'annuaire. | no |
| BR-FR-25 | error | Electronic address at most 125 characters | L'adresse de réception électronique est trop longue. | Vérifiez l'adresse saisie. | no |
| BR-FR-13 | error | BT-34 present with a scheme (BR-62) | Votre propre adresse de réception électronique manque. | Renseignez-la dans les informations de votre entreprise. | no |
| FF-VAT-01 | error | French BT-31 / BT-48 match `^FR[0-9A-Z]{2}[0-9]{9}$` (CEN BR-CO-09 for the prefix) | Le numéro de TVA « {valeur} » n'a pas le bon format. | Un numéro français s'écrit FR, puis 2 caractères, puis les 9 chiffres du SIREN. | no |
| FF-VAT-02 | error | Numeric key = (12 + 3 × (SIREN mod 97)) mod 97 on French BT-31 / BT-48 | Le numéro de TVA « {valeur} » semble mal recopié. | Vérifiez-le sur le site de la Commission européenne (VIES) ou dans l'annuaire des entreprises. | no |
| FF-VAT-03 | warning | 9 digits of BT-31 = BT-30, and of BT-48 = BT-47 (skip when the TXD note or BT-29 0231 shows an assujetti unique) | Le numéro de TVA ne correspond pas au SIREN de la même entreprise. | Vérifiez les deux numéros, sauf si l'entreprise fait partie d'un groupe TVA. | no |
| BR-FR-15 | error | BT-118, BT-151, BT-95, BT-102 ∈ {S, E, AE, K, G, O, Z} | Ce type de TVA n'est pas accepté en France. | Choisissez parmi : TVA normale, exonération, autoliquidation, livraison dans l'UE, export, hors champ, taux zéro. | no |
| BR-FR-16 | error | BT-119 / BT-152 in the French rate list | Le taux de TVA « {taux} » n'existe pas en France. | Vérifiez le taux (par exemple 20 %, 10 %, 5,5 % ou 2,1 %). | no |
| FF-RATE-01 | error | Rate written with a comma or extra zeros (« 20,0 » → 20.00) | Le taux de TVA est mal écrit. | Nous pouvons le réécrire. | yes |
| BR-E-10 + G1.41 | error | Category E has BT-121 and BT-120 (G1.41 waives this for 384 and invoices under 150 €) | Le motif de l'exonération de TVA manque. | Choisissez le motif d'exonération (par exemple franchise en base). | no |
| BR-E-02 | error | Category E ⇒ BT-31, BT-32 or BT-63 present | Votre numéro de TVA ou, à défaut, votre SIREN comme identifiant fiscal doit figurer sur la facture. | Complétez les informations de votre entreprise. | no |
| BR-FR-CO-16 | error | Franchise: E + `VATEX-FR-FRANCHISE`; if no BT-31, BT-32 = BT-30 SIREN | Votre facture en franchise de TVA n'est pas complète. | Gardez « Franchise en base » comme régime de TVA : nous ajoutons votre SIREN comme identifiant fiscal. | no |
| FF-TVA-01 | error | Franchise ⇒ visible text « TVA non applicable, art. 293 B du CGI » (BT-120 and PDF), and no VAT amount (BOFIP-NUM §450–460) | La mention « TVA non applicable, art. 293 B du CGI » manque. | Gardez « Franchise en base » comme régime de TVA : la mention est ajoutée automatiquement. | no |
| BR-AE-10 + FF-TVA-02 | error | AE ⇒ BT-121 = VATEX-FR-AE (domestic) or VATEX-EU-AE (EU customer), and BT-120 contains « Autoliquidation » (BOFIP-NUM §520, AFN-14) | La mention « Autoliquidation » manque. | Choisissez le motif d'autoliquidation (France ou client dans l'UE). | no |
| BR-AE-02 | error | AE line ⇒ seller VAT (or BT-32 / BT-63) and buyer VAT BT-48 or BT-47 | Pour une autoliquidation, le numéro de TVA de votre client doit figurer sur la facture. | Ajoutez-le dans la fiche du client. | no |
| BR-AE-05 / BR-IC-05 / BR-G-05 / BR-E-05 | error | Rate = 0 for AE, K, G, E | Avec ce type de TVA, le taux doit être 0 %. | Mettez le taux à 0 % ou changez le type de TVA. | no |
| BR-IC-02 | error | K ⇒ BT-31 and BT-48 | Pour une livraison dans l'UE, votre numéro de TVA et celui de votre client sont obligatoires. | Complétez les deux numéros de TVA. | no |
| BR-IC-10 + FF-TVA-03 | error | K ⇒ BT-121 = VATEX-EU-IC, and BT-120 cites the exemption (e.g. art. 262 ter, I du CGI) | Le motif de l'exonération pour livraison dans l'UE manque. | Choisissez « Livraison intracommunautaire » comme motif. | no |
| BR-IC-11 | error | K ⇒ BT-72 or BG-14 | Pour une livraison dans l'UE, la date de livraison est obligatoire. | Indiquez la date de livraison. | no |
| BR-IC-12 | error | K ⇒ BT-80 | Pour une livraison dans l'UE, le pays de livraison est obligatoire. | Indiquez le pays de livraison. | no |
| BR-G-02 | error | G ⇒ BT-31 (or BT-63) | Pour une vente hors UE, votre numéro de TVA est obligatoire. | Complétez les informations de votre entreprise. | no |
| BR-G-10 | error | G ⇒ BT-121 VATEX-EU-G or BT-120 | Le motif de l'exonération pour vente hors UE manque. | Choisissez « Export hors UE » comme motif. | no |
| BR-O-02 | error | O ⇒ no BT-31, BT-48, BT-63 | Une facture hors champ de la TVA ne doit pas porter de numéro de TVA. | Vérifiez le type de TVA choisi. | no |
| G2.32 | warning | Only O, or only E with one of the 19 VATEX-FR-CGI261… codes listed in G2.32 (not when the buyer is a public entity) | Cette facture ne contient que des opérations sans TVA : l'administration ne la traitera pas comme une facture électronique entre entreprises. | Vérifiez le type de TVA des lignes. | no |
| G6.21 | error | VATEX-FR-CNWVAT only on 381 / 261 / 396 | Le motif « avoir net de taxe » n'est possible que sur un avoir. | Changez le motif ou le type de document. | no |
| BR-FR-CO-05 | error | 381 (and 261, 396, 502, 503) ⇒ ≥ 1 BT-25 with BT-26 | Cet avoir doit indiquer la facture qu'il corrige. | Indiquez le numéro et la date de la facture d'origine. | no |
| BR-FR-CO-04 | error | 384 ⇒ exactly one BT-25 with BT-26 | Une facture rectificative doit indiquer une seule facture d'origine. | Indiquez le numéro et la date de la facture d'origine. | no |
| FF-CN-01 | warning | BT-25 / BT-26 found in the local history, with BT-26 ≤ BT-2 | Nous ne retrouvons pas la facture d'origine indiquée sur cet avoir. | Vérifiez le numéro et la date de la facture d'origine. | no |
| BR-FR-CO-08 | error | B4 / S4 / M4 not on 386 | Une facture d'acompte ne peut pas être une facture finale après acompte. | Changez le type de document ou le type d'opération. | no |
| BR-FR-CO-09 | error | B2 / S2 / M2 ⇒ BT-113 = BT-112 and BT-115 = 0 | La facture est marquée « déjà payée », mais il reste une somme à payer. | Corrigez le montant payé ou retirez « déjà payée ». | no |
| BR-FR-CO-12 | error | BT-5 ≠ EUR ⇒ BT-6 = EUR and BT-111 (VAT total in EUR) | Pour une facture en devise étrangère, le total de TVA en euros est obligatoire. | Indiquez le taux de change ou le montant de TVA en euros. | no |
| BR-FR-CO-17 | warning | BT-72 or BG-14 when the supply date differs from BT-2 | La date de livraison ou de fin de prestation n'est pas indiquée. | Si elle est différente de la date de facture, ajoutez-la. | no |
| BR-FR-14 | warning | Goods (B or M) delivered to an address other than the buyer's ⇒ BG-15 | L'adresse de livraison n'est pas indiquée. | Si les biens sont livrés ailleurs qu'à l'adresse de votre client, ajoutez l'adresse de livraison. | no |
| FF-DLV-01 | error | If a delivery address is entered: BT-75, BT-77, BT-78, BT-80 all present (BR-FR-14 list, CEN BR-57) | L'adresse de livraison est incomplète. | Complétez la rue, le code postal, la ville et le pays. | no |
| BR-FR-DEC-01 | error | Amounts at most 2 decimals | Un montant a plus de 2 chiffres après la virgule. | Arrondissez le montant au centime. | no |
| BR-FR-DEC-02 | error | Quantities at most 4 decimals | Une quantité a plus de 4 chiffres après la virgule. | Arrondissez la quantité. | no |
| BR-FR-DEC-03 | error | Unit price at most 6 decimals and not negative | Un prix unitaire est négatif ou trop précis. | Mettez un prix positif avec au plus 6 décimales ; une remise se saisit à part. | no |
| BR-FR-DEC-04 | error | VAT rate at most 2 decimals, positive | Le taux de TVA est mal écrit. | Saisissez un taux comme 20 ou 5,5. | no |

### Generator invariants (unit tests on our XML, never shown to users)

**What we always emit:**

- BT-23 is always written in upper case.
- BT-24 = `urn:cen.eu:en16931:2017` (AFN-B UC1).
- Notes PMT, PMD, AAB appear exactly once each (BR-FR-05/06).
- A `BAR` note, if emitted, has one value from the list (BR-FR-20/31).

**Identifiers and dates:**

- Ids with scheme `0002` or `0231` have 9 digits (BR-FR-32).
- Each private-id scheme appears once per party (BR-FR-CO-10).
- Dates: `102` format in CII (`AAAAMMJJ`), `AAAA-MM-JJ` in UBL (G1.09).

**VAT fields:**

- In CII, the same BT-8 value appears in every BG-23 (S1.13).
- BT-7 and BT-8 are never both present (BR-CO-03).
- VAT qualifiers: `VA` (BT-31 / BT-48 / BT-63) and `FC` (BT-32) in CII; `VAT` and `LOC` (BT-32) in
  UBL (S1.17, AFN-A BT-32-0).

**Validation pipeline:** run the CEN artefacts v1.3.16, then the FNFE BR-FR v1.4.0.04 fatal
schematron, on every generated file in CI.

---

## Open questions

1. **When must a PME print the four new mentions?**
   - FAQ (impots.gouv.fr, 01/09/2026): from 1 September 2026 (verified).
   - SP-MENT (official summary) ties them to the issuance calendar: 1/9/2026 for large companies and
     ETI, 1/9/2027 for PME and micro.
   - I could not read 242 nonies A or décret 2024-266 on Légifrance.
   - Proposal: treat them as mandatory now. They cost the user nothing, and BT-23 is mandatory in the
     format anyway.
   - Someone with Légifrance access should read the consolidated 242 nonies A and article 3 of
     décret 2022-1299 as amended.
2. **Wording and item numbers of 242 nonies A were not read.** I give no item numbers for the new
   mentions. The items quoted (I-2°, 6°, 7°, 12°, 13°) come from BOFiP.
3. **Spaces in invoice numbers.** DGFiP G1.05 allows them; AFNOR BR-FR-02 V1.4 and the FNFE
   schematron forbid them. We forbid them. Ask the PA partner (B2Brouter) which one it enforces.
4. **Schematron licence.** The repo LICENSE and the FNFE note say Apache-2.0. The `.sch` header says
   « EUPL version 1.4.0 », which does not exist as an EUPL version. Before bundling the `.sch` / XSLT
   in the product, ask schematronReformeFE@fnfe-mpe.org (address from NOTE) to confirm Apache-2.0.
5. **Franchise: E or Z?**
   - AFNOR (BR-FR-CO-16) says E + `VATEX-FR-FRANCHISE`.
   - DGFiP G1.47 lets franchise sellers without a VAT number use Z, and the flux 1 mapping turns E
     into Z.
   - Proposal: emit E + VATEX-FR-FRANCHISE + BT-32 = SIREN, and let the platform map it. Confirm with
     the PA.
6. **Sign of amounts on credit notes.** None of the French texts I read gives a sign convention for
   type 381 (G1.16 only forbids negative unit prices). The CEN schematron does not forbid negative
   totals either. Proposal: positive amounts on 381, as is common EN 16931 practice (inferred).
   Check with a test file through the PA.
7. **La Poste SIRET rule.** That two active La Poste SIRETs fail Luhn is verified. The
   "multiple of 5" rule comes only from python-stdnum. That is why FF-SIRET-01 is a warning, not an
   error.
8. **VAT key formula.** It comes from third-party sources only, but matches the official AFNOR
   examples. FF-VAT-02 skips letter keys. VIES remains the real check, and it needs a network call.
9. **Intra-EU services as AE + VATEX-EU-AE.** AFN-14 itself says « Cette règle doit être confirmée à
   l'échelle UE ». Re-check at the next XP Z12-014 release.
10. **BR-FR-CO-16 is not in the schematron**, although it is flagged `inSch`. A franchise invoice
    that breaks it would pass the FNFE validator but might be rejected by a PA. Our own check covers
    it.
11. **Annuaire checks (« présent et actif dans l'annuaire PPF », BR-FR-10/11/12) need a network
    lookup** through the PA or the annuaire API. They are not part of this offline table.
