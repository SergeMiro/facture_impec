# Facture Impec — working rules for coding agents

E-invoicing agent for French TPE/PME who invoice in Excel: validate → convert (Factur-X / UBL) →
send through a certified platform (B2Brouter) → track until paid → explain every problem in plain French.
The full product spec is the owner's private implementation plan (claude.ai artifact
`https://claude.ai/artifact/Q1MiX5ZKE5ycjG8Nr7YRuR`, read it with the Artifact tool). Section numbers
like "plan §7" refer to it. Where this file and the plan disagree, the plan wins and this file gets fixed.

## Where things are

- Single working copy on the VPS: `/home/sergiy_prod/facture_impec` (not under `~/workspaces`, which is auto-cleaned).
- Layout: `apps/{addin,api,mock-pdp,site}`, `packages/{core,agents,pdp-adapter,db,shared}`, `fixtures/`, `docs/`, `scripts/`.
- `apps/site` is the marketing site (Astro + Vercel, green brand). Its copy lives in `apps/site/src/content/`;
  rule 6 below is about product UI. Never put unverified claims, fake testimonials or customer counts on it.
- The previous Rust/Next.js MVP was ported to `packages/core` in M1 and removed; the tag
  `archive/rust-mvp-v1` keeps it with its history. Never build on it.
- Progress and evidence: `docs/PROGRESS.md`. Things consciously postponed: `docs/DEFERRED.md`.

## Commands

```bash
pnpm install          # Node 22, pnpm 11 (corepack)
pnpm dev              # api :4000, mock-pdp :4010, add-in :3000, site :4321
pnpm verify           # biome ci + typecheck + tests — the gate before every commit
pnpm format           # biome check --write
```

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
