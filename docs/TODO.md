# TODO.md: left for later, with the owner

Things started and not finished because they need the owner, an account or a machine we do not have
here. Not the same as `docs/DEFERRED.md` (features consciously kept small, each with what brings it
back). Strike a line when done and move its evidence to `docs/PROGRESS.md`.

## OneDrive connector (R4), after the run of 2026-10-22

What a real personal account showed and what is still open: `docs/MICROSOFT365.md`.

- [ ] « Déconnecter OneDrive » on a real account: the token, the subscription at Microsoft, the files
      and their documents gone (proven against the stand-in only). Needs `pnpm dev`, a public tunnel to
      `:4000` and the add-in sideloaded in Excel on the web (`docs/RUNBOOK.md` § OneDrive connector).
- [ ] A work account: a Microsoft 365 tenant with OneDrive for Business and its administrator's consent
      (the app's publisher is unverified). Then TODO(verify) 3 (the picker's `resource`) and 4 (work and
      SharePoint addresses) of `docs/MICROSOFT365.md`, and the 2-minute polling.
- [ ] Excel for Windows and Excel for Mac: nested app authentication (TODO(verify) 2); needs those
      machines.
- [ ] The subscription's renewal against Microsoft (a day before its 3 days end).
- [ ] Before the hosted add-in: its two SPA redirect URIs in the registration
      (`brk-multihub://<domain>`, `https://<domain>/auth.html`; `docs/DEPLOY.md` §2).
- [ ] Entra → Branding & properties: the CGU and privacy URLs, once published.
- [ ] Renew the client secret before **2027-04-20**.
- [ ] The test workbook « Qté.xlsx » in the owner's OneDrive (cell E2 changed 3 → 4 during the test)
      can be deleted.

## Google Drive connector (R5), built against the stand-in on 2026-10-23

- [ ] **The owner registers the Google Cloud project** (`docs/RUNBOOK.md` § Google Drive connector,
      `docs/GOOGLE.md` §7): Drive API, consent screen External with `drive.file` only, an OAuth client
      « Web application » with the redirect `<API_PUBLIC_URL>/connectors/google/callback`; the client id
      and secret into `~/.config/facture-impec/google.env` (600), never the repo.
- [ ] Publish the consent screen « In production » before the first real company (in Testing, refresh
      tokens die after 7 days); Google's basic verification for a non-sensitive scope.
- [ ] On a real Gmail account, then a Workspace one: TODO(verify) 1–6 of `docs/GOOGLE.md` §6 (`state`
      back on the redirect, the Web-application client, `mimetypes=`, `trashed`, notifications under
      `drive.file`, the refresh token surviving), with the API behind a public https tunnel.
- [ ] In real Excel (Windows, Mac, the web): Office opens Google's window (`openBrowserWindow`, or the
      dialog through `redirect.html` on the web). Only the pane's link fallback is proven, in the
      harness E2E.

## Files uploaded (R6), built on 2026-10-23

- [ ] In real Excel (Windows, Mac, the web): the hidden file input of « Importer un fichier » opens the
      system's file chooser inside the task pane (proven in the harness E2E in Chrome only).
- [ ] A Factur-X from a real supplier (not made by our own `toFacturXPdf`), and a UBL from another
      platform, uploaded once: read, the right supplier and number, B2 takes the price.

## Owner decisions

- [ ] **Which plans get the connector.** Now every plan (`docs/DEFERRED.md` › The connector gated by
      plan). The architecture document proposed external connectors from « Croissance »; the review of
      2026-10-22 proposed every plan until the pilot shows how it is used (Graph costs nothing per call,
      20 files per connection). Gating it is a small change plus a test.
