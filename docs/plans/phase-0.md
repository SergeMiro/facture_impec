# BTP plan — stage 0: foundations (2026-10-24)

BTP plan §12 stage 0, adapted by `docs/DECISIONS.md` D1–D2: the workspace, Turborepo, Drizzle,
Docker Compose and the gate already exist. What stage 0 adds is the vocabulary of the new back end,
its tables, and the boundary check.

## Delivered

| What | Files |
|---|---|
| `@fi/domain`: Zod schemas of BTP plan §4–5 and §10, imports nothing from the monorepo | `packages/domain/{package.json,tsconfig.json}`, `src/{index,kinds,envelope,approval,errors}.ts`, `src/domain.test.ts` |
| Tables: `blobs`, `documents`, `chantiers`, `obligations`, `actions`, `connector_syncs`; on `parties`: `subcontractor`, `siret`, `erp_ref` | `packages/db/src/schema.ts`, `packages/db/drizzle/0021_btp_foundations.sql` (+ meta), `packages/db/src/db.test.ts` |
| The company's export and deletion (RGPD) know the new tables | `apps/api/src/rgpd.ts` and its test |
| Package boundaries checked by the gate | `scripts/boundaries/{rules,check}.ts`, `scripts/boundaries/check.test.ts`, root `package.json` (`boundaries`, `test:scripts`, `verify`) |
| Docs | `docs/DECISIONS.md`, `docs/ARCHITECTURE.md` (BTP stage 0), `docs/PROGRESS.md` (criteria, evidence), `docs/TODO.md` (BTP plan), `docs/DEPENDENCIES.md` if a dependency is added |

## Definition of done (BTP plan §12, adapted)

- `pnpm verify` green, the boundary check included; it fails on a forbidden import (its own test
  shows it, on a fixture tree).
- The migration applies on PGlite (tests) and on Postgres 17 (the compose service).
- `docker build -f apps/api/Dockerfile .` succeeds with the new package (the image installs the
  API's workspace dependencies only).
- No behaviour of the existing product changes.

## Deviations

- The contracts of BTP plan §5 and §10 are written with the changes of `docs/DECISIONS.md` D6
  (`tenantId`, `revision`, no `timeout`, the actor from the session); the approval channel of the pane
  keeps the plan's name `excel`, as `DocumentSource` does.
- No `infra/docker-compose.yml`: `deploy/compose.yaml` (Postgres 17 and the API) already exists, and
  the stack has no Redis or Langfuse to add (D1).
- Postgres keeps each closed list as a check constraint (plan §4: « extended only by a migration »);
  the rest of the schema uses text columns with TypeScript enums, as before.
- The boundary check also fails on a workspace package missing from the importer's `package.json`
  (the API image installs the declared ones only) and on a path into another package. The add-in may
  import `ai` (the chat client of R8); the providers `@ai-sdk/*` stay forbidden there.
- `documents.sha256` is unique per company **and mode**: a file sent in Mode test and then for real is
  two documents, as invoices are.
