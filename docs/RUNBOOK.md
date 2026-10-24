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

Trial requests go to the Supabase project `facture-impec` (`adphrypzszrohihaetnu`, Paris, org « SergeMiro
Projects », free plan, created 2026-10-19). `apps/site/sql/001_trial_requests.sql` then `002_submit_trial_request.sql`
are applied there: the table has RLS and no grant, and the site writes only through the function
`submit_trial_request`, so the key it holds is the project's **publishable** key (`sb_publishable_…`), which
can do nothing else. Vercel has `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in production; a secret key is
never needed by the site. Supabase's advisor flags the function as « SECURITY DEFINER executable by
anon »: that is the intended door.
Without them, `pnpm dev` accepts the form and only logs it; production answers 503 with a calm
French message. Optional: `TRIAL_NOTIFY_TELEGRAM_BOT_TOKEN` + `TRIAL_NOTIFY_TELEGRAM_CHAT_ID`.

Read new requests: Supabase table editor → `trial_requests` (newest first); set `status` to
`contacted`, `active` or `declined` as you go.

Keep-alive: a free project is paused after ~7 days without database activity, and trial requests are
too rare to count on. `apps/site/sql/003_keepalive.sql` (applied 2026-10-19) adds a one-row `heartbeat`
table and `keepalive()`, callable only with the project's **secret** key. On the VPS, cron
`47 5 * * *` (UTC) runs `~/.local/bin/fi-supabase-keepalive`, which calls `POST /rest/v1/rpc/keepalive`
(3 attempts), logs `OK 200 seen_at=…` to `~/.local/log/fi-supabase-keepalive.log` and, on failure, sends a
Telegram alert. Its settings (project ref, secret key, alert bot) are in
`~/.config/facture-impec/supabase-keepalive.env` (chmod 600); after rotating the secret key, replace the
line there. Proof it runs: `select seen_at, hits from public.heartbeat`. If the project is paused anyway,
restore it from the Supabase dashboard; data is kept.

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

## Performance (`pnpm perf`)

```bash
pnpm perf                                  # 1 000 documents at 4 a second, about 5 min
pnpm perf --documents 200 --rate 8         # a quicker run
pnpm perf --database-url postgres://fi:fi@127.0.0.1:5432/perf   # a throwaway database: it is written to
```

BTP plan §11's latency budgets, each path's p50, p95 and max, PASS or FAIL, and the exit code says it
(`apps/api/src/scenarios/perf.ts`). The API runs in the command's process as in production, but for
the model (off) and the database (PGlite in memory unless `--database-url`): its workers look for
jobs every 2 s (and at once after a job, or when the process sends one), the sweep runs every 5
minutes. What it does:

- the rules check 1 000 invoices one by one (the goldens; budget 20 ms each);
- a company of 1 000 deadlines (each from its attestation, a tenth due within 30 days) is watched
  once (60 s);
- 1 000 documents of the golden set (`apps/api/scripts/golden`), each made unique, arrive through
  `POST /ingest` at a steady pace, to companies of 100: 45 % e-invoices, 50 % text PDFs, 5 % scans.
  Each is timed from its arrival to its read (5 s, 30 s by OCR) and to done or review (8 s with its
  XML, 25 s without), on the database's clock (`documents.created_at`, the audit events);
- meanwhile the deadline company lists its requests and deadlines (`GET /actions`,
  `GET /obligations`, 0.2 s) and approves 20 requests, each timed until it is sent (2 s).

A document that never settles or a request never sent fails the run. It needs poppler-utils and
tesseract (the golden scans), as `pnpm test` does. Run it on an idle machine: weekly and before a
release (§11); the last numbers are in `docs/PROGRESS.md` › stage 7B. Not part of `pnpm verify`; a
run of 20 is (`scripts/perf/perf.test.ts`), for the script, not the budgets.

A FAIL on the documents' paths with `POST /ingest` still fast is a queue that does not keep up: the
dashboard's « Jobs waiting » climbs while « Job p95 by queue » stays low. Check that the workers
still fetch again after a job (`apps/api/src/wakeups.test.ts`) before suspecting the readers.

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
| `pnpm build` | Production build (Excel/Google Sheets add-in and marketing site). |
| `pnpm sheets:package --addin <https-url>/google-sheets.html` | Generate the bound Apps Script package (`GOOGLE_SHEETS.md`). |
| `pnpm --filter @fi/api dev` | Run one package. |

On a loaded VPS, use `pnpm verify --concurrency=1` to run test packages sequentially.
This runs the same checks without increasing test timeouts.

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
| On the web | `scripts/sideload.sh web` prints the steps: Home > Add-ins > More Settings > Upload My Add-in > the manifest. The manifest lives in that browser's storage. Chrome asks whether the workbook's page may reach the local network (the pane on localhost): allow it, or the pane stays blank. | Clear the browser's cache. |
| Windows | `scripts\sideload.ps1` (registers the manifest with `office-addin-debugging` and opens Excel). Without the tool: a shared-folder catalog (`docs/OFFICE.md` §6). | `scripts\sideload.ps1 -Stop`, always. |
| Mac | `scripts/sideload.sh mac` copies the manifest into `~/Library/Containers/com.microsoft.Excel/Data/Documents/wef`; restart Excel. | `scripts/sideload.sh remove`. |

The ribbon group « Facture Impec » appears on the Home tab: Ouvrir, Vérifier, Envoyer (opens the
confirmation, never sends by itself), Mode test. The Windows and Mac scripts follow Microsoft's guides
but have not been run on those systems yet. `pnpm addin:icons` redraws the four icons
(`apps/addin/scripts/icons.ts`; the store logo is drawn by `pnpm appsource:package`).

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
IBAN), approval, dispute, export and the FEC downloaded; its later steps go on to the controls,
the corrections, the connectors, VIES and the BTP documents (an attestation, its company added from
« À valider », the request edited and validated in Mode test). VIES and the company directory are the
mock's stand-ins (`/vies`, `/sirene`), never the real services. `e2e/b2brouter.spec.ts` is M4's: a test invoice goes through the B2Brouter
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

### OneDrive connector (R4)

Local, against the stand-in (`apps/mock-pdp`, `/microsoft`): in `.env` set the stand-in values of
`.env.example` (`MICROSOFT_CLIENT_ID=00000000-0000-4000-8000-00000000f1f1`,
`MICROSOFT_CLIENT_SECRET=local-microsoft-client-secret`, the two `http://localhost:4010/microsoft…`
URLs, `CONNECTOR_SEALING_KEY=$(openssl rand -base64 32)`), then `pnpm dev` and the harness page. In
« Registre », « Connecter OneDrive » signs in Camille's personal account (`?microsoft=work`: her work
one) and « Choisir des fichiers » picks every file of that OneDrive. Put or change a file:

