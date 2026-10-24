# Facture Impec — working rules for coding agents

E-invoicing agent for French TPE/PME who invoice in Excel: validate → convert (Factur-X / UBL) →
send through a certified platform (B2Brouter) → track until paid → explain every problem in plain French.
The full product spec is the owner's private implementation plan (claude.ai artifact
`https://claude.ai/artifact/Q1MiX5ZKE5ycjG8Nr7YRuR`, read it with the Artifact tool). Section numbers
like "plan §7" refer to it. Where this file and the plan disagree, the plan wins and this file gets fixed.

## Where things are

- Single working copy on the VPS: `/home/sergiy_prod/facture_impec` (not under `~/workspaces`, which is auto-cleaned).
- Layout: `apps/{addin,api,mock-pdp,site}`, `packages/{core,agents,pdp-adapter,db,shared,domain}`, `fixtures/`, `docs/`, `scripts/`.
- The owner's second plan, the BTP back end (agents, deadlines, approvals, ERP connectors), is
  followed stage by stage: `docs/DECISIONS.md` maps it onto this repository, `docs/plans/phase-N.md`
  holds each stage. A deviation from it is written in DECISIONS before the code.
- `apps/site` is the marketing site (Astro + Vercel, green brand). Its copy lives in `apps/site/src/content/`;
  rule 6 below is about product UI. Never put unverified claims, fake testimonials or customer counts on it.
- `apps/addin` has two hosts: Office.js (`taskpane.html`) and a bound Google Sheets sidebar
  (`google-sheets.html`, `src/sheets/`). Both use the same controller and API. Google installation,
  scopes and real-account checks: `docs/GOOGLE_SHEETS.md`.
- The previous Rust/Next.js MVP was ported to `packages/core` in M1 and removed; the tag
  `archive/rust-mvp-v1` keeps it with its history. Never build on it.
- Progress and evidence: `docs/PROGRESS.md`. Things consciously postponed: `docs/DEFERRED.md`.

## Commands

```bash
pnpm install          # Node 22, pnpm 11 (corepack)
pnpm dev              # api :4000, mock-pdp :4010, add-in :3000, site :4321
pnpm verify           # biome ci + typecheck + package boundaries + tests — the gate before every commit
pnpm format           # biome check --write
pnpm test:e2e         # add-in E2E in local Chrome, own ports (docs/RUNBOOK.md § E2E); not part of verify
pnpm scenario [--provider b2brouter] all   # plan §9 scenarios, in-process; through the B2Brouter adapter
pnpm load             # k6 batch test, 1 000 invoices on a throwaway Postgres (Docker); not part of verify
pnpm accounting:check [file]   # accountant FEC imported into Paheko (Docker); not part of verify
pnpm appsource:package --addin <url> --support <url> --version a.b.c.d [--validate]   # store package (docs/APPSOURCE.md)
pnpm addin:icons      # redraw the add-in's icons
pnpm sheets:package --addin <https-url>/google-sheets.html   # bound Apps Script package (R9)
docker compose -f deploy/compose.yaml up -d --build   # API + Postgres, settings in deploy/.env (docs/DEPLOY.md)
```

B2Brouter: nothing in `pnpm verify` reaches it; the stand-in in `apps/mock-pdp` (`/b2brouter`) answers in
its place. Live runs need the owner's sandbox key in `FI_LIVE_B2BROUTER_*` (`docs/RUNBOOK.md` § B2Brouter
sandbox); a B2Brouter key lives only in the environment or a chmod 600 file outside the repo
(`~/.config/facture-impec/b2brouter.env`), never in the repo, a URL, a log or a message.

Branches: work on `dev` (the default branch). Promote by merging `dev` → `preprod` with `pnpm verify` green,
then `preprod` → `prod` when everything is OK; fast-forward only, never commit on `preprod` or `prod`
directly (`docs/RUNBOOK.md` § Branches).

GitHub Actions is disabled on this account (billing), so a green check on GitHub proves nothing and a
missing one means nothing. `pnpm verify` run locally is the gate; `.github/workflows/ci.yml` mirrors it.

## Rules (plan §12)

1. Work milestone by milestone. Before starting a milestone, restate its acceptance criteria in
   `docs/PROGRESS.md` and check them off at the end with evidence (test names, screenshots).
2. One PR (or one series of commits on `dev`) per milestone section; conventional commits; every merge must leave `pnpm verify` green.
3. Never invent external API details. If B2Brouter, SIRENE, annuaire or Office.js behaviour is unknown,
   read the docs, record the source and date in `docs/`, and if still unknown, implement against the
   mock and add a `TODO(verify)`.
4. Money is integer cents. Dates are ISO strings in UTC storage, Europe/Paris in UI. No `any`.
   Zod at every boundary.
5. Every LLM prompt lives in `packages/agents/prompts/` and has an eval fixture. Changing a prompt
   without updating the eval is a failing PR.
6. UI strings only in `packages/shared/i18n/fr.json`. French, vouvoiement, no jargon: say
   « votre client n'a pas été trouvé dans l'annuaire », not "routing lookup failed".
7. Do not add dependencies > 1 MB or with < 1k weekly downloads without a one-line justification
   in `docs/DEPENDENCIES.md`.
8. When a feature is bigger than the current milestone needs, implement the smallest version and log
   the rest in `docs/DEFERRED.md`.
9. Ask the user only when a decision changes money, legal exposure, or the product's promise.
   Everything else: decide, document, move on.
10. Keep the user calm: every error message answers "what happened, is my invoice safe, what do I click next".

## Non-negotiables (plan §0, short form)

Deterministic core, AI on top (an LLM never decides validity) · nothing goes to a real PDP without an
explicit user decision (Review mode by default) · every action writes an audit event · idempotent sends
(`tenant_id + invoice_number + fingerprint`) · same code path for local / sandbox / prod, visible
« Mode test » · pseudonymize before any LLM call by default · do not over-engineer.

## Conventions

- Internal packages export TypeScript source (`"exports": "./src/index.ts"`); there is no package build step.
  Node apps run through `tsx`, the add-in through Vite.
- One root `.env` (copy `.env.example`); it is read and validated by `@fi/shared/env`. `.env.example`
  lists exactly the variables the code reads.
- Biome formats and lints (single quotes, 2 spaces, 100 columns). Tests are Vitest, next to the code (`*.test.ts`).