- [ ] **Plain PDF invoices (R6).** An uploaded PDF without Factur-X data is refused now
      (`upload_plain_pdf`: « demandez à votre fournisseur sa facture au format Factur-X, UBL ou CII »).
      Reading it would need text extraction or OCR plus a model to find the supplier, number and lines:
      a model reading invoices (pseudonymized? the supplier's names are what it must read), errors to
      explain, a cost per page. The architecture document left it to the owner: keep refusing, or build
      it (`docs/DEFERRED.md` › Reading a plain PDF invoice).
- [ ] **The CGU.** A draft of the connectors' articles (OneDrive; Google Drive since R5; uploaded
      files since R6): `docs/CGU_ONEDRIVE.md` (French). A lawyer reviews it with the rest of the
      CGU; then `TERMS_URL` and a new `TERMS_VERSION`. 

## Google Sheets sidebar (R9), started 2026-10-24

- [ ] Publish the shared add-in and API at public HTTPS addresses, then generate the bound script
      with `pnpm sheets:package --addin https://YOUR-ADDIN/google-sheets.html`.
- [ ] Install in a real personal Google account and a Workspace account; run G1–G5 in
      `docs/GOOGLE_SHEETS.md`. Native-service and browser stand-ins remain separate evidence.
- [ ] Public Marketplace distribution: publisher registration, consent-screen configuration and
      Google's review. A manually installed bound script does not prove Marketplace acceptance.

## Pilot and production, with the owner

What only the owner can provide or decide before real invoices leave (`docs/RUNBOOK.md` § Pilot,
`docs/DEPLOY.md`).

- [ ] A host and a domain for the API and the pane (`docs/DEPLOY.md`); then `API_PUBLIC_URL`,
      `ADDIN_ORIGINS`, and the sealing keys set once and kept: `PDP_KEY_SEALING_KEY`,
      `CONNECTOR_SEALING_KEY`, `AI_KEY_SEALING_KEY` (changing one later means re-entering what it seals).
- [ ] B2Brouter: the account and its sandbox key (`test_…`, T13), then the live key when the first
      company goes live; prices of eDocExchange / eDocSync and the startups programme (T12).
- [ ] A mail provider (`MAIL_SMTP_URL`, `MAIL_FROM`): sign-in links, chasing e-mails, weekly reports.
- [ ] The CGU reviewed by a lawyer (with `docs/CGU_ONEDRIVE.md`), published, then `TERMS_URL` and
      `TERMS_VERSION`.
- [ ] Stripe: the Dashboard setup of `docs/BILLING.md` §11 (meter, prices, webhook, portal, tax,
      restricted key), then its step 9 on the sandbox (Checkout with 4242…, meter event, portal,
      cancellation on deletion).
- [ ] Three pilot companies who agree to work in « Mode test » until they say « go ».
- [ ] The marketing site's publisher identity, address and contact e-mail (legal notice), then its
      production publication.
- [ ] AppSource: the decisions on policies 1100.7 (brand in the name) and 100.4 (payment outside the
      Marketplace), and the store screenshots taken in Excel (`docs/APPSOURCE.md`).
- [ ] An EU bucket with object lock for the ten-year archive copy (`docs/DEFERRED.md` › Object storage).

## B2Brouter sandbox: the open questions of `docs/B2BROUTER.md` §11

Each closes with a call or two on the owner's sandbox key (`docs/RUNBOOK.md` § B2Brouter sandbox,
`FI_LIVE_B2BROUTER_*`); record the answer in §11 and remove the `TODO(verify)` it names in the code.

- [ ] T1 content type of an import · T2 / T17 XML or Factur-X forwarded as is · T3 webhook envelope ·
      T4 directory 200 or 202 and its body · T5 list metadata · T6 `mark_as` body · T9 French
      `document_type_code` list · T10 sending twice · T11 event names · T16 deleting an attachment ·
      T19 Schematron failure on import or on send · T20 the sandbox's path for a French invoice ·
      T21 a second `POST /payments` after a lost answer · T22 what `{account}` is, and whether it
      differs between sandbox and production · T23 a valid key on an account it cannot reach ·
      T24 an imported credit note (381) and its invoice · T25 several payments on one invoice.
