# Deferred

Things that exist in the old MVP or come to mind, but no milestone's acceptance criteria need them.
Each line says where it came from and what would bring it back.

| Item | Origin | Bring back when |
|---|---|---|
| Import of PDF invoices (text extraction + regex field extractor, `/api/import`) | MVP Phase 5 (`crates/facture-backend/src/ocr` on tag `archive/rust-mvp-v1`) | A pilot customer keeps invoices as PDFs instead of Excel rows. |
| Word documents as input | MVP Phase 6 idea | Never for emission (a .docx is not structured); maybe extraction, on demand. |
| Turborepo remote cache | M0 scaffold | CI runs on GitHub again and builds get slow. |
| Golden input as `.xlsx` (plan §2 `fixtures/golden/*.xlsx`) | M1: the golden input is the invoice model as JSON | M3, with the MappingAgent: the spreadsheet → model step is its job. |
| Allowances and charges given only as a percentage (BT-94 × BT-93 → amount) | M1 compute.ts: the amount (BT-92 / BT-136) is required and used; a percentage is carried as written | M3, if the MappingAgent meets sheets with « remise 5 % » and no amount. |
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
| Parties (customers/suppliers) table and the buyer context for rules | M2 schema: the buyer lives inside the invoice document | The add-in offers a customer picker or reads customers from a second sheet (M3 reads them from the invoice rows). |
| A payment recorded by the user and the `reportPayment` job (« Encaissée », status 212) | M2: the adapter method and the mock route exist, nothing calls them | M5, with chasing and the autopilot. |
| `late-payment` scenario (plan §9), `overdue`/`chasing` states driven by due dates | M2: no due-date clock yet | M5. |
| Autopilot (sending without a click when every check is green) | M2: Review mode only, a send always comes from a user's « Envoyer » | M5. |
| Reading received invoices: `parsed_json`, `triage_json`, `pdf_ref` of plan §4 `inbound_queue`, and the Réception screen | M4: the sweep polls each platform into `inbound_queue` (the XML, status `new`), nothing reads it yet | M6. |
| Acknowledging received invoices on B2Brouter (`POST /invoices/{id}/ack`) | M4: `listInbound` asks for `ack=false` from the day before the last one stored and never acks; the unique index drops repeats | M6: ack once a received invoice is stored and triaged. |
| Remaining plan §4 tables | M2–M4: only the tables routes and jobs use (`agent_runs` since M3, `inbound_queue` since M4) | The milestone whose feature writes them. |
| Encryption of per-company PDP credentials at rest | M4: one operator key and one webhook secret in the environment (`B2BROUTER_*`); a tenant stores only its account id, which is not a secret | A company brings its own B2Brouter key, or B2Brouter gives one webhook secret per account. |
| Mode test in prod | M4: the test platform is B2Brouter when the key is a sandbox key (`test_…`), else the mock; prod has a live key and runs no mock, so its Mode test has nowhere to go | M7, before prod opens: a second, sandbox-only B2Brouter adapter for test invoices. |
| The mock adapter registered in every environment | M4 `pdpFromEnv`: always, pointing at `MOCK_PDP_URL` | M7: only in `local` (a tenant on `pdp_provider = mock` in prod would send nowhere). |
| Rate limiting and request size limits on the API | M2: local only | Before the API is reachable from the internet (M7). |
| Bundled API image (esbuild/tsup + Docker), listening beyond 127.0.0.1 (`API_HOST`) | M2: `tsx` and `127.0.0.1` | M7, deployment to the EU VPS. |
| Scenarios against servers already running (`pnpm dev`, a hosted sandbox) | M2: each scenario starts its own in-process stack; M4: `pnpm scenario --provider b2brouter` runs them through the real adapter against the stand-in. The live sandbox has none of the mock's fault controls, so it gets the contract and the E2E instead (`docs/RUNBOOK.md`) | A hosted sandbox exists (M7) and wants a smoke run of the happy path. |
| Listing invoices beyond `limit`/`offset` (search, date range, sort) | M2: status filter only | A screen lists invoices outside the open sheet (M3's Tableau de bord lists the sheet's rows). |
| Rate limiting on `POST /api/trial` beyond honeypot + fill time + one row per e-mail | Marketing site | Spam actually reaches the table; then Vercel WAF rule or Upstash rate limit. |
| Site in other languages, blog, analytics | Marketing site | The French pilot converts and there is content worth translating or measuring (analytics would need a consent banner). |
| Automatic trial provisioning (account + install link sent on submit) | Marketing site | The add-in and API are on public HTTPS (M7); until then the owner answers each request by hand. |
| Names in a sheet column whose header does not announce them (« Cli. » is caught, « Partenaire » is not) reach MappingAgent unmasked when they carry no legal form | M3 masking.ts: header keywords + patterns + the dictionary's personal columns | A tenant's sheets show such columns; then mask every free-text column the dictionary cannot place, or show the model value shapes only. |
| DNS check of a BYOK endpoint (a public name that resolves to a private address) | M3 providers/net.ts checks the URL as written | Before BYOK is offered outside the pilot: resolve and pin the address for the call. |
| Spend cap per tenant in euros (today: a daily token cap per tenant, same for every model) | M3 orchestrator | Pricing of the AI fair use is decided (`docs/research/PRICING.md` §3.2). |
| Autopilot switch in Réglages | M3: shown, disabled, « Revue » selected | M5, with the autopilot itself. |
| Pseudonymization switch in Réglages | M3: shown on and locked; the API always pseudonymizes | A customer needs raw data sent to their own model (BYOK) and accepts it in writing. |
| « Relancer » on the fiche | M3: shown, disabled (« Les relances arrivent bientôt ») | M5, chasing. |
| Deleting the company from the add-in (RGPD erasure) | M3: `DELETE /tenant` exists and is tested; Réglages offers the export only | The owner settles the retention questions of `docs/RGPD.md`; then a button with SIREN confirmation. |
| Several companies for one e-mail | M3: the sign-in link opens the oldest company with that address | An accountant signs in for several clients: a company picker after the link. |
| Sending the sign-in mail for real | M3: local outbox only (`FI_ENV=local`); elsewhere the add-in offers the access key | A hosted sandbox or prod (M7): a transactional mail provider (owner's choice, it costs money). |
| Sheets over 5 000 invoice rows | M3: the add-in says the sheet is too big and stops (the API refuses more too) | A customer's sheet is that big: read and sync it in chunks. |
| Production manifest (public HTTPS URLs, support and help pages instead of example.com) and hosting of the task pane | M3: development manifest on https://localhost:3000 | M7, deployment; AppSource only if the owner wants it. |
| Excel-on-the-web E2E run | M3: `e2e/excel-web.spec.ts` written, skipped without an account; its Excel selectors are `TODO(verify)` | The owner provides a Microsoft account that can upload an add-in (`docs/RUNBOOK.md` § E2E). |
| Sideload scripts tried on Windows and Mac | M3: written from Microsoft's guides, run on neither | First session on a Windows or Mac machine with Excel. |
| Splitting the task pane bundle (889 kB minified, 255 kB gzipped, one chunk) | M3: served from localhost, Vite warns above 500 kB | Before hosting the pane publicly (M7): lazy-load Réglages and the fiche's XML/PDF views. |
