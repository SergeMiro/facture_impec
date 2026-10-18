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
| `pnpm verify` | `biome ci` + typecheck + tests in every package + the validation oracle of `@fi/core`. Run before each commit; it is the CI gate. |
| `pnpm --filter @fi/core test` | Core unit tests with coverage (threshold 90 %), offline, a few seconds. |
| `pnpm --filter @fi/core test:oracle` | Generated XML against the official XSD and schematrons (CEN 1.3.17, Factur-X 1.09.2), about 40 s. |
| `pnpm --filter @fi/core oracle:fetch` | Downloads the Factur-X and UBL files we may not commit into `packages/core/.oracle-cache/`, checked by sha256. `test:oracle` runs it itself. |
| `pnpm --filter @fi/core pdf:check [dir]` | Renders the 25 golden invoices as Factur-X and runs veraPDF (Docker `verapdf/cli:v1.30.2`) and the Akretion extractor (`pip install factur-x`; `FACTURX_EXTRACT=/path/to/facturx-pdfextractxml` if it is not on PATH). Manual, before changing the PDF layout. |
| `pnpm format` | Format and apply safe lint fixes. |
| `pnpm build` | Production build (today only the add-in has one). |
| `pnpm --filter @fi/api dev` | Run one package. |

The first `pnpm verify` on a machine needs the network once: the oracle downloads its files and
compiles three stylesheets (about 45 s), then works offline from `.oracle-cache/`.

When the PDF layout, the fonts or pdf-lib change, the hashes in `fixtures/golden/pdf.sha256` change
too: run `pdf:check` on the new files, then `pnpm --filter @fi/core exec vitest run --project unit -u`.

## CI

GitHub Actions is disabled on the account since 2026-09-17 (billing). `.github/workflows/ci.yml`
describes the same gate as `pnpm verify`, but nothing runs on GitHub: verify locally.

## Sideloading into Excel

Arrives in M3, with the HTTPS dev server and `scripts/sideload.*`, for Excel on the web, Windows and Mac.

## Legacy MVP

The Rust/Next.js MVP was removed from `main` at the end of M1; its code and history stay on the branch
`archive/rust-mvp-v1`. Its deployment is still live at https://facture-impec.vercel.app until the
add-in replaces it (M3).
