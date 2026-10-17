# Progress

Each milestone restates its acceptance criteria before work starts and checks them off with evidence.

## M0 — Audit & scaffold (started 2026-10-17)

| Criterion | Status | Evidence |
|---|---|---|
| Clone `SergeMiro/facture_impec` and inventory what exists | ✅ | `docs/INVENTORY_BEFORE.txt` (tree of `main @ 4c6b294`) |
| Decide Rust keep/port (plan §1) | ✅ port to TS | `docs/ARCHITECTURE.md` § "Decision: port the Rust core"; `cargo test --workspace` → 36 passed, `cargo fmt --check` clean |
| Write `docs/ARCHITECTURE.md` | ✅ | this branch |
| Write `docs/B2BROUTER.md` with verified facts | ✅ | 666 lines, every fact with source + date; 18 `TODO(verify)` items in §11, each backed by the mock PDP; 13 discrepancies with the old Rust adapter in §10 |
| Scaffold the monorepo (plan §2) | ✅ | `apps/{addin,api,mock-pdp}`, `packages/{core,agents,pdp-adapter,db,shared}`, Turborepo, Biome, Vitest |
| CI green on an empty test | ✅ locally | `pnpm verify`: biome ci clean, 8/8 typecheck, 8/8 test tasks (6 tests). GitHub Actions is disabled on the account, so CI cannot run there. |
| `pnpm install && pnpm test && pnpm dev` works on a fresh machine following `RUNBOOK.md` | ✅ | 2026-10-17, clean `node:22` container (Node 22.23.3, pnpm 11.8.0 via corepack), no caches: install 59 packages, 8/8 test tasks green, `/health` of api and mock-pdp answer, add-in page served |

## M1 — Core (started 2026-10-17)

Plan §11: « `packages/core`: invoice model, rules (§7), CII + UBL builders, Factur-X PDF embedding,
state machine, money math. Acceptance: 25 golden invoices round-trip; 60+ invalid fixtures each hit
the expected rule id; coverage ≥ 90 % on core. »

How each criterion is read here:

- **Round-trip** = invoice model → XML → model gives back the same invoice, in CII and in UBL, and the
  XML equals the committed expected file. The plan's `fixtures/golden/*.xlsx` input belongs to the
  MappingAgent (M3); in M1 the golden input is the invoice model as JSON (logged in `DEFERRED.md`).
- **Rules** follow `docs/research/FR_RULES.md` (sources checked 2026-10-17). Official ids where they
  exist (BR-xx, BR-CO-xx, BR-FR-xx), `FF-` for our own checks. `docs/RULES.md` is generated from the
  code and a test fails when it is out of date.
- **Fixtures**: every rule has at least one failing case in `fixtures/invalid` and passes on at least
  one golden invoice where it applies (plan §7 "Tests").

| Criterion | Status | Evidence |
|---|---|---|
| Invoice model (EN 16931 semantic model, Zod) | | |
| Money math in integer cents, no floats | | |
| Rules of plan §7: EN 16931 BR / BR-CO / VAT categories / BR-CL, French rules, the 4 reform mentions, sanity | | |
| `docs/RULES.md`: id, severity, message, fix hint, auto-fixable | | |
| CII (Factur-X EN 16931 profile) and UBL 2.1 builders and parsers | | |
| Factur-X PDF embedding | | |
| State machine: exhaustive transition table, tested | | |
| 25 golden invoices round-trip | | |
| 60+ invalid fixtures, each hits its expected rule id | | |
| Every rule has a failing and a passing fixture | | |
| Generated XML passes the official CEN EN 16931 v1.3.16 and FNFE BR-FR v1.4.0.04 schematrons | | |
| Coverage ≥ 90 % on `packages/core` | | |
| Every Rust rule has an equivalent (table below), then `legacy/` is deleted | | |

### Rust rules → TypeScript

Carried over from M0. Renamed ids follow `FR_RULES.md`; the rule behind them is the same or stricter.

| Rust id | TypeScript id | Note |
|---|---|---|
| BR-02 … BR-16 | same | |
| BR-CO-10, 13, 14, 15, 16, 17 | same | |
| BR-S-05, BR-Z-05, BR-E-05, BR-E-10, BR-AE-05, BR-AE-10 | same | |
| BR-DEC (generic) | BR-FR-DEC-01 … 04 | amounts, quantities, unit prices, VAT rates |
| FR-SIREN-LUHN | FF-SIREN-01 | |
| FR-SIRET-LUHN | FF-SIRET-01 | warning, with the La Poste exception (FR_RULES Q5) |
| FR-TVA-KEY | FF-VAT-02 | |
| FR-IBAN | FF-IBAN-01 | |
| FR-MENTIONS-ID (seller SIREN or SIRET) | BR-FR-10 | the seller SIREN is now mandatory on its own |
| FF-CURRENCY-FORMAT | BR-CL-03 | checks the ISO 4217 list, not only the shape |
| FF-DATE-FORMAT | FF-FMT-03 | |
| FF-LINE-CALC | same | |
| AI-DATE-LOGIC (warning) | BR-FR-CO-07 (error) | AFNOR makes due date ≥ issue date blocking |
| AI-CURRENCY | FF-CUR-01 (warning) | |
| AI-VAT-RATE | FF-RATE-02 (warning) | legal but unusual rates; illegal ones are BR-FR-16 |
| AI-ROUND-AMOUNT | dropped | flags every legitimate flat fee of 1 000 €; no rule behind it |
