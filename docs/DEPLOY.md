# Deployment (plan §11 M7)

What runs where once Facture Impec leaves `pnpm dev`: the API (with its workers) and Postgres in Docker
on the EU VPS, the task pane as static files on https, a TLS proxy in front. Files:
`apps/api/Dockerfile`, `deploy/compose.yaml`, `.dockerignore`. Nothing here is deployed yet: the hosts,
the domain and every key are the owner's (§6).

## 1. Shape

| Piece | What | Where |
|---|---|---|
| API | `apps/api/src/server.ts` through `tsx` (internal packages are TypeScript source, no build step); migrates the database on start; runs the pg-boss workers (send, sync, sweep), chasing, weekly reports and the daily purge in the same process (`API_WORKERS=true`) | `api` service of `deploy/compose.yaml`, published on `127.0.0.1:4000` only |
| Database | Postgres 17 (`postgres:17.11-alpine`), volume `pgdata` | `postgres` service, not published |
| Task pane | `apps/addin/dist/` (`taskpane.html`, `redirect.html`, `assets/`): static files, any https host | the same proxy, or a static host |
| TLS proxy | Terminates https for the API and the pane (Office, Stripe's and B2Brouter's webhooks all need https) | the owner's choice (Caddy, nginx, Cloudflare Tunnel) |

Two deployments are possible, same image: **sandbox** (`FI_ENV=sandbox`, B2Brouter sandbox key, Stripe
test key; the `preprod` branch) and **prod** (`FI_ENV=prod`, B2Brouter live key plus its sandbox key for
« Mode test », Stripe live key; the `prod` branch). The pilot runs on **prod**: every company stays in
Mode test, on B2Brouter's sandbox, until the operator switches it live (`docs/RUNBOOK.md` § Pilot).

## 2. Settings (`deploy/.env`)

One file next to `compose.yaml`, never committed, `chmod 600`. It holds the variables of `.env.example`
that differ from their defaults, plus `POSTGRES_PASSWORD`. `packages/shared/src/env.ts` refuses to start
on a wrong combination (a live key outside prod, a test key in prod, a missing secret).

| Variable | prod | Why |
|---|---|---|
| `FI_ENV` | `prod` | |
| `POSTGRES_PASSWORD` | random, `openssl rand -hex 24` | compose builds `DATABASE_URL` from it |
| `ADMIN_TOKEN` | random, ≥ 24 characters | operator routes (`/admin/*`); required outside local |
| `API_PUBLIC_URL` | `https://api.<domain>` | sign-in and sign-up links, Stripe's return pages |
| `ADDIN_ORIGINS` | `https://app.<domain>` | CORS: only the pane calls the API from a browser |
| `TRUST_PROXY_HEADER` | `x-forwarded-for` behind nginx/Caddy, `cf-connecting-ip` behind Cloudflare | the request limits count per client address |
| `B2BROUTER_API_KEY`, `B2BROUTER_WEBHOOK_SECRET` | live key and its webhook secret | real sends |
| `B2BROUTER_SANDBOX_API_KEY`, `B2BROUTER_SANDBOX_WEBHOOK_SECRET` | `test_…` key and its webhook secret | « Mode test » in prod |
| `MAIL_SMTP_URL`, `MAIL_FROM` | the mail provider | sign-in links, sign-up, chasing, weekly report; without them no link is sent |
| `TERMS_URL` | the published CGU | without it « Créer un compte » is not offered |
| `STRIPE_SECRET_KEY` (restricted `rk_live_…` advised), `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICES_*`, `STRIPE_METER_EVENT`, `STRIPE_AUTOMATIC_TAX` | `docs/BILLING.md` §11 | without a key nobody is billed |
| `AI_PROVIDER`, `AI_MODEL_AGENT`, `AI_API_KEY`, `AI_KEY_SEALING_KEY` | `docs/AI_PROVIDERS.md` | without them the agents answer deterministically |
| `PDP_KEY_SEALING_KEY` | random 32 bytes, `openssl rand -base64 32`; keep a copy outside the server | seals the B2Brouter keys companies connect in Réglages (`docs/B2BROUTER.md` §12); without it the form is not shown. Changing it later makes the saved keys unreadable and stops those companies' real sends until they paste their key again |

`DATABASE_URL`, `API_HOST` and `API_PORT` are set by compose and the image; the `MOCK_*` variables are
for local only (the mock platform exists only when `FI_ENV=local`).

## 3. Start, update, back up

```bash
cd deploy
docker compose up -d --build          # first start: builds the image, migrates, starts the workers
curl -s localhost:4000/health          # {"ok":true,"service":"api","env":"prod"}
docker compose logs -f api

git pull --ff-only && docker compose up -d --build api     # update: the API migrates on start

docker compose exec -T postgres pg_dump -U fi -Fc fi > fi-$(date +%F).dump   # backup
```

The image installs only `@fi/api` and its workspace dependencies (`--prod`), runs as `node`, and has a
health check on `/health`. Tried on 2026-10-18: build, start against the compose Postgres, migrations,
`/health`, then removed. A backup off the machine (and its restore) is the owner's choice of storage.

## 4. The task pane

```bash
ADDIN_API_URL=https://api.<domain> pnpm --filter @fi/addin build    # → apps/addin/dist/
```

Serve `apps/addin/dist/` over https at the URL given to `pnpm appsource:package --addin`, with caching
allowed on `assets/` (Office asks for cacheable icon URLs, `docs/OFFICE.md`). The manifest for Excel is built from that URL
(`docs/APPSOURCE.md` §6), whether for the store or for an accounting firm's centralized deployment.

## 5. Webhooks to register

| Sender | URL | Secret |
|---|---|---|
| B2Brouter (live account) | `https://api.<domain>/webhooks/pdp/b2brouter` | `B2BROUTER_WEBHOOK_SECRET` |
| B2Brouter (sandbox account) | `https://api.<domain>/webhooks/pdp/b2brouter_test` | `B2BROUTER_SANDBOX_WEBHOOK_SECRET` |
| Stripe (API version `2026-09-30.endive`, events in `docs/BILLING.md` §4) | `https://api.<domain>/webhooks/stripe` | `STRIPE_WEBHOOK_SECRET` |

Webhooks only say « something changed »; the sweep (`PDP_SYNC_INTERVAL_SECONDS`) brings the same news
without them, later.

## 6. What only the owner can do

A domain and its DNS; the TLS proxy; the B2Brouter live and sandbox keys and their webhooks; the mail
provider; the Stripe account (`docs/BILLING.md` §11); the published CGU, privacy page and processing
agreement (`docs/RGPD.md`); where backups go.