```bash
curl -X PUT --data-binary @Commandes.xlsx \
  "http://localhost:4010/microsoft/control/files/msa-camille/cmd-1?name=Commandes%202026.xlsx"
```

`?document=https://d.docs.live.net/x/Factures.xlsx` on the harness page plays a workbook opened from
OneDrive (the Scout's suggestion on the Tableau de bord). The E2E's last step does all of it.

Real accounts need the owner's app registration in Microsoft Entra (`docs/MICROSOFT365.md`; nothing
of it is in the repo):

1. Entra admin center → App registrations → New registration: « Facture Impec », supported accounts
   « Accounts in any organizational directory and personal Microsoft accounts ».
2. Authentication → Single-page application, redirect URIs `brk-multihub://<add-in domain>` (the domain
   the pane is served from, e.g. `addin.facture-impec.fr`), for nested app authentication in Excel for
   Windows and Mac, and `https://<add-in domain>/auth.html`, for Excel on the web (its browser flow:
   `docs/MICROSOFT365.md`). For `pnpm dev`: `brk-multihub://localhost:3000` and
   `https://localhost:3000/auth.html`. A new URI took Microsoft a few minutes to accept.
3. Expose an API: Application ID URI `api://<client id>`, scope `access_as_user` (admins and users).
4. API permissions → Microsoft Graph, delegated: `Files.Read`, `User.Read`, `offline_access`; and
   « My APIs » → this app → `access_as_user` (the pane asks `.default`, which needs it listed:
   `docs/MICROSOFT365.md`). No administrator consent is needed. A change applied after a few minutes.
5. Certificates & secrets → a client secret; put it with the client id in the API's environment
   (`MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`), with a new `CONNECTOR_SEALING_KEY`; leave the two
   URLs empty. `API_PUBLIC_URL` in https lets a personal OneDrive notify `/webhooks/microsoft`;
   otherwise its files are polled like a work one.
