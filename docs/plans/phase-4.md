# BTP plan — stage 4: the connector frame and the ERP exports (2026-10-24)

BTP plan §12 stage 4 (`connectors/ebp-saas`, queue `sync-erp`, the shared mapping, `connector_sync`)
with §9, adapted by `docs/DECISIONS.md` D3, D5 and D9. EBP SaaS waits for a developer account and a
test company (D3), so the frame is built and tested with a connector that reads the exports every
ERP can make (D5): Batigest and EBP list their clients, suppliers, chantiers and invoices to Excel
or CSV. Three series of commits, each with `pnpm verify` green:

## 4A — the frame, and companies and chantiers from an export

| What | Where |
|---|---|
| `Connector` (`id`, `probe`, `pull(cfg, cursor)` → batches of 500 rows of one entity, each with the cursor reached), `ErpBatch`, `Cursor`, the entities `tiers`, `chantier`, `facture`, `situation`, `reglement` | `packages/connectors/src/types.ts` (new package `@fi/connectors`: core and domain only, no server code) |
| The export connector: a `.xlsx` or `.csv` read by `@fi/core`'s reader, the header row found, each column recognised by its French labels, the list it holds guessed from them (or said by the person); a required column missing is a `FatalError` that names it; its cursor is the file's SHA-256 and the row reached | `packages/connectors/src/export/` |
| One Zod schema per entity row (a SIREN with its check digit, a SIRET's SIREN, an e-mail, a date, a percentage), before any mapping | `packages/connectors/src/schemas.ts` |
| The shared mapping: a `tiers` row → a company (key SIREN; the ERP's code in `erp_ref`; what a person set is never overwritten, the ERP fills what is empty); a `chantier` row → a chantier (key `erp_ref`, its customer by the ERP's code or SIREN, its réception and retenue) | `packages/connectors/src/mapping.ts` |
| `POST /erp/imports?name=&list=`: the file kept in the FileStore, the sync row per list (`connector_syncs`: `export:customers`, `export:suppliers`, `export:chantiers`), one job `erp.sync` per company and list; `GET /erp`: each list's last import and what it did | `apps/api/src/erp.ts`, `jobs.ts`, `app.ts` |
| `erp.sync`: reads from the cursor, applies each batch with its cursor in one transaction, three tries a minute apart; a fatal error stops at once and says why. A file already imported does nothing | same |
| The import's result: added, updated, unchanged, skipped (and why: no SIREN, a particulier, no code), the first rows skipped by name | `connector_syncs.result_json` (migration) |

## 4B — invoices and payments from an export, and the order of sources

| What | Where |
|---|---|
| A `facture` or `situation` row → a document `source: 'erp'` (its record as the structured payload), the usual path: its party, its chantier by the ERP's code, its deadline `facture_echeance` by the same key as the PDP's and the mail's | `apps/api/src/erp.ts`, `ingest.ts`, `document-pipeline.ts` |
| Sources in order PDP > ERP > e-mail: a deadline keeps the values of its best source; a worse one never moves them, a better one does | `saveObligations` and a test of §12's DoD (the same invoice from the PDP and from the ERP) |
| A `reglement` row → the invoice's deadline closed (`done`) by its number | `apps/api/src/erp.ts` |

## 4C — the pane

| What | Where |
|---|---|
| « Votre logiciel de gestion » in Paramètres: how to export from Batigest or EBP, a file to give, the list it holds (guessed, can be changed), the last import of each list and what it did, the rows skipped and why | `apps/addin/src/ui/`, `controller.ts`, `api.ts`, fr.json |
| The chantiers in the « Documents » tab: a document's chantier, the deadlines of a chantier | same |

## Not in stage 4 (and where it goes)

- **EBP SaaS** (OAuth per company, its API's cursor): paused (D3) until a developer account and a
  test company exist. The frame is the one it will use.
- **Batigest SQL, `bridge-win`, EBP local, Onaya**: stages 5 and 6, paused (D3).
- **A column the person maps by hand** when its label is not recognised: the import says which
  column it needs; the mapping screen comes when a pilot's export shows it is needed
  (`docs/DEFERRED.md`).
- **ERP companies checked in the directory**: a company imported from an ERP is not looked up in
  SIRENE (a list of 500 is minutes of the directory's limit); it is when it is invoiced, as today.

## Definition of done (BTP plan §12, adapted by D3)

- An export of clients, suppliers and chantiers gives the companies and chantiers it lists, once:
  the same file twice changes nothing, a newer file updates what changed; another company's data is
  never touched.
- A file stopped in the middle (a crash, a retry) goes on from its cursor and ends with the same
  result as a run without a stop.
- A file without a required column says which, in plain French, and changes nothing.
- The same invoice from the PDP and from the ERP makes one deadline with the PDP's values, whichever
  arrived first (§12 « конфликт PDP vs ERP решается по приоритету в тесте »).
- `pull` by cursor on an EBP test account: paused with EBP SaaS (D3).

## Deviations found while building

- **4B, a deadline's rank comes from its document** (D9): no `obligations.source` column; the rank
  is read through `source_document_id` → `documents.source` in `saveObligations`, so every path
  (PDP, ERP, e-mail) is ordered without a migration.
- **4B, an ERP's invoice record goes with the account**: kind `facture_vente`, it would have been
  kept ten years by the erasure as a real invoice; the invoice is the ERP's, Facture Impec holds a
  copy. `apps/api/src/rgpd.ts` deletes documents `source: 'erp'` (`docs/RGPD.md`).
- **4B, invoice numbers kept as written**: the SIREN reader drops dots and uppercases; numbers have
  their own reader (`numberOf`), an Excel number cell read as its integer.
- **4B, an invoice sent through Facture Impec is skipped** (`sent_here`), as row and as payment: its
  deadline and its payment are the platform's (`docs/DEFERRED.md`).
- **4B, payments are not summed**: a payment closes a deadline when it covers what is left; the rest
  waits for a pilot's export (`docs/DEFERRED.md`).
- **4C, the vocabulary of lists and skip reasons in `@fi/domain`**: the add-in may import only
  `core`, `shared` and `domain` (`scripts/boundaries/rules.ts`); `@fi/connectors` re-exports them.
- **4C, the section in Réglages for every company**, not only BTP ones: an ERP's customers and
  invoices help any company's reminders. The plan's « Paramètres » is the pane's « Réglages ».
- **4C, export instructions kept generic**: the menus of Batigest and EBP are not documented where
  we can read them; « affichez les colonnes utiles… exportez au format Excel ou CSV », and the real
  menus written with the first pilot (`TODO(verify)`, `docs/TODO.md`).
- **4C, deadlines narrowed by chantier on the client**: the pane already holds the deadlines of the
  horizon; a `?chantier=` filter and a chantier page wait for a pilot with many (`docs/DEFERRED.md`).