- [ ] With staging (`stag_` key and a ticket): T7 how « 213 Rejetée » shows; T14 inbound invoices.
- [ ] With B2Brouter's support: T8 meaning of `allegedly_paid`, `closed`, `expired`…; T15 webhook
      retries, timeout and source addresses; T18 whether 212 (paid) is required.

## AI in production

- [ ] The provider and model for prod (decided 2026-10-20: Mistral; preprod a free OpenRouter model
      on test data only), its key in the server's environment, never the repo.
- [ ] Record the evals on that model and make them gates: `layout`, `mapping` and `monitor` are
      recorded on llmfp only and not gating (`packages/agents/evals/recordings/*`, `"gate": false`).
- [ ] The EU-residency and retention terms of each hosted provider before BYOK is offered
      (`docs/AI_PROVIDERS.md`, `TODO(verify)`).

## Formats: licences and sources (`docs/research/FORMATS.md` §6)

- [ ] F1 the owner fills in the FNFE-MPE form for the Factur-X 1.09.2 XSD, Schematron and spec (it
      needs an e-mail; an agent must not submit it); then F2 (AFRelationship) from the spec.
- [ ] F3 UBL 2.1 XSD licence, F4 the sRGB ICC profile's licence, F5 origin of the BR-FR Schematron,
      F6 the font embedded in generated PDFs: check each licence before a public release.

## VIES (§6), built on 2026-10-24

- [ ] The first check of a real company with its own French VAT number as requester: note the format
      of VIES' consultation number in `docs/ONBOARDING.md` §5.1 and remove the `TODO(verify)` in
      `apps/api/src/vies.ts`.
- [ ] From the prod server, watch the sweep's log for a week: VIES never answering `IP_BLOCKED` or
      `GLOBAL_MAX_CONCURRENT_REQ` to our traffic.
