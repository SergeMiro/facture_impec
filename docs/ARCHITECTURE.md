# Architecture

Status: M2 (2026-10-18). This file records what is built and the decisions taken; the product spec
is the owner's implementation plan (see `CLAUDE.md`). "Plan §N" refers to its sections.

## Shape

```
Excel (desktop / web / Mac)                       apps/api  (Hono, Node 22)
apps/addin — Office.js task pane   ── HTTPS ──►   auth, ingest, validation, agent runs,
React 18 + Vite, thin client                      PdpAdapter, webhooks + status polling
                                                        │
                Postgres (Supabase EU; embedded PGlite in dev) + pg-boss queue
                                                        │
          packages/core (pure TS)          packages/agents (orchestrator + specialist agents)
          rules, builders, state machine   packages/pdp-adapter (B2Brouter | mock)
                                                        │
                    apps/mock-pdp — fake PDP for local dev and CI (plan §3)
```

The add-in never owns business logic. Validation lives once, in `packages/core`, and runs in two
places: in the task pane for instant hints, and in the API as the authoritative verdict.

## What exists after M0

| Path | State |
|---|---|
| `apps/api` | Hono app with `GET /health`, started by `tsx`; reads env through `@fi/shared/env`. |
| `apps/mock-pdp` | Hono app with `GET /health` on :4010. The lifecycle engine is M2. |
| `apps/addin` | Vite + React 18 placeholder page that renders French strings from `@fi/shared`. Office.js, HTTPS and the manifest are M3. |
| `packages/shared` | `t()` over `i18n/fr.json` (keys type-checked) and the Zod server-env schema. |
| `packages/{agents,pdp-adapter,db}` | Empty, wired into the workspace. Each `src/index.ts` names the milestone that fills it. |
| `apps/site` | Marketing site (added 2026-10-17, outside the plan's milestones, at the owner's request): landing page with an in-browser demo, pricing, `/presentation` slides, legal pages, and the trial-access form backed by `POST /api/trial`. |

## Marketing site (`apps/site`)

Astro 7, static pages plus one serverless endpoint (`@astrojs/vercel`), Tailwind 4, and React 18 only
for the three interactive islands (demo, pricing toggle, trial form). It is separate from the add-in:
marketing copy lives in `apps/site/src/content/`, while product UI strings stay in
`packages/shared/i18n/fr.json` (rule 6).

- **Brand.** Green: the palette in `packages/shared/src/brand.ts` is mirrored by the Tailwind `@theme`
  tokens in `apps/site/src/styles/global.css`. The add-in adopts the same tokens in M3, with the
  orange « Mode test » colour kept apart.
- **Fonts.** Fraunces (titles) and Inter (text) are self-hosted through Fontsource: no request to
  Google Fonts, so no third-party transfer to declare.
- **Demo.** Simulated in the browser: five invoices, two planted errors, then a « Mode test »
  rehearsal with the French lifecycle statuses. Its SIREN key check is a local copy; after M1 it
  imports `@fi/core` instead.
- **Trial form.** The request schema is shared (`@fi/shared` `TrialRequestSchema`). The handler
  (`apps/site/src/lib/trial.ts`) drops bots silently (honeypot + minimum fill time), validates,
  stores one row per e-mail in Supabase through PostgREST (`apps/site/sql/001_trial_requests.sql`,
  RLS on, no policy, server secret key only) and optionally notifies the owner on Telegram without
  personal data. With no storage configured, development logs the request and production answers 503.
- **Env.** Astro reads the root `.env` (`vite.envDir`), like every other app.
- **Prices** on the site come from `docs/research/PRICING.md` §3.2 and are a proposal until the owner
  validates them and B2Brouter's price is known.

## What M1 added: `packages/core`

Pure TypeScript, no Node modules outside tests and scripts, so the add-in runs the same code as the API.

| Module | What it does |
|---|---|
| `model.ts` | EN 16931 semantic model (BT/BG ids in comments) as Zod schemas; `InvoiceDraft` is what a user or the mapping provides. |
| `money.ts`, `compute.ts` | Amounts in integer cents; quantities and prices stay decimal text and are multiplied in `bigint`, rounded half away from zero. `computeInvoice` fills line amounts, totals and the VAT breakdown. |
| `rules/` | 224 rules (EN 16931, code lists generated from the CEN artefacts, VAT categories, French rules of `docs/research/FR_RULES.md`, sanity). `validate()` returns issues with French message and fix hint; `docs/RULES.md` is generated from them. |
| `xml/` | CII (Factur-X EN 16931) and UBL 2.1 builders and namespace-aware parsers; a bad value becomes an issue, only a file that is not CII or UBL throws. |
| `pdf/` (`@fi/core/pdf`) | The Factur-X PDF: an A4 rendering in DejaVu Sans, PDF/A-3B with `factur-x.xml` attached by `@cantoo/pdf-lib`'s `embedFacturX`, reproducible bytes; and the reader that takes the XML back out. Separate entry so pdf-lib (≈ 600 KB) loads only on demand. |
| `state.ts` | The invoice state machine of plan §4 (`docs/STATE_MACHINE.md`). |
| `ids.ts`, `dates.ts` | SIREN/SIRET/VAT/IBAN checks; ISO dates, Europe/Paris « today ». |

