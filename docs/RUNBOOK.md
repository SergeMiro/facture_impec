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

## Database

Without `DATABASE_URL` the API opens an embedded PGlite database in `.data/pglite` (git-ignored) and
migrates it at startup. To start over: stop the API, `rm -rf .data/pglite`. With
`DATABASE_URL=postgres://…` it uses that Postgres instead (required in sandbox and prod); migrations
run the same way. After changing `packages/db/src/schema.ts`: `pnpm --filter @fi/db generate`, read the
new SQL file in `packages/db/drizzle/`, commit it.

## Using the API by hand (local)

Set in `.env`: `ADMIN_TOKEN` (24+ characters, admin routes answer 503 without it) and
`MOCK_PDP_WEBHOOK_URL=http://localhost:4000/webhooks/pdp/mock` (without it the mock sends no webhooks
and statuses arrive with the sweep, every `PDP_SYNC_INTERVAL_SECONDS`). Then `pnpm dev`, and:

```bash
# A tenant; the key is shown once.
curl -s -X POST localhost:4000/admin/tenants -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' -d '{"name":"Atelier Dupont SARL","siren":"100000009"}'
KEY=fik_…

# Golden invoice 01 dated today, as the scenarios send it.
BODY=$(cd apps/api && npx tsx -e "import {scenarioDraft} from './src/scenarios/invoice.ts'; console.log(JSON.stringify({draft: scenarioDraft(1)}))")
curl -s -X POST localhost:4000/invoices -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d "$BODY"   # 201, status validated
curl -s -X POST localhost:4000/invoices/$ID/send -H "authorization: Bearer $KEY"   # 202
curl -s localhost:4000/invoices/$ID -H "authorization: Bearer $KEY"   # status + timeline
```

The seller SIREN of golden invoice 01 is 100000009, the tenant's: an invoice in another company's
name is refused (`seller_mismatch`). At the default speed the mock reaches « Payée » about 32 s after the deposit. The mock's control endpoints
(`GET/PUT /control`, `POST /control/reset`, `POST /scenarios/:id`) need no header; the platform-side ones (`/invoices`,
`/inbound`, `/directory`, …) take `x-account-id`, which is the tenant's `pdpAccount` (its SIREN unless
set). `docs/ARCHITECTURE.md` lists them all.

## Scenarios

```bash
pnpm scenario              # happy: 10 invoices to « Payée », limit 60 s
pnpm scenario duplicate-send network-flap
pnpm scenario all
```

Each scenario starts its own stack in one process (PGlite in memory, API and mock on free ports,
webhooks between them), so it neither needs nor touches `pnpm dev` or `.env`. Scenarios are JSON in
`fixtures/scenarios/` (number of invoices, platform timeline and faults, repeated creates/sends,
expected status and time limit); the same runs are part of `pnpm verify` (`apps/api/src/scenarios.test.ts`).

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