- [ ] « Vérifier dans VIES » (2026-10-24): each click on a number VIES cannot answer asks again (once
      today's answer exists, never). If users click in a loop during an outage, remember the failure
      for a few minutes per number (DEFERRED § VIES, « Remembering that a member state is down »).
- [ ] Look at the fiche with a real answer from a country that gives no name (Germany, Spain): only
      « Valide selon le service européen VIES » shows; check users understand that VIES has no name to
      give, not that the check failed.

## Credit notes (§4), built on 2026-10-24

- [ ] **Owner: does a credit note count in the monthly quota?** Every deposit counts now
      (`recordUsage` in `runSend`), credit notes included. Not counting them is a one-line filter on
      `credit_of` (money: `docs/BILLING.md`).
- [ ] **Accountant:** confirm the path of a refused invoice (credit note, then a new invoice with a
      new number) and of « Abandonner la créance » (wording, and whether it should also propose a
      credit note so the company recovers the VAT on the unpaid amount: `docs/DEFERRED.md`).
- [ ] **B2Brouter T24** (`docs/B2BROUTER.md` §11): does an imported CII of type 381 with its preceding
      invoice become a credit note linked to it on B2Brouter (`is_credit_note`,
      `invoice_references`), and does it follow the same statuses? Then let the credit-note E2E run on
      the live sandbox (`apps/addin/e2e/b2brouter.spec.ts` skips it there).
- [ ] **MonitorAgent prompt:** say in `packages/agents/prompts/monitor.md` that a refused invoice is
      fixed by a credit note and a new invoice, never resent under its number, then record the
      `monitor` eval again (`packages/agents/evals/recordings/`). Until then the pane shows its
      `fix_and_resend` on a refusal as « Corriger : un avoir, puis une nouvelle facture ».

## Percentage discounts, built on 2026-10-24

- [ ] **Mapping eval:** the MappingAgent now sees the field « Remise sur la ligne (en %) » in its
      field list; record `mapping` again (`packages/agents/evals/recordings/`) with a sheet holding a
      « Remise % » column, so the eval scores it. The guard puts a percentage column in the right
      field whatever the model says.

## Instalments, built on 2026-10-24

- [ ] **B2Brouter T25** (`docs/B2BROUTER.md` §11): several `POST /payments` with an `amount` on one
      invoice: does B2Brouter add them up, and does the invoice reach `paid` (212) only once the sum
      reaches its total? What does it do with a payment that would exceed the total? Until then each
      instalment is reported with its amount, and the platform's `paid` is taken as it comes.
- [ ] **Accountant:** the wording of the reminders after an instalment (« Nous avons bien reçu un
      règlement de… ; il reste … à régler ») and of the formal notice, which now demands the balance.
- [ ] **Weekly report:** count the instalments received in the week (`docs/DEFERRED.md` › Instalments).

## Finding an invoice, built on 2026-10-24

- [ ] **Chat eval fixture:** `packages/agents/evals/chat.fixtures.ts` still quotes the old answer to a
      correction of a sent invoice (« établissez une facture rectificative ou un avoir… »); the API now
      says to click « Établir un avoir » on its fiche (`api.error.invoice_sent`). Update the fixture
      and record `chat` again, with the `monitor` and `mapping` recordings above.
- [ ] **Hosted database:** whether `unaccent` can be enabled there, before a pilot asks for searches
      that ignore accents (`docs/DEFERRED.md` › Finding an invoice).

## BTP plan (`docs/DECISIONS.md`), started 2026-10-24

Stages (`docs/plans/phase-N.md` each):

- [x] **0 — vocabulary, tables, boundaries** (`docs/plans/phase-0.md`).
- [ ] **1 — ingest and validate** (1A, the BTP rules where invoices are already checked: done
      2026-10-24; 1B, FileStore, `POST /ingest`, the ingest and validate workers with OCR, the PDP
      adapter, 50 golden documents and a measured p95: done 2026-10-24; 1C, raw e-mail (`.eml`):
      done 2026-10-24). Left: drive folders watched (below), the e-mail provider (owner, D3).
- [x] **2 — documents pipeline** (`docs/plans/phase-2.md`; 2A, classify with its eval, dates and
      SIRENs read, the company linked, deadlines derived, `POST /documents/:id/review`: done
      2026-10-24; 2B, `GET /documents`, `GET /obligations` and the pane's « Documents » tab with
      « Échéances », « À vérifier », « Reçus » and « Déposer un document »: done 2026-10-24).
      Extraction of invoices waits for the owner (below); chantiers come with stage 4; what 2B left
      is in `docs/DEFERRED.md` › The documents in the pane.
- [ ] **3 — watchers and approvals** (`docs/plans/phase-3.md`; 3A, the deadline watchers, the
      requests from `fr.json`, `GET /actions`, `POST /actions/:id/decide`, the queue `action.send`,
      « Ajouter comme fournisseur », `POST /obligations/:id/close`: done 2026-10-24; 3B « À valider »
      in the pane, « C'est fait » on the deadlines: done 2026-10-24). Left: 3C the weekly e-mail's
      links; the Telegram bot waits for the owner (below);
      invoices sent through Facture Impec keep CollectAgent's chasing, not duplicated.
- [ ] **4 — connectors**: the frame and the ERP-export connector (D5); EBP SaaS paused (D3).
- [ ] **5, 6** paused (D3). **7 — observability, performance, runbook, onboarding.**

Owner questions (BTP plan §13 and what stage 0 found):

- [ ] **The first pilots' platform** (Sage, EBP, B2Brouter, another): which PDP adapter comes first.
      B2Brouter's received invoices are already polled (M4) and become documents at stage 1.
- [ ] **EBP SaaS**: a developer account and a test company with BTP data (stage 4).
- [ ] **Batigest**: a pilot's machine for `probe` (stage 5).
- [ ] **Excel on the web or desktop only**: the add-in runs in both already; the plan's question about a
      WebSocket does not arise (the pane asks the API).
- [ ] **Letters**: the pilots' current chasing and « demande d'attestation » letters, or ours.
- [ ] **A model's cost per company**: today a daily token cap per company (`AI_DAILY_TOKENS`,
      `tenantDailyTokens`; reached, the AI waits for the next day and the rules keep working). A
      monthly cap in euros instead, and what the company sees when it is reached?
- [ ] **Reading invoices without XML**: the BTP plan reads a PDF's text or OCR and extracts with a
      model, which answers « Plain PDF invoices (R6) » above with « build it ». Still the owner's:
      the supplier's names are what the model must read, so pseudonymizing hides the answer
      (`docs/RGPD.md` › AI assistance); a model without training on the data, under contract?
- [ ] **Mail ingestion** (D3): a forwarding address (an inbound e-mail provider, a monthly cost) or
      Gmail / Outlook OAuth (`gmail.readonly` is a restricted scope: Google's paid assessment).
- [ ] **Telegram**: the bot's token and name (stage 3); BotFather, in the owner's account, and the
      API's public HTTPS address for its webhook. Until then, decisions come from the pane and e-mail.
- [ ] **Sending actions' e-mails**: the sender domain (SPF, DKIM), with the SMTP of the pilot.
- [ ] **Files' storage**: an object store (S3, encryption at rest, region) when hosting is chosen; the
      bytes stay in Postgres (`blobs`) until then.
- [ ] **How long non-invoice documents stay** (BTP plan §13 RGPD: a retention per company): an
      attestation or a contrat de travail after the sous-traitant or employee left. Today: until the
      account is deleted.
- [ ] **Row-level security per company** (D1): deployment hardening, with the hosting.

Left from stage 1 for later (2026-10-24):

- [ ] **Légifrance, read in a browser**: loi n° 71-584 art. 1 and 2 (the retenue's 5 % of the TTC, its
      release after a year) and C. trav. L8222-1 / D8222-1 (the 5 000 € HT threshold of the
      attestation de vigilance). Both are `TODO(verify)` in `docs/research/BTP_RULES.md`: Légifrance
      answered 403 to WebFetch and curl; a real browser (neo) may pass its Cloudflare check.
- [ ] **Drive folders watched** (BTP plan stage 1 `drive` adapter): a folder picker in the pane, then
      the Graph (`/delta`) and Drive (`changes.list`) change feeds read and recorded with their dates
      before a line of code; today the R4/R5 connections read the files a person picks.
- [ ] **Retenue and situation columns on the sheet** (`docs/DEFERRED.md` › BTP rules): needed before
      BTP-RG-* and BTP-SIT-* speak on the company's own invoices.

Left from stage 2A for later (2026-10-24):

- [ ] **Légifrance, read in a browser**: C. trav. D8222-5 (the attestation de vigilance and the
      extrait K / K bis asked again every six months), the base of the two renewals
      (`packages/agents/src/obligations.ts`, `TODO(verify)`).
- [ ] **ClassifyAgent on the production model**: record `classify` with Mistral once the owner's key
      is there (`pnpm --filter @fi/agents eval:record classify`, `EVAL_GATE=true`), as the other agents.
- [ ] **Real documents**: the first pilot's attestations, Kbis, PV and contracts through the classifier
      and the date patterns, to see where they miss (dates by a model: `docs/DEFERRED.md`).

## Excel on the web E2E

- [ ] A Microsoft account that can upload an add-in in Excel on the web, then
      `apps/addin/e2e/excel-web.spec.ts` run once and its Excel selectors confirmed (`TODO(verify)`).

Left from stage 3A for later (2026-10-24):

- [ ] **Reply-To on CollectAgent's chasing e-mails**: a customer's answer to a reminder reaches our
      sender address, not the company. `Mail.replyTo` exists since 3A (requests use it); the chasing
      mails (`apps/api/src/collect.ts`) should set it to the person who sent the step, or the owner.
- [ ] **The requests' letters read by a pilot**: the six `request.body.*` in `fr.json` (the
      retenue's cites loi n° 71-584 art. 2, `TODO(verify)` with Légifrance above).
