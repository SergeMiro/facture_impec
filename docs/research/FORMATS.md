# Invoice formats and validation: verified facts for `packages/core` (M1)

Research date: **2026-10-17**. Versions checked on that date: `@e-invoice-eu/core` 3.4.1, CEN EN 16931
validation artefacts 1.3.17, Factur-X 1.09.2 (= ZUGFeRD 2.5.2), SaxonJS 2.7.0, Saxon-HE 12.10, veraPDF 1.30.2.

This file covers what `packages/core` needs before anyone writes the invoice model, the EN 16931
validator, the CII and UBL 2.1 builders and parsers, and Factur-X (profile EN 16931) PDF embedding.

## Verdict

1. **Do not depend on `@e-invoice-eu/core`.** It cannot parse CII or UBL. It has no business
   rules and does not compute totals. A 3.4.1 install is 74 MB. It also has three defects that
   hit French invoices (§1.6). Its PDF/A-3 code (WTFPL) is a good model for our own embedder.
2. **Oracle = the CEN 1.3.17 XSLT, run in Node by SaxonJS 2.7.0.** It needs no Java. It passes
   all 1,142 assertions of the CEN unit tests. A run takes about 56 ms per CII file and 103 ms
   per UBL file. Saxon-HE 12.10 in Docker gives the same result and serves as the cross-check.
3. **Factur-X: we draw the PDF ourselves on `@cantoo/pdf-lib` + `@cantoo/fontkit` and attach the
   XML with its `embedFacturX` (M1 update, §3.3).** We prove it with veraPDF (PDF/A-3b) and the
   Akretion extractor. Nobody publishes a licence for the
   official Factur-X XSD and schematron, so do not commit them. Fetch them pinned by sha256.
4. **Code lists: generate them from the vendored CEN `*-codes.sch`.** That is the simplest
   source, and it matches the oracle by construction (§4).

## How to read this file

- **verified**: stated by an official source (standard body, project repository, registry), or I
  ran it myself and the output is quoted here.
- **inferred**: taken from a third party (vendor docs, another implementation) or reasoned from
  verified facts. Do not build on it without checking.
- **our decision**: a design choice for Facture Impec. It is not a fact about the formats.
- Each tag looks like `[verified, S1, 2026-10-17]`, where `S1` points to §0. "ran" means I ran
  it myself. In tables, status and source sit in their own columns, and every row was checked
  on 2026-10-17.
- **How this was gathered.**
  - Sources: npm registry and downloads API, GitHub API (`gh api`), and `curl` of public pages.
  - Hands-on runs happened in a scratch directory outside the repo, on Node 22.22.2, Docker 29.4.1
    and Google Chrome 154. Each downloaded archive was treated as untrusted and extracted into
    its own empty directory. Python ran with `-I`.
  - One browser test ran against `localhost`. It is marked **browser: local** (headless Chrome).
    No cloud browser was used.
- **Not done.** The official Factur-X downloads on fnfe-mpe.org and ferd-net.de sit behind an
  email form. I did not submit it, so the Factur-X specification PDF was not read; see §6, F1–F2.
  No repo file other than this one was touched, and no dependency was added.

## 0. Sources

| ID | URL | What it is |
|---|---|---|
| S1 | https://www.npmjs.com/package/@e-invoice-eu/core (data: https://registry.npmjs.org/@e-invoice-eu/core) | npm metadata: versions, licence, dependencies, unpacked size, publish dates |
| S2 | https://api.npmjs.org/downloads/point/last-week/{package} | Weekly downloads for every package in this file (window 2026-10-06 → 2026-10-12) |
| S3 | https://github.com/gflohr/e-invoice-eu | Source, CI (`.github/workflows/ci.yaml`), specs, contributors, stars |
| S4 | https://gflohr.github.io/e-invoice-eu/en/docs/basics/supported-formats/ | Supported formats |
| S5 | https://gflohr.github.io/e-invoice-eu/en/docs/details/internal-format/ | Input model ("internal format") |
| S6 | https://gflohr.github.io/e-invoice-eu/en/docs/details/validation/ | "E-Invoice-EU does not check these semantic requirements" |
| S7 | https://github.com/gflohr/e-invoice-eu/issues/279 | BT-13 missing in Factur-X EN16931, closed as "Extended only" |
| S8 | https://github.com/gflohr/e-invoice-eu/issues/647 | Several BT-22 notes in one `ram:IncludedNote` (open, 2026-10-17) |
| S9 | https://github.com/gflohr/e-invoice-eu/issues/646 | `ram:CardHolderName` typo, XSD violation when BT-88 is set (open, 2026-10-17) |
| S10 | https://github.com/gflohr/e-invoice-eu/issues/78 | "Offer Automatic Validation" (closed) |
| S11 | https://github.com/gflohr/e-invoice-eu/blob/ef0b71a604b50a2ef620508edf6fb8f715d6ada0/packages/core/src/format/format-cii.service.ts#L1270 | BT-13 mapping with `fxProfileMask: FX_MASK_EXTENDED` |
| S12 | https://github.com/ConnectingEurope/eInvoicing-EN16931/releases/tag/validation-1.3.17 | CEN validation artefacts 1.3.17: release assets |
| S13 | https://github.com/ConnectingEurope/eInvoicing-EN16931/tree/validation-1.3.17 | Same tag, source: README, `LICENSE.txt`, `cii/schema`, `ubl/schema/README.md`, `test/` |
| S14 | https://github.com/ConnectingEurope/eInvoicing-EN16931/issues/500, …/issues/511 | BR-CO-25 and BR-CO-27 removed from the schematron by design (via #477, #454) |
| S15 | https://github.com/ConnectingEurope/eInvoicing-EN16931/issues/525 | Code list update (ICD 0249–0251, EAS 9960, VATEX-ES) shipped in 1.3.17 |
| S16 | https://ec.europa.eu/digital-building-blocks/sites/display/DIGITAL/Registry+of+supporting+artefacts+to+implement+EN16931 | EC registry: code lists v18 "used from 2026-11-15", genericode files, CEN zips |
| S17 | https://www.npmjs.com/package/saxon-js (+ `LICENSE.txt` inside the package) | SaxonJS 2.7.0, "Saxonica" licence v1.0 (June 2020) |
| S18 | https://www.npmjs.com/package/xslt3 | XSLT → SEF compiler CLI for SaxonJS 2 |
| S19 | https://www.npmjs.com/package/saxonjs-he (+ `LICENSE.txt`) | SaxonJS 3.0.0-beta2, licence v2.0 (December 2024) |
| S20 | https://repo1.maven.org/maven2/net/sf/saxon/Saxon-HE/ | Saxon-HE 12.10 jar + `.sha1`, 13.1 pom, `maven-metadata.xml` (MPL-2.0) |
| S21 | https://repo1.maven.org/maven2/org/xmlresolver/xmlresolver/5.3.3/ | xmlresolver 5.3.3, runtime dependency of Saxon-HE 12 |
| S22 | http://docs.oasis-open.org/ubl/os-UBL-2.1/ | OASIS UBL 2.1: `UBL-2.1.zip` (57.9 MB) and per-file `xsd/` |
| S23 | https://fnfe-mpe.org/factur-x/ | FNFE-MPE Factur-X page; the download needs an email form |
| S24 | https://www.ferd-net.de/en/downloads/publications/details/zugferd-252-english | FeRD: ZUGFeRD 2.5.2 information package, 4 August 2026, release notes |
| S25 | https://fnfe-mpe.org/wp-content/uploads/2026/06/2026-06-10_Factur-X_1.09_ZUGFeRD_2.5_Press_Release_EN.pdf | Factur-X 1.09 / ZUGFeRD 2.5 press release |
| S26 | https://github.com/akretion/factur-x (commit `8b549890ca51085eaf26d71085be2af478249839`), https://pypi.org/project/factur-x/ | Akretion `factur-x` 7.7 (2026-10-14): embedder, extractor, bundled Factur-X 1.09.2 XSD/XSLT |
| S27 | https://hub.docker.com/r/verapdf/cli | veraPDF CLI image, tags `v1.30.2` (2026-06-03) and `v1.30.3` (2026-10-07) |
| S28 | https://registry.npmjs.org/{package} | npm metadata for the other packages compared in §5 |
| S29 | https://www.datalogics.com/factur-x-is-your-business-ready, https://www.loslab.com/hotpdf-component-doc/it/topics/THotPDFAddFacturXAssociatedFileMethod.html, https://gotenberg.dev/docs/manipulate-pdfs/factur-x | Vendor docs on AFRelationship (third party; they disagree) |