6. Run the TODO(verify) list of `docs/MICROSOFT365.md` on a personal and a work account, and note the
   results there. A personal OneDrive's notifications need the API on a public https address: for a
   try, a temporary tunnel to `:4000` as `API_PUBLIC_URL`.
7. Branding & properties: the CGU and privacy URLs, once published (Microsoft shows them on the consent
   screen).

Changing `CONNECTOR_SEALING_KEY` makes every stored token unreadable: the connections then ask to
« Reconnecter ». Rotating the client secret needs nothing else.

### Google Drive connector (R5)

Local, against the stand-in (`apps/mock-pdp`, `/google`): in `.env` set
`GOOGLE_CLIENT_ID=local-google-client.apps.googleusercontent.com`,
`GOOGLE_CLIENT_SECRET=local-google-client-secret`, the three `http://localhost:4010/google/…` URLs of
`.env.example` and a `CONNECTOR_SEALING_KEY`, then `pnpm dev` and the harness page. In « Registre »,
« Connecter Google Drive » shows « Ouvrir la fenêtre Google » (the harness has no Office window); the
stand-in's page there lets you pick Camille's files by hand. Put or change a file (`sheet=1` stores it
as a Google Sheets spreadsheet), or answer the next window without the page:

```bash
curl -X PUT --data-binary @Commandes.xlsx \
  "http://localhost:4010/google/control/files/g-camille/cmd-1?sheet=1&name=Commandes%202026"
curl -X POST -H 'content-type: application/json' -d '{"account":"g-camille","pick":["cmd-1"]}' \
  http://localhost:4010/google/control/choose
```

The E2E's last step does all of it. Real accounts need the owner's Google Cloud project
(`docs/GOOGLE.md` §7; nothing of it is in the repo):

1. Google Cloud console → a project « Facture Impec » → APIs & Services → enable « Google Drive API ».
2. OAuth consent screen: External; app name, support e-mail, the CGU and privacy URLs; scope
   `https://www.googleapis.com/auth/drive.file` only. Publish it (« In production »): in Testing,
   Google expires refresh tokens after 7 days and only listed test users can sign in.
3. Credentials → Create OAuth client ID → Web application; authorized redirect URI
   `<API_PUBLIC_URL>/connectors/google/callback` (https outside local).
4. Into the API's environment, never the repo: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, with the
   `CONNECTOR_SEALING_KEY` OneDrive uses; leave the three URLs empty. On this VPS the values live in
   `~/.config/facture-impec/google.env` (chmod 600).
5. Run the TODO(verify) list of `docs/GOOGLE.md` §6 on a Gmail account and a Workspace one and note
   the results there. Notifications need the API on a public https address (a temporary tunnel to
   `:4000` as `API_PUBLIC_URL` for a try); without it the files are polled every 2 minutes.

« Déconnecter Google Drive » and deleting the account revoke the token at Google. Changing
`CONNECTOR_SEALING_KEY` asks every Google connection to « Reconnecter », as for OneDrive.

### Files uploaded from the pane (R6)

Nothing to configure: « Registre » → « Fichiers importés » → « Importer un fichier » takes an .xlsx,
.xlsm or .csv workbook, a Factur-X PDF, or a UBL or CII invoice (.xml), 10 MB at most. The same call
with curl (an API key of the company; the name in the query, the bytes as the body):

```bash
curl -X POST -H "authorization: Bearer $FI_KEY" --data-binary @FA-2026-311.pdf \
  "http://localhost:4000/uploads?name=FA-2026-311.pdf"
curl -H "authorization: Bearer $FI_KEY" http://localhost:4000/uploads
```

Workbooks are limited to 5,000 nonempty rows per sheet, including the header. This limit also applies
to OneDrive and Google Drive files. Files above this limit are refused before any documents change.
A refused replacement preserves the previous upload. A connected file shows the problem and keeps
its previous documents. If a sheet exceeds the limit, split its rows across sheets and include each
new sheet. The next connector check reads the file again.

A supplier invoice counts in B2 once the registry job ran (the worker, a few seconds; `checkNow` in
tests). A plain PDF is refused until the owner decides (`docs/TODO.md`). The files live in the
`uploads` table; a workbook's bytes are there in base64, so the table grows with them.

