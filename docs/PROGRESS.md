# Progress

Each milestone restates its acceptance criteria before work starts and checks them off with evidence.

## M0 — Audit & scaffold (started 2026-10-17)

| Criterion | Status | Evidence |
|---|---|---|
| Clone `SergeMiro/facture_impec` and inventory what exists | ✅ | `docs/INVENTORY_BEFORE.txt` (tree of `main @ 4c6b294`) |
| Decide Rust keep/port (plan §1) | ✅ port to TS | `docs/ARCHITECTURE.md` § "Decision: port the Rust core"; `cargo test --workspace` → 36 passed, `cargo fmt --check` clean |
| Write `docs/ARCHITECTURE.md` | ✅ | this branch |
| Write `docs/B2BROUTER.md` with verified facts | ⏳ | |
| Scaffold the monorepo (plan §2) | ✅ | `apps/{addin,api,mock-pdp}`, `packages/{core,agents,pdp-adapter,db,shared}`, Turborepo, Biome, Vitest |
| CI green on an empty test | ✅ locally | `pnpm verify`: biome ci clean, 8/8 typecheck, 8/8 test tasks (6 tests). GitHub Actions is disabled on the account, so CI cannot run there. |
| `pnpm install && pnpm test && pnpm dev` works on a fresh machine following `RUNBOOK.md` | ✅ | 2026-10-17, clean `node:22` container (Node 22.23.3, pnpm 11.8.0 via corepack), no caches: install 59 packages, 8/8 test tasks green, `/health` of api and mock-pdp answer, add-in page served |

## M1 — carry-over from M0

Every rule id of the Rust core must exist in `packages/core` with a passing and a failing fixture
before `legacy/` is deleted:

- EN 16931 presence: BR-02 BR-03 BR-04 BR-05 BR-06 BR-07 BR-08 BR-09 BR-10 BR-11 BR-12 BR-13 BR-14 BR-15 BR-16
- EN 16931 calculation: BR-CO-10 BR-CO-13 BR-CO-14 BR-CO-15 BR-CO-16 BR-CO-17
- VAT categories: BR-S-05 BR-Z-05 BR-E-05 BR-E-10 BR-AE-05 BR-AE-10
- Decimals: BR-DEC (generic in Rust; split into the exact BR-DEC-* ids per BT)
- French formats: FR-SIREN-LUHN FR-SIRET-LUHN FR-TVA-KEY FR-IBAN FR-MENTIONS-ID
- Own checks: FF-CURRENCY-FORMAT FF-DATE-FORMAT FF-LINE-CALC
- Soft heuristics (warnings): AI-DATE-LOGIC AI-CURRENCY AI-VAT-RATE AI-ROUND-AMOUNT — keep the
  deterministic ones as `warning` rules under plan §7 "Sanity", renamed to `FF-` ids
