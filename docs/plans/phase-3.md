# BTP plan — stage 3: the deadlines watched, the requests a person approves (2026-10-24)

BTP plan §12 stage 3 (`WatcherGraph`, `ActionGraph`, queues `watch` / `action` / `notify`, the
Telegram bot, the e-mail digest, `POST /actions/:id/decide`), with §7, §8 and §10, adapted by
`docs/DECISIONS.md` D1–D8. Stage 2 leaves open deadlines (`obligations`) and `confirmer_tiers`
drafts. Three series of commits, each with `pnpm verify` green:

## 3A — watchers, decisions, sending (the back end)

| What | Where |
|---|---|
| `draftRequest`: the e-mail of each action kind from `fr.json` templates (the company, the recipient, the date, the amount, the document), Mode test prefixed | `packages/agents/src/requests.ts`, fr.json `request.*` |
| `runWatchers`: open deadlines in their horizon → one draft each, keyed `<kind>:<deadline>:<date>`; a moved or closed deadline withdraws its draft; a snoozed draft whose day came is a draft again; a claim that never finished goes back to a draft | `apps/api/src/watchers.ts`, on the chasing timer (`workers.ts`) |
| `GET /actions?status=&test=`: the drafts with what they will send, to whom, for which deadline and document | `apps/api/src/actions.ts`, `app.ts` |
| `POST /actions/:id/decide`: approve, reject, edit (text, address), snooze; the revision checked; one audit event; approve queues `action.send` | same, `jobs.ts` |
| `confirmer_tiers` approved: the supplier added from the directory, its deadlines and documents linked | same |
| `action.send`: claimed, checked (the deadline still open and on the same date, an address), e-mailed, `sent`; Mode test sends nothing | `apps/api/src/actions.ts`, `workers.ts` (queue and sweep) |
| `POST /obligations/:id/close` (`done` or `dismissed`): the deadline closed, its drafts withdrawn | `apps/api/src/actions.ts`, `app.ts` |
| `ApprovalDecision.to` (with `edit`) | `packages/domain/src/approval.ts` |

## 3B — « À valider » in the pane

| What | Where |
|---|---|
| « À valider » first in the « Documents » tab: each draft with its recipient, subject and text; « Envoyer », « Modifier », « Plus tard », « Ignorer »; a new company: « Ajouter comme fournisseur » | `apps/addin/src/ui/DocumentsView.tsx` (or its own file), `controller.ts`, `api.ts`, fr.json |
| « C'est fait » and « Ignorer » on each deadline | same |

## 3C — the drafts in the weekly e-mail, decided by a link

| What | Where |
|---|---|
| The weekly report lists the drafts waiting, each with « Envoyer » and « Ignorer » links | `apps/api/src/report.ts`, `@fi/agents` weekly report, fr.json |
| A link = a single-use token (SHA-256 stored), 7 days, bound to the draft's revision and the person; GET shows a page with one button, POST decides with `channel: 'email'` | `apps/api/src/action-links.ts`, `packages/db` (table `action_links`, migration) |

## Not in stage 3 (and where it goes)

- **Telegram** and **WhatsApp**: paused (D3, D8): the owner's bot token and a public address.
- **Instant e-mail alerts** for an error-level problem: the weekly report and the pane first
  (`docs/DEFERRED.md`).
- **A reminder cadence for document invoices** (courtesy before, firm after): one reminder after the
  due date; CollectAgent's cadence covers invoices sent through Facture Impec.
- **`tva_declaration`, `situation_echeance`, `contrat_fin`**: no deadline of these kinds exists yet.
- **A model rewriting a draft** (`revise`): the person writes in « Modifier ».
- **Moving the older decisions** (chasing drafts, received invoices) into « À valider » (D5).

## Definition of done (BTP plan §12 and §11, adapted)

- The integration test of §12 on the e-mail channel: a deadline in its horizon → a draft → a
  decision (the pane's route and the e-mailed link) → the job → the check → one e-mail; a second
  approval, the same link twice, or the job run twice send no second e-mail.
- A watcher run twice makes one draft; a newer attestation withdraws the draft for the older date;
  « C'est fait » withdraws it; a snoozed draft comes back on its day.
- An answer to an older revision, to another company's action or to an action already decided is
  refused in plain French; every decision writes an audit event.
- Mode test never e-mails anyone outside the company.
- The pane shows the drafts and decides them; the deadlines can be closed from it.

## Deviations found while building

- **3A (2026-10-24)**: a request goes only to the right side: an attestation, a Kbis or an insurance
  to a supplier, a retenue or an invoice reminder to a customer (a PV de réception naming a
  sous-traitant would otherwise ask it for a retenue the company holds). Approving « confirmer_tiers »
  refuses a company the directory says is closed or a duplicate (`supplier_closed`,
  `supplier_duplicate`), as « Clients » does for customers, and drafts the new supplier's requests at once rather than at
  the next run. The withdrawal reasons are
  `deadline_moved`, `deadline_done`, `deadline_dismissed`, `deadline_gone`, in `comment`.