### Documents for the BTP back end (stage 1B)

The worker reads PDFs with poppler (`pdfinfo`, `pdftotext`, `pdftoppm`) and scans with tesseract in
French. On a developer machine:

```bash
sudo apt-get install -y poppler-utils tesseract-ocr tesseract-ocr-fra
tesseract --list-langs        # must list fra
```

The API image installs them (`apps/api/Dockerfile`); check an image with
`docker run --rm --entrypoint tesseract <image> --list-langs`. Without them, a document stays
`ingested`: the job is retried, then the sweep tries again every few minutes, and nothing is lost.

One file by hand (an API key of the company; the bytes as the body, the name in the query):

```bash
curl -X POST -H "authorization: Bearer $FI_KEY" --data-binary @attestation.pdf \
  "http://localhost:4000/ingest?name=attestation.pdf"          # 201 with the document, 200 if known
curl -H "authorization: Bearer $FI_KEY" http://localhost:4000/documents/<id>
```

An e-mail saved as `.eml` (Outlook: « Enregistrer sous »; Gmail: « Télécharger le message »): each
attachment becomes a document, the answer lists the parts left aside and why.

```bash
curl -X POST -H "authorization: Bearer $FI_KEY" --data-binary @facture-dupont.eml \
  "http://localhost:4000/ingest/mail"
```

`?test=true` keeps it in Mode test. 20 MB at most (35 MB for an e-mail); 429 with `Retry-After: 60` while 200 documents
of the company wait to be read. The 50 golden documents and the p95: `apps/api/src/ingest.test.ts`
(`apps/api/scripts/golden/documents.ts` makes them).

### What each document is (stage 2A)

A read text document goes to the queue `document.classify`; `GET /documents/<id>` then shows its
`kind`, its `stage` (`done`, or `needs_review` with `reviewReason`) and what was read. The model is
asked only when the patterns cannot say; with `AI_PROVIDER` empty the patterns alone answer and the
rest waits in review. A document in review, answered by hand (the kind, and the date or the SIREN
asked for):

```bash
curl -X POST -H "authorization: Bearer $FI_KEY" -H 'content-type: application/json' \
  -d '{"kind":"attestation_vigilance","issuedOn":"2026-10-01","siren":"552100554"}' \
  http://localhost:4000/documents/<id>/review     # 200; 422 names the field still missing
```

Deadlines are rows of `obligations`, one per `key`; `select kind, key, due_on, status from
obligations where tenant_id = '<id>' order by due_on` shows a company's. What the pane shows (2B):

```bash
curl -H "authorization: Bearer $FI_KEY" "http://localhost:4000/documents?stage=needs_review"
curl -H "authorization: Bearer $FI_KEY" "http://localhost:4000/obligations?horizon=365"
```

In the pane: the tab « Documents ». `?test=true` on both for Mode test, as the pane does. Recording the classifier's
eval through llmfp: `docs/AI_PROVIDERS.md` (`pnpm --filter @fi/agents eval:record classify`).

### Requests a person approves (stage 3A)

The watchers run on the chasing timer (every 5 minutes) and draft one request per open deadline in its
horizon (`docs/ARCHITECTURE.md` › stage 3A). What waits, and a decision by hand:

```bash
curl -H "authorization: Bearer $FI_KEY" "http://localhost:4000/actions"            # drafts
curl -H "authorization: Bearer $FI_KEY" "http://localhost:4000/actions?status=sent"
curl -X POST -H "authorization: Bearer $FI_KEY" -H 'content-type: application/json' \
  -d '{"revision":0,"decision":"approve"}' http://localhost:4000/actions/<id>/decide
curl -X POST -H "authorization: Bearer $FI_KEY" -H 'content-type: application/json' \
  -d '{"status":"done"}' http://localhost:4000/obligations/<id>/close
```

A 409 `action_revision_changed` means the list is older than the action: read it again. A request
stuck `approved`: `select status, error, payload_json->>'sendingAt', payload_json->>'tries' from actions
where id = '<id>'`; a claim older than 10 minutes becomes a draft « send_unknown » at the next run,
for a person to decide again (the e-mail may or may not have left). `failed` with `mail_failed`: SMTP
refused it three times (`docs/DEPLOY.md` › mail); with `no_longer_needed`: its deadline closed or moved.

