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
| `party` (`role[]`, `source`, `erp_ref`) | `parties` (`kind` customer or supplier) + `subcontracting`, `siret`, `erp_ref` | Sous-traitance is a property of the relationship, not a third kind of company: a supplier marked so is the company's sous-traitant, a customer marked so is the company's donneur d'ordre (0021 named it `subcontractor`, 0022 renamed it when the customer side came in stage 1). SIREN stays the key: the URSSAF attestation and the Kbis are per enterprise. |
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

## D7 — Stage 2: what each document is, by rules first (2026-10-24)

| BTP plan §7 says | Here | Why |
|---|---|---|
| `cheapClassify` ≥ 0.9 → kind, else `llmClassify` (Haiku class), < 0.7 → `needs_review` | The same thresholds. Patterns on the title give 0.95; a match in the body only gives 0.75 and is what the rules answer when the AI is off or the model failed (budget, network) | A company without AI still gets its attestations sorted; a body match is above the model's own bar. |
| A schema error is not retried | The orchestrator gets a per-call retry test: `classify` retries only what the provider says is retryable; a malformed answer is not asked again: the body pattern answers if one matched (0.75), else the document goes to review (`unclassified`) | §7; the other agents keep their retries (a fallback answer exists for them). |
| Output « kind + confidence » | `maxOutputTokens` 2 000, not the few dozen the answer needs | A reasoning model thinks inside the cap: at 200, 6 of the first 20 eval answers were cut (`finishReason: length`) and read as malformed (`docs/AI_PROVIDERS.md`). |
| `extractInvoice` (Sonnet class) for invoices | Only for a PDF without XML, and paused: owner's question « Reading invoices without XML » (`docs/TODO.md`). Such a document → `needs_review` `invoice_without_data` | A model must read the supplier's names to extract an invoice, so pseudonymizing hides the answer. Factur-X, UBL and CII are read at stage 1 without a model. |
| `extractDates` (Haiku class): siret, validFrom, validTo | Read by labelled patterns (« délivrée le », « à jour au », « valable du … au … », « réception prononcée le ») and SIRENs with a valid check digit; not found → `needs_review` `dates_missing`, a person gives them (`POST /documents/:id/review`) | These dates make legal deadlines: a rule is checked by a test, costs nothing, and a missed date is a question to a person, never a guess. A model fallback comes when pilots' real documents show where the patterns miss (`docs/DEFERRED.md`). The patterns come from public templates, not from real pilot documents: `TODO(verify)`. |
| `extractContract` | Deferred with `contrat_fin` | Nothing reads a contract's end before stage 3's watchers; contracts are classified and linked. |
| `linkParties`: unknown SIRET → `confirm_party` | Unknown SIREN on an attestation, a Kbis or an insurance → a `confirmer_tiers` draft. On an invoice: no draft | The pane already proposes a new customer or supplier from a received invoice (Réception, Clients); asking twice is noise. Several SIRENs, none known → `needs_review` `party_unclear`. |
| Chantier linked | Not at stage 2 | No rule finds a chantier in a document's text reliably; chantiers come with the ERP connectors (stage 4). |
| `deriveObligations` table | `attestation_vigilance` → `attestation_vigilance_renouvellement`, issued + 6 months; `kbis` → `kbis_renouvellement`, « à jour au » + 6 months; insurance → `assurance_expiration`, its end; `pv_reception` → `retenue_garantie_liberation`, réception + 1 year; a sale invoice (structured) → `facture_echeance`, its due date and amount payable. Nothing for the other kinds | D8222-5 (every six months, `TODO(verify)` with Légifrance, `docs/research/BTP_RULES.md`); loi 71-584 art. 2. `situation_echeance` needs a situation's number, which no XML carries (D4). |
| Keys | By SIREN, not by party: `attestation_vigilance_renouvellement:<SIREN>`, `assurance_expiration:<SIREN>:<decennale|rc>`; an invoice `facture_echeance:<seller SIREN>:<number>`; a réception by its document. A newer document moves the deadline, an older one does not. Mode test keys start with `test:` | An attestation is per enterprise; the same invoice from the PDP, an ERP or an e-mail makes one deadline (§9). |
| `persist` in one transaction | The document's final stage, its obligations and drafts, the audit event: one transaction, guarded by the stage it started from | A second run of the same job finds the document moved and does nothing. |
| Queue `classify`: concurrency 3, 60/min | pg-boss `localConcurrency` 3; no per-minute limiter | The orchestrator already holds two model calls per company and the daily token cap; most documents never reach a model. |
| Backpressure on `classify` > 500 | The ingest backlog (200 per company, D1 stage 1) counts every document not yet classified | One threshold for one company's flood. |
| — | `POST /documents/:id/review`: a person gives the kind, the dates and the SIREN; the same derivation runs. A field still missing → 422 naming it. An invoice without its data is taken as the person says (`done`, no deadline) | Every review reason has a way out in the pane; an invoice's amounts wait for the owner's question above. |
| A structured invoice: `validated` | `done` once checked: its rules, its party, its deadline (a sale) in one transaction | Nothing else happens to it at stage 2; stage 3 reads the deadline. |
| — | A réception's deadline is keyed by its document: the same PV received as a scan and as a PDF makes two | A missed deadline costs more than a repeated one; the chantier (stage 4) will key it (`docs/DEFERRED.md`). |

