# Memory doc — stages M0–M6: the vault, recall, links, the runner, the relay, rules, prepare (2026-10-25)

The owner's memory document (private, 2026-10-24; "memory doc §N"), adapted by `docs/DECISIONS.md`
D12. It comes between BTP stages 4 and 5. Each stage is one series of commits on `dev`, its criteria
in `docs/PROGRESS.md` before the code and its evidence after, `pnpm verify` green, then promoted.
What needs the owner or a pilot goes to `docs/TODO.md` › Memory; what is consciously smaller, to
`docs/DEFERRED.md` › Memory.

## The vault (memory doc §3–§4)

A folder a person can open in Obsidian or the Explorer and read without the app:

```
index.md                 root: the sections, what each holds, how many pages (code)
tiers/ chantiers/ finances/ juridique/ catalogue/ rh/   sections; rh/ off unless the company turns it on
  index.md               one line per page: name · type · one fact · updated (code)
  <slug>.md              one page per company, chantier, document, article, person
raw/YYYY/MM/<file>       originals, and <file>.txt beside each: the text read from it (append only)
log.md                   one line per write, append only
open-questions.md        what the agent did not find or is unsure of; closed by a person or a document
_schema.md               the page types, their keys and required fields, the schema's version (code)
_conflicts/              a Drive conflict copy, moved here, never chosen by the agent
_system/                 the runner's lock, the compile journal, the database's daily dumps
```

A page: YAML frontmatter that only code writes (a Zod schema per type), a text a model may write in
short paragraphs each naming its source, and a `## Liens` section code writes from the links. The
types reuse `@fi/domain`'s document kinds; a company (`tiers`) has roles (client, fournisseur,
sous-traitant) rather than three types.

## M0 — vault and schema

| What | Where |
|---|---|
| Page types and their frontmatter schemas, `_schema.md` written from them, stable slugs | `packages/memory/src/types.ts`, `slug.ts` (new package `@fi/memory`) |
| A page read and written: YAML frontmatter, text, `## Liens` | `packages/memory/src/page.ts` |
| `compile(vault, patch)`: every frontmatter checked, every source present, each file written to `.tmp` then renamed, a journal so a crash leaves the patch whole or absent; links written both ways; section and root `index.md`; `log.md` | `packages/memory/src/compile.ts`, `journal.ts`, `indexes.ts` |
| `rebuild(vault)`: every page read again, the indexes rewritten, an invalid page put in `open-questions.md` | `packages/memory/src/rebuild.ts` |
| A person's edit (`user_edit`): read, checked, indexed; a person's edit wins over an agent's patch on the same page within a minute | `packages/memory/src/watch.ts` |
| The vault's single writer: a lock file with the host and a time to live | `packages/memory/src/lock.ts` |

Done when: 1 000 synthetic pages rebuild in under 60 s; a process killed (`SIGKILL`) in the middle of
compile never leaves a damaged file, and the patch is all there or not at all after recovery; an
invalid frontmatter is refused, the whole patch with it.

## M1 — index and recall

| What | Where |
|---|---|
| Tables `memory_pages` (facts, folded text for full-text), `memory_links`, `memory_questions`; loaded by compile and by rebuild | `packages/db` (migration), `packages/memory/src/store.ts` |
| `recall`: 1 a key, 2 links one or two steps away, 3 full-text in the section, 4 in the whole wiki, 5 in `raw/*.txt` (a hit there writes the fact back to its page), 6 « nothing » with what was searched and an open question; `mustBeExhaustive` looks for a contradicting page before an outward action; level and time logged | `packages/memory/src/recall.ts` |
| A demo vault (30 companies, 5 chantiers, 200 documents) made by a seeded generator, and 100 golden questions | `fixtures/vault-demo/`, `scripts/vault-demo.ts`, `packages/memory/src/recall.golden.test.ts` |

Done when: ≥ 80 % of the golden questions answered at levels 1–2, none « not found » wrongly, each
level within its time budget.

## M2 — links between documents

| What | Where |
|---|---|
| Link rules: exact (an identifier in the document: BT-11 chantier, BT-13 order, a quote's number), strong (same company, amount within 2 %, dates within 30 days; an article by supplier code or name), inferred (a model's, with its quote: never feeds `prepare`, a person confirms it once and it becomes strong) | `packages/memory/src/link-rules.ts` |
| Lint: a link without its reverse, a link without a source | `packages/memory/src/lint.ts` |

Done when: on the demo vault's chains (quote → invoice, purchase → sale) ≥ 90 % are exact or strong
and the rest marked inferred. The memory doc's « 50 real chains » need a pilot (TODO).

## M3 — the runner

| What | Where |
|---|---|
| `apps/api` in runner mode: localhost only, PGlite in a data folder outside the vault, the vault's lock, the schedules caught up after a stop (each one's last run kept, a missed one run once), the database dumped into `_system/` daily (7 kept) | `apps/api/src/runner.ts`, `runtime.ts`, `@fi/shared` env |
| Mode B: a Docker image with the vault as a volume | `deploy/runner/` |

Done when: stopped for 30 hours (a test clock) and started again, every schedule runs once and no
document is left without a status. The memory doc's 48 hours on a machine switched off and on, and
the Windows service, need a Windows machine (TODO).

## M4 — the relay and the channels

| What | Where |
|---|---|
| `apps/relay`: no business data; a licence's public key, a chat bound to a runner, the answers to buttons kept 7 days until the runner fetches them. The runner pulls (it sits behind the company's router); each button carries a token the runner signed for that action and revision, so the relay can neither invent an action nor change one | `apps/relay` (new) |
| Telegram through the relay, tested with a stand-in bot; the add-in pointed at the runner on localhost | `apps/relay`, `apps/addin` settings |

Done when: an approval pressed while the runner is off reaches it when it comes back (within 7
days), and a forged or replayed token is refused. Telegram itself stays paused (D3).

## M5 — rules and lint

| What | Where |
|---|---|
| The rule catalogue: each rule a detect by code, a draft kind, a default autonomy (notify, propose, prepare; execute only for internal actions), a cooldown per rule and entity, its legal source; CollectAgent, the D8 watchers and BTP-AUTOLIQ-01 listed in it; `rule_runs` | `packages/agents/src/rules/` |
| v1 rules not yet built: quote accepted and not invoiced, situation due, purchase not re-billed, price increase, margin below the company's threshold, cash forecast, VAT return due, sous-traitant without documents | same |
| Lint of the memory: contradictions between pages, pages without sources, one-sided links, stale indexes, a dated page without its deadline, a fact found at levels 4–5 three times; each finding a fix a person approves | `packages/memory/src/lint.ts` |
| The weekly report's completeness block: documents received and filed, rules run of rules due, open questions (blocking ones), memory fixes waiting | `apps/api/src/report.ts`, `@fi/agents` report |

Done when: each rule has a « fires / does not fire » test; lint finds the 20 defects planted in a
copy of the demo vault.

## M6 — prepare

| What | Where |
|---|---|
| An invoice from an accepted quote's lines, a situation n+1 from n and the ERP's progress: amounts, VAT, retenue and autoliquidation by code, the validator before anything is shown, a model only for the covering text (or a template) | `packages/agents/src/prepare.ts`, `apps/api` |

Done when: 20 demo quotes give 20 valid invoices without an amount touched; two runs give the same
frontmatter byte for byte.

## Not in these stages (and where it goes)

- Every business table rebuilt from the vault: D12, `docs/DEFERRED.md`.
- A model choosing among recall's candidates, vectors: when the golden set shows code alone misses.
- The owner's open questions (memory doc §12): `docs/TODO.md` › Memory.