---

## 1. `@e-invoice-eu/core`

### 1.1 Package facts

| Fact | Value | Status | Source |
|---|---|---|---|
| Latest version | 3.4.1, published 2026-10-15 | verified | S1 |
| Licence | WTFPL (GitHub shows `NOASSERTION` because it does not recognise WTFPL) | verified | S1, S3 |
| Downloads | 19,661 / week; 66,858 / month | verified | S2 |
| Unpacked size | 21.2 MB, 47 files | verified | S1 |
| Real install | `npm install` → 27 packages, **74 MB**: `@cantoo/pdf-lib` 32 MB, the package itself 21 MB, `@e965/xlsx` 7.8 MB, `ajv` 2.5 MB, `@oozcitak/*` 2.4 MB | verified (ran) | — |
| Runtime dependencies | `ajv` ^8.20, `tslib`, `@e965/xlsx` ^0.20.3, `tmp-promise`, `xmlbuilder2` ^4.0.3, `jsonpath-plus` ^11.2.1, `@cantoo/pdf-lib` ^2.11.1, `@esgettext/runtime`. No `engines`, `exports` or `browser` field. | verified | S1 |
| Release activity | 41 versions since 2025-03-30; 3.3.0 (2026-09-05), 3.3.1–3.3.3, 3.4.0 (2026-10-04), 3.4.1 (2026-10-15) | verified | S1 |
| Community | 361 stars, 32 forks, 23 open issues. In practice one maintainer: `gflohr` has 1,691 commits, the next human contributor has 11. | verified | S3 |
| Tests | 23 `*.spec.ts` files in `packages/core`, Vitest, mostly `toMatchSnapshot`. CI runs on Ubuntu, macOS and Windows. **Neither the specs nor `ci.yaml` validate the output against an XSD or a schematron.** | verified | S3 |

### 1.2 Model, outputs, validation

- **Input model.** JSON in an "internal format" modelled on Peppol UBL. The root is
  `"ubl:Invoice"`, keys look like `cbc:`/`cac:`, and attributes are written `key@attr`
  (`"cbc:EndpointID@schemeID": "0225"`). Amounts are strings. [verified, S5, 2026-10-17]
- **Input check.** Ajv validates the input against a JSON schema that includes the code lists.
  [verified, S6, 2026-10-17] The schema mirrors Peppol cardinalities, with quirks. For example,
  the buyer's `cac:PartyIdentification` must be an object, while the seller's must be an array
  (my array input was rejected with "must be object"). [verified (ran), 2026-10-17]
- **No computation.** Totals, VAT breakdown and line amounts must be supplied. They are copied, not
  computed. [verified (ran), 2026-10-17]
- **No business rules.** The docs give BR-CO-25 as their example of a rule the library does not
  check: "In general, E-Invoice-EU does not check these semantic requirements."
  [verified, S6, 2026-10-17] Issue #78 "Offer Automatic Validation" is closed. [verified, S10,
  2026-10-17] Its CLI can send files to a separate Java validation server (`e-invoice-eu-validator`).
  That server is not part of `core`. [verified, S3, 2026-10-17]
- **Outputs.** CII, UBL; Factur-X MINIMUM, BASIC WL, BASIC, EN16931 (alias Comfort), EXTENDED and
  XRECHNUNG; XRECHNUNG-CII and XRECHNUNG-UBL; ZUGFeRD aliases. [verified, S4, 2026-10-17]
- **API.** `InvoiceService.generate(input, options): Promise<string | Uint8Array>`. The package
  exports `FormatFactoryService`, `InvoiceService`, `MappingService`, `ValidationService`,
  `invoiceSchema`, `mappingSchema` and a few regex constants. [verified, S1 type declarations,
  2026-10-17]

### 1.3 PDF handling

- Factur-X needs an input PDF, or a spreadsheet plus LibreOffice (Node only). **It does not render
  a PDF.** [verified, S4, 2026-10-17]
- `format-factur-x.service.ts` is 454 lines. The flow is `getInvoicePdf` → `super.generate`
  (builds the XML from its own model) → `attachFacturX` → `createPDFA`. The PDF/A code sits in
  private methods. [verified, S3, 2026-10-17]
- **You cannot pass it an XML that you built yourself.** It always regenerates the XML from its
  JSON model, so "use it only for embedding" is not possible through the API. [verified, S3,
  2026-10-17]
- Its PDF/A step does **not** convert the input PDF. It adds the XMP, the OutputIntent and the
  attachment. If the input PDF uses a non-embedded font (Helvetica), veraPDF fails the result on
  ISO 19005-3 clause 6.2.11.4.1. With an embedded DejaVu Sans subset, it passes.
  [verified (ran), 2026-10-17]

### 1.4 Browser and Node support

- **Node:** works (CommonJS `require`). [verified (ran), 2026-10-17]
- **Browser:** the ESM build imports `child_process`, `fs` and `tmp-promise`, and
  `@esgettext/runtime` imports `promises` from `fs`. Vite externalizes all of them and the app
  breaks. [verified (ran), 2026-10-17]
- The prebuilt UMD file `dist/e-invoice-eu.min.js` does work when imported as a module
  (`import eivu from '@e-invoice-eu/core/dist/e-invoice-eu.min.js'`). Once bundled it does not set
  `window.eInvoiceEU`, and Vite 6 with target `chrome87` rejects top-level await, so the calls go in
  an async IIFE. The bundle is
  1,625,068 bytes minified (555,618 gzip). **browser: local** (headless Chrome 154 on
  `vite preview`, `localhost:4789`). [verified (ran), 2026-10-17]
- In the browser, CII + UBL took 378 ms, and adding Factur-X brought the total to 442 ms. Outputs:
  CII 9,545 B, UBL 6,529 B, Factur-X PDF 21,015 B. **browser: local** [verified (ran), 2026-10-17]

