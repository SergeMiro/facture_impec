# Runbook

## Fresh machine

Requirements: Node 22 and Git. pnpm comes through corepack.

```bash
git clone https://github.com/SergeMiro/facture_impec.git facture-impec
cd facture-impec
corepack enable          # provides the pnpm version pinned in package.json
pnpm install
cp .env.example .env     # optional: every variable has a default
pnpm test
pnpm dev
```

`pnpm dev` starts three processes through Turborepo:

| Process | URL | Check |
|---|---|---|
| API | http://localhost:4000 | `curl localhost:4000/health` → `{"ok":true,"service":"api","env":"local"}` |
| Mock PDP | http://localhost:4010 | `curl localhost:4010/health` → `{"ok":true,"service":"mock-pdp"}` |
| Add-in (task pane) | http://localhost:3000 | page titled « Facture Impec » |

Stop with Ctrl+C. Ports come from `.env` (`API_PORT`, `MOCK_PDP_PORT`, `ADDIN_PORT`).

## Daily commands

| Command | What it does |
|---|---|
| `pnpm verify` | `biome ci` + typecheck + tests in every package. Run before each commit; it is the CI gate. |
| `pnpm format` | Format and apply safe lint fixes. |
| `pnpm build` | Production build (today only the add-in has one). |
| `pnpm --filter @fi/api dev` | Run one package. |

## CI

GitHub Actions is disabled on the account since 2026-09-17 (billing). `.github/workflows/ci.yml`
describes the same gate as `pnpm verify`, but nothing runs on GitHub: verify locally.

## Sideloading into Excel

Arrives in M3, with the HTTPS dev server and `scripts/sideload.*`, for Excel on the web, Windows and Mac.

## Legacy MVP

`legacy/rust-mvp/` is the frozen Rust/Next.js MVP (still live at https://facture-impec.vercel.app).
It is not part of the workspace and is removed at the end of M1. Full history: branch `archive/rust-mvp-v1`.
