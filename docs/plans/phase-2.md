# BTP plan — stage 2: what each document is, and the deadlines it makes (2026-10-24)

BTP plan §12 stage 2 (DocumentGraph, deriveObligations, `GET /obligations`, `POST /ingest`, the task
pane on the API), with §7's graph and §11's tests, adapted by `docs/DECISIONS.md` D1–D7. Stage 1
leaves a text document `ingested` with its text read, and a structured invoice `validated`. Two
series of commits, each with `pnpm verify` green:

## 2A — classify, read, link, derive (the back end)

| What | Where |
|---|---|
| `cheapClassify`: the kind from the title (0.95) or the body (0.75) by patterns, the file's name and the e-mail's subject; no model | `packages/agents/src/classify.ts` |
| `llmClassify`: the model of role `classify` on the first 2 000 characters, pseudonymized; an answer under 0.7 or malformed sends the document to review, never retried | same, `prompts/classify.md`, orchestrator phase `classify` |
| Its eval: 45 synthetic French documents over the 14 labels (the 15 kinds, an invoice's side told by its SIRENs), the rules alone as the floor, a recording through llmfp | `packages/agents/evals/classify.fixtures.ts`, `evals.test.ts`, `scripts/record-evals.ts` |
| `readFields`: the dates a kind needs (issued, valid until, réception) and the SIRENs named, by labelled patterns; a SIREN only with a valid check digit | `packages/agents/src/document-fields.ts` |
| `deriveObligations`: kind + fields → deadlines (the table of D7), a pure function | `packages/agents/src/obligations.ts` |
| Queue `document.classify`: classify → read → link the company by SIREN → derive → one transaction (document, obligations, a `confirmer_tiers` draft for an unknown SIREN, audit); `needs_review` with a reason when a step cannot say | `apps/api/src/document-pipeline.ts`, `jobs.ts`, `deps.ts`, `workers.ts` (sweep) |
| A structured invoice goes on after its rules: linked, its deadline derived (a sale: `facture_echeance`), `done` | `apps/api/src/ingest.ts` (`runDocumentValidate`) |
| `POST /documents/:id/review`: a person says the kind and the dates; the same derivation runs | `apps/api/src/document-pipeline.ts`, `app.ts`, fr.json |
| Backpressure counts the documents waiting for `classify` too | `apps/api/src/ingest.ts` (`checkBacklog`) |

## 2B — the registry in the pane

| What | Where |
|---|---|
| `GET /documents` (newest first, by stage or kind, paginated) and `GET /obligations?horizon=` (open deadlines, overdue first) | `apps/api/src/document-pipeline.ts`, `app.ts` |
| « Documents » (what arrived, what each became, « À vérifier » with its form) and « Échéances » (what falls due, to whom, from which document) | `apps/addin/src/ui/`, `controller.ts`, `api.ts`, fr.json |

2B in the pane, decided before the code: **one tab « Documents »** with three parts, « Échéances »
first, « À vérifier » with its count, « Reçus »: the pane has seven tabs already and they wrap; the
deadlines and the documents they come from are one subject. A **« Déposer un document »** button
(`POST /ingest`): without it a pilot has no way to bring an attestation to the back end until the
e-mail provider is chosen (D3). A document in review shows **the start of its text** (300
characters), so a person can say what it is without opening the file; opening the file itself waits
(`docs/DEFERRED.md`). Mode test shows test documents and deadlines, as « Réception ».

## Not in stage 2 (and where it goes)

- **extractInvoice** (a PDF invoice without XML read by a model): the owner's question « Reading
  invoices without XML » (`docs/TODO.md`). Until then such a document waits in review
  (`invoice_without_data`); a Factur-X, UBL or CII invoice needs no extraction.
- **extractContract** and `contrat_fin`: contracts are classified and linked; their end date later
  (`docs/DEFERRED.md`).
- **The chantier of a document**: chantiers come with the ERP connectors (stage 4); no rule finds a
  chantier in a document's text reliably.
- **Dates read by a model** when the patterns miss: once pilots' real documents show where they
  miss (`docs/DEFERRED.md`).
- **The watchers and « À valider »**: stage 3 reads the deadlines and drafts made here.

## Definition of done (BTP plan §12 and §11, adapted)

- Classification on the eval's 45 documents: the rules alone recorded as the floor; rules then the
  model ≥ 95 % on the recording (free models through llmfp: a gate only for the code path, as the
  other agents' recordings, `docs/AI_PROVIDERS.md`). « Amounts ≥ 98 % » waits with extractInvoice.
- Pipeline tests on 12+ documents (stage 1's golden ones and new texts): the kind, the stage, the
  review reason, the deadlines and drafts each one makes; the same document twice makes them once;
  a newer attestation moves the renewal, an older one does not.
- A model's malformed or unsure answer sends the document to review and the worker goes on; with the
  AI off the rules still classify; the text sent to the model holds no SIREN, e-mail or company name.
- A Mode test document never makes a real deadline or draft.
- The pane shows the documents and the deadlines; a document in review gets its kind and dates from
  a person and then its deadline.
- p95 of the classify job measured on the golden documents (rules; one run with the model).

## Deviations

Recorded in D7 before the code: the output cap (2 000 tokens, reasoning models), a structured
invoice ending `done` rather than `validated`, a réception keyed by its document, a reviewed invoice
without data taken as said. Also:

- `cheapClassify` and `llmClassify` are `classifyByRules` and `askModel` behind one
  `classifyDocument`; the record script asks the model on all 45 documents (`askModel`), so a
  recording still holds when a pattern changes and the model's own score is known.
- The patterns may say nothing, never the wrong kind: a title (0.95) skips the model, so the eval
  asserts no pattern answer is wrong. A generic word (« facture », « devis », « avoir ») counts only
  where a line starts, and the file's name is read apart from the text.
- The date patterns grew two forms found on the golden documents: « du 1er janvier au 31 décembre
  2026 » (a start without its year) and « déclare recevoir les travaux le … ».

2B (2026-10-24):

- The two lists live in `apps/api/src/document-lists.ts`, not in `document-pipeline.ts`: reading
  and settling stay apart.
- Which date each kind needs, and which kinds need a company (`DEADLINE_DATE`, `STANDING_KINDS`),
  moved from `@fi/agents` to `@fi/domain`: the pane's form and the settling ask for the same field
  from one table.
- « Le registre visible dans Excel » of BTP plan §12 is the « Échéances » part of the pane, not a
  sheet the add-in writes: a sheet of deadlines would go stale between two syncs and fight the
  company's own columns. A copy to a sheet, if a pilot asks for one, is `docs/DEFERRED.md` material.
