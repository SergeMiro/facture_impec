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
| Add-in (task pane) | http://localhost:3000 | page titled « Facture Impec » |
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

Deploy (the Vercel project is not linked to git; deploy from the CLI):

```bash
cd apps/site && npx vercel build && npx vercel deploy --prebuilt          # preview URL
npx vercel deploy --prebuilt --prod                                        # production, after review
```

Before production: fill the publisher identity in `apps/site/src/content/site.ts` (`legal`) and set
`PUBLIC_CONTACT_EMAIL`; the legal pages show « à compléter » markers until then.

## Daily commands

| Command | What it does |
|---|---|
| `pnpm verify` | `biome ci` + typecheck + tests in every package. Run before each commit; it is the CI gate. |
| `pnpm format` | Format and apply safe lint fixes. |
| `pnpm build` | Production build (add-in and marketing site). |
| `pnpm --filter @fi/api dev` | Run one package. |

## CI

GitHub Actions is disabled on the account since 2026-09-17 (billing). `.github/workflows/ci.yml`
describes the same gate as `pnpm verify`, but nothing runs on GitHub: verify locally.

## Sideloading into Excel

Arrives in M3, with the HTTPS dev server and `scripts/sideload.*`, for Excel on the web, Windows and Mac.

## Legacy MVP

`legacy/rust-mvp/` is the frozen Rust/Next.js MVP (still live at https://facture-impec.vercel.app).
It is not part of the workspace and is removed at the end of M1. Full history: branch `archive/rust-mvp-v1`.