## D8 — Stage 3: watchers, actions and approvals on the existing chasing (2026-10-24)

| BTP plan §7, §8, §10 say | Here | Why |
|---|---|---|
| `WatcherGraph` per company and deadline kind, cron at 6:00 / 7:00 Paris, queue `watch` | `runWatchers` on the chasing timer (every 5 minutes, business clock): one pass over the open deadlines in their horizon. A draft's key is `<action kind>:<deadline id>:<due date>`, unique per company, so a second run makes nothing | Chasing already runs this way for the scenario clock; the query is cheap; the key makes a run twice harmless where a cron made it rare. |
| `composeDraft`: a model writes the e-mail (`subject`, `body`, `recipient`) | Templates in `fr.json` filled by `draftRequest` (`@fi/agents`), as CollectAgent's letters | The request is fixed content with legal weight (C. trav. D8222-5, loi 71-584); the recipient comes from the company's data, never from a model; no SIREN or name goes to a model; §10 fixes WhatsApp's texts anyway. A tone rewrite on the person's ask can come later with its eval. |
| Horizons: attestation, Kbis, insurance 30 days; invoices overdue or within 7 days; retenue a year after the réception | The same for the standing documents and the retenue; an invoice reminder only once it is overdue, and only for an invoice that came as a document (`facture_echeance` without `invoice_id`) | An invoice sent through Facture Impec is chased by CollectAgent on its cadence; a second reminder would duplicate it (BTP plan §12 « not duplicated »). A document invoice has no cadence yet: one reminder after its date (`docs/DEFERRED.md`). |
| `dedupe`: no new action while a draft is open for the deadline | The key above. A deadline that moved (a newer attestation) or closed withdraws its open draft (`rejected`, by `agent:watch`, with the reason) before a new one is drafted | Nobody approves a request for a document already received. |
| `ActionGraph` with `interrupt` and `PostgresSaver` | D1: the action row is the state; `POST /actions/:id/decide` changes it in one transaction and queues `action.send` (one per action) | |
| `edit` → node `revise` (a model, three rounds) | `edit` carries the person's own text, and the recipient's address when it was missing; the draft takes them and its revision goes up | « Modifier » is the person's pen; no model rewrites what a person wrote. |
| `snooze` → a delayed job; `timeout` from a job | `snoozed` until `snooze_until` (at most 30 days, D6); the watcher run makes it a draft again. No timeout (D6) | One timer already passes every 5 minutes. |
| `preflight`: the validator on the outgoing document | Before sending: the deadline is still open and on the same date, the recipient is there; else `failed` with its reason, nothing sent | A request carries no invoice to validate; what can make it wrong is a deadline that changed meanwhile. |
| `send` idempotent by action id (an `event` checked before) | Claimed in one transaction (`payload.sendingAt`), sent, then `sent`. A claim older than 10 minutes that never finished goes back to a draft, « envoi incertain », for a person to decide | CollectAgent's rule: never send twice silently, never lose a send silently. |
| Queues `watch`, `action`, `notify` | `action.send` only; e-mail notification is the weekly report (3C) | Telegram is paused (below); the pane reads the API. |
| Telegram bot: webhook, inline buttons, a chat bound by a one-time code | Paused: it needs the owner's bot (BotFather token) and a public HTTPS address for the webhook | BTP plan §12: no access, no build from the documentation. `ApprovalDecision` already has `channel: 'telegram'`. |
| E-mail: a weekly digest, instant alerts for errors, approval by a signed link (7 days, single use) | The weekly report (Monday 8:00, mailed to the owners) lists the drafts, each with « Envoyer » and « Ignorer » links. A link opens a page with one button, as the sign-in link: a mail scanner opening it decides nothing. 7 days, single use, bound to the draft's revision. Instant alerts deferred | Mail clients and scanners follow links: a GET must not decide. |
| `confirm_party` | `confirmer_tiers`: « Ajouter comme fournisseur » looks the SIREN up in the directory, adds the supplier and links its deadlines and documents; the next watcher run drafts its requests | Attestations, Kbis and insurance come from suppliers and sous-traitants. Marking a sous-traitant stays the person's switch (VAT consequences, stage 1A). |
| — | `ApprovalDecision` gains `to` (an e-mail address, with `edit` only). An address given there is kept on the company when it had none | A company without an address would leave its draft unsendable. |
| — | « C'est fait » and « Ignorer » on a deadline (`POST /obligations/:id/close`) close it and withdraw its open drafts | A deadline handled elsewhere (the attestation came by hand) must stop its requests. |
| Mode test | A test draft is never e-mailed: approving it marks it sent, « Mode test : rien n'a été envoyé » | As test invoices. |
