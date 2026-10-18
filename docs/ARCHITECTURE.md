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
| `local` | `apps/mock-pdp` on :4010 | PGlite in `.data/pglite`, or any Postgres through `DATABASE_URL` |
| `sandbox` | B2Brouter sandbox | Supabase `fi-sandbox`, from M4 |
| `prod` | B2Brouter production | Supabase `fi-prod` (EU), from M7 |

`FI_ENV` selects the environment; it is validated at startup and reported by `/health`.
