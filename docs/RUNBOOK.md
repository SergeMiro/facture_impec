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

`pnpm dev` starts four processes through Turborepo:

| Process | URL | Check |
|---|---|---|
| API | http://localhost:4000 | `curl localhost:4000/health` → `{"ok":true,"service":"api","env":"local"}` |
| Mock PDP | http://localhost:4010 | `curl localhost:4010/health` → `{"ok":true,"service":"mock-pdp"}` |
| Add-in (task pane) | https://localhost:3000/taskpane.html | « Ouvrez Facture Impec depuis Excel » outside Excel; the harness at `/harness.html` (§ Add-in) |
| Marketing site | http://localhost:4321 | landing page; `/presentation`, `/api/trial` |

Stop with Ctrl+C. Ports come from `.env` (`API_PORT`, `MOCK_PDP_PORT`, `ADDIN_PORT`, `SITE_PORT`).

## Marketing site

```bash
pnpm --filter @fi/site dev       # http://localhost:4321
pnpm --filter @fi/site build     # static pages + Vercel function in apps/site/.vercel/output
```

Trial requests need a Supabase project: run `apps/site/sql/001_trial_requests.sql` once in its SQL
editor, then set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` (server secret, `sb_secret_…`) in Vercel.
Without them, `pnpm dev` accepts the form and only logs it; production answers 503 with a calm
French message. Optional: `TRIAL_NOTIFY_TELEGRAM_BOT_TOKEN` + `TRIAL_NOTIFY_TELEGRAM_CHAT_ID`.

Read new requests: Supabase table editor → `trial_requests` (newest first); set `status` to
`contacted`, `active` or `declined` as you go.

Deploy: Vercel project `facture-impec-site` (team `sergemiros-projects`, created 2026-10-18, framework
Astro, Node 22), production https://facture-impec-site.vercel.app. It is not linked to git: pushes deploy
nothing, the CLI does. Link the folder once (`apps/site/.vercel` is ignored), then build with Astro, whose
Vercel adapter writes `apps/site/.vercel/output`, and upload that output. Remove the old output first:
`deploy --prebuilt` silently ships whatever it finds. The old project `facture-impec` keeps the
Next.js MVP and is not touched. The CLI reads `VERCEL_TOKEN` from the environment; never pass
`--token` on the command line, the CLI repeats the command, token included, in its output.

```bash
(cd apps/site && npx vercel link --yes --project facture-impec-site --scope sergemiros-projects)  # once
rm -rf apps/site/.vercel/output && pnpm --filter @fi/site build
(cd apps/site && npx vercel deploy --prebuilt --yes)          # preview URL
(cd apps/site && npx vercel deploy --prebuilt --prod --yes)   # production
```

Before production: fill the publisher identity in `apps/site/src/content/site.ts` (`legal`) and set
`PUBLIC_CONTACT_EMAIL`; the legal pages show « à compléter » markers until then.

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

`pnpm scenario --provider b2brouter …` runs the same scenarios through the real B2Brouter adapter,
against the B2Brouter stand-in the mock serves at `/b2brouter` (`apps/api/src/scenarios-b2brouter.test.ts`
keeps six of them in `pnpm verify`, `late-payment` included). The live sandbox has none of the mock's
fault controls, so it gets the contract and the E2E instead (§ B2Brouter sandbox).

## Load test (k6)

```bash
pnpm load                          # 1 000 invoices, 20 virtual users, about 2.5 min
pnpm load --invoices 200 --vus 10  # a quicker run
```

Plan §9 « 1 000 invoices / tenant batch send ». `scripts/load/run.ts` starts a throwaway Postgres in
Docker (`postgres:17.11-alpine`, removed at the end), the API and the mock platform in its own process,
creates one company, and runs `scripts/load/batch-send.js` in Docker (`grafana/k6:2.3.0`, host network):
each iteration creates an invoice and sends it. Then it waits until the API has recorded every invoice
as at the platform and checks that the platform holds each number once. It prints k6's request rate,
p95 per request (create, send) and the end-to-end throughput, then PASS or FAIL. Manual, not part of
`pnpm verify`; the last numbers are in `docs/PROGRESS.md` M5. It needs Docker, nothing else.

## Accountant export check (Paheko)

```bash
pnpm accounting:check                          # the FEC of the 25 golden invoices, about 10 s
pnpm accounting:check path/to/…FEC….txt        # a file downloaded from « Réception »
```

Plan §11 M6 « export opens in a standard accounting tool ». `scripts/accounting/check.ts` builds the FEC
the way `POST /inbound/export` does (or takes the given file), starts Paheko in Docker without network
(`paheko/paheko:1.3.23-8.5.10-apache-trixie`, removed at the end), creates an organisation and imports
the file through Paheko's own FEC import (`scripts/accounting/paheko-import.php`), then compares the books
with the file: entries, debit and credit, each account's balance, no unbalanced entry. It prints ✓ or the
first refusal and exits 1. Manual, not part of `pnpm verify` (Docker, 1.5 GB image). Rules, choices and
the last results: `docs/ACCOUNTING_EXPORT.md`. The E2E run keeps the FEC it downloads next to its
screenshots (`apps/addin/test-results/…/TEST-…FEC….txt`).

## B2Brouter sandbox

Nothing in `pnpm verify` reaches B2Brouter. Locally, the stand-in answers in its place: in `.env`,
`B2BROUTER_API_KEY=test_local_stand_in`, `B2BROUTER_BASE_URL=http://localhost:4010/b2brouter`,
`MOCK_PDP_B2BROUTER_WEBHOOK_URL=http://localhost:4000/webhooks/pdp/b2brouter`, and a
`B2BROUTER_WEBHOOK_SECRET` of your choice; then `pnpm dev`, and Mode test goes through the adapter.