The weekly e-mail (stage 3C) lists the drafts with « Envoyer » and « Ignorer » links to
`API_PUBLIC_URL/decide?token=…`: that variable must be the address people reach the API at, or the
links lead nowhere (without it in the workers, the e-mail lists nothing). A person says a link « n'est
plus valable »: `select decision, revision, used_at, expires_at from action_links where action_id =
'<id>'`: used, older than 7 days, or the request changed since (its `revision` above the link's). The
decision itself is in `audit_events` (`action.decide`, actor `user:<id>`), the channel on the action.

An ERP list (stage 4A) given from the pane and not imported: `select connector, last_error,
cursor_json, result_json->>'finishedAt', result_json->'skipped' from connector_syncs where tenant_id =
'<id>'`. `erp_interrupted`: a batch failed, the queue tries again three times a minute apart from the
cursor; after that, the same file given again goes on from it. `export_missing`: the bytes are gone,
the same file again goes on. A column not recognised: the person sees which one is needed; the
labels known are in `packages/connectors/src/export/columns.ts`.

An ERP invoice that made no deadline (stage 4B): its reason is in `result_json->'skipped'`.
`paid`: nothing left to pay. `sent_here`: the invoice went through Facture Impec, its deadline is
the platform's. `credit_note`, `not_invoice`: an avoir, a devis. `no_number`, `no_due_date`: the
ERP's row lacks it. A payment not applied: `partial_payment` (less than what is left; nothing is
summed, the next export's « Reste à payer » closes it), `invoice_unknown` (no deadline of that
number). A deadline whose date or amount does not follow the ERP: a better source has it, `select
o.due_on, o.amount, d.source from obligations o join documents d on d.id =
o.source_document_id where o.key like '%facture_echeance:%:<number>'`; a PDP's values are never
moved by the ERP. An ERP invoice that is never reminded: it has no customer (`withoutCustomer` in
the import's result), the reminder has no one to go to.

## Deployment

The API image, the compose file and the settings of a hosted sandbox or prod: `docs/DEPLOY.md`. The
store package for Excel: `pnpm appsource:package` (`docs/APPSOURCE.md` §6).

## Pilot

Plan §11 M7: « 3 pilot tenants on sandbox, zero P1 bugs for 5 days, then switch one to prod ». It runs on
the **prod** deployment (`docs/DEPLOY.md` §1): each company signs up and works in « Mode test », which
goes to B2Brouter's sandbox; nothing real leaves until the operator switches that company live. The
rehearsal of the whole path is `apps/api/src/pilot.test.ts` (in `pnpm verify`).

### Before day 1

- [ ] The prod stack runs, `/health` answers on `https://api.<domain>`, the pane is served and the manifest
      built from its URL is in the pilots' Excel (sideloaded, centralized deployment or store).
- [ ] `B2BROUTER_SANDBOX_API_KEY` is set (without it there is no Mode test in prod), the mail provider
      sends, `TERMS_URL` points at the published CGU.
- [ ] Three pilot companies agreed to it, knowing it is a pilot: their invoices stay test invoices until
      they say « go » for real.

### Each company

```bash
API=https://api.<domain>; AUTH="authorization: Bearer $ADMIN_TOKEN"
# 1. They click « Créer un compte » in Excel (SIREN, e-mail, terms, the link). Find the company:
curl -s -H "$AUTH" "$API/admin/tenants?siren=<SIREN>"
# 2. Pilot status: never billed, whatever Stripe says.
curl -s -X PUT -H "$AUTH" -H 'content-type: application/json' \
  -d '{"status":"pilot"}' "$API/admin/tenants/<id>/billing"
# 3. If B2Brouter's account id is not the SIREN (docs/B2BROUTER.md T22):
curl -s -X PUT -H "$AUTH" -H 'content-type: application/json' \
  -d '{"account":"<B2Brouter account id>"}' "$API/admin/tenants/<id>/platform"
```

An accounting firm's brand, if a pilot comes through one:
`PUT /admin/tenants/<id>/white-label {"whiteLabel":{"firmName":"…","accentColor":"#0f6cbd","full":false}}`
(`full: true` also removes the Facture Impec mention and signs the weekly report with the firm's name).

### P1, P2

A **P1** is any of: an invoice sent twice, or to the wrong customer or platform; a real invoice leaving
without the user's « Envoyer » (or the autopilot the user switched on for that customer, under the
ceiling) or while the company is not live; an amount, VAT or date in the XML that
differs from the sheet; an invoice lost or stuck (no platform answer, no error shown) for more than a
business day; personal data of one company visible to another; the pane unusable for a pilot (cannot
sign in, cannot send a test invoice) for more than an hour. A P1 resets the 5-day clock once fixed.

A **P2** is anything else wrong that has a way around: a confusing message, a column badly guessed, a
chase planned on the wrong day. Logged, fixed, does not reset the clock.

### Every morning

First the alerts mailbox and the Grafana dashboard (`docs/DEPLOY.md` § 7, § Observability below):
an alert of the night is either explained or a P1/P2. Then:

```bash
curl -s -H "$AUTH" "$API/admin/tenants"                 # status, plan, live or not
# The API's errors of the day, one JSON line each (tenantId, route or queue, jobId, the stack). A job
# is an error only once its retries are spent; a failed attempt it retried is a warning.
docker compose -f deploy/compose.yaml logs --since 24h --no-log-prefix api | grep '"level":"error"' | tail -50
docker compose -f deploy/compose.yaml exec -T postgres psql -U fi -d fi <<'SQL'
-- Sends that did not reach the platform after an hour.
select t.siren, i.number, i.is_test, s.status, s.attempts, s.last_error, s.updated_at
from pdp_submissions s join invoices i on i.id = s.invoice_id join tenants t on t.id = s.tenant_id
where s.status = 'pending' and s.updated_at < now() - interval '1 hour';
-- Invoices refused by the platform or still « sending » in the last day.
select t.siren, i.number, i.is_test, i.status, i.pdp_status_raw, i.updated_at
from invoices i join tenants t on t.id = i.tenant_id
where i.status in ('rejected_by_pdp', 'sending') and i.updated_at > now() - interval '1 day';
-- Jobs pg-boss gave up on.
select name, count(*) from pgboss.job where state = 'failed' and completed_on > now() - interval '1 day'
group by name;
SQL
```

Each line is either explained (a real customer error the pane explained) or a bug: P1 or P2. Write the
day in `docs/PROGRESS.md` M7 (date, invoices sent per company, P1/P2 found, fixed in which commit).

### Switching one live (day 6 at the earliest)

After five consecutive days without P1, with the company's agreement and its B2Brouter production
account set up (the owner's step: account, DGFiP setting, plan):

```bash
curl -s -X PUT -H "$AUTH" -H 'content-type: application/json' \
  -d '{"live":true,"confirmSiren":"<SIREN>"}' "$API/admin/tenants/<id>/live"
```

The call checks that B2Brouter answers for that account (`platform_account_missing` with B2Brouter's
reason otherwise, nothing changed) and records `tenant.live` in the audit log. From then on the pane no
longer says « Votre compte est en cours d'activation… », « Mode test » off sends for real, and the inbox is read.
Watch its first real invoice to « Déposée » and beyond the same day. `{"live":false,…}` closes real
sends again (audit `tenant.offline`); invoices already sent keep being followed.

### The ten-year archive (M8)

Every real invoice sent or received is in `invoice_archive` (`docs/ARCHITECTURE.md` M8). Check one
company's archive, a deleted one included, after a restore or once a month:

```bash
curl -s -H "$AUTH" "$API/admin/tenants/<id>/archive"
# {"rows":12,"ok":true,"broken":null,"lastChain":"…"}
```

`ok: false` names the first row whose XML, PDF or chain no longer matches (`broken.id`, `problem`): treat
it as a P1, restore that company's rows from the last backup that checks out, and find out who could
write to the database. Keep each month's `lastChain` somewhere outside the server (a note, a mail):
it is what shows that the newest rows were not removed (`docs/DEFERRED.md`). Real invoices that left
before M8 are archived by the sweep as it catches up, 100 per pass. Supplier invoices are archived
only as they are stored, so one received for real before M8 is not; no company was live before M8.

### A company's own B2Brouter key (M8)

Offered in Réglages only when `PDP_KEY_SEALING_KEY` is set (`docs/DEPLOY.md` §2). The owner of the
company pastes the key (and B2Brouter's account id if it is not the SIREN); the API tries it before
saving (`docs/B2BROUTER.md` §12). What the operator sees: audit `settings.pdp_key` / `settings.pdp_key_remove`
with the key's last four characters and the account. If a company's real sends stop with
`pdp_not_configured` (« La connexion à votre plateforme… n'est pas encore configurée ») after a change
of `PDP_KEY_SEALING_KEY`, the owner pastes the key again;
« Revenir à notre connexion » is refused once the company is live (it can only replace the key).

## Observability

Prometheus, Alertmanager and Grafana run with `docker compose --profile observability` (`docs/DEPLOY.md`
§ 7); the alerts are mailed to the operator. Each alert below says what it means and what to do. The
API's log lines are JSON on stderr; the ones of one company, one job or one request:

```bash
LOGS="docker compose -f deploy/compose.yaml logs --since 2h --no-log-prefix api"
$LOGS | grep '"tenantId":"<tenant id>"'
$LOGS | grep '"jobId":"<job id>"'        # a job's lines: each attempt (warn), the last one's failure (error)
$LOGS | grep '"requestId":"<id>"'        # the x-request-id header of an answer
```

**ApiDown** — Prometheus has not reached `/metrics` for 5 minutes. `docker compose ps`, then
`docker compose logs --since 30m api`: a failed migration or a missing setting stops the API at start and
says why. `curl -s localhost:4000/health`. If only Prometheus is refused (401), `METRICS_TOKEN` differs
between the API and the secret: both come from `deploy/.env`, restart both. Nothing is lost while the
API is down: jobs wait in Postgres, the platforms send their webhooks again.

**JobFailedForGood** — a job used all its retries in the last hour (pg-boss `failed`, the « dlq »):

```sql
select id, name, data, output, completed_on from pgboss.job
where state = 'failed' and completed_on > now() - interval '1 hour' order by completed_on;
```

`output` is the error; the job's log lines (`"jobId"`) say which company. Fix the cause first. Then
the sweep (`src/workers.ts`) queues again a send that never finished (`invoice.send`), a payment
report still pending (`invoice.report_payment`) and a document still `ingested` or `classified` after
10 minutes; an approved request whose e-mail never left (`action.send`) goes back to a person in the
pane as a draft to decide again (`send_unknown`, the watchers); an `erp.sync` import resumes when the person
sends the same file again. For the other queues, the job's `data` says what was not done. A failure
that comes back after the fix is a P1 or a P2 (§ Pilot).

**ErpImportStuck** — an ERP export has been read for more than 2 hours (`fi_erp_import_running_seconds`,
by list). The pane shows « en cours ». The `erp.sync` job's log lines say where it stopped; the same
file sent again from the pane continues from its cursor (`docs/DECISIONS.md` D9). A file far beyond
the pilot's sizes goes to `docs/DEFERRED.md` (imports over 10 minutes).

**RouteOverBudget** — a route's p95 over §11's budget for 15 minutes: `POST /ingest` 0.3 s,
`GET /actions` and `GET /obligations` 0.2 s, `POST /actions/:id/decide` 2 s. On the dashboard: is it
one route or all (the database: `docker stats`, slow queries in `docker compose logs postgres`), one
company with many rows (its `tenantId` in the slow requests' lines), or a burst of requests? Measure
the same paths with `pnpm perf` on a copy of the data before changing code.

**DocumentReadOverBudget**, **DocumentSettledOverBudget** — documents take longer than §11's budgets
from their arrival: read in 5 s (30 s by OCR), settled in 8 s with e-invoice data, 25 s without. The
dashboard's « Jobs waiting » says whether they wait in the queue (a backlog: many documents at once,
the workers busy) or are slow to read or classify (OCR, the model provider: `fi_agent_runs_total` by
status). A backlog empties by itself; a company sending more than 200 at once is told to wait (429).

**WatchersOverBudget** — the deadline watchers, on the chasing timer every 5 minutes, take more than
60 s (p95 of the hour). `pnpm perf` measures them on a company of 1 000 deadlines; the dashboard's
« Chasing timer » shows whether the other tasks of the same run (chasing, weekly reports) grew too.
Nothing is lost while they are slow: a deadline is drafted at the next run that reaches it.

## Legacy MVP

The Rust/Next.js MVP was removed at the end of M1; its code and history stay on the tag
`archive/rust-mvp-v1`. Its deployment is still live at https://facture-impec.vercel.app until the
add-in replaces it (M3).