### 1.5 French B2B test: minimal code and timings

The test invoice:
- seller: SIREN 123456782, SIRET 12345678200010, VAT FR11123456782, EAS 0225 endpoint;
- buyer: SIREN 987654324, SIRET 98765432400027, VAT FR14987654324;
- lines: 5 DAY at 650.00 and 1 C62 at 240.00 (both 20 %), 4 H87 at 35.50 (5.5 %);
- totals: VAT 698.00 + 7.81 = 705.81; HT 3,632.00; TTC 4,337.81;
- other: IBAN FR7630006000011234567890189, due date, BT-13 `BC-7781`, BT-10 buyer reference.

All identifiers are Luhn or mod-97 valid test values.

```js
// Node 22, CommonJS packages loaded from an ESM script.
const { InvoiceService } = require('@e-invoice-eu/core');
const { PDFDocument } = require('@cantoo/pdf-lib');
const fontkit = require('@cantoo/fontkit'); // NOT @pdf-lib/fontkit: it crashes when subsetting with @cantoo/pdf-lib
const service = new InvoiceService(logger);

const doc = await PDFDocument.create();
doc.registerFontkit(fontkit);
const font = await doc.embedFont(readFileSync('DejaVuSans.ttf'), { subset: true }); // PDF/A needs embedded fonts
doc.addPage([595.28, 841.89]).drawText('Facture FA-2026-0042', { x: 50, y: 780, size: 12, font });
const visual = await doc.save();

const cii = await service.generate(structuredClone(invoice), { format: 'CII', lang: 'fr-fr' });
const ubl = await service.generate(structuredClone(invoice), { format: 'UBL', lang: 'fr-fr' });
const pdf = await service.generate(structuredClone(invoice), {
  format: 'Factur-X-EN16931', lang: 'fr-fr',
  pdf: { buffer: visual, filename: 'visual.pdf', mimetype: 'application/pdf' },
});
```

Node 22 timings, 5 runs each, first run / median of the warm runs [verified (ran), 2026-10-17]:

| Step | First | Warm median |
|---|---|---|
| `require` of the three packages | 413–540 ms | — |
| Render the visual PDF (our code, pdf-lib) | 78 ms | 28–39 ms |
| `generate` CII | 264–280 ms | 151–154 ms |
| `generate` UBL | 155–166 ms | 149–152 ms |
| `generate` Factur-X EN16931 (XML + PDF/A) | 146–175 ms | 136–147 ms |

**Results through the oracle (§2), with one BT-22 note and `cbc:ProfileID` = `B1`:**
- CEN CII and UBL: 0 fatal, 0 warnings.
- Factur-X EN16931 XSD: valid. Factur-X EN16931 schematron: 0 issues.
- veraPDF PDF/A-3b: PASS (888 checks, 0 failed).
- The Akretion extractor finds and extracts `factur-x.xml`.

[verified (ran), 2026-10-17]

**Output PDF structure** [verified (ran) with veraPDF and a pdf-lib reader, 2026-10-17]:
- PDF 1.7; XMP `pdfaid:part` 3, `pdfaid:conformance` B.
- `fx:DocumentType` INVOICE, `fx:DocumentFileName` `factur-x.xml`, `fx:Version` 1.0,
  `fx:ConformanceLevel` `EN 16931`, namespace `urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#`.
- `/AF` in the catalog. The filespec has `/F (factur-x.xml)` and `/AFRelationship /Alternative`;
  the embedded file has `/Subtype /text#2Fxml`.
- `/OutputIntent /S /GTS_PDFA1`, identifier sRGB, with an ICC stream (N = 3, 3,024 bytes).

**A deliberately wrong invoice** (TaxAmount 700, PayableAmount 9999.99, one wrong line total, no due
date and no payment terms) was generated **without any complaint**. The CEN oracle then reported
BR-CO-10, BR-CO-14, BR-CO-15, BR-CO-16 and BR-S-08. BR-CO-25 did not fire, because CEN 1.3.17
does not contain it (§2.1). [verified (ran), 2026-10-17]

### 1.6 Defects that matter for France

| # | Defect | Effect | Status | Source |
|---|---|---|---|---|
| D1 | BT-13 (purchase order reference) is dropped from Factur-X **EN16931**: the mapping uses `fxProfileMask: FX_MASK_EXTENDED` | Silent data loss. The Factur-X 1.09 EN16931 XSD *does* allow `ram:BuyerOrderReferencedDocument` in `HeaderTradeAgreement` (so does MINIMUM). Plain CII keeps it. Upstream closed the issue as "Extended only". | verified (ran); verified | S11, S7, S26 |
| D2 | Several BT-22 notes go into **one** `ram:IncludedNote` with several `ram:Content` | CEN: warning CII-SR-030. Factur-X EN16931 XSD: **invalid** ("Content not expected, expected SubjectCode"). Factur-X schematron: FX-SCH-A-000160. The Akretion extractor rejects the PDF. French invoices usually carry several mandatory notes (late-payment penalties, the €40 recovery fee). | verified (ran); open issue | S8 |
| D3 | BT-23 defaults to the Peppol URN `urn:fdc:peppol.eu:2017:poacc:billing:01:1.0` unless `cbc:ProfileID` is set | Valid EN 16931, but wrong for the French B1/S1/M1 framework. | verified (ran) | — |
| D4 | `ram:CardHolderName` instead of `ram:CardholderName` | XSD-invalid CII as soon as BT-88 is set | verified (issue) | S9 |
| D5 | The PDF/A result depends on the fonts of the input PDF (§1.3) | You still need your own PDF/A-clean renderer | verified (ran) | — |

### 1.7 Can it parse CII or UBL back?

**No.** There is no parser, no `fromXML`, no DOM parser in its exports, and no
reverse mapping. [verified, S1 type declarations + S3 source, 2026-10-17]

### 1.8 Verdict on `@e-invoice-eu/core`

**Do not use it as a dependency** (our decision). Reasons:
- We would still write the parser, the rules and all the arithmetic (§1.2, §1.7).
- Its Peppol-shaped JSON would become a second model next to our BT/BG model.
- D1–D3 hit ordinary French invoices.
- It installs 74 MB, its ESM build is Node-only, and one person maintains it.

What to take from it: `createPDFA` / `attachFacturX` are a working, veraPDF-passing reference for
the XMP, OutputIntent and `/AF` layout. WTFPL allows copying, but we write our own on the same
library, `@cantoo/pdf-lib` (§3.3). It does not need to stay as a dev dependency either: the CEN
oracle is the stronger reference.

---

## 2. Validation oracle: CEN EN 16931 schematron

### 2.1 Artefacts, licence, paths

