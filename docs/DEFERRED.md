# Deferred

Things that exist in the old MVP or come to mind, but no milestone's acceptance criteria need them.
Each line says where it came from and what would bring it back.

| Item | Origin | Bring back when |
|---|---|---|
| Import of PDF invoices (text extraction + regex field extractor, `/api/import`) | MVP Phase 5 (`crates/facture-backend/src/ocr` on tag `archive/rust-mvp-v1`); R6 takes Factur-X, UBL and CII, and refuses a plain PDF | A pilot customer keeps invoices as PDFs instead of Excel rows; see « Reading a plain PDF invoice » below. |
| Word documents as input | MVP Phase 6 idea | Never for emission (a .docx is not structured); maybe extraction, on demand. |
| Turborepo remote cache | M0 scaffold | CI runs on GitHub again and builds get slow. |
| Golden input as `.xlsx` (plan §2 `fixtures/golden/*.xlsx`) | M1: the golden input is the invoice model as JSON | M3, with the MappingAgent: the spreadsheet → model step is its job. |
| ~~Allowances and charges given only as a percentage (BT-94 × BT-93 → amount)~~ | **Implemented 2026-10-24**: `computeInvoice` gives a percentage without an amount its amount from its base (given, else the line's gross amount, else the lines of its VAT category and rate). | — |
| BR-CO-21…24, BR-17…20, BR-51, BR-52, BR-54, BR-56, BR-65 (reason codes, payee, tax representative, attachments, item classification) | M1 rules | The add-in can capture those fields (payee, tax representative, attachments, item classification). |
| BG-10 payee, BG-11 tax representative, BG-18 card payment, BG-24 attachments, BG-32 item attributes | M1 model | Same: a customer needs them; the builders then write them. |
| Self-billing (BR-FR-22, type 389) | M1 rules | An accountant tenant issues invoices on behalf of its suppliers. |
| Automatic fixes applied to the sheet (`autoFixable` rules) | M1: rules carry the flag; M3: « Corriger dans la feuille » selects the cell and the user types | The owner decides the add-in may write the user's own cells, which plan §5 forbids today. |
| Several preceding invoices (BG-3) in CII | M1: the model keeps a list, Factur-X allows it, D16B allows 0..1 | A corrective invoice must cite two invoices; check the CII D16B XSD first. |
| Unknown BT-8 code on import | M1 parsers: dropped, the model only knows invoice / delivery / payment | A supplier sends another UNTDID 2005/2475 code. |
| Credit note BT-9 in UBL without a payment means | M1: UBL puts it in `cac:PaymentMeans` (UBL-SR-46), so it is lost without one | A credit note needs a due date and no payment means. |
| Unit code of a quantity without value | M1 parsers: lost with the missing quantity | Never, unless an import shows it. |
| BT-7 / BT-8 in CII without a VAT breakdown | M1: CII writes them in the first BG-23 (CII-SR-461/462) | Never: a valid invoice always has a breakdown. |
| BT-6 equal to BT-5 in CII | M1: left out, CEN CII rejects it (BR-53); UBL keeps it | Never: it carries no information. |
| PDF design (logo, colours, tenant layout) and the product font choice | M1: one plain A4 layout in DejaVu Sans; M3 « Voir le PDF » shows it as is | A pilot customer asks for their logo, or before the first paying customer (M7). |
| A table row taller than a page in the PDF | M1 render.ts: a row is never split | A line description longer than about 60 lines. |
| `MINIMUM` / `BASIC WL` Factur-X profiles (AFRelationship `Data`) | M1: only EN 16931 is written | A PDP asks for a lighter profile. |
| `pdf_ref` of plan §4 `inbound_queue`: the PDF of a received invoice | M6: the XML is read, triaged and shown; the PDF a supplier attached is not fetched or stored | The Réception screen offers « Voir la facture », with object storage for the files (M7 hosting). |
| Acknowledging received invoices on B2Brouter (`POST /invoices/{id}/ack`) | M4: `listInbound` asks for `ack=false` from the day before the last one stored and never acks; the unique index drops repeats. M6 triages them but still does not ack: no sandbox can deliver an invoice to try it on (`docs/B2BROUTER.md` T14) | The sandbox key is there: ack once a received invoice is stored and triaged, with a contract test. |
| Remaining plan §4 tables | M2–M4: only the tables routes and jobs use (`agent_runs` since M3, `inbound_queue` since M4) | The milestone whose feature writes them. |
| Bundling the API (esbuild/tsup) instead of `tsx` in the image | M2: `tsx`; M7: the Docker image runs `tsx` on the TypeScript source (`docs/DEPLOY.md`) | Start-up time or image size matters (several instances, autoscaling). |
| Scenarios against servers already running (`pnpm dev`, a hosted sandbox) | M2: each scenario starts its own in-process stack; M4: `pnpm scenario --provider b2brouter` runs them through the real adapter against the stand-in. The live sandbox has none of the mock's fault controls, so it gets the contract and the E2E instead (`docs/RUNBOOK.md`) | A hosted sandbox exists (M7) and wants a smoke run of the happy path. |
| ~~Listing invoices beyond `limit`/`offset` (search, date range, sort)~~ — **done 2026-10-24** (`apps/api/src/search.ts`, « Retrouver une facture » on the Tableau de bord) | M2: status filter only | — |
| Rate limiting on `POST /api/trial` beyond honeypot + fill time + one row per e-mail | Marketing site | Spam actually reaches the table; then Vercel WAF rule or Upstash rate limit. |
| Site in other languages, blog, analytics | Marketing site | The French pilot converts and there is content worth translating or measuring (analytics would need a consent banner). |
| Automatic trial provisioning from the site's form (account + install link sent on submit) | Marketing site; M7: the add-in's « Créer un compte » makes the account itself | The site points to the add-in's install link instead of collecting requests by hand, once the pane is public. |
| Names in a sheet column whose header does not announce them (« Cli. » is caught, « Partenaire » is not) reach MappingAgent unmasked when they carry no legal form | M3 masking.ts: header keywords + patterns + the dictionary's personal columns | A tenant's sheets show such columns; then mask every free-text column the dictionary cannot place, or show the model value shapes only. |
| DNS check of a BYOK endpoint (a public name that resolves to a private address) | M3 providers/net.ts checks the URL as written | Before BYOK is offered outside the pilot: resolve and pin the address for the call. |
| Spend cap per tenant in euros (today: a daily token cap per tenant, same for every model) | M3 orchestrator | Pricing of the AI fair use is decided (`docs/research/PRICING.md` §3.2). |
| Pseudonymization switch in Réglages | M3: shown on and locked; the API always pseudonymizes | A customer needs raw data sent to their own model (BYOK) and accepts it in writing. |
| Several companies for one e-mail | M3: the sign-in link opens the oldest company with that address | An accountant signs in for several clients: a company picker after the link. |
| Sheets over 5 000 invoice rows | M3: the add-in says the sheet is too big and stops (the API refuses more too) | A customer's sheet is that big: read and sync it in chunks. |
| Excel-on-the-web E2E run | M3: `e2e/excel-web.spec.ts` written, skipped without an account; its Excel selectors are `TODO(verify)` | The owner provides a Microsoft account that can upload an add-in (`docs/RUNBOOK.md` § E2E). |
| Sideload scripts tried on Windows and Mac | M3: written from Microsoft's guides, run on neither | First session on a Windows or Mac machine with Excel. |
| Splitting the task pane bundle (781 kB minified, 222 kB gzipped, one chunk after M7) | M3: served from localhost, Vite warns above 500 kB; M7 kept one chunk | Pilots find the first load slow on their connection: lazy-load Réglages, Abonnement and the fiche's XML/PDF views. |
| Chase drafts reworded by a model (tone, the customer's history) | M5: deterministic templates in `fr.json`; no model writes amounts, dates or legal text | A pilot customer finds the templates stiff; then a model rewrites only the wording around the code-written facts, with an eval. |
| ~~Partial payments and instalments~~ — **done 2026-10-24** (`apps/api/src/payments.ts`: an amount per payment, the balance chased, one platform report per payment) | M5: « Encaissée » recorded the whole amount payable | — |
| ~~Credit notes generated from a refusal~~ — **done 2026-10-24** (§4: « Établir un avoir » on the fiche, `apps/api/src/credits.ts`) | M5: the MonitorAgent proposes « avoir » and drafts the message; the user issued the credit note in their own tool | — |
| Chasing again after a dispute is settled | M5: a refusal or a dispute pauses the plan, and the state machine has no way back from `refused_by_customer` to the chased states | The state machine gets a « litige réglé » transition back to `accepted`; the plan then resumes from the next step. Since §4 (2026-10-24) a refused invoice is settled by a credit note and a new invoice (AFNOR XP Z12-014 use case 5), which the new invoice's own plan chases: bring this back only if the platform lets a customer withdraw a refusal (`docs/B2BROUTER.md` T7, T8). |
| Weekly report per person (opt-out, HTML) | M5: one plain-text mail to every owner of the company | An owner asks to stop it. |
| Send throughput beyond one API process | M5 k6: 4 send workers per process, about 8 invoices/s end to end (`docs/PROGRESS.md` M5) | A company sends several thousand invoices at once, or several API processes share the queue. |
| Formal-notice wording reviewed by a lawyer | M5: written from articles L441-10 and D441-5 of the Code de commerce; always a draft the user reads and sends | Before the first paying customer uses it: the owner or a lawyer reads `chase.body.formal_notice`. |
| Telling the supplier's platform what the buyer decided (lifecycle statuses « approuvée », « contestée », « refusée », « payée ») | M6: « Bon pour paiement » and « Contester » stay in Facture Impec; nothing is sent to the platform | B2Brouter's way of reporting a buyer's decision is read in its docs and recorded in `docs/B2BROUTER.md`; then each decision is reported once, like « Encaissée ». |
| Charge accounts per supplier or per line, analytic codes | M6: every charge goes to 606000 in the FEC (`docs/ACCOUNTING_EXPORT.md`) | An accountant asks for it: a supplier → account table in Réglages, applied at export. |
| Invoices in another currency in the FEC | M6: they stay in the CSV only (no exchange rate) | A customer receives foreign-currency invoices regularly: the rate of the invoice (BT-6 total in EUR) or of the day, with `Montantdevise` / `Idevise`. |
| Disputing or re-exporting an invoice already exported | M6: an exported invoice stays exported; reversing it is the accountant's entry | Users ask to correct an export: a reversing entry in the next FEC. |
| Paying a supplier from the screen (payment file SEPA, bank link) | M6: « Bon pour paiement » is a decision recorded for the user and the accountant; no money moves | Plan stage after M7, and only with an explicit decision per payment. |
| Mock platform ids after a restart | M4: `apps/mock-pdp` numbers inbound documents and invoices from 1 again after a restart, so a received id can equal one stored before; the unique index on (tenant, provider, pdp_ref) then drops the new one. M6's test injection no longer goes through the mock | Someone loses a mock delivery in local work: persist the mock's counters or prefix ids with a start time. |
| Stripe thin events instead of snapshot events | M7: one snapshot endpoint pinned to `2026-09-30.endive` (`docs/BILLING.md` §4) | Stripe deprecates snapshot events, or a second endpoint is needed anyway. |
| Metronome instead of Stripe Billing Meters | M7: meter events, which Stripe marks « not recommended » for new integrations but supports (`docs/BILLING.md` §7) | Stripe announces the end of Meters, or pricing needs credits or commitments. |
| Per-dossier billing for accounting firms (Cabinet plan) | M7: on quote, outside Stripe (`docs/research/PRICING.md`) | A firm brings several client companies and wants one invoice for all. |
| Chasing e-mails sent under the accounting firm's name | M7: the full white label signs the weekly report; chasing mails keep the company's name, which is who chases | A firm chases on behalf of its clients and asks for it. |
| Asking existing companies to accept new terms | M7: `TERMS_VERSION` is checked at sign-up only; an account keeps the version it accepted | The CGU change after the first customers: a banner in the pane and `terms_version` updated on acceptance. |
| A company's sandbox account id kept apart from its live one | M7: one `pdp_account` for both, set by the operator (`docs/B2BROUTER.md` T22) | T22 shows that B2Brouter gives a company different ids in sandbox and production. |
| A VIES check right after a sync, or on demand from ~~an invoice~~ or Clients — **on demand from the fiche done 2026-10-24** (« Vérifier dans VIES », `checkBuyerVat`) | §6: the sweep asks within one sweep (5 minutes by default); the fiche asks now; Clients has no button: it lists French companies only (row below) | Right after a sync: people send intra-EU invoices within minutes of writing them. Clients: once it holds foreign customers. |
| Foreign customers in the customer directory | M8: Clients finds French companies only (SIREN), so a foreign customer stays as the sheet writes it, with no « Envoi automatique ». §6: VIES' answers are kept per number (`vat_checks`), not per customer | Companies invoice EU customers often enough to want them completed and sent automatically. |
| ~~Showing VIES' name and address next to the customer~~ — **done 2026-10-24** on the invoice's fiche (« Enregistré à ce numéro ») | Shown, not compared with the customer's name: the user sees the difference | A customer writes a wrong but valid number and nobody looks: compare the names (spelling, legal forms, transliteration) and warn. |
| VIES for suppliers' numbers on received invoices | §6: customers' numbers only | Received intra-EU purchases (autoliquidation) need the same proof. |
| Remembering that a member state is down | §6: a number VIES could not answer is asked again at each sweep (one request per 5 minutes per number at most) | VIES' availability page shows long outages, or VIES complains about the traffic. |
| VIES' consultation number with a real French requester | §6: sent and kept, its format not seen (`TODO(verify)`, `docs/ONBOARDING.md` §5.1) | The first real company's first check: record the format. |
| INSEE API Sirene as a second directory | M7: the DINUM Annuaire only, no key; when it is down the person types the company in | The DINUM API is unavailable too often for sign-ups, or its terms change. |
| An operator screen (companies, pilot status, go-live) | M7: `/admin/*` with `curl` (`docs/RUNBOOK.md` § Pilot) | More than a handful of companies, or someone other than the developer operates. |
| Store screenshots generated from the harness | M7: the owner takes them in Excel (`docs/APPSOURCE.md` §2) | A listing update needs new screenshots often. |
| Object storage with an immutability flag for the archive (S3 Object Lock or equivalent), and the last chain anchored outside the database | M8: `invoice_archive` in Postgres, written once by trigger, a hash chain per company; it leaves the machine with the database backup. Someone with superuser rights can still drop the trigger, and removing the newest row leaves no broken chain behind it | The owner opens a bucket in the EU with object lock; then each archived file is copied there, and each company's last chain is published or e-mailed daily so the newest row is covered too. |
| A company's own sandbox key and its own webhook secret | M8: a company key serves its real invoices; « Mode test » keeps the deployment's sandbox. We hold no webhook secret for the company's account, so its real invoices get their statuses from the sweep's polling, not from webhooks | B2Brouter documents a webhook secret per account, or a company asks to rehearse on its own sandbox. |
| A live company moving to another B2Brouter account | M8: once live, its key can be replaced but the account no longer changes, and the key cannot be removed | A pilot company changes its B2Brouter account: the operator takes it out of live, then the owner changes key and account. |
| B2Brouter's answer to a key on an account it does not know | M8: a 404 on the probe reads as « wrong account », a 401/403 as « wrong key » (`docs/B2BROUTER.md` §12, `TODO(verify)`) | The owner's sandbox key is there: try a wrong account once and record the answer. |
| More than 1 000 customers per company | M8: Clients lists the first 1 000 customers by name; a sync reads every customer at once | A company has that many: pagination in Clients and a lookup by the sheet's SIRENs and names only. |
| Suppliers in the directory (`parties.kind = 'supplier'`) | M8: the column exists, only customers are written; Réception reads suppliers from their invoices | A user wants to name or check a supplier before its first invoice arrives. |
| « Livré à une autre adresse » on a customer (BR-FR-14) | R0: the customer switches are « Exige son numéro de bon de commande » and « Organisme public »; the rules always run with `deliversElsewhere: false` | The mapping gets a delivery address (BG-15), or the customer card stores one: then the switch, the field and the rule arrive together, so the error it raises can be fixed. |
| ~~The registry table `rule_exceptions` (a finding the user accepted)~~ | R0–R2 | **Done in R7** (`rule_exceptions`, `item_synonyms`; `docs/ARCHITECTURE.md` › What R7 added). |
| The sweep split per company | R0: the sweep is one job for all companies: global queries find what is behind (`registryBehind` among them) and queue per-company or per-invoice jobs | Several hundred companies make one sweep slow, or one company's backlog delays the others: then one sweep job per company. |
| ~~Percentage discounts per line (« Remise 10 % »)~~ | **Implemented 2026-10-24**: the sheet field « Remise sur la ligne (en %) » (BT-138), computed by core; « 10 % » typed in the euros column is read as a percentage too. | Still left: a percentage charge on a line, a discount on the whole invoice from a sheet column (one per VAT rate), and percentage discounts in the « Commandes » / « Achats » sheets (R1, R3 read euros only). |
| An article reference written by the customer (BT-156) or a standard identifier (GTIN, BT-157) in the sheet | R0: the sheet gives the company's own reference (BT-155); the registry reads BT-156 and BT-157 from received invoices | A customer asks for its own references on the invoices, or a seller of goods for GTINs. |
| A first sync written in batches | R0: a sheet's new invoices are written one by one, 7 statements each (invoice, verdict, events, audit); 4 999 new invoices take 62 s on PGlite (`docs/PROGRESS.md` R0) while a repeat sync takes 2 s | A first sync of a full sheet in production takes more than 30 s, or a proxy in front of the API cuts long requests: then multi-row inserts per batch of invoices. |
| A « FI_Registre » sheet or a CSV export of the registry | R1: the registry is seen in the pane (« Registre ») and in the RGPD export | A user wants to filter or pivot the registry in Excel, or hand it to their accountant. |
| Sending only the rows that changed | R1: each change in an included sheet sends the whole sheet (5 000 rows at most); the API skips it when the etag is unchanged and writes only the documents whose content changed | A sheet near the limit makes each change slow to upload, or the upload weighs on a mobile connection. |
| Included sheets of more than 5 000 rows | R1: the same limit as the invoice sheet (`MAX_ROWS`); a longer sheet is refused with the usual message | A pilot company keeps years of orders in one sheet: then reading by blocks, which needs « sending only the rows that changed » first. |
| Suppliers' price lists | R1: a price list is the company's own selling prices, one document with no other party | R2 compares purchase prices against what suppliers promised, or a user includes a supplier's tariff sheet. |
| A cost price column in a price list | R1: a price list reads reference, designation, unit, unit price and VAT rate only | A check needs the margin (a sale below cost). |
| One table for the invoice sheet's mapping and the other sheets' layouts | R1: the invoice sheet keeps `sheet_mappings` (M3); the other sheets use `layout_profiles` | A third kind of mapping appears, or a change has to be made twice. |
| A status column written into an included sheet (read, not understood) | R1: the sheet is never written; its card in « Registre » counts the rows not understood | Users ask which rows were not read. |
| LayoutAgent recorded again, and a gating recording from a paid provider | R1: the gate is ≥ 95 % on the kind and key fields; the free llmfp recording is not a gate (`delivery-04` fell back after 3 retries) | The owner chooses the included provider (`docs/AI_PROVIDERS.md`): record it with `gate: true`. |
| Suggesting other sheets from their headers | R1: the Tableau de bord suggests a sheet only by its name (« Commandes », « BL », « Achats », « Tarifs »): the pane reads no sheet before the user asks | Users keep orders in sheets named otherwise (« Feuil2 ») and miss the suggestion; reading headers then needs its own consent. |
| An included sheet renamed or moved to another workbook | R1: the sheet is followed by its name; renamed, its card says it is missing, and including it again under its new name finds its layout by its headers. `WorksheetCollection.onNameChanged` is ExcelApi 1.17 (`docs/OFFICE.md` §5, checked 2026-10-19), above the ExcelApi 1.7 the manifest requires | Users rename sheets often enough to complain: then follow the sheet by its id where 1.17 is available. |
| ~~« C'est normal (remise accordée) » on a finding, and the exceptions it leaves~~ | R2 | **Done in R7** for price findings, per customer and article or per article, 3 or 12 months or no end; what is left is in the rows below. |
| MatchAgent (an LLM proposing links the rules cannot find) and ExplainAgent (an LLM wording a finding) | R2: the Linker is deterministic (number, then customer + articles + quantities); messages are `fr.json` templates filled with the rule's numbers | Users have orders the Linker misses (other references, reworded designations), or the templates read too stiff; the agents propose, a rule or a person still decides. |
| The Linker matching a customer whatever its legal form (« Boulangerie Martin » and « Boulangerie Martin SAS ») | R2: without a SIREN on both sides, the Linker matches names after accents, case and punctuation are dropped, not legal forms (B6 is laxer: one name inside the other is the same customer) | Pilot data shows orders written without the legal form: then strip SAS, SARL, EURL… in `partyKey`, with tests that two different companies stay apart. |
| B6 on the delivery address | R2: B6 compares the customer's SIREN, else its name | The invoice or the order carries a delivery address (BG-15). |
| Units (a box of 12 against 12 pieces) | R2: quantities are compared as written; the unit is read but not converted. R3: a purchase in another unit gives no cost (C62, H87 and EA count as one piece) | A pilot company sells the same article in several units. |
| An invoiced article no order announced | R2: B1/B4/B5 compare the articles of the order; an extra article on the invoice is judged only against « Tarifs » (A5) | Users ask for « article non commandé » as a finding. |
| B4 against the delivery notes of an order | R2: an invoice with an order is compared with the order; delivered quantities count only for a delivery note billed directly | Partial deliveries billed in full before delivery show up in pilot data. |
| The 30 days of B3 as a company setting | R2: `UNBILLED_DAYS` = 30 for every company | A company invoices monthly or on another rhythm and finds the warning early or late. |
| Checking only what a change touches | R2: a check reads all the company's documents again (one query, then pure functions), once the documents' mark moved | A company's registry makes one check slower than a second or so: then check the documents linked to what changed. |
| The fiche's findings as fresh as « Contrôles » | R2: the fiche shows the findings of the last check (the registry job runs one after every sync); « Contrôles » and « Envoyer » check again first | Users see a fiche that lags behind the sheet for more than a few seconds. |
| Money at stake counted twice when B1 and B2 are about the same line | R3: « en jeu » adds the findings; the 300 € / 400 € invoice bought 10 × 35 € shows 100 € (B1) + 50 € (B2) = 150 €, although correcting the price to the order's 400 € fixes both | Users find the summary inflated: then count, per invoice line, the largest amount of its findings. |
| Supplier references tied to the company's own | R3: a purchase gives its cost by the company's own item on both sides, else by the same name; a supplier's reference alone ties nothing. R7: « Est-ce le même article ? » ties an article bought to one sold by name, once a person says « Oui » | Pilot catalogues carry suppliers' codes: propose pairs by code too. |
| A weighted average or FIFO cost | R3: the latest purchase on or before the sale (else the first in the 60 days after) | A pilot company holds stock bought at several prices and finds the warnings follow its last price too closely. |
| Charges and allowances of the whole purchase invoice in the cost | R3: the cost is the line's net price after the line's own discount; transport or a discount on the whole invoice is not spread over its lines | Users resell at a price that only loses money once transport is counted. |
| The « Achats » sheet's suppliers in `parties` | R3: only a received invoice's seller with a SIREN joins `parties`; an « Achats » row names a supplier without a SIREN, and stays in its document | A supplier screen, or a check that needs the supplier (a supplier who charged more than its own price list). |
| A margin per article, per family or per customer | R3: one minimum margin for the company (« Réglages »). R7: « C'est normal » on a B2 warning keeps it quiet for that article (and customer) | Users ask for a margin set per family rather than accepted case by case (row below). |
| A reason typed with « C'est normal » | R7: the exception keeps the rule, the customer, the article, the end, who and when; the finding it came from is in the audit | A person asks why a price was accepted, or an accountant wants it written down. |
| « C'est normal » on a delivery left unbilled (B3), a VAT rate (B6) or a sum (A1–A4) | R7: only price findings (A5, B1, B2, B4, B7) can be called normal; the others say the invoice is wrong, not unusual | A pilot company has a recurring case where one of them is right on purpose. |
| A margin per family of articles | R7: « C'est normal » on B2 per article and customer; one minimum margin for the company (R3) | A company with many articles asks for one margin per family. |
| Article synonyms by reference code, and between two sold articles | R7: proposed only between an article sold with no cost and an article bought, by name (shared words, same unit), 20 at most | Pilot catalogues show suppliers' codes in a column, or the same article sold under two names. |
| An action from the report's « Manque à facturer » line | R7: the weekly report says how many gaps and how much, and points to « Contrôles » | People read the report and ask for a link to each gap. |
| The supplier's details beyond its name, SIREN and address | R3: a supplier in `parties` keeps what its invoice says of it: name, SIREN, address; no VAT number, e-mail or platform routing | A feature needs to write to suppliers or check their VAT number. |
| ~~A draft avoir or facture rectificative for a sent invoice~~ — **avoir done 2026-10-24** (the refusal of a correction now points to « Établir un avoir »; a facture rectificative (384) stays in « After a send ») | R8: a correction of an invoice already sent is refused with the amount at stake | — |
| Corrections of more than one cell (a quantity, a discount, a whole line, a VAT rate — A4) | R8: the code builds a correction only when one unit price says it all (B1, B4, A5, A1); a line with a discount, or a finding a price does not fix, gets the steps instead | Pilot data shows findings people keep correcting by hand in the same way. |
| Writing into a workbook that is not open (a cloud file while Excel is closed) | R8: the pane writes only into the workbook it runs in; a finding of another workbook is named, nothing written. Plan R8: such writes may clash with co-authoring | Users correct invoices kept in a workbook they rarely open. |
| A first message written by a model (ExplainAgent, cached) | R8: the conversation opens on the finding's own wording, built by code (R2 deferred the ExplainAgent); the model speaks only when asked | The templates read too stiff for the first message, and the ExplainAgent exists. |
| The `candidates` tool (the documents that nearly matched) | R8: the agent reads the finding, one document and an article's history; « Oui / Non » on links stays in « Contrôles » | People ask the agent why an order was not linked. |
| Mastra (multi-step plans that pause for days) | R8: one turn of `ToolLoopAgent` (`ai` 7.0.143) per answer, at most 6 steps | The chat has to carry a plan over many invoices (« redo the quarter »). |
| One answer at a time per conversation | R8: two panes asking about the same finding at once both answer; the conversation kept is the last one to end | Users open the same workbook on two machines and lose a turn. |
| A token cap per chat answer | R8: an answer is refused once the company's day's tokens are spent (`ai_budget`) and is bounded by its 6 steps, not by `runTokens` | A provider bills per answer in a way that makes one long answer costly. |
| A correction written while the pane went offline | R8: if the sync or the decision cannot reach the API after the cell was written, the edit stays « proposed » until its lock runs out; asked again, the card finds the cell already at « Après » and reports a conflict | Users meet it: then keep the pending decision in the offline queue. |
| Two cards in one answer | R8: the pane shows one card at a time; a second card replaces the first, whose call is asked again when the chat opens next | A model calls proposeFix twice in one answer often enough to confuse people. |
| A real invoice corrected from the sheet in Mode test (and a test one outside it) | R8: in Mode test the row feeds the test copy, so the pane refuses to correct a real invoice's finding from it (and the other way round), and says why | Users keep real findings open while rehearsing and ask to correct them without leaving Mode test. |
| Delta queries (`driveItem: delta`) instead of one metadata call per file | R4: each check asks Graph for each picked file's metadata (20 files at most) and downloads only those whose cTag changed | A company follows more files than a check reads comfortably, or Graph throttles the checks. |
| `Files.Read.All` or `Sites.Selected`, and change notifications on a work OneDrive | R4: `Files.Read` and the File Picker only (owner's decision); a work OneDrive is polled every 2 minutes, since its subscriptions need `Files.Read.All` | Work users find two minutes too slow, and the owner accepts asking an administrator for more. |
| Several Microsoft accounts per company, more than 20 files | R4: one account (`connector_other_account`), 20 files (`MAX_FILES`) | A company keeps orders in a colleague's OneDrive, or more than twenty workbooks. |
| The connector gated by plan | R4: every plan gets it while it is new | A money decision for the owner (architecture document: per-source consent, tariff open). |
| The Scout's other signals: links to other workbooks in formulas, the sheet names | R4: the workbook's address and the mail's MX only | The pilot shows people with orders in OneDrive whom neither signal reaches. |
| Sign-in through the Office dialog where nested app authentication is missing | R4: such an Office says so calmly (`addin.connector.port.unsupported`); the sheets of the open workbook stay read as before | Pilot users run an Excel build without NestedAppAuth 1.1 and ask for OneDrive. |
| A verified publisher for the Microsoft app (work accounts consent by themselves) | 2026-10-22: the app is registered with the owner's personal Microsoft account, which Microsoft cannot verify; a work account needs its administrator's consent once (`docs/MICROSOFT365.md` § The owner's app registration) | Before selling OneDrive to companies on Microsoft 365: the owner registers the app again in the company's own Entra tenant, with its own domain, and verifies it with a Microsoft AI Cloud Partner Program account (free). |
| Other clouds (Dropbox, Box, a NAS) | R5: OneDrive and Google Drive | A pilot company keeps its orders elsewhere. |
| The Google Sheets API instead of the .xlsx export | R5: a Google Sheets file is exported as .xlsx (10 MB at most) and read by R4's reader | A spreadsheet is over 10 MB exported, or formatting lost in the export changes what detection sees. |
| Google's JavaScript picker in the pane | R5: Google's one-window flow opened in the browser by Office; the pane polls for the result | The one-window flow fails on a real account (TODO(verify) 1–3 of `docs/GOOGLE.md`), or people find the browser round trip confusing. |
| A whole Google Drive folder followed (new files picked up by themselves) | R5: files only, picked one by one in Google's window; the same window adds more | People keep a folder per month and forget to add the new file: first check on a real account what `drive.file` grants on a picked folder (`docs/GOOGLE.md`). |
| Several Google accounts per company | R5: one account (`connector_other_account`), 20 files | A company keeps orders in a colleague's Drive. |
| `changes.list` instead of one version check per file | R5: a notification queues the connection's check, which asks each picked file's version | Companies follow enough files that the checks hit Drive's quotas. |
| Refresh tokens in Google's « Testing » mode | R5 needs the consent screen « In production »: in Testing, Google expires refresh tokens after 7 days | Never on purpose: the owner publishes the consent screen before the first real company (`docs/TODO.md`). |
| An uploaded supplier invoice in « Réception » and the accountant's export | R6: it is a bought document of the registry only (B2's cost), never a received invoice with a status | A pilot company receives supplier invoices outside the platform during the transition and wants them in its export: needs a status and a payment to follow, as `inbound_queue`. |
| Reading a plain (printed or scanned) PDF invoice | R6: refused with `upload_plain_pdf`; the MVP's text extractor is on tag `archive/rust-mvp-v1` | The owner decides it (`docs/TODO.md` › Files uploaded): OCR or a model, its errors and its cost. |
| Several files in one upload, a zip, drag and drop | R6: one file per « Importer un fichier » | People upload a month of supplier invoices at once. |
| Uploaded files kept in an object store instead of the database | R6: a workbook's bytes in `uploads.content` (base64, 10 MB at most); an invoice only as read | Uploads weigh on the database's size or its backups. |
| Lifecycle notifications (`lifecycleNotificationUrl`: subscription removed, reauthorization) | R4: a lost subscription is found at the next check and created again; the hourly check covers the gap | Notifications go missing for long enough that people notice. |
| Revoking the app's access at Microsoft from « Déconnecter » | R4: « Déconnecter » deletes our tokens and the subscription; the consent stays in the person's Microsoft account until they withdraw it there. For a personal account that is `https://account.live.com/consent/Manage` (seen 2026-10-22, `docs/MICROSOFT365.md` TODO(verify) 6); a work account's is not known yet | The pane links to that page after a disconnect once a work account's page is known too, or a pilot user asks where to withdraw it. |
| One consent instead of two on a personal account | 2026-10-22: the first « Choisir des fichiers » asks once more (the picker's `OneDrive.ReadOnly`), after the consent of « Connecter OneDrive » | Pilot users stop at the second screen: ask `OneDrive.ReadOnly` with the first sign-in (`extraScopesToConsent`), after checking it on a real account. |
| A sign-in window left open from an earlier try | 2026-10-22: MSAL reuses it and answers `interaction_in_progress`; the pane says « La connexion à Microsoft n'a pas abouti » and closing the window is enough | Pilot users meet it: then the pane names the window to close. |
| Terms and privacy links on Microsoft's consent screen | 2026-10-22: the registration's Branding has none yet | The CGU and the privacy page are published (`TERMS_URL`): the owner adds both in Entra → Branding & properties. |
| The File Picker in an Office dialog instead of a frame over the pane | R4: a frame over the task pane, with its own « Fermer » | The picker refuses to run inside the pane's frame on some Excel (TODO(verify) 3 in `docs/MICROSOFT365.md`). |
| Writing into a connected file | R4: picked files are only read, never modified (R8 writes only into the open workbook) | Users want corrections applied to their OneDrive files too: needs `Files.ReadWrite` and the co-authoring question of R8. |

## After a send: credit notes (§4), built on 2026-10-24

| Item | Current behaviour | Bring back when |
|---|---|---|
| A partial credit note (some lines, a part of the amount: a discount granted afterwards, goods returned) | « Établir un avoir » credits the whole invoice | A pilot company needs it: the credit note's lines chosen in the pane, and the original stays due for the rest (not `credited`). |
| A credit note on a paid invoice (a refund) | Refused with `credit_paid`: « faites cet avoir avec votre comptable » | A pilot refunds customers: the refund recorded as a payment out, and the platform told. |
| A corrective invoice (type 384) or resending a refused invoice under its number | Not offered: the state machine's `resend` (disputed → needs_fix) has no route, because a refused invoice is not corrected under its number (AFNOR XP Z12-014 use case 5) | The norm or B2Brouter (T24) says a 384 is the way for a case we meet. |
| A credit note the platform rejects | It cannot be corrected in the sheet (it has no row) and the pane has no « Annuler »: the API's `PUT /invoices/:id` and `POST /invoices/:id/cancel` work | It happens: an « Annuler l'avoir » button on its fiche, then « Établir un avoir » again. |
| Credit notes written into the sheet | A credit note lives in the pane and the API only; the original's row says « Annulée par un avoir » | Users want their credit notes in their workbook, or the sheet's own credit notes (type 381 rows) linked to their invoices. |
| Credit notes in the weekly report | Left out of its counts (sent, paid, overdue): a credit note's amount would add, not subtract | Owners ask for « avoirs émis » in the report: a line of its own, and the sent total net of them. |
| A credit note per write-off for the VAT on the unpaid amount | « Abandonner la créance » only stops chasing and records the loss; recovering the VAT on an irrecoverable debt needs a rectifying document | The accountant's answer in `docs/TODO.md` › Credit notes. |

## Google Sheets host (R9)

| Item | Current behaviour | Bring back when |
|---|---|---|
| Public Google Workspace Marketplace listing | The reproducible bound-script package is installed manually in a spreadsheet. | The owner supplies the publisher account and hosted app/API addresses; complete Google's distribution review. |
| ~~Connecting a new OneDrive account from Google Sheets~~ | **Implemented in R9** with the standard MSAL client and the existing popup relay. | Real-account consent and picker verification remain G5 in `docs/GOOGLE_SHEETS.md`. |
| Google Sheets ranges above 5,000 used rows or 250,000 cells | The host refuses before reading the oversized range. | A pilot needs larger sheets: chunk reads with a stable revision check before syncing the combined snapshot. |

## Instalments (2026-10-24)

| What | Smallest version now | When to do the rest |
|---|---|---|
| The weekly report's « encaissé cette semaine » counts instalments | It counts the invoices that became paid this week, at their full amount; an instalment shows only in the balance still owed | A pilot company reads its report against its bank: then sum the payments recorded in the week (`payment_reports`, or a payments ledger for invoices without a platform). |
| What was received on the sheet | The status column says « Relance en cours » or « Échue » while a balance is left; the fiche shows what arrived and what is left | A pilot wants it in Excel: a « Reste à payer » column written back like the status. |
| The MonitorAgent sees the balance | Its input is the invoice's amount payable | A refusal or a dispute on an invoice paid in part shows up: then pass the balance and record the eval again. |
| Undoing a payment typed by mistake | A payment is final, as « Encaissée » was; the confirmation names the amount and what will be left | A user records the wrong amount: a correction that writes a negative payment report, if the platform accepts one (`docs/B2BROUTER.md` T25). |
| A payment by the platform (212 from the customer's side) with an amount | The platform's `paid` makes the invoice paid whatever was recorded | B2Brouter tells partial payments apart (T25): then add the amount it reports to `amount_paid`. |

## Finding an invoice (2026-10-24)

| What | Smallest version now | When to do the rest |
|---|---|---|
| Accents ignored in the search (« Societe » finds « Société ») | Case is ignored, accents are not (`ilike`) | A pilot misses an invoice because of an accent: `unaccent` in Postgres (an extension to enable on the hosted database) or a normalised name column. |
| Searching the amount, the customer's SIREN or a line's article | Number and customer's name | Users type an amount or a SIREN into the box. |
| The last search kept when the pane reopens | Kept while the pane is open | Users repeat the same search every morning. |
| Supplier invoices in the same search | « Réception » lists them on its own | A user looks for a supplier's invoice from the Tableau de bord. |


## BTP rules where invoices are checked (BTP plan stage 1A, 2026-10-24)

| What | Smallest version now | When to do the rest |
|---|---|---|
| Retenue de garantie and situation on the company's own invoices | The rules BTP-RG-01/02/03 and BTP-SIT-01/02 are in `@fi/core` with their cases, and speak when the caller gives the retenue, the chantier and the situation; neither the sheet nor the pane gives them yet, so on a sheet invoice only the autoliquidation rules speak | A BTP pilot invoices situations from its sheet: optional columns « Retenue de garantie », « Chantier », « N° de situation », « Cumul des travaux », detected like the others; the retenue written as the ABU note of annex A cas n°26; the previous situation of the chantier read from the company's invoices. Stage 2's chantiers give the link. |
| The sous-traitance said once per relationship | A switch on the customer (Clients) and on the supplier (Réception); a sous-traitant who also sells materials alone gets a warning to ignore on those | A pilot mixes works and supplies with the same company often: a per-invoice « Fourniture seule » choice, or reading the line's nature (`goods`) to stay silent. |
| A supplier in « Mode test » | Marking the made-up supplier of a test invoice keeps it among the company's suppliers like a real one | The made-up supplier shows in a pilot's lists: mark those parties as test and leave them out of « Registre ». |
| Documents in the pane (stage 1B) | `POST /ingest` and `GET /documents/:id` exist; the pane has no screen for them | Stage 2: the documents list with their kind, chantier and deadlines, once the classifier gives a kind. |
| Bytes in S3 (stage 1B) | The FileStore keeps bytes in Postgres (`blobs`); 20 MB per file | The database passes a few GB, or a pilot sends scans every day: an S3 driver behind the same `FileStore` (`apps/api/src/files.ts`), the keys unchanged. |
| OCR past ten pages (stage 1B) | A scan is read on its first ten pages (`truncated: true` beyond); a text PDF is kept up to 100 000 characters | A classifier needs a page further on (a contract's annexes): read more pages in the background, after the first ten. |

## What each document is, and its deadlines (BTP plan stage 2A, 2026-10-24)

| What | Smallest version now | When to do the rest |
|---|---|---|
| A contract's end (`extractContract`, `contrat_fin`) | Contracts are classified and linked to their company; no deadline | A pilot asks for contract ends: a model reads the end date and the notice from the first pages, with its eval, keyed like the others. |
| Dates read by a model | Labelled patterns: issue, validity (period or end), réception; a missing one goes to a person (`dates_missing`) | Real documents show the patterns missing often: a model reads the date the patterns could not, a person still confirms a date that makes a deadline. |
| A réception's deadline across copies | Keyed by its document: the same PV as a scan and as a PDF makes two retenues | Chantiers (stage 4): the key becomes the chantier and the réception date, and the copies meet. |
| The chantier of a document | None: no pattern finds it reliably in a text | Stage 4's ERP connectors give chantiers; a document is linked by the address or the reference they list. |
| An invoice's amounts without XML | `invoice_without_data`: a person says it is an invoice, it is `done` without a deadline | The owner's question « Reading invoices without XML » (`docs/TODO.md`): `extractInvoice` and its 98 % eval. |
| Deadlines of a company not confirmed yet | Keyed by its SIREN, without a party; `confirmer_tiers` asks once | Done in stage 3A: approving `confirmer_tiers` adds the supplier and links its documents and deadlines. |

## The documents in the pane (BTP plan stage 2B, 2026-10-24)

| What | Smallest version now | When to do the rest |
|---|---|---|
| Opening the file of a document | A document in review shows the first 300 characters of its text, which says what most are | A scan whose text says nothing, or a person who wants the page: `GET /documents/:id/file` with the bytes, opened by the pane as the R6 files are. |
| A deadline that is wrong or done | Listed until its date moves with a newer document; a dismissed one (stage 3) leaves the list | Stage 3's actions: « C'est fait » and « Ignorer » on a deadline, audited, with the watchers. |
| Finding a document | Newest first, by stage or kind through the API; the pane shows the newest 50 and « Afficher plus » | A pilot has hundreds: a search by name or company, as « Retrouver une facture ». |
| A document seen as it is read | « Actualiser » after a deposit | The pane asks again by itself while a deposited document is being read (a few seconds). |
| The deadlines on a sheet (BTP plan §12 « registre visible dans Excel ») | The « Échéances » part of the pane, read from the API each time | A pilot who wants them in the workbook: a sheet written on demand, as the registry export, never kept in step by itself. |

## Requests a person approves (BTP plan stage 3A, 2026-10-24)

| What | Smallest version now | When to do the rest |
|---|---|---|
| Instant alerts (BTP plan §8 `notify`) | The pane's « À valider » and, in 3C, the weekly report | A pilot misses an urgent request between two reports: one e-mail when a draft is made, at most daily. |
| Reminders of an invoice that came as a document | One request once it is overdue | A pilot asks for a cadence: CollectAgent's steps (courtesy before, firm after) on these deadlines too. |
| A model rewriting a draft (`revise`) | The person writes in « Modifier » | A pilot finds the letters stiff: a model rewrites from the person's words, with its eval and fixture. |
| The sender of a request | Our sender address, the company named in the text, `Reply-To` the person who approved | The owner's question « Sending actions' e-mails » (`docs/TODO.md`): the company's domain with SPF and DKIM. |
| The company's own renewals (its own attestation, Kbis) | Listed in « Échéances », no request (nobody to ask) | A reminder to the company itself, with the instant alerts. |
| Withdrawn, refused and failed requests in the pane | `GET /actions?status=` lists them; the pane shows the drafts | A pilot asks what happened to one: a « Historique » under « À valider ». |
| A request to a supplier not marked sous-traitant | Drafted for any supplier whose attestation, Kbis or insurance runs out | Pilots find it noisy: only for suppliers marked « sous-traitant », with a switch. |
| The weekly e-mail's links (3C) | Plain text, owners only, « Envoyer » and « Ignorer » (« Ajouter comme fournisseur »), ten listed | A pilot wants « Modifier » or « Plus tard » from the e-mail (a page with the text and the address), members who are not owners, or an HTML e-mail with buttons. |
| Old links | Expired links stay in `action_links` until their action or the account goes | Many reports: a daily purge of links expired more than 30 days ago, with `purgeExpired`. |

## The ERP's lists (BTP plan stage 4A, 2026-10-24)

| What | Smallest version now | When to do the rest |
|---|---|---|
| A column whose label is not known | The import names the column it needs; the labels known are common French usage | A pilot's export uses other labels: add them to `columns.ts`; if they vary from pilot to pilot, a screen to map a column by hand, kept per company and list. |
| Companies from an ERP checked in the directory | Not looked up (`source: 'erp'`, `verifiedAt` null); looked up when invoiced, as today | A pilot wants them checked: a background lookup within SIRENE's limit, a few a minute. |
| Particuliers and companies without a SIREN in the ERP | Skipped and counted, the first twenty by name | A pilot's chantiers are mostly for private customers: a customer without SIREN, keyed by the ERP's code, for chantiers only. |
| A company or chantier gone from the ERP | Kept: an export lists, it does not delete | A pilot closes chantiers by removing them: a chantier missing from a complete export marked closed, never deleted. |
| The same file given again on purpose | « Déjà importé », nothing done | A person deleted a company in Facture Impec and wants it back: « Importer à nouveau » forcing a run. |
| A list split in several files | Each file is an import of its own; the list's row shows the last one | A pilot splits a list of more than 5 000 rows: the files listed together. |
| Partial payments (stage 4B) | A payment closes a deadline only when it covers what is left; a smaller one is counted (`partial_payment`) and nothing more. The next export's « Reste à payer » closes it | A pilot pays in instalments and exports payments without invoices: payments summed per invoice across rows and files, kept by their reference. |
| A payment cancelled, a cheque bounced | A deadline closed as paid stays closed, whatever comes after | A pilot's export shows it (a negative payment, « Reste à payer » back above 0 on a closed invoice): reopen it, audited, with what the person sees. |
| The ERP's « Reste à payer » below the PDP's amount | The PDP's amount stays on the deadline; the ERP closes it only at 0 | A pilot's customers pay in part: the amount at stake lowered by the ERP's « Reste à payer » whatever the source, its date kept. |
| `situation_echeance` | Unused: a situation's deadline is `facture_echeance` with the same key (D9) | A pilot needs situations apart in the reminders or the weekly e-mail: its own kind and wording. |
| The retenue de garantie inside a situation's « Reste à payer » | The amount left is the ERP's, retenue included when the ERP includes it | Its release is watched (stage 2): the retenue taken out of the amount reminded, from the chantier's rate. |
| Purchase deadlines from an ERP | Only sales invoices are read; a supplier's invoice comes from the PDP or the mail | A pilot wants to see what it owes from its ERP: a `factures fournisseurs` list, deadlines `facture_achat`. |
| An invoice sent through Facture Impec and paid in the ERP | Its payment row is skipped (`sent_here`); the invoice follows the platform's statuses | A pilot records payments only in its ERP: the payment marks the invoice paid, through `applyTransition`, audited. |
| An invoice number written as an Excel number | Kept as the number reads (`0042` becomes `42`) | A pilot's numbers lose their zeros: read the cell's displayed text instead of its value. |
| An invoice from the mail sent through Facture Impec | Not checked against `invoices`: a mailed copy of one's own invoice makes a deadline beside the platform's | A pilot forwards its own invoices to its address: the same `sent_here` check as the ERP's. |

## The ERP's lists in the pane (BTP plan stage 4C, 2026-10-24)

| What | Smallest version now | When to do the rest |
|---|---|---|
| A chantier's page | The chantier's name on a deadline and a received document; the deadlines narrowed to one chantier in the pane | A pilot runs many chantiers: `GET /chantiers` and a page per chantier (its customer, documents, deadlines, retenue), `GET /obligations?chantier=` on the server. |
| The documents narrowed by chantier | Only the deadlines have the filter; « Reçus » shows the chantier on each | A pilot looks for a chantier's PV or attestation among many: the same filter on « Reçus » and « À vérifier ». |
| An import longer than ten minutes | The pane follows it for 200 × 3 s, then « Actualiser » shows where it is | A pilot's list takes longer (thousands of rows): follow while the pane is open, or a notice in the weekly e-mail. |
| How to export from each ERP | One generic sentence (`addin.erp.how`) | The first pilots' real menus (Batigest, EBP): a line per ERP, written from their screens (`docs/TODO.md`). |
| Choosing the columns of an export | The import names a missing column in French | Already listed under stage 4A: a screen to map a column by hand when pilots' labels vary. |

## What runs, measured (BTP plan stage 7A, 2026-10-24)

| What | Smallest version now | When to do the rest |
|---|---|---|
| Langfuse: each graph run a trace, its prompts and answers | `agent_runs` (agent, model, prompt hash, attempts, tokens, times) and `fi_llm_tokens_total`, `fi_agent_runs_total` | A prompt must be debugged on real traffic: Langfuse self-hosted (ClickHouse, Redis, an object store) with the companies' text pseudonymized and erased with them (`docs/DECISIONS.md` D10). |
| OpenTelemetry traces across the API, the workers and the connectors | One process; each log line has the request's or the job's ids | The workers run apart from the API: OpenTelemetry (pg-boss 12 has its own hooks), `trace_id` in a job's data. |
| Several API processes behind Prometheus | One target, `api:4000`; the counts in the process are that process's | A second API process: one scrape target per process (compose's DNS or service discovery), the dashboards summed over `instance`. |
| Logs kept and searched | `docker compose logs`, 5 files of 10 MB, `grep` on the JSON fields | More than a few days to search, or several machines: a log store (Loki or the host's), with the same retention as personal data (`docs/RGPD.md`). |
| Alerts by another channel than e-mail | Alertmanager mails the operator | The operator wants them on the phone: a Telegram or SMS receiver in `alertmanager.yml`. |

## Measured under load (BTP plan stage 7B, 2026-10-24)

| What | Smallest version now | When to do the rest |
|---|---|---|
| Waking workers in another process | A job sent from the process wakes its queue's workers there; a worker fetches again after each job (`bossWakeups`, `apps/api/src/jobs.ts`); another process finds the job at its next poll (2 s) | The workers run apart from the API: pg-boss's LISTEN/NOTIFY (`useListenNotify`, the queues' `notify`), on a session connection (not a transaction pooler). |
| A load from outside the process | `fetch` in the API's process, the paths timed on the server's side | The API is hosted: the same paths from another machine (k6, as `pnpm load`), through the proxy and TLS, to see what the network adds. |
| The model on during the run | Off: classify falls back to the rules; the run measures the pipeline, not a provider | The production model is chosen: a run with it on, classify's own time per document in the report (§11 gives the graph 25 s). |
