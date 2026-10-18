# Architecture

Status: M1 (2026-10-18). This file records what is built and the decisions taken; the product spec
is the owner's implementation plan (see `CLAUDE.md`). "Plan §N" refers to its sections.

## Shape

```
Excel (desktop / web / Mac)                       apps/api  (Hono, Node 22)
apps/addin — Office.js task pane   ── HTTPS ──►   auth, ingest, validation, agent runs,
React 18 + Vite, thin client                      PdpAdapter, webhooks + status polling
                                                        │
                    Postgres (Supabase EU; local Docker in dev) + pg-boss queue
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

- the branch `archive/rust-mvp-v1` points at `4c6b294` and keeps the whole MVP (Rust crates, Next.js add-in, docs);
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
- **API runtime (M2).** Bundle `apps/api` and `apps/mock-pdp` (esbuild/tsup) and ship one Docker image for the EU VPS.
- **LLM (M3).** Plan §1 names the Anthropic API with `claude-sonnet-4-6` / `claude-haiku-4-5`. Current
  equivalents are `claude-sonnet-5-5` / `claude-haiku-5-5`; model ids will come from env so the choice
  stays a config change.
- **PDP (M2/M4).** Facts about B2Brouter, with sources and dates, live in `docs/B2BROUTER.md`.
  Business code only sees `PdpAdapter`. Two changes to the plan §8 interface follow from those facts
  and land in M2: B2Brouter keeps one account per SIREN, so every call carries the tenant's PDP
  account; and reporting a payment (`paid`, French status 212) needs its own method. B2Brouter has no
  idempotency key, so `sendInvoice` imports first and sends in a second call, and our own
  idempotency key guards both.

## Environments

| Env | PDP | Data |
|---|---|---|
| `local` | `apps/mock-pdp` on :4010 | local Postgres (Docker), from M2 |
| `sandbox` | B2Brouter sandbox | Supabase `fi-sandbox`, from M4 |
| `prod` | B2Brouter production | Supabase `fi-prod` (EU), from M7 |

`FI_ENV` selects the environment; it is validated at startup and reported by `/health`.