Tests: `pnpm --filter @fi/core test` (unit, offline, coverage ≥ 90 %) and `test:oracle`, which runs
the official XSD and schematrons (CEN 1.3.17, Factur-X 1.09.2) on every golden invoice, every CEN
example read back, and every EN 16931 invalid fixture. The Factur-X files we may not commit are
downloaded once into `.oracle-cache/`, pinned by sha256. `pdf:check` runs veraPDF and the Akretion
extractor on the golden PDFs; it is manual because both tools live outside `node_modules`.

## What M2 added: the mock platform and the API

```
apps/api ── PdpAdapter (packages/pdp-adapter) ── HTTP ──► apps/mock-pdp
   ▲  POST /webhooks/pdp/mock (signed)  ◄───────────────────────┘
   │
packages/db: Drizzle schema + migrations, PGlite (local) or Postgres (DATABASE_URL), pg-boss queues
```

| Path | What it does |
|---|---|
| `packages/db` | Tables `tenants`, `api_keys`, `invoices`, `validation_results`, `invoice_events`, `audit_events`, `pdp_submissions` (the part of plan §4 that M2 needs). `openDatabase()` opens PGlite in a directory (or in memory) or Postgres from a URL; same migrations for both. `applyTransition()` is the only writer of `invoices.status`: it locks the row, asks `@fi/core` `transition()`, writes the event and the audit line in one transaction. Two triggers back it up: `invoices.status` refuses any other write, `audit_events` is append-only. |
| `packages/pdp-adapter` | The `PdpAdapter` interface (plan §8 with the two changes recorded below), the platform-status → state-machine mapping, the webhook signature (`t=<unix>,s=<HMAC-SHA256 of "t.body">`, 5 min tolerance, B2Brouter's scheme), the mock adapter, and `@fi/pdp-adapter/contract`: ten conformance tests any adapter must pass. |
| `apps/mock-pdp` | Plan §3. `POST /invoices` takes CII or UBL and runs the same `@fi/core` validator (number already used on that account → BR-FR-CO-02), dedupes on the `idempotency-key` header, and plays a scripted timeline in business time: `deposited → received_by_platform → delivered → accepted → payment_received` by default (PT5M, PT1H, P2D, P30D), or any timeline set through `PUT /control`. One real second is `MOCK_PDP_SPEED` business seconds; the clock is injectable (`ManualClock` in tests). Also: `POST /scenarios/:id` forces a transition, `GET /invoices/:id/status`, `POST /invoices/:id/payments`, `POST /inbound` + `GET /inbound`, `GET /directory/:siren`, and fault injection (lost answers, 503s, failing webhooks, unknown SIRENs). Webhooks are signed and retried with backoff. |
| `apps/api` | Hono. Admin: `POST /admin/tenants` (behind `ADMIN_TOKEN`) creates a tenant and shows its API key once; only its sha256 is stored. Tenant routes behind `Bearer fik_…`: `GET/PATCH /tenant`, `POST /validate` (stores nothing), `POST/GET /invoices`, `GET/PUT /invoices/:id`, `POST /invoices/:id/{validate,send,cancel}`, `GET /invoices/:id/xml`. `POST /webhooks/pdp/:provider` checks the signature and queues a status sync. Every error answers in French from `fr.json` (`api.error.*`): what happened, is the invoice safe, what to do. |
| `apps/api/src/scenarios` | Plan §9 scenarios as JSON in `fixtures/scenarios/`, run in one process (PGlite in memory, both apps on free ports) by `pnpm scenario <name>|all` and by `src/scenarios.test.ts` inside `pnpm verify`. |

### How a send works

1. `POST /invoices/:id/send` moves `validated → ready_to_send` (event `approve`, actor `user`) and,
   after the commit, queues `invoice.send` with the invoice id as singleton key (pg-boss `exclusive`
   policy: one job per invoice, queued or running). Pressing « Envoyer » again answers 202 with
   `alreadySent: true`.
2. The send job claims the invoice (`ready_to_send → sending`, writes the CII, upserts the
   `pdp_submissions` row keyed by sha256(tenant + number + fingerprint)), then calls the platform
   **outside any transaction** with that key.
3. Answer `deposited` → `deposited` with the platform reference; `rejected` → `rejected_by_pdp` with
   the reasons. No answer (timeout, 5xx, lost response) → `send_interrupted` back to `ready_to_send`
   and the job fails, so pg-boss retries with backoff; the retry carries the same key, and the
   platform returns the invoice it already holds instead of a second one.
4. The platform's webhook only says "something changed on invoice X". The API queues `invoice.sync`
   (`stately` policy, keyed by provider + account + reference); the sync job fetches the whole history
   through `getStatus` and applies each platform event once (unique `(invoice_id, pdp_event_id)`).
   An event the state machine does not allow from the current status (« Reçue » then « Mise à
   disposition », both `delivered` for us) or a status we do not know is kept on the timeline as a
   `pdp_event`, never dropped.
5. A sweep every `PDP_SYNC_INTERVAL_SECONDS` re-queues sends left in `ready_to_send`/`sending` and
   syncs every invoice still waiting for news, so a lost webhook or a crash between commit and queue
   only delays things.

### Decisions taken in M2

| Topic | Decision | Why |
|---|---|---|
| Local database | PGlite (Postgres compiled to WASM) in `.data/pglite`, or in memory for tests; `DATABASE_URL` switches to a real Postgres | No Docker needed for `pnpm dev`, tests or scenarios; same SQL, same migrations, same pg-boss (its `pglite` backend). |
| ORM | Drizzle, only inside `@fi/db`; other packages import its operators from `@fi/db` | Typed SQL close to Postgres, migrations generated as plain SQL files we can read and edit (`0001_guards.sql` is hand-written). |
| Queue | pg-boss 12 in the same database | Plan §1. No Redis; jobs commit and roll back with the data they describe. |
| Enqueue after commit | Never call `boss.send` inside a transaction; the sweep covers a crash between commit and enqueue | PGlite is one connection: pg-boss querying it from inside an open transaction deadlocks. On Postgres it would merely be a second connection; keeping one rule for both is simpler. |
| Webhook = notice, not data | The webhook body only names the invoice; the state comes from `getStatus` | `docs/B2BROUTER.md` §4: a B2Brouter webhook only says something changed, the state is fetched through the API; it also makes replayed, reordered or forged-but-valid webhooks harmless. |
| Auth | Tenant API keys `fik_…` (24 random bytes, sha256 at rest, revocable) created by an admin token | Enough for the add-in and the scenarios in M2; magic link for people arrives with the add-in (M3). |
| Errors | `{error:{code, message, details?}}`, message from `fr.json` | Rule 10 of `CLAUDE.md`; the code is stable for the add-in, the message is for the user. |

## What M3 added: agents, the add-in routes, the task pane

```
Excel ── office.js ── apps/addin (task pane, React + Fluent UI)
                         │  ExcelPort: SheetReader → RawRow[] with addresses, StatusWriter (FI_Statut / FI_Détail)
                         │  Controller: one state for five screens, OfflineQueue, auto-sync on cell changes
                         ▼  /api (Vite proxy in dev)
                      apps/api ── packages/agents (orchestrator → MappingAgent, ExplainAgent, TestAgent)
```

| Path | What it does |
|---|---|
| `packages/agents` | Plan §6. Providers (Mistral, Anthropic, OpenAI, Google, Azure, any OpenAI-compatible endpoint; the subscription's or the tenant's own sealed key), the pseudonymizer (names, identifiers, IBAN, e-mails, phones, street lines → stable tokens, re-hydrated in the answer), the orchestrator (one run per invoice, two per tenant, token caps, 3 retries, every run in `agent_runs`, a failed run falls back to the deterministic answer). MappingAgent proposes the columns (header dictionary as fallback), ExplainAgent turns rule issues into plain French with the cell to fix and never proposes a forbidden auto-fix, TestAgent is the deterministic rehearsal checklist. Prompts in `prompts/`, evals in `evals/`. |
| `apps/api` (M3 routes) | Sign-in links (`/auth/magic-link`, confirm page, poll → session token `fis_…`), `/me`, `/settings` (+ `/settings/ai`), `/detect`, sheet mappings per workbook, `POST /workbooks/:id/sync` (the sheet's rows → drafts → validated invoices, one status per row, test invoices numbered `TEST-…` when asked), `/invoices/:id/{explain,rehearse,scenario,pdf}`, RGPD export and deletion (`docs/RGPD.md`). The local `OutboxMailer` keeps sign-in mails (`GET /admin/outbox`). |
| `apps/addin/src/excel` | The only code that touches Excel. `office.ts` implements `ExcelPort` with office.js (retry + timeout around every `Excel.run`); `fake.ts` implements it in memory for tests and the harness. `reader.ts` returns rows with addresses and leaves out the two owned columns; `writer.ts` batches status writes, at most one per 500 ms, newest wins. |
| `apps/addin/src/controller.ts` | Every action of the five screens, independent of React: sign-in, detection, sync, fiche, rehearsal, send (always behind a confirmation), Mode test, scenarios, settings. Actions that need the network go through `OfflineQueue` when it is down (« en attente de connexion ») and run when it is back. A cell change re-syncs after 1.5 s; the add-in's own status writes are filtered out. |
| `apps/addin/src/ui` | Connexion, Détection, Tableau de bord, Fiche facture, Réglages; the orange Mode test banner on every screen. Strings only from `fr.json`. |
| `apps/addin/src/harness` | A dev page with a sheet in the browser, the ribbon and the real pane (`/harness.html`), the demo sheet and `seedDemo`. |
| `apps/addin/manifest.xml` | Classic XML manifest, shared runtime, ribbon group « Facture Impec » on the Home tab (`docs/OFFICE.md` §2). |

Tests: `controller.test.ts` runs the pane's whole flow against the real API in memory (PGlite) with a
scripted platform; `e2e/harness.spec.ts` runs it in Chrome against the real API, mock PDP and dev
server (`docs/RUNBOOK.md` § E2E).

### Decisions taken in M3

| Topic | Decision | Why |
|---|---|---|
| Manifest | Classic XML manifest, not the unified JSON one | The unified one does not install on perpetual Office for Windows nor from a network share, so an XML version would be needed anyway (`docs/OFFICE.md` §1). |
| Ribbon buttons with the pane closed | « Vérifier » writes the statuses in the sheet; « Envoyer » asks to open the pane | `showAsTaskpane` is ignored for Marketplace add-ins since 2026-02-23 (`docs/OFFICE.md` §3): a result must be readable without the pane. |
| Ribbon « Envoyer » | Opens the fiche with the confirmation; never sends by itself | Plan §0: nothing goes to a platform without an explicit decision; a ribbon click is too easy to make by mistake. |
| No router | The controller holds the current screen | office.js breaks the history API (`docs/OFFICE.md` §8); five screens do not need URLs. |
| Session storage | `OfficeRuntime.storage`, then `localStorage` partitioned by `Office.context.partitionKey`, then memory | `docs/OFFICE.md` §4: the shared runtime has `OfficeRuntime.storage`; Excel on the web needs the partition key. |
| Workbook identity | A random id in the document settings, the mapping in the document and on the server | The same file reopened elsewhere keeps its mapping; a copy of a sheet does not inherit another company's. |
| Mode test switch | Turned on only when the company allows test invoices and a test platform exists | The banner must never promise a test that the server would refuse. |
| Status columns | Two columns after the user's data, found again by their headers | Plan §5: never write in the user's own cells. |
| Contract tests | The pane against the real API in memory, not mocked HTTP | The pane and the API change together; a mocked API would drift. |
| E2E target | The harness page in local Chrome on every run; Excel on the web only with an account | Excel on the web needs a Microsoft account that can upload add-ins (owner, `docs/DEFERRED.md`). |

## What M4 added: B2Brouter, received invoices, a sheet that follows its invoices

```
apps/addin ── sync / GET /invoices?ids= ──► apps/api ── PdpAdapter ──► B2Brouter (test_ key: sandbox)
     ▲ FI_Statut without a click                 │  ▲                  └─ or its stand-in, apps/mock-pdp /b2brouter
     └──────────── 30 s → 5 min ─────────────────┘  └── webhooks /webhooks/pdp/b2brouter + the sweep
```

| Path | What it does |
|---|---|
| `packages/pdp-adapter/src/b2brouter` | The real adapter (`docs/B2BROUTER.md` §3.4): one operator key, the tenant's account id on every call, import → attach → send with search-then-reuse instead of an idempotency key, history from events + state + responses, directory with 202 polling, `POST /payments`, received invoices from `/as/original`, signed webhooks. Platform refusals are French (`pdp.refused.*`). `sandbox.test.ts` runs the contract against the real sandbox by hand. |
| `apps/mock-pdp/src/b2brouter.ts` | B2Brouter's API over the mock's engine (same clock, timeline, faults, directory, inbound), in both shapes where B2Brouter's docs disagree; its webhooks are signed the B2Brouter way. The contract suite runs against it in both shapes. |
| `apps/api/src/runtime.ts` | `pdpFromEnv` adds B2Brouter when `B2BROUTER_API_KEY` is set and stops the API when the key does not fit its host or environment; `testPlatformFromEnv` makes B2Brouter the test platform for a sandbox key (scenarios are then written by the API, `sandbox.ts`). |
| `apps/api/src/workers.ts` | The sweep also polls every company's platform (and the test platform) for received invoices into `inbound_queue`, from the last one stored, once each, with an audit event. |
| `apps/addin/src/controller.ts` | While a row of the sheet is on its way (`ready_to_send` … `delivered`), the pane asks `GET /invoices?ids=` every 30 s, then twice as late up to 5 min, and syncs the sheet as soon as one moved. |

Tests: the contract suite against the stand-in (both shapes) and, by hand, the real sandbox; the
scenarios through the adapter (`scenarios-b2brouter.test.ts`, `pnpm scenario --provider b2brouter`);
`controller.test.ts` follows a sent invoice on the sheet with the fiche closed;
`e2e/b2brouter.spec.ts` does it in Chrome against the stand-in, or the sandbox with the owner's key.

### Decisions taken in M4

| Topic | Decision | Why |
|---|---|---|
| Credentials | One operator key in the environment; tenants keep their B2Brouter account id | B2Brouter keeps one account per SIREN, and one key per integration group reaches every account in the group (`docs/B2BROUTER.md` §2); nothing secret is stored per tenant, so nothing to encrypt yet. |
| Key hygiene | `sandbox` takes only `test_…`, `prod` never; the key must fit its host; a stand-in host only in `local`; live test runs refuse non-sandbox keys | A wrong key in the wrong place either sends real invoices from a test or fakes sends in prod; both must stop at startup. |
| No idempotency key | Search the number, compare the original bytes, reuse or replace our own draft, refuse a number taken by another document | B2Brouter has none for invoices (`docs/B2BROUTER.md` §6); blind retries would duplicate. |
| Mode test | B2Brouter when the key is a sandbox key, else the mock | The sandbox is the honest test; the mock stays for local work without a key. |
| Status in the sheet | The pane polls a cheap status list, with backoff, and syncs only on a change | A full sync reads and validates the whole sheet and writes audit rows; every 30 s it would flood both. |
| Received invoices | Polled by the sweep, stored as XML with status `new`; reading and triage wait for M6 | Plan §11 asks M4 for the polling; the Réception screen is M6. |
| A stand-in for B2Brouter | In `apps/mock-pdp`, over the same engine | No sandbox key on this server yet: everything but the live calls is proven against it, and the live run is one command (`docs/RUNBOOK.md`). |

## What M5 added: getting paid (Monitor, Collect, Report)

```
sync / webhook ─► invoice delivered/accepted ─► chasing run (every 5 min) ─► chase_plans.steps
                                                   │ overdue at J+1, then each step from 9:00 Paris
                                                   ├─ Review: a draft on « Relancer » → user mails it, « Marquer comme envoyée »
                                                   └─ Autopilot (≤ ceiling): the agent mails courtesy/reminder/firm; formal notice: always a draft
« Encaissée » ─► paid + plan ended ─► payment_reports ─► job: PdpAdapter.reportPayment (B2Brouter POST /payments)
rejection / refusal ─► monitor job ─► note « next step » on the timeline (rules by code; a model picks among 3 for a refusal)
Monday 8:00 Paris ─► weekly report mailed to the owners; the same card on the Tableau de bord (GET /report)
```

| Path | What it does |
|---|---|
| `packages/core/src/chase.ts` | The plan as data: cadence → steps with their tone and date, the step of the day from 9:00 Paris, missed steps skipped instead of a burst, promise hold, rescheduling after a new cadence, end. Pure functions, no clock of their own. |
| `packages/agents/src/collect.ts` | Chase drafts from `fr.json` templates with the number, amount, dates and days late written by code; the autopilot guardrail (`autopilotDecision`): never a formal notice, never a test invoice, never above the ceiling or without an address. |
| `packages/agents/src/monitor.ts`, `prompts/monitor.md` | Next step after a rejection (rule ids read from the platform's answer, « fix and resend ») or a refusal (a model chooses among fix and resend / credit note / contact the customer and drafts the message, after pseudonymization; a draft with a wrong amount or an invented token falls back to the three options). |
| `packages/agents/src/report.ts` | The week in at most 10 lines: four numbers, then at most three actions, formal notices first. Deterministic. |
| `apps/api/src/collect.ts` | The chasing run: overdue, plan creation, the step of the day per invoice (invoice locked first, plan second), mail sending outside the transaction with a `sending` claim so a crash never sends twice; « Relancer » routes (prepare, mark as sent, promise). |
| `apps/api/src/payments.ts` | « Encaissée »: paid, plan ended, a `payment_reports` row in the same transaction, then the report job (once; a refusal is `failed`, an outage is retried). |
| `apps/api/src/monitor.ts`, `report.ts` | The monitor job (queued after the send and sync commits, and by the sweep); the weekly mail (one claim per company and ISO week in `weekly_reports`) and `GET /report`. |
| `apps/addin/src/ui/ChasePanel.tsx` | « Relancer » on the fiche: plan, draft (copy, open in the mail app), « Marquer comme envoyée », « Préparer une relance maintenant », « Promesse de paiement », « Encaissée »; the MonitorAgent's card. Réglages: autopilot with its ceiling; Tableau de bord: the weekly card. |
| `scripts/load/` | The k6 batch test (`pnpm load`): the API and the mock platform in one process on a throwaway Postgres, k6 in Docker. |

Tables (migration `0004_chasing.sql`): `chase_plans` (one per invoice, steps as JSON), `payment_reports`,
`weekly_reports`. The tenant's `mode` and `autopilot_max_amount` columns, there since M2, are now read.

Tests: `packages/core/src/chase.test.ts`, the agents' tests and the monitor eval, `apps/api/src/collect.test.ts`,
`monitor.test.ts`, `report.test.ts`, the `late-payment` scenario on the accelerated business clock (mock and
B2Brouter adapter), `controller.test.ts` and `e2e/b2brouter.spec.ts` for the pane.

### Decisions taken in M5

| Topic | Decision | Why |
|---|---|---|
| Who writes a chase mail | Templates with code-written facts; no model | Amounts, dates and legal references must be exact; the plan's non-negotiable « an LLM never decides validity » extends to what is owed. |
| Formal notice | Always a draft, in every mode, checked in the agent, the API and the scenario | Plan §6; it has legal effect and is best sent by registered letter. |
| Autopilot scope | Chasing only, opt-in per company, with a mandatory ceiling, only where the deployment can send mail | Plan §0.2: nothing leaves without an explicit user decision; switching the autopilot on is that decision for chasing. |
| A step missed while the server was down | Skipped, the latest due step acts | A customer must not receive three reminders in one morning. |
| Sending a chase mail | Claim the step (`sending`, committed), send outside the transaction, then record; a claim older than 10 min becomes a draft « interrompu » | A crash between the mail and the commit must never lead to a second mail. |
| Business clock in the scenario | The API's clock runs at the platform's speed only once the invoice is at the customer | The platform's latency would otherwise eat business days before the plan exists. |
| Payment report | One `payment_reports` row per invoice written with the payment; the job retries only outages | « Encaissée » must reach the platform once; a lost answer at B2Brouter is still open (`docs/B2BROUTER.md` T21). |

## What M6 added: receiving supplier invoices (Réception)

```
platform ─► inbound poll (sweep) ─► inbound_queue (XML, new) ─► triage (InboundAgent, per tenant, in order)
Mode test « Recevoir une facture de test » ─► inbound_queue (is_test) ─┘        │ parsed facts + flags
« Réception » tab ◄── GET /inbound?test= ◄─────────────────────────────────────┘
   « Bon pour paiement » / « Contester » ─► applyInboundTransition (new → approved | disputed)
   « Exporter vers le comptable » ─► POST /inbound/export ─► inbound_exports (FEC + CSV) ─► rows exported
```

| Path | What it does |
|---|---|
| `packages/core/src/inbound.ts` | The supplier invoice's state machine (`new` → `approved` / `disputed` → `exported`), the supplier key (SIREN, else VAT number, else name), the IBANs read and masked, credit notes. |
| `packages/agents/src/inbound.ts` | The InboundAgent: reads the CII or UBL file with `@fi/core` and the EN 16931 rules, then flags in plain French: unreadable, another buyer, wrong amounts, other rules, duplicate, possible duplicate, IBAN changed or invalid, new supplier, credit note, foreign currency. Deterministic, no model; `block` flags make approval impossible. |
| `packages/core/src/export.ts` | `buildFec` (purchase journal in the layout of article A47 A-1, `docs/ACCOUNTING_EXPORT.md`) and `buildCsv`. `packages/core/test/export-check.ts` is the strict reader the tests use. |
| `apps/api/src/inbound.ts` | Triage (row and tenant locked, so two copies of one invoice see each other), the routes of the screen (`GET /inbound?test=`, `GET /inbound/:id`, `POST /inbound/:id/{approve,dispute}`, `POST /inbound/export`, `GET /inbound/exports?test=`, `GET /inbound/exports/:id/{fec,csv}`, `POST /inbound/test`), the export (tenant locked so entry numbers never repeat; files kept in `inbound_exports` for later downloads), the Mode test injection. |
| `apps/api/src/workers.ts` | The inbound poll stores test-platform deliveries as test rows and triages what it stored. |
| `apps/addin/src/ui/ReceptionView.tsx` | Screen 5: the cards with their flags, the IBAN confirmation box, the dispute reason, the export and its downloads, the three test buttons in Mode test. |
| `scripts/accounting/` | `pnpm accounting:check`: the FEC imported into Paheko (pinned Docker image) through its own import, then the books compared with the file. |

Tables (migration `0005_reception.sql`): `inbound_queue` gains `is_test`, `parsed_json`, `triage_json`,
the facts the triage and the screen need (supplier, number, dates, amount, currency, IBANs), the decision
(`decided_at`, `decided_by`, `dispute_reason`) and `export_id`; a trigger refuses a status change outside
`applyInboundTransition`. New `inbound_exports`: one row per export with both files and its entry range.

Tests: the core and agent tests above, `apps/api/src/inbound.test.ts` (delivery, triage, approval, IBAN
confirmation, export, Mode test, RGPD), `packages/db/src/db.test.ts` (the status guard),
`controller.test.ts` and `e2e/harness.spec.ts` for the pane, `pnpm accounting:check` by hand.

### Decisions taken in M6

| Topic | Decision | Why |
|---|---|---|
| Who triages | Code, no model | Every flag is a fact (a number seen before, an IBAN never seen, totals that do not add up); a model must not decide whether money goes out. |
| When triage runs | After each poll, and before each listing for rows not triaged yet; serialized per company | A row is never shown untriaged, and two copies arriving together still meet. |
| What blocks « Bon pour paiement » | Unreadable, another buyer, a duplicate, amounts that do not add up; a new IBAN needs the user's explicit confirmation, recorded in the audit | Paying twice or paying a fraudster are the two expensive mistakes; the rest is information. |
| IBAN history | Compared with the supplier's earlier invoices of the same side (real or test), disputed ones aside | A disputed invoice may be the fraud itself; the supplier going back to an old IBAN is not an alert. |
| Mode test supplier invoices | Written by the API as the test platform would deliver them, on the mock and on B2Brouter alike | B2Brouter's sandbox cannot receive (T14), and the mock's ids restart with the process; one path for both keeps them comparable. |
| Accounts in the FEC | One charge account (606000), deductible VAT (445660), supplier (401000) with an auxiliary account per supplier | The smallest file every French accounting program imports; the accountant re-assigns charges (`docs/DEFERRED.md`). |
| Invoices the FEC cannot hold | Other currencies and VAT lines that do not add up go to the CSV only, and the pane says so | No exchange rate, and an entry that does not balance would be refused or wrong. |
| Once exported | No dispute and no second export of an invoice | The accountant holds it now; reversing it is their entry (`docs/DEFERRED.md`). |

## Decision: port the Rust core to TypeScript, archive Rust

The plan (§1) keeps the Rust/WASM core only if it compiles, has tests, **and** covers more rules than
we can port in two days. Audit of `main @ 4c6b294` on 2026-10-17:

| Criterion | Finding |
|---|---|
| Compiles | Yes. `cargo fmt --check` clean, `cargo test --workspace` builds all three crates. |
| Has tests | Yes. 36 tests, all green (core: 10 unit + 10 integration; backend: 16). |
| Rule coverage | 40 rule ids in ~1,200 lines of `facture-core`: BR-02…16, BR-CO-10/13/14/15/16/17, BR-S/Z/E/AE-05, BR-E/AE-10, a generic BR-DEC, 5 French format checks (SIREN/SIRET Luhn, VAT key, IBAN, identifier mentions), 3 `FF-*` and 4 soft `AI-*` heuristics. Each rule is a few lines over a flat model, so this is well inside a two-day port. |
| Builders | None. There is no CII, UBL or Factur-X output: the MVP relied on the PDP to produce the XML. M1 needs our own builders anyway. |

Verdict: **port.** The third criterion fails, and keeping Rust would mean two languages, a WASM build
for the add-in and a second runtime binding for the Node API, for a rule set we can rewrite in under
two days. The plan forbids dual implementations, so Rust stops being a source of truth today:

- the tag `archive/rust-mvp-v1` (a branch until 2026-10-18) points at `4c6b294` and keeps the whole MVP (Rust crates, Next.js add-in, docs);
- `legacy/rust-mvp/` held a read-only copy during M1, so the port could be checked rule by rule;
- once every Rust rule id had a TypeScript equivalent and a fixture (`docs/PROGRESS.md`), `legacy/` was deleted.

What the port keeps from the MVP: exact EN 16931 rule codes (source: Peppol BIS Billing 3.0 rule
list, to be cross-checked against the official schematron `ConnectingEurope/eInvoicing-EN16931`),
the `FF-` prefix for our own checks, French messages, and the cell reference carried by every issue.

## Decisions taken in M0

| Topic | Decision | Why |
|---|---|---|
| Workspace | pnpm 11 workspaces + Turborepo 2, Node 22 (`.nvmrc`) | Plan §1. |
| Internal packages | Export TS source, no build step; apps run via `tsx` and Vite | Fewest moving parts; one source of truth per type. Bundling the API for production is decided in M2. |
| TypeScript | v7 (native compiler) for type checks; `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `module: Preserve` + `bundler` resolution | Strict per plan; `Preserve` works for both Vite and `tsx`. If a tool breaks on TS 7, fall back to 6.0. |
| Lint / format | Biome 2, `recommended` preset, `noExplicitAny` = error | Plan §1; enforces "no `any`". |
| Environment | One root `.env`, validated by Zod in `@fi/shared/env`; `.env.example` lists exactly what the code reads | "Zod at every boundary"; `.env.example` always complete. |
| Ports | add-in 3000, api 4000, mock-pdp 4010 | 4010 is fixed by plan §3; 3000 is the Office add-in convention. |
| React | 18.3 | Plan §2. Fluent UI v9 (added in M3) supports React ≤ 19. |
| CI | `pnpm verify` (biome ci + typecheck + test); `ci.yml` runs the same | GitHub Actions is disabled on the account (billing since 2026-09-17), so the local run is the real gate. |
| Old deployment | `facture-impec.vercel.app` (Next.js MVP) stays up untouched; it is deployed from the CLI, not linked to git | Replaced by the new add-in in M3. |

## Decisions prepared for later milestones

- **Money (M1, done).** Amounts are integer cents (`number`, safe up to 9×10¹⁵). Quantity (BT-129)
  and item net price (BT-146) may have more decimals: they stay decimal text and line net is
  quantity × price rounded half away from zero to the cent, computed in `bigint`. Never floats.
- **XML (M1, done).** `@e-invoice-eu/core` was evaluated and not adopted: it cannot parse CII or UBL,
  has no business rules and installs 74 MB (`docs/research/FORMATS.md` §1). Our own builders pass the
  official XSD and schematrons.
- **API runtime (M7).** Bundle `apps/api` and `apps/mock-pdp` (esbuild/tsup) and ship one Docker image for the EU VPS; until then both run through `tsx` (`docs/DEFERRED.md`).
- **LLM (M3).** Plan §1 named the Anthropic API only. On 2026-10-17 the owner asked for every major
  provider plus any OpenAI-compatible endpoint, included or with the tenant's own key: design in
  `docs/AI_PROVIDERS.md` (Vercel AI SDK, per-tenant settings, sealed keys, capability probe, no silent
  provider switch). Model ids come from env so the default stays a config change.
- **PDP (M2/M4).** Facts about B2Brouter, with sources and dates, live in `docs/B2BROUTER.md`.
  Business code only sees `PdpAdapter`. Two changes to the plan §8 interface follow from those facts
  and landed in M2: B2Brouter keeps one account per SIREN, so every call carries the tenant's PDP
  account; and reporting a payment (`paid`, French status 212) needs its own method. B2Brouter has no
  idempotency key, so `sendInvoice` imports first and sends in a second call, and our own
  idempotency key guards both.

## Environments

| Env | PDP | Data |
|---|---|---|
| `local` | `apps/mock-pdp` on :4010 (with B2Brouter's stand-in at `/b2brouter`), or B2Brouter's sandbox with a `test_` key | PGlite in `.data/pglite`, or any Postgres through `DATABASE_URL` |
| `sandbox` | B2Brouter sandbox (`test_` key required) | Supabase `fi-sandbox`, when it is hosted (M7) |
| `prod` | B2Brouter production | Supabase `fi-prod` (EU), from M7 |

`FI_ENV` selects the environment; it is validated at startup and reported by `/health`.
