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
| « Mode test » banner, `TEST-` number prefix, setting `invoices.is_test` (plan §0) | M2: the column exists and keeps test numbers apart in the unique index, but the API always writes `false`; only the mock platform exists | M3, with the add-in banner; mandatory before the B2Brouter sandbox (M4). |
| Parties (customers/suppliers) table and the buyer context for rules | M2 schema: the buyer lives inside the invoice document | M3, when the add-in picks customers from a list. |
| Magic-link login for people | M2: tenant API keys created by an admin token | M3, with the add-in. |
| B2Brouter adapter (import then send, search-then-retry, webhook secret per account) | M2: mock adapter only; facts in `docs/B2BROUTER.md` | M4, against the sandbox, with the same contract suite. |
| A payment recorded by the user and the `reportPayment` job (« Encaissée », status 212) | M2: the adapter method and the mock route exist, nothing calls them | M5, with chasing and the autopilot. |
| `late-payment` scenario (plan §9), `overdue`/`chasing` states driven by due dates | M2: no due-date clock yet | M5. |
| Autopilot (sending without a click when every check is green) | M2: Review mode only, a send always comes from a user's « Envoyer » | M5. |
| Inbound invoices polled into an `inbound_queue` | M2: the mock serves `GET /inbound`, the API does not poll it | M6. |
| Remaining plan §4 tables (`agent_runs`, `inbound_queue`, `mappings`, …) | M2: only the tables its routes and jobs use | The milestone whose feature writes them. |
| Encryption of PDP credentials at rest | M2: the mock needs none; `pdpAccount` is an id, not a secret | M4, before the first B2Brouter API key is stored. |
| Rate limiting and request size limits on the API | M2: local only | Before the API is reachable from the internet (M7). |
| Bundled API image (esbuild/tsup + Docker), listening beyond 127.0.0.1 (`API_HOST`) | M2: `tsx` and `127.0.0.1` | M7, deployment to the EU VPS. |
| Scenarios against servers already running (`pnpm dev`, sandbox) | M2: each scenario starts its own in-process stack | M4, to replay the scenarios on the B2Brouter sandbox. |
| Listing invoices beyond `limit`/`offset` (search, date range, sort) | M2: status filter only | M3, when the add-in shows a list. |
| Rate limiting on `POST /api/trial` beyond honeypot + fill time + one row per e-mail | Marketing site | Spam actually reaches the table; then Vercel WAF rule or Upstash rate limit. |
| Site in other languages, blog, analytics | Marketing site | The French pilot converts and there is content worth translating or measuring (analytics would need a consent banner). |
| Automatic trial provisioning (account + install link sent on submit) | Marketing site | M3 has accounts; until then the owner answers each request by hand. |
| Names in a sheet column whose header does not announce them (« Cli. » is caught, « Partenaire » is not) reach MappingAgent unmasked when they carry no legal form | M3 masking.ts: header keywords + patterns + the dictionary's personal columns | A tenant's sheets show such columns; then mask every free-text column the dictionary cannot place, or show the model value shapes only. |
| DNS check of a BYOK endpoint (a public name that resolves to a private address) | M3 providers/net.ts checks the URL as written | Before BYOK is offered outside the pilot: resolve and pin the address for the call. |
| Spend cap per tenant in euros (today: a daily token cap per tenant, same for every model) | M3 orchestrator | Pricing of the AI fair use is decided (`docs/research/PRICING.md` §3.2). |
