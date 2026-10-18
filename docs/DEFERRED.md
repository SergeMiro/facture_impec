# Deferred

Things that exist in the old MVP or come to mind, but no milestone's acceptance criteria need them.
Each line says where it came from and what would bring it back.

| Item | Origin | Bring back when |
|---|---|---|
| Import of PDF invoices (text extraction + regex field extractor, `/api/import`) | MVP Phase 5 (`crates/facture-backend/src/ocr` on branch `archive/rust-mvp-v1`) | A pilot customer keeps invoices as PDFs instead of Excel rows. |
| Word documents as input | MVP Phase 6 idea | Never for emission (a .docx is not structured); maybe extraction, on demand. |
| Turborepo remote cache | M0 scaffold | CI runs on GitHub again and builds get slow. |
| Golden input as `.xlsx` (plan §2 `fixtures/golden/*.xlsx`) | M1: the golden input is the invoice model as JSON | M3, with the MappingAgent: the spreadsheet → model step is its job. |
| Allowances and charges given only as a percentage (BT-94 × BT-93 → amount) | M1 compute.ts: the amount (BT-92 / BT-136) is required and used; a percentage is carried as written | M3, if the MappingAgent meets sheets with « remise 5 % » and no amount. |
| BR-CO-21…24, BR-17…20, BR-51, BR-52, BR-54, BR-56, BR-65 (reason codes, payee, tax representative, attachments, item classification) | M1 rules | The add-in can capture those fields (payee, tax representative, attachments, item classification). |
| BG-10 payee, BG-11 tax representative, BG-18 card payment, BG-24 attachments, BG-32 item attributes | M1 model | Same: a customer needs them; the builders then write them. |
| Self-billing (BR-FR-22, type 389) | M1 rules | An accountant tenant issues invoices on behalf of its suppliers. |
| Automatic fixes applied to the sheet (`autoFixable` rules) | M1: rules carry the flag | M3, ExplainAgent + « Corriger dans la feuille ». |
| Several preceding invoices (BG-3) in CII | M1: the model keeps a list, Factur-X allows it, D16B allows 0..1 | A corrective invoice must cite two invoices; check the CII D16B XSD first. |
| Unknown BT-8 code on import | M1 parsers: dropped, the model only knows invoice / delivery / payment | A supplier sends another UNTDID 2005/2475 code. |
| Credit note BT-9 in UBL without a payment means | M1: UBL puts it in `cac:PaymentMeans` (UBL-SR-46), so it is lost without one | A credit note needs a due date and no payment means. |
| Unit code of a quantity without value | M1 parsers: lost with the missing quantity | Never, unless an import shows it. |
| BT-7 / BT-8 in CII without a VAT breakdown | M1: CII writes them in the first BG-23 (CII-SR-461/462) | Never: a valid invoice always has a breakdown. |
| BT-6 equal to BT-5 in CII | M1: left out, CEN CII rejects it (BR-53); UBL keeps it | Never: it carries no information. |
| PDF design (logo, colours, tenant layout) and the product font choice | M1: one plain A4 layout in DejaVu Sans | M3, with the add-in's « Voir le PDF ». |
| A table row taller than a page in the PDF | M1 render.ts: a row is never split | A line description longer than about 60 lines. |
| `MINIMUM` / `BASIC WL` Factur-X profiles (AFRelationship `Data`) | M1: only EN 16931 is written | A PDP asks for a lighter profile. |