| Fact | Value | Status | Source |
|---|---|---|---|
| Latest tag | `validation-1.3.17`, published 2026-10-12 (README: "v1.3.17 - 2026-10-09"; milestone "1.3.17 (Nov-26)") | verified | S12, S13 |
| Assets | `en16931-cii-1.3.17.zip`: 227,817 B, sha256 `e5f3235824b6b38454b1d54cf3f14e01efb5b33971fbefc4e64997d0ef619e89` | verified (ran) | S12 |
| | `en16931-ubl-1.3.17.zip`: 2,651,001 B, sha256 `bf02a0e3f6cbe692a4a28e70be7bdcaded5612b4169b543e13d6cb4f33c29e92` | verified (ran) | S12 |
| Licence | **EUPL-1.2** (`LICENSE.txt`). README: "Derivative work created from … validation-1.2.3. That was Licensed under the Apache License, Version 2.0". The zips do not contain the licence file; copy it from the tag. | verified | S13 |
| XSLT | `xslt/EN16931-CII-validation.xslt` (729,883 B), `xslt/EN16931-UBL-validation.xslt` (898,710 B) | verified (ran) | S12 |
| Schematron | `schematron/preprocessed/*.sch`; code lists in `schematron/codelist/EN16931-{CII,UBL}-codes.sch` | verified (ran) | S12 |
| Examples | 15 CII and 19 UBL files in `examples/`. One UBL example, `FT G2G_TD01 con Allegato…xml`, weighs 3.3 MB on its own. | verified (ran) | S12 |
| CII XSD (D16B) | In the repo, not in the zip: `cii/schema/D16B SCRDM (Subset)/uncoupled clm/CII/uncefact/data/standard/CrossIndustryInvoice_100pD16B.xsd` (54 files, 576 KB). UN/CEFACT 2016 notice: "may be copied and furnished to others". | verified | S13 |
| UBL 2.1 XSD | **Not redistributed by CEN**. `ubl/schema/README.md` points to OASIS `UBL-2.1.zip` (57.9 MB). The 16 files needed (`maindoc/UBL-{Invoice,CreditNote}-2.1.xsd` + `common/*`) total 2.9 MB. Header: "Copyright (c) OASIS Open 2013. All Rights Reserved." | verified | S13, S22 |
| Unit tests | VEFA testSets (namespace `http://difi.no/xsd/vefa/validator/1.0`): `test/Invoice-unit-UBL` (206 files), `test/CreditNote-unit-UBL` (71), `test/cii` (2), plus `test/testfiles` (29 full documents). Upstream CI runs them with `phelger/vefa-validator`. | verified | S13 |
| Rule ids | UBL XSLT: 985 ids (678 `UBL-CR-*`). CII XSLT: 814 ids (484 `CII-SR-*`, 103 `CII-DT-*`). The `BR-*` families are identical in both: BR 58, BR-CO 23, BR-CL 23, BR-DEC 21, plus the VAT-category families. | verified (ran) | S12 |
| BR-CO-25, BR-CO-27 | **Absent from 1.3.16 and later, by design** (BR-CO-25 via #477/#232, BR-CO-27 via #454). EN 16931-1 still contains BR-CO-25. Factur-X EXTENDED and EXTENDED-CTC-FR still assert BR-CO-25. Factur-X EN16931 and the BR-FR-Flux2 XSLT do not. In Factur-X BASIC WL, BASIC and EN16931, BR-CO-27 is now called CII-SR-470. | verified; verified (ran, grep of the S26 XSLTs) | S14, S24, S26 |
| Stale file | `codelist/iso6523/ICD-list.pdf` dates from 2018 (ICDs up to 0189). Do not use it; use `*-codes.sch` (§4). | verified (ran) | S13 |

### 2.2 SaxonJS in Node (no Java)

| Fact | Value | Status | Source |
|---|---|---|---|
| Packages | `saxon-js` 2.7.0 (2.40 MB unpacked, depends on `axios` ^1.5.1, 92,995 / week); `xslt3` 2.7.0 (42 KB, 56,570 / week) | verified | S17, S18, S2 |
| Install | 29 packages, 6.5 MB (`axios` 2.2 MB). No TypeScript types and no `@types/saxon-js`, so we need a small local `.d.ts` (rule "no `any`"). | verified (ran) | — |
| Licence | Saxonica licence v1.0. The package is free but closed source (obfuscated JS). "Redistribution in binary form, without modification, is permitted as part of an application", with the copyright notice kept. No reverse engineering. No re-hosting on a site "whose primary purpose is to make it available to third parties". A dev dependency installed from npm meets these terms. | verified | S17 |
| Compile XSLT → SEF (once per syntax) | `node xslt3.js -xsl:EN16931-CII-validation.xslt -export:en16931-cii.sef.json -nogo -relocate:on`. CII: 14.5 s, 543 MB RSS, SEF 5.05 MB. UBL: 18.3 s, 709 MB, SEF 6.84 MB. Factur-X EN16931: 14.0 s. | verified (ran) | — |
| Per-file run | Library load 183 ms, SEF parse 47–58 ms. CII examples: median **56 ms** (first 232 ms). UBL examples: median **103 ms** (first 332 ms). | verified (ran) | — |
| Correctness | All 15 CII and 19 UBL examples: 0 fatal, 0 warnings. **CEN unit tests: UBL 277 files / 1,131 tests / 1,133 assertions pass, 0 fail, 39.8 s (35 ms per test); CII 9 / 9 in 0.4 s.** | verified (ran) | S13 |
| SaxonJS 3 (`saxonjs-he` 3.0.0-beta2) | Licence v2.0 (same terms), no dependencies, 2.45 MB, 3,770 / week. Same results, but about **5× slower**: 209 s for the unit tests, CII median 168 ms. Stay on 2.7 until 3.x is final and faster. | verified (ran) | S19, S2 |

Unit-test replay rules: for each `<test>`, `success` means the rule must not fire, `error` means it
fires with `flag="fatal"`, `warning` means it fires with `flag="warning"`. Only the rule ids listed
in the test are compared. [verified (ran), S13, 2026-10-17]

**From SVRL to a list of failed rule ids** (tested logic, written here in TypeScript; `SaxonJS`
is typed by our local `.d.ts`):

```ts
const SVRL = 'http://purl.oclc.org/dsdl/svrl';
export interface OracleHit { id: string; flag: 'fatal' | 'warning'; location: string; text: string }

/** Run one compiled CEN stylesheet (SEF JSON, parsed once) on one XML string. */
export async function runOracle(sef: object, xml: string, baseUri?: string): Promise<OracleHit[]> {
  const source = await SaxonJS.getResource({ text: xml, type: 'xml' });
  const { principalResult } = await SaxonJS.transform(
    { stylesheetInternal: sef, ...(baseUri ? { stylesheetBaseURI: baseUri } : {}),
      sourceNode: source, destination: 'document' },
    'async',
  );
  const ns = { namespaceContext: { svrl: SVRL } };
  const nodes = SaxonJS.XPath.evaluate('//svrl:failed-assert | //svrl:successful-report',
    principalResult, { ...ns, resultForm: 'array' }) as Element[];
  return nodes.map((n) => ({
    id: n.getAttribute('id') ?? '',
    flag: n.getAttribute('flag') === 'warning' ? 'warning' : 'fatal', // CEN uses fatal | warning
    location: n.getAttribute('location') ?? '',
    text: String(SaxonJS.XPath.evaluate('normalize-space(svrl:text)', n, ns)),
  }));
}
```

The Factur-X XSLTs load a `*_codedb.xml` file relative to the stylesheet. Without a base URI,
SaxonJS fails with **XTDE1162**, so pass `stylesheetBaseURI` = `file://…/FACTUR-X_EN16931.xslt`.
The CEN XSLTs do not need it. [verified (ran), 2026-10-17]

### 2.3 XSD validation in Node: `xmllint-wasm`

- `xmllint-wasm` 5.3.0: MIT, 0.89 MB installed, no dependencies, 410,929 / week. It runs libxml2
  2.13.8 compiled to wasm in a worker thread. It has separate Node and browser entry points and
  ships `.d.ts` files. [verified, S28, S2; ran, 2026-10-17]
- Imports resolve offline if every `*.xsd` is preloaded under its relative path:
  `validateXML({ xml: [{ fileName, contents }], schema: [main], preload: allOtherXsds, maxMemoryPages: memoryPages.GiB })`.
- Timings: CII against D16B or the Factur-X EN16931 XSD took 100–111 ms per file; UBL 193–204 ms.
  A file with an unknown element was rejected. It also caught D2. [verified (ran), 2026-10-17]
- XSD and schematron are separate checks. CEN's schematron never loads the XSD, so run both.
  [verified (ran): D2 gave only a CEN *warning* but an XSD *error*, 2026-10-17]

### 2.4 Fallback and cross-check: Saxon-HE in Docker

- Saxon-HE 12.10 (Maven, 2026-07-09, **MPL-2.0**). Its jar sha1 `1d6492db…a5d2` matches the
  `.sha1` file on Maven. It needs `xmlresolver` 5.3.3. 13.1 came out on 2026-10-15 and uses
  xmlresolver 6.1.0; it was not tested. [verified, S20, S21; ran, 2026-10-17]
- The local jars have these sha256 values: `Saxon-HE-12.10.jar` `b571af282f25d7301059f788b9a149aab8b5cdc14ef3d212dc5425d3dcbb9a97`,
  `xmlresolver-5.3.3.jar` `1fe4d5b92f708dcdb82dbce12919e0171e6b5ca62c6dca6220483625098feb5f`.
  [verified (ran), 2026-10-17]
- Exact command (a whole directory in one JVM; for one file use `-s:/in/x.xml -o:/out/x.svrl.xml`):

```bash
docker run --rm --network none -u "$(id -u):$(id -g)" \
  -v "$JARS":/saxon:ro -v "$CEN/xslt":/xslt:ro -v "$IN":/in:ro -v "$OUT":/out \
  eclipse-temurin:21-jre \
  java -cp /saxon/Saxon-HE-12.10.jar:/saxon/xmlresolver-5.3.3.jar net.sf.saxon.Transform \
       -s:/in -xsl:/xslt/EN16931-CII-validation.xslt -o:/out -t
```

- Timings: stylesheet compile 1.14 s, execution 12–190 ms per file. Wall clock is 2.0–2.3 s per
  `docker run`, whether it handles 1 file or 16. Results are identical to SaxonJS (our two-note
  CII: only CII-SR-030). [verified (ran), 2026-10-17]
- Use: an optional `pnpm oracle:java` cross-check, and the fallback if SaxonJS ever disagrees
  with CEN's own runs. It is not the default, because `pnpm verify` must not require Docker
  (our decision).

---

## 3. Factur-X

### 3.1 Version, publisher, artefacts

| Fact | Value | Status | Source |
|---|---|---|---|
| Publishers | FNFE-MPE (France) and FeRD (Germany), jointly. Factur-X = ZUGFeRD 2.x. | verified | S23, S24 |
| Current version | **Factur-X 1.09.2 = ZUGFeRD 2.5.2**, information package dated 2026-08-04. The bundled XSLT header says "Release date: 2026-08-04, Effective date: 2026-09-01". | verified | S24, S26 |
| Syntax | UN/CEFACT CII **D22B** (the CEN artefacts use D16B). Our one-note sample was valid against both the CEN D16B XSD and the Factur-X EN16931 XSD, so one CII output can serve both. | verified; verified (ran) | S23 |
| Profiles | MINIMUM, BASIC WL, BASIC, EN 16931, EXTENDED, each with its own XSD and schematron. EXTENDED-CTC-FR is a French extension of EXTENDED. | verified | S23, S26 |
| 2.5.2 changes | BR-CO-27 renamed to CII-SR-470 in BASIC WL / BASIC / EN16931, with no functional change. EXTENDED gets several BR-FXEXT-* replacements. The next release is "expected … in autumn 2026" and will add gross invoices and parts of the EN 16931 revision. | verified | S24 |
| Official download | fnfe-mpe.org and ferd-net.de give the package only after an email form. **Not submitted** (§6 F1). | verified | S23, S24 |
| Licence of the XSD and schematron | **Not found.** Neither page states redistribution terms. Treat it as unknown. | verified (absence on S23, S24) | S23, S24 |
| Mirror | Akretion `factur-x` (BSD-style code licence; 7.7 on PyPI, 2026-10-14; 311 stars) bundles the 1.09.2 artefacts. Example: `src/facturx/xsd_and_schematron/facturx-en16931/{Factur-X_EN16931.xsd, FACTUR-X_EN16931.xslt (652,613 B), FACTUR-X_EN16931_codedb.xml}`. It also bundles `cii-schematron-fr-ctc/BR-FR-Flux2-Schematron-CII.xslt`, `cii-extended-ctc-fr/`, and `ubl-2.1/` (BR-FR-Flux2 UBL, EXTENDED-CTC-FR UBL, a copy of the CEN UBL XSLT). Its README does not state the licence of these artefacts. | verified | S26 |

### 3.2 Exact PDF requirements

The official specification PDF was not read (F1), so each line below says where it comes from.
"veraPDF" means the line is enforced by the PDF/A-3 validation that our sample passed.

| # | Requirement | Status | Source |
|---|---|---|---|
| P1 | The file is **PDF/A-3**, conformance **B** at minimum. XMP has `pdfaid:part` = 3 and `pdfaid:conformance` = B. | inferred: both independent implementations write exactly this; veraPDF validates it | S26, §1.5 |
| P2 | **Every font is embedded.** A non-embedded Helvetica fails ISO 19005-3 §6.2.11.4.1. | verified (ran, veraPDF) | — |
| P3 | An **OutputIntent** `/S /GTS_PDFA1` with an embedded ICC profile (sRGB, N = 3), required as soon as device RGB is used | verified (ran, veraPDF passed with it); the e-invoice-eu ICC is 3,024 B | §1.5 |
| P4 | One embedded file named **`factur-x.xml`**: filespec `/F` and `/UF` = `factur-x.xml`, `/Type /Filespec`, `/EF << /F … /UF … >>`, `/Desc` | inferred (S26 code; e-invoice-eu output identical); veraPDF checks the PDF/A part | S26 |
| P5 | The embedded stream has `/Type /EmbeddedFile`, `/Subtype /text#2Fxml` (MIME `text/xml`) and `/Params` with `/ModDate`. Akretion also writes `/Size` and `/CheckSum` (MD5). | inferred (S26); MIME subtype verified (ran) in both outputs | S26 |
| P6 | **`/AFRelationship`** on the filespec, and the catalog lists it in **`/AF [ … ]`** and in the `/Names /EmbeddedFiles` tree. Akretion allows `Data`, `Source` or `Alternative` for the XML (default `Data`) and **forces `Data` for MINIMUM and BASIC WL**. e-invoice-eu writes `Alternative`. Vendors disagree: one doc says Alternative is always required; another says the German rules need Data for MINIMUM/BASIC WL and Alternative for BASIC and up, and that France allows all three. | inferred | S26, S29 |
| P7 | XMP has the **Factur-X PDF/A extension schema** (namespace `urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#`, prefix `fx`, four Text properties of category `external`) and the values `fx:DocumentType` INVOICE, `fx:DocumentFileName` `factur-x.xml`, `fx:Version` `1.0`, `fx:ConformanceLevel` ∈ {MINIMUM, BASIC WL, BASIC, EN 16931, EXTENDED}. The case of "CrossIndustryDocument" and the trailing `#` matter. | inferred (S26 template + level map; e-invoice-eu identical). veraPDF checks only that the extension schema is declared, not the values. | S26 |
| P8 | Inside the XML, `GuidelineSpecifiedDocumentContextParameter/ID` (BT-24) is `urn:cen.eu:en16931:2017` for profile EN 16931. BASIC uses `…#compliant#urn:factur-x.eu:1p0:basic`, EXTENDED uses `…#conformant#urn:factur-x.eu:1p0:extended`, MINIMUM and BASIC WL use `urn:factur-x.eu:1p0:{minimum,basicwl}`. Akretion reads the level from this value. | inferred (S26 code comments) | S26 |
| P9 | The usual PDF/A-3 bans apply: no encryption, no JavaScript, no external content, and XMP consistent with the Info dictionary | inferred (ISO 19005-3 summary; veraPDF enforces it) | — |

**Our decision (AFRelationship):** use `Alternative` for EN 16931, BASIC and EXTENDED, and `Data`
for MINIMUM and BASIC WL. Every reading above accepts this choice; the strictest one (German)
requires it. Revisit once F2 is closed.

### 3.3 Which JS library

- **`@cantoo/pdf-lib` 2.11.1** (MIT, published 2026-09-15, 1,140,576 / week) **+ `@cantoo/fontkit`
  2.0.12** (MIT, 2026-09-11, 30,783 / week). It is the maintained fork of pdf-lib, and
  e-invoice-eu builds its veraPDF-passing PDF/A output on it. It gives low-level access to
  `PDFName` / `PDFDict` / streams for `/AF`, the filespec, XMP and OutputIntent.
  [verified, S28, S2, 2026-10-17]
- Measured bundle cost with esbuild (minified ESM, browser target):
  - `@cantoo/pdf-lib` alone: 596,849 B (251,388 gzip);
  - with `@cantoo/fontkit`: 978,859 B (405,938 gzip).

  Load it with a dynamic `import()` only when the user exports a Factur-X file (our decision):
  it lives behind its own entry, `@fi/core/pdf`. [verified (ran), 2026-10-17]
- **M1 update (2026-10-18): no embedder of our own.** 2.11.1 ships `embedFacturX(doc, xml, options)`
  (`src/api/pdfa/facturx.ts`): it calls `convertToPDFA({ conformance: '3B' })` (sRGB output
  intent, `/ID`, XMP with `pdfaid` and Info kept in sync), adds the `fx:` properties and the PDF/A
  extension schema, and attaches the XML with `/AF` and `/AFRelationship` (default `Alternative`).
  That is P1 and P3–P7 of §3.2. We only draw the page, embed DejaVu subsets (P2) and replace the
  random `/ID` with a hash of the XML and the date, so the same invoice gives the same bytes
  (`fixtures/golden/pdf.sha256`). Code: `packages/core/src/pdf/`. [verified (ran): veraPDF 3b and
  the Akretion extractor pass on the 25 golden invoices, `pnpm --filter @fi/core pdf:check`]
- `@pdf-lib/fontkit` 1.1.1 does **not** work with `@cantoo/pdf-lib`: it crashes while subsetting
  ("reading 'pos'"). [verified (ran), 2026-10-17]
- Not chosen:
  - `pdf-lib` 1.17.1: 18.2 M / week, but last published 2022-05-12.
  - `pdfkit` 0.20.2 (10.5 MB): it writes new documents; attaching files with `/AF` was not
    checked.

  [verified metadata, S28, 2026-10-17]

### 3.4 Verification

- **veraPDF** (PDF/A-3b), image `verapdf/cli`, GPLv3. `v1.30.2` was tested (54 MB); `v1.30.3`
  (2026-10-07) is the latest. Each run takes about 12 s of wall time, mostly JVM start-up.
  [verified, S27; ran, 2026-10-17]

```bash
docker run --rm --network none -v "$DIR":/data:ro verapdf/cli:v1.30.2 \
  --flavour 3b --format text /data/invoice.facturx.pdf
# machine-readable: --format mrr  →  read isCompliant / failedRules from the XML report
```

- **Akretion extractor** (Python, run in its own venv). It checks that `factur-x.xml` is present
  and valid against the XSD of the profile it detects. Its schematron check needs a separate Saxon
  server; without one it skips that check.
  [verified (ran), S26, 2026-10-17]

```bash
python -I "$VENV/bin/facturx-pdfextractxml" -l debug invoice.facturx.pdf extracted.xml
```

- **Our own checks on the extracted XML:**
  - the Factur-X EN16931 XSD (`xmllint-wasm`);
  - the Factur-X EN16931 XSLT (SaxonJS, with `stylesheetBaseURI`);
  - the CEN CII XSLT.

  A pdf-lib read-back test asserts P4–P7.
  [our decision; each tool verified (ran) above]

  As built in M1: `src/pdf/pdf.test.ts` reads every golden PDF back (XML equals `toCii`, P4–P7,
  hashes); the oracle runs the XSD and XSLTs on the same XML (`test/oracle/`); veraPDF and the
  extractor run from `scripts/pdf-check.ts`, outside `pnpm verify` because both are outside
  `node_modules` (Docker image, Python venv).

---

## 4. Code lists

### 4.1 What CEN 1.3.17 carries

The values below were extracted from the `BR-CL-*` asserts in `EN16931-{UBL,CII}-codes.sch`.
Two patterns cover every rule: `contains(' A B C ', concat(' ', normalize-space(.), ' '))` and
`@mimeCode = '…'`. [verified (ran), S12, 2026-10-17]

| Rule | List | Codes | Notes |
|---|---|---|---|
| BR-CL-01 | UNTDID 1001 (BT-3 invoice type) | 62 | |
| BR-CL-03/04/05 | ISO 4217 currency | 178 | |
| BR-CL-06 | VAT point date code (BT-8) | 3 | **Syntax-specific:** UBL `3 35 432` (UNCL 2005), CII `5 29 72` (UNCL 2475). Store the meaning in our model and map it per syntax. |
| BR-CL-07 | UNTDID 1153 (reference qualifiers) | 818 | |
| BR-CL-08 | UNCL 4451 (BT-21 note subject) | 401 | CII only |
| BR-CL-10/11/21/26 | ISO 6523 ICD | 246 | Has 0002 (SIREN), 0009 (SIRET), 0225, 0249–0251. UBL BR-CL-10 also accepts `SEPA`. |
| BR-CL-13 | UNTDID 7143 (item classification) | 185 | |
| BR-CL-14/15 | ISO 3166-1 alpha-2 | 251 | Has `XI` and `1A` |
| BR-CL-16 | UNCL 4461 (payment means) | 84 | Has 30, 49, 58, 59 |
| BR-CL-17/18 | UNCL 5305 (VAT category) | 10 | `AE B E G K L M O S Z` |
| BR-CL-19 | UNCL 5189 (allowance reason) | 19 | |
| BR-CL-20 | UNCL 7161 (charge reason) | 178 | |
| BR-CL-22 | VATEX (exemption reason code) | 106 | Has 26 `VATEX-FR-*` and the 18 new `VATEX-ES-*` |
| BR-CL-23 | UN/ECE Rec 20 + Rec 21 (units) | 2,162 | Has DAY, C62, H87, HUR |
| BR-CL-24 | MIME codes (attachments) | 6 | `application/pdf`, `image/png`, `image/jpeg`, `text/csv`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/vnd.oasis.opendocument.spreadsheet` |
| BR-CL-25 | CEF EAS (electronic address scheme) | 103 | Has 0225 (French SIREN endpoint) and 9960 |

- **Version.** 1.3.17 carries the EC code lists **v18**. The EC registry lists
  "EN16931 code lists values v18 - used from 2026-11-15.xlsx", EAS v17 (September 2026) and
  VATEX v9. The newest genericode zip is `digital-genericodes-2026-05-15` (v17b); there is no v18
  genericode yet. Issue #525 names the additions (ICD 0249–0251, EAS 9960, 18 VATEX-ES), and all
  of them are present in the extracted lists. [verified, S15, S16; ran, 2026-10-17]
- **Other sources, and why not.**
  - The EC xlsx/genericode is official, but its version can drift from the oracle.
  - The Factur-X `*_codedb.xml` covers only Factur-X, and its licence is unknown.
  - e-invoice-eu ships only UNTDID 1001 and 4451 as CSV.
  - The ICD PDF in the CEN repo is from 2018.

  [verified, S16, S26, S3, S13, 2026-10-17]

### 4.2 Is extracting from the schematron the simplest way?

**Yes.**
- It is one ~60-line script over two vendored files. My extractor is a short regex pass, and its
  output is 123 KB of JSON for both syntaxes.
- The lists are, by construction, exactly what the oracle accepts. A code we accept and the
  oracle rejects, or the reverse, cannot happen.
- When CEN bumps the version, re-vendor and regenerate. The diff of the generated file *is* the
  code-list changelog. [verified (ran), 2026-10-17]

Our decision: `pnpm codelists:gen` writes
`packages/core/src/codelists/generated.ts` (`as const` arrays + `Set`s, with the CEN version and the
sha256 of the source `.sch` in a header). A unit test regenerates it in memory and fails on any
drift. Names (labels) for the UI are not in the schematron. If the add-in needs labels, take them
from the EC xlsx later and key them by code; validity still comes only from the schematron.

---

## 5. Recommendation for M1

### 5.1 Dependencies

| Package | Version | Where | Licence | Size (unpacked → our measure) | Weekly | Rule 7 line needed |
|---|---|---|---|---|---|---|
| `@cantoo/pdf-lib` | 2.11.1 | `packages/core` | MIT | 26.3 MB (installs `culori`, `fflate`, `node-html-better-parser`, `html-entities`, `tslib`); bundle 597 KB min / 251 KB gzip | 1,140,576 | **yes** (> 1 MB) |
| `@cantoo/fontkit` | 2.0.12 | `packages/core` | MIT | 12.47 MB (installs `brotli`, `dfa`, `fflate`, `restructure`); adds 382 KB min / 155 KB gzip | 30,783 | **yes** (> 1 MB) |
| `@xmldom/xmldom` | 0.9.12 | `packages/core` | MIT | 0.44 MB, no dependencies; 94 KB min / 31 KB gzip | 58.3 M | no |
| `saxon-js` | 2.7.0 | dev, `packages/core` | Saxonica v1.0 | 2.40 MB + `axios` 2.2 MB | 92,995 | **yes** (> 1 MB) |
| `xslt3` | 2.7.0 | dev, `packages/core` | Saxonica v1.0 | 42 KB | 56,570 | no |
| `xmllint-wasm` | 5.3.0 | dev, `packages/core` | MIT | 0.89 MB installed | 410,929 | no |

[verified: S2, S17, S18, S28; sizes and bundles ran, 2026-10-17]

**Why `@xmldom/xmldom` for parsing.** `packages/core` runs in the task pane *and* in Node, and
Node 22 has no `DOMParser`, so one namespace-aware DOM gives a single code path. On our outputs,
parsing plus lookup took 7.6 ms (CII) and 3.1 ms (UBL). With a throwing `onError`, it **rejects**
DOCTYPE entities, both external (`SYSTEM "file:///etc/hostname"`) and internal ("entity not
found"), and rejects malformed XML. So there is no XXE and no entity expansion.
[verified (ran), 2026-10-17]

Rejected:
- `fast-xml-parser` 5.11.2: 1.32 MB, and it is not a DOM, so namespaces turn into prefix strings
  (inferred).
- `libxmljs2` 0.37.0: native addon, Node only (inferred).
- `xmlbuilder2` 4.0.3: it fails to bundle for the browser without a Node `events` polyfill
  (esbuild: `Could not resolve "events"`), and pulls 2.4 MB of `@oozcitak/*` plus `js-yaml`.

[verified (ran) for xmlbuilder2, 2026-10-17]

**Lines to add to `docs/DEPENDENCIES.md`** when the packages land (our decision, wording proposed):

| Package | Why it is worth it |
|---|---|
| `@cantoo/pdf-lib` (core) | Only maintained pure-JS PDF library with the low-level access Factur-X needs (`/AF`, filespec, XMP, OutputIntent); runs in the task pane and Node; loaded lazily (≈ 251 KB gzip). |
| `@cantoo/fontkit` (core) | Embeds and subsets TrueType fonts. PDF/A-3 forbids non-embedded fonts (veraPDF 6.2.11.4.1), and `@pdf-lib/fontkit` crashes with `@cantoo/pdf-lib`. |
| `saxon-js` (dev, core) | Runs the official CEN EN 16931 schematron (XSLT 2) in Node with no Java: the oracle behind `pnpm test`. Proprietary but free; npm redistribution allowed. |

### 5.2 What we write ourselves

- **Model.** The EN 16931 BT/BG model. Money in integer cents; scaled integers for BT-129/BT-146.
  Nothing from the e-invoice-eu JSON shape.
- **Calculation.** Line totals, document totals, VAT breakdown (BG-23) and rounding. None of the
  libraries computes anything.
- **Builders.**
  - **CII**: one output valid against both the CEN D16B XSD and the Factur-X 1.09.2 EN16931 XSD.
    Element order follows the XSD sequences. One `ram:IncludedNote` per BT-22 (avoids D2).
    BT-13 is always written (avoids D1). BT-23 is set explicitly (B1/S1/M1 for France, avoids D3).
  - **UBL 2.1**: same rules.
  - Both are written as a small string writer with XML escaping (our decision; no XML builder
    dependency).
- **Parsers.** CII and UBL → model, on `@xmldom/xmldom`, using namespace-URI lookups and never
  prefixes.
- **Rules.** BR-*, BR-CO-*, BR-DEC-*, the VAT-category families, BR-CL-* via the generated lists,
  and **BR-CO-25** (absent from CEN 1.3.17; enforced by Factur-X EXTENDED and EXTENDED-CTC-FR).
  Use exactly the CEN rule ids, so our results and the oracle's compare as sets. French checks
  (SIREN/SIRET/VAT/IBAN, mentions) keep their own ids. The French BR-FR-Flux2 XSLT is a possible
  second oracle later (F5).
- **Factur-X embedder** on `@cantoo/pdf-lib`: XMP with `pdfaid` and the `fx` extension schema,
  OutputIntent with an sRGB ICC profile (F4), filespec, `/AF`, `/Names/EmbeddedFiles`,
  AFRelationship per §3.2.
- **Visual PDF renderer.** Embedded TTF only (P2). The site already self-hosts Inter; check that
  its licence allows embedding in PDFs (F6).

### 5.3 How the oracle runs in `pnpm test`

All of this is our decision, built from the measurements above.

1. **Vendored files** in `packages/core/test/oracle/cen-1.3.17/`:
   - the CEN `xslt/`, `schematron/` (incl. `codelist/`), `examples/` without the 3.3 MB Italian
     file, `test/` unit tests (2.0 MB) and the CII D16B XSD (576 KB);
   - `LICENSE.txt` (EUPL-1.2), the UN/CEFACT notice, and a `SOURCE.md` with the tag, URLs and the
     two zip sha256 values.

   That comes to about 6 MB. File headers stay untouched.
2. **Fetched, not committed**:
   - the 16 UBL 2.1 XSD files from OASIS (F3);
   - the Factur-X 1.09.2 EN16931 XSD, XSLT and codedb from Akretion commit `8b549890ca51085eaf26d71085be2af478249839` (F1).

   `pnpm oracle:fetch` downloads them into `packages/core/.oracle-cache/` (gitignored) and checks
   pinned sha256 values. It is idempotent and a no-op when the files are already there. It is
   chained before the oracle tests and in the RUNBOOK. It needs network access once, like
   `pnpm install`.
3. **Compile once, then cache.** A Vitest `globalSetup` compiles each XSLT to SEF with `xslt3` if
   `.oracle-cache/sef/<sha256(xslt)>-saxonjs-2.7.0.json` is missing.
   - Cold: about 15–18 s per stylesheet (CII, UBL, Factur-X: about 47 s in total) and up to
     0.7 GB RSS.
   - Warm: about 50 ms per SEF to parse.
   - SEF files are never committed (5–7 MB each, derived files).
4. **Oracle tests** (`*.oracle.test.ts`, their own Vitest project with a 60 s timeout).
   - Every fixture goes through our builder → `xmllint-wasm` XSD → SaxonJS CEN XSLT (and the
     Factur-X XSD/XSLT for CII).
   - The test asserts **no fatal hit**, and **set(our fatal `BR-*` ids) == set(oracle fatal `BR-*`
     ids)**. Syntax rules (`UBL-CR-*`, `CII-SR-*`, `CII-DT-*`) are the builders' job and are only
     checked as "no fatal". Rules CEN does not carry (BR-CO-25, our FR checks) sit on an explicit
     allow-list.
   - The CEN unit-test payloads (UBL) are parsed by *our* UBL parser and checked by *our* rules
     against their `success`/`error` expectations. That turns 1,131 official tests into tests of
     our validator.
   - Budget: about 0.1 s per fixture; a 40-fixture corpus runs in under 10 s warm.
5. **Outside `pnpm verify`** (Docker is not guaranteed on a fresh machine):
   - `pnpm test:pdfa` runs veraPDF and the Akretion extractor on generated PDFs. It is required
     before merging any change under `packages/core/src/facturx/`.
   - `pnpm oracle:java` runs the Saxon-HE cross-check.
   - `pnpm oracle:selftest` replays the CEN unit tests through the oracle itself (40 s) after
     each CEN bump.

### 5.4 What to vendor, and under which licence

| Artefact | Licence | Decision |
|---|---|---|
| CEN 1.3.17 XSLT, schematron, code lists, examples, unit tests | EUPL-1.2 (verified, S13) | Vendor, with `LICENSE.txt`. Our own code is not a derivative of the XSLT; we only run it in tests. |
| CII D16B XSD (from the CEN repo) | UN/CEFACT notice: copying allowed (verified, S13) | Vendor, notice kept |
| UBL 2.1 XSD (16 files) | OASIS: "All Rights Reserved" header; CEN does not redistribute it (verified, S13, S22) | Fetch with sha256 pins (F3) |
| Factur-X 1.09.2 XSD, XSLT, codedb | Unknown (verified absence, S23, S24) | Fetch from the pinned Akretion commit with sha256 (F1) |
| SaxonJS / xslt3 | Saxonica v1.0 (verified, S17) | npm dev dependency only; never bundled into the add-in |
| Saxon-HE 12.10 jar | MPL-2.0 (verified, S20) | Downloaded by `pnpm oracle:java`, sha1/sha256 checked |
| veraPDF | GPLv3 (verified, S27) | Docker image only, never linked |
| sRGB ICC profile | To check (F4) | Vendor in `packages/core` once F4 is closed |

---

## 6. Open TODO(verify)

| # | Open question | Meanwhile | How to close it |
|---|---|---|---|
| F1 | Licence of the Factur-X 1.09.2 XSD, schematron and codedb; and the official spec text | Fetch from the pinned Akretion commit; never commit them | The **owner** fills in the FNFE-MPE form (it needs an email; an agent must not submit it) or asks FNFE-MPE in writing |
| F2 | Official AFRelationship rule for profile EN 16931 | `Alternative` for BASIC and up, `Data` for MINIMUM/BASIC WL (§3.2) | Read the spec from F1 |
| F3 | Can the 16 OASIS UBL 2.1 XSD files be committed? | Fetch them with sha256 pins | Read the OASIS IPR / copyright notice in the UBL 2.1 package |
| F4 | Source and licence of the sRGB ICC profile (the one e-invoice-eu embeds is 3,024 B) | Embed the profile pdf-lib users commonly ship, in tests only | Pick a profile with an explicit redistribution licence (for example from color.org) and record it |
| F5 | Origin, version and licence of `BR-FR-Flux2-Schematron-{CII,UBL}.xslt` (bundled by Akretion; about 120 distinct BR-FR ids) | Not used as an oracle in M1; French checks stay in our own rules | Trace it to the DGFiP / AFNOR publication |
| F6 | Licence terms for embedding Inter (or another TTF) in generated PDFs | Tests use DejaVu Sans (as in this research) | Check the font licence before shipping the renderer |
| F7 | CEN code lists v18 apply from 2026-11-15, and before that date v17 is in force | Use 1.3.17 (v18) | Decide whether a pre-2026-11-15 invoice may use a v18-only code; low impact |
