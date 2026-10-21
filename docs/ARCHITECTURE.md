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

The add-in never owns business logic. Validation lives once, in `packages/core`, and runs in the API:
the pane sends the sheet's cells (`POST /workbooks/:id/sync`) and shows the verdict that comes back,
row by row. The pane never calls `validate()`, and neither detection nor the totals run in it.

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

## What M7 added: sign-up, billing, the operator's switches, deployment, the store package

```
Excel « Créer un compte » ─► GET /onboarding/company/:siren ─► Annuaire des entreprises (DINUM, no key)
   └─► POST /onboarding/signup ─► e-mailed link ─► button ─► tenant (trial 30 d) + owner ─► pane polls, signed in
Réglages « Choisir une formule » ─► POST /billing/checkout ─► Stripe Checkout (browser window / dialog)
Stripe ─► POST /webhooks/stripe (signed) ─► tenants.billing_status, plan, period ─► send gate
each real send ─► billing_usage (+ meter event beyond the quota)
operator ─► /admin/tenants (list, platform account, pilot/trial, white label, live in prod)
```

| Path | What it does |
|---|---|
| `apps/api/src/onboarding.ts`, `sirene.ts` | « Créer un compte »: directory lookup, sign-up request, link, creation, poll (`docs/ONBOARDING.md`). |
| `apps/api/src/billing.ts`, `stripe.ts` | Checkout, customer portal, the signed webhook, the gate on real sends, usage and meter events, cancellation at deletion (`docs/BILLING.md`). |
| `apps/api/src/admin.ts` | The operator: list companies, create one, set its platform account, pilot or trial, an accounting firm's brand, go-live in prod. |
| `apps/api/src/platform.ts` | `routeFor` (a test invoice to the test platform), `homeProvider`, `awaitsGoLive` (prod only). |
| `apps/api/src/runtime.ts` | The registry: the mock in local only, B2Brouter with the key, `b2brouter_test` (B2Brouter's sandbox) in prod for Mode test; the SMTP mailer outside local. |
| `apps/api/src/limits.ts` | Requests per client address and per company in fixed windows, body size limits (2 MB, 256 KB on webhooks, sign-in and sign-up). |
| `apps/api/src/rgpd.ts` | `purgeExpired`, daily: links, sessions and sign-up requests a day after they end; deletion also ends the Stripe subscription. |
| `apps/api/src/report.ts`, `packages/agents/src/report.ts` | The weekly report signed with the firm's name under a full white label. |
| `apps/addin/src/ui/Signup.tsx`, `Subscription.tsx`, `SettingsView.tsx` | The wizard; Abonnement in Réglages (trial, quota used, plans, portal); « Supprimer le compte » with the SIREN typed again. |
| `apps/addin/src/pages.ts`, `redirect.html` | Stripe pages outside Excel: `openBrowserWindow`, or a dialog on our page in Excel on the web; only Stripe's two hosts. |
| `apps/addin/scripts/release.ts`, `appsource.ts` | `pnpm appsource:package`: store manifest, icons, store logo, listing checks, reviewers' notes and sample (`docs/APPSOURCE.md`). |
| `apps/mock-pdp/src/stripe.ts`, `sirene.ts` | Stand-ins for Stripe and the directory, in local and tests. |
| `apps/api/Dockerfile`, `deploy/compose.yaml` | The API image and the pilot stack with Postgres (`docs/DEPLOY.md`). |

Tables (migration `0006_pilot.sql`): `tenants` gains `live_at`, `white_label_json`, the terms accepted and
the billing columns (`billing_status`, `trial_ends_at`, `plan`, `billing_interval`, `stripe_customer_id`,
`stripe_subscription_id`, `billing_period_end`); new `signup_requests`, `billing_usage` (real sends per
company and period, once per invoice) and `stripe_events` (webhook ids already handled).

Tests: `apps/api/src/onboarding.test.ts`, `billing.test.ts`, `operator.test.ts`, `mail.test.ts`,
`pilot.test.ts` (the pilot rehearsed in prod mode), `controller.test.ts` › creating an account and
› the subscription, then leaving, `release.test.ts`, `pages.test.ts`.

### Decisions taken in M7

| Topic | Decision | Why |
|---|---|---|
| Who may create an account | Anyone with a SIREN the directory knows and an e-mail they can read | Self-service is the point; real sends stay closed until the operator's go-live in prod, after B2Brouter's own checks on the account. |
| VAT number at sign-up | DGFiP's published number, else the computed one marked « à confirmer » | The key formula is unofficial and not every company has a number (`docs/ONBOARDING.md` §2). |
| Billing state | Stripe is the source; the database mirrors it from signed webhooks, and the pane re-reads after Checkout | No card data or price amounts in our code; one source of truth. |
| What billing blocks | Only a real send, once the trial is over without a subscription or after it ended | Reading, Mode test, exports, RGPD and following invoices already sent must never depend on payment. |
| Mode test in prod | B2Brouter's sandbox through a second key, as its own provider `b2brouter_test` | Prod has no mock, and a test invoice must never reach a real platform (plan §0.5). |
| Go-live | One operator call per company, checked against the platform, audited, reversible | « Switch one to prod » (plan §11) without a second deployment or a data move. |
| API runtime | One image running `tsx`, workers in the same process | No bundler to maintain for a pilot; a bundle is in `docs/DEFERRED.md` if start-up or size matters. |
| Stripe from Excel | Browser window (desktop) or a dialog on our own page (web), only Stripe's hosts | Stripe advises against iframes; no AppDomain needed; 1100.4 asks for the user's click. |

## What M8 added: customers, autopilot send, the archive, a company's own platform key

M8 closes what plan §0.2, §4, §6 and §10 asked for and M0–M7 had left in `docs/DEFERRED.md`
(criteria in `docs/PROGRESS.md` M8).

```
Clients « Chercher dans l'annuaire » ─► POST /parties/search ─► PartyAgent ─► Annuaire (name or SIREN)
                                                                   └─► PDP lookupRecipient (reach)
   « C'est ce client » ─► POST /parties ─► lookup again ─► parties (verified, names as the sheet writes them)
sync ─► each invoice's buyer completed from its customer (sheet wins) ─► invoices.party_id
validated + customer opted in + autopilot ceiling ─► autopilot_at = last change + 15 min
sweep ─► runAutopilot (every check again) ─► approve (actor system) ─► send queue | cancelled + reason
real deposit / real received invoice ─► invoice_archive (XML, PDF, SHA-256, chain, keep 10 years)
Réglages « Connecter votre compte B2Brouter » ─► PUT /settings/pdp ─► probe ─► tenants.pdp_key_sealed
```

| Path | What it does |
|---|---|
| `packages/agents/src/party.ts` | The PartyAgent (plan §6 ENRICH): `findParty` (three letters, post code then without, five candidates, exact name first, reach asked of the platform) and `confirmParty` (never a SIREN the directory does not vouch for now: invalid, unknown, closed, duplicate). Deterministic, no model, no customer name to a model. |
| `packages/core/src/party.ts` | `completeBuyer`: fills what the sheet leaves empty (name, SIREN, VAT number, address, e-mail); a sheet SIREN of another company fills nothing. `partyKey` matches names without case, accents or punctuation. |
| `apps/api/src/parties.ts` | Routes `/parties*`, the agent run in `agent_runs` (no tokens), the customers read once per sync, the note in FI_Détail. |
| `apps/api/src/autopilot.ts` | `autopilotBlocker` (mode and ceiling, validated without warning, invoice in euros under the ceiling, confirmed customer opted in, a first invoice to it sent by hand and delivered), `planAutopilot` after every change, `holdAutopilot`, `runAutopilot` in the sweep (platform, go-live, billing and directory checked again when due). |
| `apps/api/src/archive.ts` | `archiveSent` after a real deposit, `archiveReceived` in the transaction that stores a real supplier invoice, `runArchive` catching up in the sweep, `archivedPdf` for « Voir le PDF », `verifyArchive` for the operator, `archiveRegister` for the RGPD export. |
| `apps/api/src/platform.ts` | `adapterFor`: a company with its own key uses it for real invoices; a key saved that this deployment cannot open stops real sends rather than falling back to ours. |
| `apps/api/src/settings.ts`, `runtime.ts` | `savePdpKey` / `removePdpKey` (owner only, probe first); `ownPdpFromEnv` builds a company's adapter, refusing a key of another environment. |
| `apps/addin/src/ui/CustomersView.tsx` | The Clients tab: search, candidates with their reach, « C'est ce client », e-mail and « Envoi automatique » per customer. The fiche gains « Trouver ce client » and the planned send with « Annuler l'envoi automatique ». |

Tables (migration `0007_gaps.sql`): new `parties` (one row per company and SIREN, the names the sheets
use, routing, the autopilot switch) and `invoice_archive` (written once: a trigger refuses any update,
truncate, and any delete before `keep_until`); `invoices` gains `party_id`, `autopilot_at`,
`autopilot_fingerprint`, `autopilot_held`; `tenants` gains `pdp_key_sealed`, `pdp_key_hint`.

Tests: `packages/agents/src/party.test.ts`, `packages/core/src/party.test.ts`,
`apps/api/src/parties.test.ts`, `autopilot.test.ts`, `archive.test.ts`, `own-platform.test.ts`,
`runtime.test.ts` › company keys, `packages/db/src/db.test.ts` › invoice_archive,
`controller.test.ts` › customers and › autopilot hold.

### Decisions taken in M8

| Topic | Decision | Why |
|---|---|---|
| PartyAgent and models | Deterministic; the directory and the platform answer, the agent only orders and guards | Whether a company exists is a fact to look up, and plan §0 keeps names away from models by default. |
| What the directory receives | Only what the user typed in the search (or « Trouver ce client », which fills it with the sheet's name) | No sheet is sent to a third party without a click. |
| A customer and the sheet | The sheet always wins; only empty cells are filled, and a different SIREN means another customer | The user's own cells are the truth (plan §5); the directory completes, it never corrects. |
| When an invoice leaves by itself | Opt-in per customer and a ceiling per company (plan §0.2), checked again when due, never a credit note or another currency, never past a warning | A wrong automatic send is a real invoice in a real customer's platform; the expensive cases stay with a person. |
| Trial period | The first invoice to each customer is sent by hand and must be delivered before the autopilot takes the next ones | The customer's platform address and the content are seen working once by the user. |
| Grace before an automatic send | 15 minutes after the last change, shown in the sheet and on the fiche, cancellable | The sheet syncs while the user types; a half-typed invoice must not leave. |
| The archive | In Postgres, written once by trigger, a SHA-256 per file and a hash chain per company; it leaves the machine with the backup | Plan §10's ten years without an object-storage bucket yet (`docs/DEFERRED.md`); the chain shows a changed row. |
| RGPD deletion and the archive | The archive stays for its ten years; customers and the company's key go | The legal retention of invoices outweighs erasure (art. 17.3.b), the rest has no such basis (`docs/RGPD.md`). |
| A company's own key | Sealed with AES-256-GCM under `PDP_KEY_SEALING_KEY`, tested before it is saved, shown by its last four characters, used for real invoices only | A secret the company gave us must be useless if the database leaks, and « Mode test » must never reach its real account. |
| A key the deployment cannot open | Real sends stop (« Envoyer » answers `pdp_not_configured`, the invoice stays); we never fall back to our own key | Sending a company's invoices from our account would be an invoice from the wrong sender. |

## What R0 added: cheap syncs, checks that follow the customer, the document registry

R0 prepares the checks of documents together (an order against its invoice, what was bought against what
was sold) that run in the background in later stages (criteria in `docs/PROGRESS.md` R0).

```
sync ─► the sheet's invoices read in one query ─► computed in memory ─► written only if changed
     └─► check key = hash(ruleset, fingerprint, day, history witnesses, company, customer switches)
           same key ─► nothing written      new key, same verdict ─► one UPDATE for all of them
           new verdict ─► validation_results + event, as before
rows left the sheet ─► cancel (reason row_removed), unless the invoice already left
sync that wrote / supplier invoice triaged ─► registry.refresh (one per company) ─► docs, doc_lines, items
```

| Path | What it does |
|---|---|
| `packages/core/src/rules/history.ts` | `NumberingHistory`: an index of the numbers issued; `for(invoice)` hands the history rules (BR-FR-CO-02, FF-NUM-01/02, FF-CN-01) the few earlier invoices that decide them instead of the whole list. |
| `apps/api/src/ruleset.ts` | `RULESET`: a digest of `packages/core`'s code and `fr.json`. A deploy that changes a rule or a message gives every invoice a new check key, so each one is checked once more. |
| `apps/api/src/invoices.ts` | `checkOf` (the key and the check), `rememberChecks` (every new key whose verdict did not change, in one statement), `recheckParty` (a customer switch changed: its invoices not yet sent are checked again). |
| `apps/api/src/workbooks.ts` | The sync: one read of the sheet's invoices, unchanged ones skipped; an invoice found unchanged elsewhere in the sheet follows its rows; the ones whose rows are gone are cancelled with `row_removed`. |
| `apps/api/src/registry.ts` | `refreshRegistry`: projects the invoices whose fingerprint moved and the supplier invoices read since, removes the cancelled ones, in batches of 200; `itemKey` ties a line to the company's article (its own reference BT-155 sold or BT-156 bought, else the normalized name; a bought line without it stays the supplier's article). `registryBehind` lets the sweep catch up. |
| `packages/core/src/sheet` | Two mapping fields: « Référence de l'article » (BT-155) and « Remise sur la ligne » (an amount, BT-136, reason code 95). A percentage is never taken for an amount: detection and the MappingAgent's guard leave it out and say so; typed by hand, it becomes a discount without an amount that BR-41 stops on its cell. |
| `apps/addin/src/ui/CustomersView.tsx` | Two switches per customer: « Exige son numéro de bon de commande » (FF-PO-01) and « Organisme public » (DGFIP-G2.32). |

Tables: migration `0008_sync_checks.sql` (`invoices.validated_key`, the two customer switches) and
`0009_registry.sql` (`items`, `docs`, `doc_lines`). Load: `pnpm load:sync` (`docs/PROGRESS.md` R0).

Tests: `apps/api/src/sync.test.ts` (writes counted through the database logger),
`apps/api/src/registry.test.ts`, `packages/core/src/rules/history.test.ts` (property test against the
whole list), `packages/core/src/sheet/sheet.test.ts` › article reference and discount,
`packages/agents/src/mapping.test.ts` › percentage discount, `parties.test.ts` › order number,
`controller.test.ts` › customer switches.

### Decisions taken in R0

| Topic | Decision | Why |
|---|---|---|
| When an invoice is checked again | When its check key changes: the rules' code, its content, the day, its numbering neighbours, the company's VAT setting or its customer's switches | A verdict is a pure function of these; anything else checking again is wasted work, and anything less could leave a stale verdict. |
| A deploy that changes the rules | `RULESET` is part of the key, so the first sync after it checks every invoice once | An invoice validated under old rules must never leave under them. |
| The history rules | An index gives each invoice its few witnesses; a property test compares with the whole list | The whole list made each check grow with the company's age (5 000 invoices: 8.5 s instead of 0.8 s). |
| Rows removed from the sheet | Their invoice is cancelled (`row_removed` on the timeline) unless it already left for the platform | The sheet is the user's truth; once an invoice is at the platform, only the platform's lifecycle changes it. |
| The registry | Derived data in three tables, rebuilt from `invoices` and `inbound_queue` at any time, written by one job per company | The checks of later stages read lines and articles across documents; a projection keeps the invoice itself the single source, and one writer per company avoids races. |
| An article's identity | The company's own reference, else its normalized name; a bought line without the company's reference stays the supplier's article | Which of the company's articles a supplier line is will be a decision of a later stage (with its evidence), never a guess while projecting. |
| A percentage discount | Not supported: left unmapped with a warning, or stopped by BR-41 when mapped by hand | A percentage needs its base amount and rounding rules (BT-137/138); the smallest correct version takes the amount (`docs/DEFERRED.md`). |

## What R1 added: every sheet of the workbook

R1 lets the company's other sheets into the registry: customer orders, delivery notes, purchases and price
lists (criteria in `docs/PROGRESS.md` R1). Nothing is checked against them yet (R2).

```
« Inclure cette feuille » ─► the first 50 rows ─► a profile for these headers? ─► yes: reused as is
                                                └─► no: LayoutAgent (pseudonymized) ─► guard ─► else the dictionary
the user checks the kind and columns ─► PUT …/sources/:sheet ─► layout_profiles (version +1 if changed)
                                                             └─► sources (consent) ─► first read
a change in that sheet (its own event, 1.5 s) ─► POST …/sources/:sheet/sync with the whole sheet
   same rows as last time ─► nothing written
   header row moved ─► found again by its fingerprint      not found ─► nothing read, the pane says so
   else ─► only the documents whose content changed are written again; those gone are deleted
```

| Path | What it does |
|---|---|
| `packages/core/src/layout` | The four kinds and their fields (`fields.ts`); the dictionary that proposes a kind from the sheet's name and headers, and the columns (`detect.ts`); `readLayout` turns a confirmed layout into documents and lines in cents with their source cells, a row it cannot place counted, never guessed (`read.ts`). A price list is one document, the company's own prices; a row is an article only with a price, or a reference and a name. |
| `packages/agents/src/layout.ts`, `prompts/layout.md` | LayoutAgent: MappingAgent's masking, budget and orchestrator under its own phase `layout`. The supplier column is masked too (a sole trader is a person); article references stay readable. `guardLayout` keeps only real columns and fields the kind reads, a SIREN column only under a SIREN header, and the dictionary's sure columns where the model said nothing. |
| `apps/api/src/sources.ts` | `detectSource` (a profile first, else the agent, nothing saved), `includeSource` (profile and consent, then a first read), `syncSource` (the etag of the rows, the header found again, one version per document), `removeSource`, `registryView` (the « Registre » screen, each document with the cell it starts at). |
| `apps/addin/src/controller.ts` | One change listener per included sheet, independent of the invoice sheet's; each one read when the pane opens. An included sheet made active opens the Registre, never the invoice detection. |
| `apps/addin/src/ui/RegistryView.tsx` | « Registre »: the invoice sheet, each included sheet (documents, lines, last read, rows not understood, the header lost), the other sheets with « Inclure cette feuille » (names that say orders or purchases first), the confirmation of a layout, the latest documents with « Voir dans la feuille ». |

Tables: migration `0010_sources.sql` (`layout_profiles`, `sources`; `docs.kind`, `source_id`, `source_key`,
`order_ref`). Eval: `pnpm --filter @fi/agents eval:record layout` (`docs/AI_PROVIDERS.md`).

Tests: `packages/core/src/layout/layout.test.ts`, `packages/agents/src/layout.test.ts`,
`packages/agents/evals/evals.test.ts` › LayoutAgent, `apps/api/src/sources.test.ts`,
`apps/addin/src/controller.test.ts` › the other sheets of the workbook (R1), `apps/addin/e2e/harness.spec.ts`
› Registre.

### Decisions taken in R1

| Topic | Decision | Why |
|---|---|---|
| What a sheet holds | Proposed by a profile, LayoutAgent or the dictionary; read only after the user confirmed the kind and every column | An LLM never decides what the company's data means (plan §0); the confirmation is also the consent recorded in `sources`. |
| Remembering a layout | One profile per company and header fingerprint, in any workbook; its version rises only when the kind or a column changed | Next month's sheet with the same headers needs no agent call and no question. |
| A changed sheet | The pane sends the whole sheet; the API compares the etag of the rows, then one version per document, and writes only what changed | The simplest exact answer: a row-level state table (`row_state`) would save upload, not writes, below the 5 000-row limit (`docs/DEFERRED.md`). |
| A row inserted above the headers | The confirmed header row is found again by its fingerprint; if it is gone, nothing is read and the documents stay | Reading with the wrong header row would turn the headers into a document or shift every column. |
| An invoice sheet or « Autre » | Not included (`422 layout_kind_unsupported`); invoices keep their own path | Invoices are validated and sent; a registry copy would be a second truth. |
| Sheets proposed on the Tableau de bord | By their name only (« Commandes », « BL », « Achats », « Tarifs ») | The pane reads no other sheet before the user asks for it. |
| A purchase line's article | The supplier's article (`supplier:<supplier>:ref:<reference>`) | Which of the company's own articles it is will be decided later with its evidence (R0 rule), never guessed while reading. |

## What R2 added: checks across documents

R2 reads the registry's documents together: which order an invoice bills, which order a delivery note
delivers, and what does not add up between them, always as a rule in code with its money at stake and its
cells (criteria in `docs/PROGRESS.md` R2). A blocking finding can stop a send; nothing here asks a model.

```
an invoice synced, a sheet read, a sheet removed ─► registry job ─► registry brought up to date ─► checkNow
the sweep (every few minutes) ─► companies whose documents moved, or not checked today ─► checkNow
GET /checks, « Envoyer » ─► checkNow first

checkNow ─► mark of the documents unchanged and checked today? ─► nothing
          └─► runChecks (one at a time per company: advisory lock)
                docs + lines + cells ─► linkDocs (decisions of people kept) ─► checkRegistry (A1–A5, B1, B3–B6)
                ─► links written (proposed/auto), findings diffed (open / resolved / reopened), check_state
                ─► an invoice now held or freed ─► autopilot replanned; one it was about to send is cancelled
                   with the reason on its timeline
```

| Path | What it does |
|---|---|
| `packages/core/src/checks/link.ts` | The Linker: the order number first (score 100, every order of that number proposed when there are several), else the same customer (SIREN, else the normalized name), the same articles and quantities, in a window of dates (−30/+120 days for an invoice, −7/+180 for a delivery note). One clear candidate ≥ 80 links on its own; close ones (within 25 points) are proposed, three at most. A person's « Oui » settles the document; a « Non » takes that candidate out, and the others are weighed without it. |
| `packages/core/src/checks/check.ts` | The Checker. Inside an invoice: A1 HT/TTC confused, A2 a total typed by hand that no formula keeps in step, A3 a discount taken twice or a percentage typed as euros, A4 a VAT rate that is not this article's usual one (≥ 3 earlier invoices), A5 a price other than « Tarifs ». Across documents: B1 billed less than the order (blocking), B3 delivered and not billed after 30 days (warning), B4 billed more than ordered or delivered (blocking), B5 billed twice or advances above the order (blocking), B6 another customer than the order (warning). Test invoices are checked against the same sheets, apart from the real ones. Every finding: a key (stable across runs), a message key and its parameters, the cents at stake, the evidence (role, document, cell). |
| `packages/core/src/sheet` | The invoice sheet's own checks for A1–A3 (`build.ts`): an amount that includes VAT, a typed total, a discount twice; they need the formula of each cell, which the pane now reads (`Range.formulas`, `docs/OFFICE.md` § 5) and sends as a flag, never the formula itself. |
| `apps/api/src/checks.ts` | `runChecks` (above), `checkNow`, `checksBehind` (the sweep), `checksView` (the screen: open findings by money, the links waiting for a person, the money at stake on real invoices), `decideLink`, `blockingFindings` (the send gate). |
| `apps/api/src/invoices.ts` › `requestSend` | Checks again, then refuses `409 blocking_findings` unless the request names the fingerprint of every open blocking finding of that invoice (`{ acknowledge: [...] }`); a send despite findings writes a timeline note and the audit event `invoice.send_despite_findings` with them. |
| `apps/api/src/autopilot.ts` | A blocking finding is a reason not to plan (`findings`); the run checks each company before sending its due invoices, and a company whose check failed sends nothing that round. |
| `apps/addin/src/ui/ChecksView.tsx` | « Contrôles »: the money at stake, the links to confirm with « Oui » / « Non », one card per finding with « Corriger la ligne », « Voir la commande » (or the delivery note, the price list, the earlier invoice) and « Ouvrir la facture ». The fiche shows the same cards, and « Envoyer quand même » with the amount at stake. |

Tables: migration `0011_checks.sql` (`links`, `findings`, `check_state`; `docs.prepaid`).

Tests: `packages/core/src/checks/checks.test.ts`, `packages/core/src/checks/corpus.test.ts` (the scenarios
of `packages/core/test/checks-corpus.ts`), `packages/core/src/sheet/sheet.test.ts`, `apps/api/src/checks.test.ts`,
`apps/addin/src/controller.test.ts` › the checks across documents (R2), `apps/addin/e2e/harness.spec.ts` › Contrôles.

### Decisions taken in R2

| Topic | Decision | Why |
|---|---|---|
| Who decides a finding | Rules in `packages/core`; the wording from `fr.json` templates filled with the rule's numbers | Plan §0: an LLM never decides validity. MatchAgent and ExplainAgent wait (`docs/DEFERRED.md`). |
| When the checks run | After the registry job, in the sweep when the documents' mark moved or the day changed, and before a send or the screen; never in a request that edits an invoice | The edit stays fast; what blocks a send is checked on what is current at the moment of sending. |
| Knowing nothing changed | A mark per company: the count and a hash of each document's version and its invoice's status | `updated_at` misses changes made in the same instant; the mark is cheap and exact. |
| A finding over time | One row per (company, key): open, resolved when it is no longer found, reopened if it comes back; the fingerprint changes with its amount or cells | The screen and the audit tell a new problem from the same one; an acknowledgement is valid only for what the user saw. |
| « Envoyer quand même » | The pane sends the fingerprints the user saw; the API refuses a send that leaves one out | A finding that appeared or changed after the fiche was opened is not acknowledged by a click made before it. |
| The autopilot | Never sends past an open blocking finding: unplanned, a note with the reason; replanned by itself when the finding is resolved | Plan R2: the autopilot cancels and says why; only a person can send despite a finding. |
| A link a person decided | Kept as it is, whatever the next run finds; a confirmed link settles its document | People correct the Linker; it never undoes them. |
| Money at stake in the summary | Real invoices only; findings on test invoices are shown with « Test », never added up | Plan R2: a test invoice is never added to the real ones. |

## What R3 added: purchases and margin

R3 gives each sold line what it cost, from what the company bought: the supplier invoices received
through the platform and the rows of an included « Achats » sheet. Rule B2 then says when a line is sold
under that cost (blocking), or above it but under the margin the company set in « Réglages » (warning).
Criteria in `docs/PROGRESS.md` R3. Like R2, every step is a rule in code; nothing asks a model.

```
supplier invoice polled from the platform ─► registry job ─► docs (in, invoice) + supplier in parties
« Achats » sheet included ─► docs (in, purchase) from its rows
checkRegistry ─► findCosts: each sold line ─► the purchase of the same article ─► cost links (auto)
              ─► World.margins (B2): price < cost ─► « vente à perte » ; price < cost / (1 − margin) ─► warning
PATCH /settings { minMarginPercent } ─► audit settings.update ─► registry job ─► the mark moved: checked again
« Ce n'est pas le même article » ─► POST /links/:id rejected ─► the purchase before gives the cost
```

| Path | What it does |
|---|---|
| `packages/core/src/checks/cost.ts` | `findCosts`: a purchase is a received invoice (not a credit note or an advance) or a purchase sheet's document. The same article is the company's own item on both sides, else the same name once accents, case and punctuation are dropped (`normalizeName`); the same currency, and a unit that does not contradict (C62, H87 and EA are one piece; a box is another article). A purchase a person confirmed for the invoice comes first, one they rejected never counts. The latest purchase on or before the sale counts, else the first in the 60 days after it. Each purchase used is one link of kind « cost » (purchase → invoice): score 100 by item, 80 by name. |
| `packages/core/src/checks/amounts.ts` | A line's unit price as the checks read it, its discount and a sheet's TTC taken out; shared by A1–A5, B2 and the cost. |
| `packages/core/src/checks/check.ts` › `margins` | B2: a line given away (price 0) or without a quantity is not judged; a loss of a euro or more is blocking, with « la facture FA-77 de Grossiste SA » or « l'achat A-2 de la feuille « Achats » » in the wording; above the cost, a margin on the selling price under the company's minimum is a warning with the euros missing to reach it. Evidence: the invoice's price cell and the purchase (its cell, or for a received invoice its id). |
| `apps/api/src/registry.ts` › `noteSuppliers` | A real received invoice whose seller has a SIREN puts that supplier in `parties` (kind supplier, source « invoice », not verified, no names); one already there stays as it is. A « Mode test » invoice adds none. |
| `apps/api/src/parties.ts` | « Clients » lists and changes customers only: a supplier's id answers 404. |
| `apps/api/src/checks.ts` | The mark of a company ends with its minimum margin, so changing it checks again; the documents carry their currency and the lines their unit; each piece of evidence its received invoice (`inboundId`), each B2 finding the id of its cost link (`costLinkId`). |
| `apps/api/src/settings.ts` | `minMarginPercent`: a whole percentage from 1 to 90, or null; a change queues the registry job. |
| `apps/addin/src/ui/ChecksView.tsx`, `ReceptionView.tsx`, `SettingsView.tsx`, `RegistryView.tsx` | « Voir l'achat » selects the row of « Achats »; « Voir la facture du fournisseur » opens « Réception » on that invoice; « Ce n'est pas le même article » rejects the cost link; « Marge minimale sur le prix de vente (%) » in « Réglages »; « Registre » counts the suppliers. |

Tables: migration `0012_purchases.sql` (`tenants.min_margin_percent`; `parties.verified_at` may be null for
a supplier no directory confirmed).

Tests: `packages/core/src/checks/checks.test.ts` › what a sold line cost (R3), the B2 scenarios of
`packages/core/test/checks-corpus.ts`, `apps/api/src/purchases.test.ts`, `apps/addin/src/controller.test.ts` ›
purchases and margin (R3), `apps/addin/e2e/harness.spec.ts` › Achats.

### Decisions taken in R3

| Topic | Decision | Why |
|---|---|---|
| Which purchase gives the cost | The latest one of the same article on or before the sale, else the first in the 60 days after | What the company paid last is what it knows when it sets a price; the supplier's invoice often arrives after the sale. A weighted average or FIFO waits for stock data (`docs/DEFERRED.md`). |
| The same article | The company's own item on both sides, else the same name; a supplier's reference alone never ties | A supplier's « GM-CH-01 » says nothing about the company's « CH-01 ». Mapping one to the other is R7's job (catalogue). |
| Units | One piece is one piece whatever the code (C62, H87, EA); any other unit must be the same on both sides | Invoices built from a sheet say C62, suppliers' invoices often H87; a box of 12 against a piece would give a false loss. |
| Which margin | On the selling price (« taux de marque »): margin = (price − cost) / price, and the hint gives an example (20 %: bought 80 €, sold at least 100 € HT) | The figure a seller reasons in when pricing; the example removes the doubt with « taux de marge » on cost. |
| A loss against a margin | A loss blocks; a margin under the minimum warns; no minimum set, no warning | Plan R3: « продажа в убыток » blocking, the margin a warning; a company that never set one is not nagged. |
| Suppliers in `parties` | Only from real received invoices with a SIREN, as the invoice names them; never verified against the directory, never shown or changed in « Clients » | A supplier is known from its own invoice; an « Achats » row without SIREN is not a company we can name. |
| « Ce n'est pas le même article » | A « Non » on the cost link, through the same `POST /links/:id` as R2's links; the purchase before then counts | One way to correct the matcher, kept by the next runs like every decision of a person. |

## What R8 added: the chat and the corrections

R8 lets the person ask « pourquoi ? » about a finding, have its cell corrected, and take the correction
back, all in the pane. The code builds every correction (one price cell, « Avant → Après ») from the
finding; the model only explains and asks for the card. Nothing is written before the person's click,
and the checks, not the model, say whether it is corrected. Criteria in `docs/PROGRESS.md` R8.

```
check.ts: B1/B4 (order), A5 (price list), A1 (VAT on top) ─► finding.fix { cell, field: price, before, after }
« Corriger pour moi »     ─► POST /findings/:id/fix {by: person}           ─► edits row (proposed) + 5 min lock
« Demander à l'assistant » ─► GET /findings/:id/chat (opening = the finding) ─► POST /chat (SSE)
   ChatAgent (ToolLoopAgent) ─ read tools: finding, document, itemHistory (server side, pseudonymized)
                             └ proposeFix / undoEdit: no execute ─► the pane asks /fix or /edits/:id/undo
card « Appliquer » ─► pane: ask again (lock renewed) ─► cell still « Avant », no formula? ─► writeCell
                  ─► sync the sheet ─► POST /edits/:id {applied} ─► lock ends, checks run ─► {resolved, remaining}
                  ─► addToolOutput ─► the Chat asks again ─► the agent says « corrigé » only if resolved
« Annuler la correction » ─► POST /edits/:id/undo ─► same card the other way ─► {reverted} | conflict ─► ask
```

| Path | What it does |
|---|---|
| `packages/core/src/checks/check.ts` | A finding whose correction is one unit price carries `fix`: the price cell, the price it holds and the one of the order (B1, B4), of « Tarifs » (A5), or the price without VAT (A1). A loss (B2), a discount taken twice or a price that needs more than four decimals carries none. |
| `apps/api/src/edits.ts` | The journal (`edits`), the lock and the audit: `proposeFix` (re-asked: the same card, lock renewed), `proposeUndo`, `decideEdit` (applied, declined, conflict, reverted, kept), each checked against the edit's status; an invoice already sent is refused with the avoir to make. The click ends the lock and checks the company again; the answer says whether the finding closed and what remains on the invoice. |
| `apps/api/src/checks.ts`, `autopilot.ts`, `invoices.ts` | The lock: while `invoices.edit_lock_until` runs, the checks leave that invoice's findings as they are, the autopilot skips it, a send answers `invoice_editing`; the other invoices go on. |
| `packages/agents/src/chat.ts`, `prompts/chat.md` | ChatAgent: `ToolLoopAgent` of `ai` 7.0.143, at most 6 steps; a middleware masks the prompt of every call and unmasks the answer, the stream included. `proposeFix` and `undoEdit` have no `execute`: their result is the person's click, sent by the pane. |
| `apps/api/src/chat.ts` | `GET /findings/:id/chat`: the kept conversation, or its opening (the finding as the `finding` tool reads it, and its wording). `POST /chat`: one answer streamed (UI message stream), the opening read again from the finding, the conversation kept with it once the answer ends, the run in `agent_runs` (agent « chat ») within the day's token budget, `chat.ask` in the audit. |
| `apps/addin/src/chat.ts` | `PaneChat`: the `AbstractChat` of `ai`, its state outside React like the rest of the controller. A card tool call becomes a card; an answered card asks the agent again (`sendAutomaticallyWhen`), never after read tools alone; a call left without a click is asked again when the chat opens next. |
| `apps/addin/src/controller.ts` (R8 section) | `fixFinding`, `undoCorrection`, `openChat`, `ask`, `applyCard`, `overwrite`, `declineCard`. Before writing, `readCell`: a formula, an empty cell, a missing sheet or another value is a conflict, nothing written; after, the sheet is read again and the decision sent. A finding of the other mode (Mode test or not) is not corrected from the row. |
| `apps/addin/src/excel/office.ts` › `readCell`, `writeCell` | One cell's value, text and formula; one number written into `Range.values`. |
| `apps/addin/src/ui/EditCard.tsx`, `ChatView.tsx`, `ChecksView.tsx` | The « Avant → Après » card, « Annuler la correction », the conversation, « Corriger pour moi » and « Demander à l'assistant » on each finding. |

Tables: migration `0013_edits.sql` (`edits`, `chats`, `findings.fix_json`, `invoices.edit_lock_until`).

Tests: `packages/core/src/checks/checks.test.ts` › the correction the code builds (R8),
`apps/api/src/edits.test.ts`, `apps/api/src/chat.test.ts`, `packages/agents/src/chat.test.ts`,
`packages/agents/evals/evals.test.ts` › ChatAgent, `apps/addin/src/chat.test.ts`,
`apps/addin/src/controller.test.ts` › corrections and the assistant (R8), `apps/addin/e2e/harness.spec.ts` ›
Corrections, Assistant.

### Decisions taken in R8

| Topic | Decision | Why |
|---|---|---|
| Who writes the value | The code, from the finding (`fix`); `proposeFix` takes no value, only the finding the conversation is about | A model that types « 600 » can type « 6000 ». The card shows what the checks computed, nothing else. |
| Where the cell is written | In the pane (Office.js), after the click, and only if the cell still holds « Avant » as a plain value | The API never touches the workbook; the person's sheet is the source. A formula or a value typed since is the person's, not ours to overwrite. |
| « corrigé » | Said only when the checks, run again after the sync, closed the finding; otherwise the answer names what remains | Plan R8: the agent confirms through the deterministic checks, never on its own word. |
| The chat in the pane | `AbstractChat` of `ai` with a state class that reports every change to the controller, not `@ai-sdk/react`'s `useChat` | All the pane's state lives in the controller, outside React, and its tests drive it without a DOM; one more package for one hook was not needed. |
| The first message | The finding's own wording, built by the server without a model call | It opens at once and costs nothing; the model is asked only when the person asks. |
| The lock | Five minutes on the invoice, renewed when the card is asked again; the click ends it | A card shown on stale findings would correct the wrong thing; a lost click must not hold an invoice for good. |
| AI handle for the tests | `AiDeps.handle` lets the API's tests hand a scripted model | The same route code runs with a mock and a real provider. |
| An undo over a changed cell | A conflict, then « Remettre quand même » (writes) or « Laisser » (keeps the correction undoable); a conflict may follow a conflict | Taking a correction back must never erase what the person typed since without a second click. |
| Mode test | A finding of a real invoice is not corrected from the sheet while Mode test is on (and the other way round): the pane says why | In Mode test the row feeds the test copy; the real invoice would not be read again and its finding would stay. |

## What R4 added: OneDrive files read without Excel

R4 reads the orders, delivery notes, purchases or price lists a company keeps in OneDrive or SharePoint,
on the server, while Excel is closed. The person connects one Microsoft account from the pane, picks the
files in Microsoft's own picker and includes their sheets as R1 includes the open workbook's; from then
on a change in a file shows as a finding in « Contrôles » without anybody opening it. Microsoft's side,
sources and what is left to verify: `docs/MICROSOFT365.md`. Criteria in `docs/PROGRESS.md` R4.

```
pane  « Connecter OneDrive » ─► MicrosoftPort.signIn (NAA) ─► POST /connectors/microsoft {token}
      API: on-behalf-of ─► Graph + refresh token (sealed) ─► connections row ─► subscribe (personal only)
      « Choisir des fichiers » ─► MicrosoftPort.pick (File Picker v8) ─► POST …/files ─► each read once
      « Inclure cette feuille » ─► …/sheets/:sheet/detect (R1 detection on the file's rows) ─► PUT ─► sources (type file)
check connector.check job (webhook, sweep every 2 min / hourly when notified, reconnect)
      ─► refresh token ─► each file: metadata ─► cTag unchanged? done : download ─► readSheetFile
      ─► readSource (actor connector:microsoft) ─► documents ─► registry job ─► checks ─► findings
« Déconnecter » ─► unsubscribe ─► delete connection, files, their sources and documents ─► checks again
```

| Path | What it does |
|---|---|
| `packages/core/src/sheet/file.ts` | `readSheetFile`: an .xlsx/.xlsm (its zip parts: shared strings, styles, sheets, formulas) or a .csv (UTF-8 or Windows-1252, `;` `,` or tab) into the same `SheetSnapshot` the pane sends; 10 MB, 60 MB inflated and 5 000 rows at most, checked before inflating. |
| `apps/api/src/microsoft.ts` | The identity platform and Graph: `exchange` (on-behalf-of), `refresh`, `me`, `drive`, `item`, `content` (302 followed, size cap), `subscribe`, `renew`, `unsubscribe`. Every answer through Zod; every failure a `MicrosoftError` whose kind says what to do (reconnect, wait, file missing or forbidden, too large, try later). |
| `apps/api/src/connectors.ts` | The connector: `connect`, `pickFiles` (all read first; one fails, none kept), `detectFileSheet`, `includeFileSheet`, `removeFile`, `disconnect` (a sheet is taken out by `removeSource`, as in R1); `checkConnection` (the background check), `watch` (subscription kept and audited), `notified` (webhook → job), `connectorsBehind` (the sweep), the view for the pane with the picker's address and the Scout's `mailOnMicrosoft`. |
| `apps/api/src/app.ts`, `jobs.ts`, `workers.ts`, `runtime.ts` | Routes `/connectors/microsoft…` and `/webhooks/microsoft` (handshake, `clientState`); queue `connector.check` (stately per connection); the sweep enqueues due connections; `microsoftFromEnv` (only Microsoft's hosts outside local) and the cached MX lookup. |
| `apps/api/src/sources.ts`, `checks.ts`, `rgpd.ts` | A source of `type: file` is read only by the API (a pane's snapshot for it is refused); findings name the file of their document; the export and the erasure include connections (without their token) and files. |
| `apps/mock-pdp/src/microsoft.ts` | The stand-in: token endpoint (OBO, refresh), Graph (me, drive, items, content with a 302, subscriptions with the handshake and notifications), two accounts (personal `msa-camille`, work `aad-camille`) and `/microsoft/control` to put a file, change it, delete it, throttle or refuse a token. |
| `apps/addin/src/microsoft/` | `MicrosoftPort`: `office.ts` (MSAL loaded only on « Connecter », NAA, the picker in a frame over the pane), `stand-in.ts` (harness and E2E), `onMicrosoftCloud` (the Scout's address check). |
| `apps/addin/src/controller.ts` (R4 section), `ui/RegistryView.tsx`, `ui/Dashboard.tsx` | « Fichiers OneDrive » in « Registre » (account, files, sheets, problems, « Déconnecter » confirmed); the confirm screen of a file's sheet; « Contrôles » naming the file; the Scout's suggestion on the Tableau de bord. |

Tables: migration `0014_connectors.sql` (`connections`, `connected_files`, `sources.file_id`).

Tests: `packages/core/src/sheet/file.test.ts`, `apps/api/src/microsoft.test.ts`,
`apps/api/src/connectors.test.ts`, `apps/api/src/runtime.test.ts` › microsoftFromEnv,
mailExchangesFromDns, `apps/addin/src/controller.test.ts` › OneDrive files read without Excel (R4),
`apps/addin/e2e/harness.spec.ts` › OneDrive.

### Decisions taken in R4

| Topic | Decision | Why |
|---|---|---|
| What we may read | `Files.Read` (the person's own files) and the File Picker: only picked files, never a folder or a search; not `Files.Read.All` | Owner's choice from the architecture document: the smallest permission that needs no administrator, and a promise the person can see. |
| Where the token lives | The API exchanges the pane's token on behalf of the person and keeps only the refresh token, sealed with `CONNECTOR_SEALING_KEY`; the pane never holds a Graph token beyond the picker | The background check needs a token while Excel is closed; a key outside the database makes a dump useless. |
| Personal vs work | Personal OneDrive: a subscription tells us within minutes, an hourly check catches a lost notification. Work: polled every 2 minutes | Learn: on OneDrive for Business a subscription needs `Files.Read.All`, which we do not ask. |
| What triggers a read | The cTag (content tag), not the eTag; the same snapshot twice writes nothing (R1) | A rename or a share changes the eTag, not the content. |
| One account per company | A second account waits for « Déconnecter » (`connector_other_account`) | Enough for the pilot; several accounts: `docs/DEFERRED.md`. |
| A file that breaks | Its row says why (missing, forbidden, too large, unreadable); what it gave stays until it reads again or is removed | The person keeps their findings while they fix the file; nothing vanishes silently. |
| Sign-in where NAA is missing | A calm message (`addin.connector.port.unsupported`), no Office dialog fallback | The dialog flow needs its own redirect page and a second token path; NAA covers current Excel. `docs/DEFERRED.md`. |
| The Scout | Two signals (the workbook's address, the mail's MX), shown once on the Tableau de bord, answered once per device | The plan's smallest useful version; formula links and sheet names wait (`docs/DEFERRED.md`). |
| Tariff | Every plan gets the connector for now | Gating it is a money decision for the owner (`docs/DEFERRED.md`). |

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
- **API runtime (M7, done).** One Docker image runs `apps/api` through `tsx` with its workers (`docs/DEPLOY.md`); bundling it is deferred (`docs/DEFERRED.md`).
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
| `sandbox` | B2Brouter sandbox (`test_` key required) | Postgres through `DATABASE_URL`: the compose service (`docs/DEPLOY.md`) or a managed EU Postgres |
| `prod` | B2Brouter production, and its sandbox (`b2brouter_test`) for « Mode test » | Same; nothing is hosted yet |

`FI_ENV` selects the environment; it is validated at startup and reported by `/health`.