**Owner, once** (`docs/B2BROUTER.md` §1; an agent never creates accounts or keys):

1. Register at https://app.b2brouter.net, set up the company on the free Basic plan.
2. Developers (lightning bolt) → Create Sandbox; copy the `test_…` key.
3. Note the sandbox account id (a number, in the account's URL or `GET /accounts`), and a SIREN the
   sandbox directory knows (`GET /directory/fr/0002/{siren}` answers 200).

**The live runs** (the key goes in the environment or in a chmod 600 file outside the repo, never in
the repo, a URL, a log or a chat):

```bash
read -rs FI_LIVE_B2BROUTER_KEY && export FI_LIVE_B2BROUTER_KEY   # paste the test_… key, Enter
export FI_LIVE_B2BROUTER_ACCOUNT=123456 FI_LIVE_B2BROUTER_SIREN=123456789
# or, once: the three lines `export FI_LIVE_B2BROUTER_…=…` in ~/.config/facture-impec/b2brouter.env
# (chmod 600), then: set -a; . ~/.config/facture-impec/b2brouter.env; set +a
pnpm --filter @fi/pdp-adapter exec vitest run src/b2brouter/sandbox.test.ts   # the contract, ~3 min
pnpm --filter @fi/addin exec playwright test e2e/b2brouter.spec.ts            # Excel → sandbox → sheet
unset FI_LIVE_B2BROUTER_KEY
```

Both refuse a key that is not `test_…`. Each run leaves a few test invoices in the sandbox (numbers
`FI-…` and `TEST-E2E-…`); the sandbox never sends them anywhere. Webhooks cannot reach this server,
so the E2E's API polls the platform every 10 s. What these runs show answers `docs/B2BROUTER.md` §11
T1, T3–T5, T10, T19 and T20: write the answers there, with the date. T21 (a payment posted twice) takes
one more call by hand on an invoice the contract left in the sandbox.

## Daily commands

| Command | What it does |
|---|---|
| `pnpm verify` | `biome ci` + typecheck + tests in every package + the validation oracle of `@fi/core`. Run before each commit; it is the CI gate. |
| `pnpm --filter @fi/core test` | Core unit tests with coverage (threshold 90 %), offline, a few seconds. |
| `pnpm --filter @fi/core test:oracle` | Generated XML against the official XSD and schematrons (CEN 1.3.17, Factur-X 1.09.2), about 40 s. |
| `pnpm --filter @fi/core oracle:fetch` | Downloads the Factur-X and UBL files we may not commit into `packages/core/.oracle-cache/`, checked by sha256. `test:oracle` runs it itself. |
| `pnpm --filter @fi/core pdf:check [dir]` | Renders the 25 golden invoices as Factur-X and runs veraPDF (Docker `verapdf/cli:v1.30.2`) and the Akretion extractor (`pip install factur-x`; `FACTURX_EXTRACT=/path/to/facturx-pdfextractxml` if it is not on PATH). Manual, before changing the PDF layout. |
| `pnpm accounting:check [file]` | Imports the accountant FEC into Paheko (Docker) and checks the books (§ Accountant export check). Manual, before changing the export. |
| `pnpm format` | Format and apply safe lint fixes. |
| `pnpm build` | Production build (add-in and marketing site). |
| `pnpm --filter @fi/api dev` | Run one package. |

The first `pnpm verify` on a machine needs the network once: the oracle downloads its files and
compiles three stylesheets (about 45 s), then works offline from `.oracle-cache/`.

When the PDF layout, the fonts or pdf-lib change, the hashes in `fixtures/golden/pdf.sha256` change
too: run `pdf:check` on the new files, then `pnpm --filter @fi/core exec vitest run --project unit -u`.

## Branches and promotion

Three long-lived branches, nothing else lives on GitHub (the old MVP is the tag `archive/rust-mvp-v1`):

| Branch | Role |
|---|---|
| `dev` | Default branch. All work lands here: commits directly, or short-lived branches merged in. |
| `preprod` | What is about to ship. Only ever updated by merging `dev`. |
| `prod` | What is shipped. Only ever updated by merging `preprod`. |

```bash
pnpm verify                                    # on dev: green, or stop
git switch preprod && git pull --ff-only
git merge --ff-only dev && pnpm verify         # still green on this exact commit
git push origin preprod
git switch prod && git pull --ff-only
git merge --ff-only preprod && git push origin prod
git switch dev
```

Promotions are fast-forward only, so the three branches point at the same commits and « what is in
prod » is always a commit of `dev`. A fast-forward that fails means someone committed on `preprod` or
`prod` directly: stop and bring that commit back through `dev`. No branch deploys anything by itself
today (the Vercel project is not linked to git); when the sandbox (M4) and production (M7) deployments
exist, `preprod` deploys to sandbox and `prod` to production.

## CI

GitHub Actions is disabled on the account since 2026-09-17 (billing). `.github/workflows/ci.yml`
describes the same gate as `pnpm verify`, but nothing runs on GitHub: verify locally.

## Add-in

The task pane (`apps/addin`) is a Vite page. Office only loads add-ins over HTTPS, so `pnpm dev` and
`pnpm dev:addin` serve it on **https://localhost:3000** with a localhost certificate kept in
`~/.office-addin-dev-certs` (created, and renewed when it has less than a day left, by `vite.config.ts`).
The CA is not installed (that needs sudo): the first time, open https://localhost:3000/taskpane.html in
the browser that runs Excel and accept the certificate; or run `npx office-addin-dev-certs install`
once on your own machine to trust it for good. The pane calls the API through the dev server's `/api`
proxy, so there is no CORS to set up.

### Without Excel: the harness page

https://localhost:3000/harness.html is a dev-only page (never built): a sheet in the browser with
three demo invoices, the ribbon's four buttons, and the real task pane next to it, talking to the real
API. It is what the E2E drives, and the quickest way to try a change.

```bash
echo "ADMIN_TOKEN=$(openssl rand -hex 16)" >> .env    # once
pnpm dev
pnpm seed:demo [email]       # the demo company; prints its access key
```

Sign in with the key, or with the e-mail: in local the sign-in mail is not sent but printed in the
API's log (and kept at `GET /admin/outbox`). Open its link and click « Me connecter ».

### Sideloading into Excel

`apps/addin/manifest.xml` is the development manifest (every URL on https://localhost:3000,
validated in `docs/OFFICE.md` §2). `pnpm dev` must be running on the same machine as Excel.

| Excel | How | Remove |
|---|---|---|
| On the web | `scripts/sideload.sh web` prints the steps: Home > Add-ins > More Settings > Upload My Add-in > the manifest. The manifest lives in that browser's storage. | Clear the browser's cache. |
| Windows | `scripts\sideload.ps1` (registers the manifest with `office-addin-debugging` and opens Excel). Without the tool: a shared-folder catalog (`docs/OFFICE.md` §6). | `scripts\sideload.ps1 -Stop`, always. |
| Mac | `scripts/sideload.sh mac` copies the manifest into `~/Library/Containers/com.microsoft.Excel/Data/Documents/wef`; restart Excel. | `scripts/sideload.sh remove`. |

The ribbon group « Facture Impec » appears on the Home tab: Ouvrir, Vérifier, Envoyer (opens the
confirmation, never sends by itself), Mode test. The Windows and Mac scripts follow Microsoft's guides
but have not been run on those systems yet. `pnpm addin:icons` redraws the four icons.

### E2E

```bash
pnpm test:e2e
```

Playwright starts its own mock PDP (:4110), API (:4100, throwaway PGlite database, no AI) and dev
server (:3100), so it runs next to `pnpm dev`, and drives the harness page in the machine's Chrome
(`/usr/bin/google-chrome`; on this VPS that is the right browser: Browserbase cannot reach localhost).
`e2e/harness.spec.ts` is the M3 acceptance path: sign in by link, confirm the columns, fix the two
errors from « Corriger dans la feuille », rehearse, « Prêt à envoyer », Mode test, send a test invoice,
« Simuler un rejet PDP », then M6's Réception: three test supplier invoices (normal, duplicate, new
IBAN), approval, dispute, export and the FEC downloaded. `e2e/b2brouter.spec.ts` is M4's: a test invoice goes through the B2Brouter
adapter to the stand-in, the fiche is closed, and FI_Statut turns « Test · Acceptée par le client » by
itself (about 30 s, the pane's first status check). The stack has a `test_` key, so B2Brouter's
stand-in is the test platform for both. About a minute in all. It is not part of `pnpm verify` (it
needs Chrome and free ports). With `FI_LIVE_B2BROUTER_*` set, run `e2e/b2brouter.spec.ts` alone: it
goes to the real sandbox and the M3 spec skips itself (§ B2Brouter sandbox).

`e2e/excel-web.spec.ts` runs the pane inside Excel on the web and is skipped unless both are set:

- `FI_E2E_EXCEL_URL`: a workbook in OneDrive opened in Excel on the web;
- `FI_E2E_STORAGE`: a Playwright storage state signed in to that Microsoft account, recorded once with
  `pnpm --filter @fi/addin exec playwright codegen --save-storage=e2e/.auth/microsoft.json https://www.office.com`
  (the `.auth` folder is git-ignored; never commit it).

## Legacy MVP

The Rust/Next.js MVP was removed at the end of M1; its code and history stay on the tag
`archive/rust-mvp-v1`. Its deployment is still live at https://facture-impec.vercel.app until the
add-in replaces it (M3).
