# Decisions (ADR log)

The owner's second plan, « Plan de réalisation : système d'agents BTP et connecteurs » (private
Claude Docs document, 2026-10-24, "BTP plan §N" below), turns Facture Impec from an invoice checker
into a back end of agents for building-trade SMEs (PME BTP): it receives their documents, checks
them deterministically, watches deadlines and prepares actions for a person to approve. The Excel
add-in becomes one client of that back end.

The BTP plan says: where it contradicts the code, the plan wins, and the change is written here
before the code; where the repository already chose another tool of the same class, the repository
keeps it, and that is written here too. Each entry: the date, what the plan says, what we do, why,
and when to look again.

## D1 — Tools: the repository keeps its own (2026-10-24)

The BTP plan §3 names a stack. It was written without the repository at hand: most of it already
exists here under another name, and the plan's own rule keeps what is there.

| BTP plan says | Repository has, and keeps | Why |
|---|---|---|
| Fastify | Hono 4 on `@hono/node-server` (`apps/api`) | Same class; 60+ routes exist; Hono's routing is as fast. |
| BullMQ 5 on Redis 7 | pg-boss 12 on Postgres (`apps/api/src/jobs.ts`) | Same class. It already gives what §8 asks of BullMQ: `singletonKey` = the idempotency key, retries with backoff, cron schedules with a time zone, dead-letter queues. No Redis: the plan's own principle « un seul Postgres » holds better. |
| Rust/WASM validator `core-validator` | `@fi/core`, TypeScript (Rust archived 2026-10-17, `docs/ARCHITECTURE.md` › Decision: port the Rust core) | The same code runs in the browser and in Node, which is what the plan wants from WASM (§13, « un seul paquet »). BTP rules are TypeScript with JSON fixture tables (`fixtures/btp/`) instead of `.rs` + `.toml`; « a rule without a test fails CI » holds. |
| LangGraph.js, `PostgresSaver`, `PostgresStore` | Pipelines in `packages/agents` run by API workers, with the orchestrator (`packages/agents/src/orchestrator.ts`: 3 attempts with backoff, two runs at a time per company, a token cap per run and per company per day, every run in `agent_runs` with its tokens). For the BTP pipelines a malformed answer is not retried but sends the document to review, as §7 asks | Same class (agent orchestration). §7's graphs are short chains with one or two model calls; their state lives in business tables (`documents.stage`, `actions.status`). The `interrupt` / resume of §7 is an `actions` row waiting for a decision plus a job queued by `POST /actions/:id/decide`: no worker waits, resume is one job, sending is idempotent by action id. One state store instead of two (business rows and checkpoints that could disagree). Look again if a flow needs a model loop with several human turns of free-form memory. |
| Zod 3 | Zod 4 | Already everywhere. |
| ESLint + `eslint-plugin-boundaries` | Biome 2; package boundaries checked by `scripts/check-boundaries.ts` inside `pnpm verify` | Biome has no boundaries rule. The script reads every import and fails the gate on a forbidden one, which is what the plan wants (« violation = build failure »). |
| promptfoo | The eval harness of `packages/agents/evals` (recorded answers, the prompt's hash in each recording) | Same class. A prompt changed without its eval fails `pnpm verify` (CLAUDE.md rule 5). Accuracy thresholds of §11 become eval assertions. |
| S3 / MinIO, `storage_key` only in the database | A `FileStore` interface; its first driver keeps bytes in Postgres (`blobs`), the S3 driver comes with hosting | Hosting is the owner's choice (TODO). Documents keep only a `storage_key` from day one, so moving bytes to S3 is a data copy, not a model change. |
| Langfuse, OpenTelemetry, Grafana, Prometheus | `agent_runs` (tokens, model, attempts per agent run) and structured logs until BTP stage 7 | Stage 7 of the plan. |
| pgvector schema `vec`, embedding matching | Not yet | Rules classify first (§7 `cheapClassify`); embeddings come when the model share of the flow is measured above the plan's 5 %. |
| Schemas `app` / `graph` / `vec`, `org_id` with row-level security | Tables stay in `public`, `tenant_id`; tenant isolation in code, tested on every route (« keeps tenants apart ») | `graph` has no use without LangGraph, `vec` comes with embeddings. RLS needs a database role per request; it is deployment hardening (TODO), not a model change. Renaming 40 tables' `tenant_id` to `org_id` buys nothing. |
| One branch and one PR per stage | One series of commits on `dev` per stage, promoted fast-forward to `preprod` then `prod` with `pnpm verify` green | CLAUDE.md rule 2. GitHub Actions is off on this account, so a PR's checks prove nothing; the local gate is the gate. |

## D2 — Data model: the plan's tables on the existing ones (2026-10-24)

| BTP plan §4 | Here | Notes |
|---|---|---|
| `org` | `tenants` | `pa_provider` = `pdp_provider`; `settings` = the existing columns and `invoice_defaults`. |
| `party` (`role[]`, `source`, `erp_ref`) | `parties` (`kind` customer or supplier) + `subcontractor` on a supplier, `siret`, `erp_ref` | Sous-traitance is a property of the supplier relationship, not a third kind of company: a supplier row says whether it is a sous-traitant. SIREN stays the key: the URSSAF attestation and the Kbis are per enterprise. |
| `chantier` | `chantiers` (new) | |
| `document` | `documents` (new): every file that arrives, whatever its kind, with `sha256` unique per company and a `storage_key` | The registry `docs` stays the projection of business documents (invoices, orders, deliveries, purchases) that the checks across documents read; a document that is an invoice is projected there as before. |
| `invoice` | `invoices` (sent, full lifecycle, state machine) and the registry `docs` (received ones) | Situation number, retenue de garantie and autoliquidation are added where an invoice is read (see D4). |
| `obligation` | `obligations` (new) | Created only from a document or an invoice (`source_document_id` or `invoice_id`, one of the two required by a check constraint). |
| `action` | `actions` (new) | Its status changes only through `POST /actions/:id/decide` (and the sender's own result); a worker never sets `approved`. |
| `event` | `audit_events` (append-only, written in the same transaction) and `invoice_events` (an invoice's timeline) | The feed `GET /events` reads them. |
| `connector_sync` | `connector_syncs` (new) | The OAuth `connections` of R4/R5 stay as they are. |

## D3 — What waits for access we do not have (2026-10-24)

BTP plan §12: « if there is no access to the external system, the stage is paused and written down,
not built from the documentation without a check ». Paused, with what unblocks each (`docs/TODO.md`
› BTP plan):

| Stage | Needs | Built meanwhile |
|---|---|---|
| 4 EBP SaaS | a developer account and an EBP test company with BTP data | The connector frame (§9: `Connector`, cursor, `connector_syncs`, shared mapping, source priority PDP > ERP > e-mail) tested with a file connector (D5). |
| 5 Batigest + `bridge-win` | a pilot's machine for `probe` (the plan forbids guessing the SQL schema) | Nothing on Batigest's SQL. |
| 6 EBP local, Onaya, WhatsApp | an EBP « API » licence, an Orisha partnership, Meta's template approval | Nothing; Telegram and e-mail carry the approvals (§13 already says so for WhatsApp). |
| 1 mail adapter | the owner's choice: a forwarding address (an inbound e-mail provider, a cost) or Gmail/Outlook OAuth (`gmail.readonly` is a restricted scope: Google's paid security assessment) | The provider-neutral part: a raw e-mail (`.eml`) becomes its attachments and an envelope, tested with a stand-in. |

## D4 — French e-invoicing facts that change BTP rules (2026-10-24)

- A « facture de situation » is an ordinary invoice for French e-invoicing: BR-FR-04 allows type
  codes 380, 389, 393, 501, 386, 500, 384, 471–473, 261, 262, 381, 396, 502, 503 only
  (`docs/research/FR_RULES.md`), so UNTDID 875–877 cannot be used. The situation number is not a
  structured field of the XML: it comes from where the invoice was written (a sheet column, an ERP
  row) or from reading the PDF. BTP-SIT-01/02 run only when that number is known.
- BTP-DATE-01 of the plan (due date before the issue date or more than 60 days after) already
  exists as two rules of `@fi/core`: BR-FR-CO-07 (before the issue date, error, from the French
  CIUS) and FF-DUE-02 (more than 60 days, warning). No third rule.
- The « Autoliquidation » mention on a reverse-charge invoice is already FF-TVA-02. BTP-AUTOLIQ-01
  adds what only the company knows: the supplier is its sous-traitant, so the invoice must carry no
  VAT (CGI art. 283, 2 nonies; BOI-TVA-DECLA-10-10-20).

## D5 — Additions of ours (2026-10-24)

- **ERP exports as a connector.** Batigest and EBP both export their lists (clients, chantiers,
  invoices) to Excel or CSV. A connector that reads those exports goes through the same `Connector`
  interface, mapping and priority, works today without any partnership, and gives pilots a way in
  before the API connectors exist.
- **One place to approve.** The pane already asks for decisions in several places (« Corriger pour
  moi », the chasing drafts, the received invoices). New actions arrive in « À valider »; the older
  decisions stay where they are until each is moved there on purpose (`docs/DEFERRED.md`).

## D6 — Contracts of BTP plan §5 and §10, as written in `@fi/domain` (2026-10-24)

| BTP plan says | `@fi/domain` | Why |
|---|---|---|
| `DocumentEnvelope.orgId` | `tenantId` | D2: org = tenant. |
| `DocumentEnvelope` without name or size | `name`, `size` (at most 20 MB), `isTest`, the MIME types the ingest can read | A person sees the file's name; the size is refused at the door; Mode test never creates a real deadline or action. |
| `structured.payload` | `xml` for Factur-X, UBL and CII; `record` for an ERP row | Each format typed rather than `unknown`. |
| `ApprovalDecision.decision` includes `timeout` | No `timeout` | A draft nobody answers stays a draft and is reminded; nothing goes out, or is dropped, without a person (BTP plan §2). |
| `ApprovalDecision.actorId` | Not in the body: the signed-in person, the bound Telegram chat or the signed e-mail link | A body cannot be trusted to say who sent it. |
| — | `revision` | An answer to an action that changed since (edited, already answered elsewhere) is refused. Two channels can carry the same action. |
| `ValidationInput` / `ValidationResult` | `@fi/core`'s `Issue` (rule id, severity, path, French message), unchanged | One finding type for the add-in and the back end; BTP rules join `@fi/core` at stage 1 (D1). |
| `DocumentState` | The `documents` row (`stage`, `kind`, `extracted`, `validation`) | D1: the state lives in business tables. |
| `Connector` | Stage 4, with the ERP-export connector (D5) | Nothing reads it before. |
