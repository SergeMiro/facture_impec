# CEN EN 16931 validation artefacts 1.3.17

Copied unchanged on 2026-10-17 from the official CEN release
https://github.com/ConnectingEurope/eInvoicing-EN16931/releases/tag/validation-1.3.17
(research and measurements: `docs/research/FORMATS.md` §2 and §4).

| Path here | Taken from | sha256 of the source archive |
|---|---|---|
| `xslt/EN16931-CII-validation.xslt`, `codelist/EN16931-CII-codes.sch`, `examples/cii/` | `en16931-cii-1.3.17.zip` | `e5f3235824b6b38454b1d54cf3f14e01efb5b33971fbefc4e64997d0ef619e89` |
| `xslt/EN16931-UBL-validation.xslt`, `codelist/EN16931-UBL-codes.sch`, `examples/ubl/` | `en16931-ubl-1.3.17.zip` | `bf02a0e3f6cbe692a4a28e70be7bdcaded5612b4169b543e13d6cb4f33c29e92` |
| `cii-d16b/` | repository tag, `cii/schema/D16B SCRDM (Subset)/uncoupled clm/CII/uncefact` | — |
| `LICENSE.txt` | repository tag (the zips do not contain it) | — |

Left out: the 3.3 MB Italian example `FT G2G_TD01 con Allegato, Bonifico e Split Payment.xml`.

Licences: the CEN artefacts are under the EUPL-1.2 (`LICENSE.txt`). The CII D16B schemas carry the
UN/CEFACT notice in each file header, which allows copying. We only run these files in tests and
generate our code lists from `codelist/` (`pnpm --filter @fi/core codelists`); none of them is
bundled into the add-in.

Not here on purpose (fetched with pinned sha256 by `pnpm --filter @fi/core oracle:fetch`): the OASIS
UBL 2.1 XSD and the Factur-X 1.09.2 XSD/XSLT, whose redistribution terms are not stated
(`FORMATS.md` §6, F1 and F3).

To upgrade: download the new release zips, check their sha256 against the release page, replace this
folder, update this file, run the code-list generator, and read the diff of
`src/codelists/generated.ts`: it is the code-list changelog.
