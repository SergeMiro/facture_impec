# B2Brouter API: verified facts for Facture Impec

Research date: **2026-10-17**. API version documented at that date: **2026-06-26**.
Re-read on **2026-10-18** while writing the adapter (M4), against the same OpenAPI file (S1): the
`POST /payments` body, `GET /invoices/{id}/as/original`, list and event paging. What the adapter
does with all this is §3.4; nothing has been run against the real API yet (§11).

This file is the only source of truth about B2Brouter for `packages/pdp-adapter`. Business code
sees only `PdpAdapter`. Anything not in this file is unknown: implement it against `apps/mock-pdp`
and add a `TODO(verify)` (see §11).

## How to read this file

- **verified**: stated in B2Brouter's official documentation, its published OpenAPI files, or an
  official government page.
- **inferred**: taken from a blog, an SDK, a third party, or reasoned from verified facts. Do not
  build on it without checking.
- **our decision**: a design choice for Facture Impec. It is not a fact about B2Brouter.
- Each tag looks like `[verified, S1, 2026-10-17]`, where `S1` points to the source list below.
  In tables, the source and status sit in their own column, and the check date is
  2026-10-17 for every row.
- **How this was gathered.** Every fact comes from plain HTTP fetches (`curl`) of public pages and
  files. No local browser was used. One attempt to start a Browserbase cloud session failed with
  HTTP 402 (plan quota), so **no fact in this file was obtained with a browser** (no
  `browser: cloud` facts), and no session was left open.
- **Not tested live.** No account was created, no form was submitted, and no API key was used.
  Nothing here has been run against the real API yet. Behaviour that only a call can show is
  listed in §11.

## 0. Sources

| ID | URL | What it is |
|---|---|---|
| S1 | https://b2brouter.readme.io/openapi/b2brouter-api.yaml (same file versioned at https://app.b2brouter.net/api/v20260626/bundled/openapi.yaml) | Official OpenAPI 3.0.1 spec, `info.version` 2026-06-26 |
| S2 | https://b2brouter.readme.io/openapi/webhooks.yaml | Official webhooks spec (OpenAPI 3.1.0) |
| S3 | https://docs.b2brouter.net/en/developers/testing/environments/ | Environments guide |
| S4 | https://docs.b2brouter.net/en/developers/testing/sandbox/ | Sandbox guide |
| S5 | https://docs.b2brouter.net/en/developers/start-using-our-api/introduction/ | Auth, versioning, rate limits |
| S6 | https://docs.b2brouter.net/en/developers/start-using-our-api/get-started/ | Get started (keys, going to production) |
| S7 | https://docs.b2brouter.net/en/developers/essential-guides/error-codes/ | Error codes |
| S8 | https://docs.b2brouter.net/en/developers/essential-guides/webhooks/ | Webhook signature guide (last updated 2026-09-23) |
| S9 | https://docs.b2brouter.net/en/developers/essential-guides/b2brouter-directory/ | Directory guide |
| S10 | https://docs.b2brouter.net/en/developers/essential-guides/transaction/ | What is billable |
| S11 | https://docs.b2brouter.net/en/developers/essential-guides/account/ | Accounts API and subscriptions |
| S12 | https://docs.b2brouter.net/en/developers/essential-guides/download-invoice/ | Download invoices |
| S13 | https://docs.b2brouter.net/en/developers/essential-guides/invoices-attachments/ | Attachments |
| S14 | https://docs.b2brouter.net/en/developers/guides-by-country/france/dgfip-e-invoicing-and-e-reporting/ | France: DGFiP e-invoicing and e-reporting |
| S15 | https://docs.b2brouter.net/en/developers/guides-by-country/france/fr-supported-use-cases/ | France: supported use cases (last updated 2026-10-13) |
| S16 | https://docs.b2brouter.net/en/developers/common-use-cases/send-invoices-end-to-end/ | Send invoices end to end |
| S17 | https://docs.b2brouter.net/en/developers/common-use-cases/receive-integrate-and-manage-received-invoices/ | Receive invoices |
| S18 | https://docs.b2brouter.net/en/developers/changelog/v2026-06-26/ and https://docs.b2brouter.net/en/developers/changelog/v2026-04-20/ | Changelogs |
| S19 | https://docs.b2brouter.net/en/developers/start-using-our-api/sdks/ and https://github.com/B2Brouter/b2brouter-php | SDK page; PHP SDK source code (behaviour = **inferred**) |
| S20 | https://www.impots.gouv.fr/je-consulte-la-liste-des-plateformes-agreees (page modified 2026-10-13) and its spreadsheet `.../listes_plateformes_agreees/liste_pa_attente_rapport_audit.xlsx` | DGFiP list of registered platforms (PA) |
| S21 | https://www.b2brouter.net/fr/tarifs/ | Web-app plans and prices |
| S22 | https://www.b2brouter.net/fr/tarification-des-produits-integres/ and https://www.b2brouter.net/global/pricing-integrated-products/ | Pricing for integrated products (eDocExchange / eDocSync) |
| S23 | https://developer.b2brouter.net/llms.txt and https://b2brouter.readme.io/.well-known/api-catalog | Developer index; API catalogue that points to S1/S2 |
| S24 | https://docs.b2brouter.net/_llms-txt/developers.txt | All developer guides as one text file (the copy used to read S3–S18) |
| S25 | https://docs.b2brouter.net/_llms-txt/trust-center.txt | Trust center (certifications, B2Brouter's own statement) |

S24 bundles S3–S18, so a fact tagged `S14` can also be found in S24.

## 1. Environments, base URLs and how to get credentials

| Env | Base URL | Key prefix | How a developer gets a key | Source |
|---|---|---|---|---|
| **Sandbox** | `https://api.b2brouter.net` (**same as production**) | `test_` | Self-service. Free, immediate, **no support ticket** (steps below). | verified S3, S4, S6 |
| **Staging** | `https://api-staging.b2brouter.net` | `stag_` | Register at https://app-staging.b2brouter.net/en/register, then **open a support ticket** to get API permissions. | verified S3, S7, S17 |
| **Production** | `https://api.b2brouter.net` | `prod_` (older keys have no prefix) | Production account plus a paid **eDocExchange** (monthly, priced by volume) or **eDocSync** subscription (§9). | verified S3, S6, S11 |

**Getting a sandbox key, step by step** [verified, S4 + S6, 2026-10-17]:

1. Register a user at `https://app.b2brouter.net` (the production web app; sandboxes live inside it),
   then set up the company account on the free **Basic** plan.
2. Click **Developers** (the lightning-bolt icon).
3. Click **Create Sandbox** and give it a name. You can have at most **5 sandboxes per account /
   integration group**.
4. The sandbox API key starts with `test_`. That prefix alone sends every request to the sandbox.
   No other URL is needed.

This is a manual step for the **owner**. No agent should do it (no accounts, no credentials).

**What the sandbox does** [verified, S3 + S4, 2026-10-17]:

- It is isolated, free, and **all eDocExchange features are available whatever your real
  subscription**. Usage does not count against the production quota.
- Outbound sends (email, Peppol, tax authority) are **simulated**. Documents move through their
  lifecycle without contacting any real system. **Webhooks are fired.**
- The default path is `draft → sent → registered`. Three test contacts exist, all on scheme 0088
  (GLN):
  - `9508397101047`: `sent → registered`
  - `9506215594996`: `sent → registered → refused`
  - `9500047420799`: `sent → error`, with error `PEPPOL_NO_RECEIVER`
- A full lifecycle (accepted, refused, rejected, error) is simulated **only for Peppol invoices**.
  Other channels just end in `sent`.
- **Not simulated yet:** receiving inbound documents, order responses, and response files from tax
  authorities. Inbound flows **cannot be tested in the sandbox**.
- DGFiP Annuaire writes are simulated, but SIREN and SIRET checksums are still validated [S14].

**What staging does** [verified, S3 + S14, 2026-10-17]:

- Staging is a full stack with its own database, connected to the **DGFiP QAS** (qualification)
  environment.
- Real SIRENs are refused there. Use fictitious ones from the Chorus Pro QAS "matelas de données",
  which is free and takes about 5 minutes, or ask support for a pre-assigned set.
- The eDocExchange subscription is simulated in staging.

**Keys and accounts are not shared between environments** [verified, S6 + S14, 2026-10-17]. A key
from one environment returns 401 in another [S7].

**Things to note:**

- The OpenAPI `servers` list contains only staging (labelled "Test server") and production
  [verified, S1]. Most guide examples call `api-staging`.
- The "production pilot" option in the DGFiP guide **ended on 2026-09-01** [verified, S14].
- The sandbox **also accepts the key as an `api_key` query parameter** [verified, S4]. We do not
  use it, because keys must not appear in URLs or logs [our decision].

**For our config** [our decision]:

- Default `B2BROUTER_BASE_URL` to `https://api.b2brouter.net`.
- Work out the environment from the key prefix (`test_` / `stag_` / `prod_`), and refuse to start
  when the prefix does not match the configured URL (a `stag_` key needs `api-staging`).
- `FI_ENV=sandbox` must only accept `test_` keys.

## 2. Authentication and versioning

- **API key in a header:** `X-B2B-API-Key: <key>` (OpenAPI security scheme `api_key`). There is
  **no OAuth2**. [verified, S1 + S5 + S7, 2026-10-17]
- **Version header (optional):** `X-B2B-API-Version: YYYY-MM-DD`.
  - The current version is `2026-06-26`. Other published versions: 2026-04-20, 2026-03-02,
    2025-10-13 and the legacy 2025-01-01.
  - Without the header, the integration group's default version applies.
  - [verified, S1 + S5 + S18, 2026-10-17]
  - **We always send it, pinned to `2026-06-26`** [our decision].
- **Version must match the host.** Version 2025-01-01 lives on `app.b2brouter.net` /
  `app-staging.b2brouter.net`. Every version from 2025-10-13 on uses `api.b2brouter.net` /
  `api-staging.b2brouter.net`. A mismatch returns 400 `api_version_subdomain_mismatch`.
  [verified, S7, 2026-10-17]
- **Key scope:**
  - One standard key per **integration group**, with full access to **all accounts in the group**.
  - Restricted keys can be set to None, Reading or Writing per section. Missing permission
    returns 401.
  - [verified, S5 + S6, 2026-10-17]
- **Account id:** it goes in the path only for `/accounts/{account}/...` endpoints. Invoice-level
  endpoints are flat (`/invoices/{id}...`). [verified, S1 + S17, 2026-10-17]
- **Auth errors:**
  - 401: `unauthorized`, `missing_api_key`, `invalid_api_key`, `expired_api_key`.
  - 403: `no_account_group`, meaning the key is valid but has no permissions. Staging needs a
    ticket; sandbox permissions are automatic.
  - [verified, S7, 2026-10-17]
- **Tracing:**
  - Every logged response carries the header `X-B2B-API-Request-Id`.
  - Error bodies also carry a `request_log_url`.
  - Log both [verified, S7, 2026-10-17].
- **Error body:** `{"error": {"code", "message", "param", "type", "request_log_url"}}`
  [verified, S7, 2026-10-17].
  - A 404 from the directory has been shown as `{"error": "Not found"}` (a plain string).
  - 429 has **no** `code`.
  - Parse errors defensively.

## 3. Endpoints

Paths are relative to the base URL. "Wrapper" means the JSON object around the resource.

### 3.1 Table

| Purpose | Method and path | Request essentials | Success response | Source (2026-10-17) |
|---|---|---|---|---|
| Create from JSON | `POST /accounts/{account}/invoices` | `{"invoice": {...}, "send_after_import"?, "issue_after_import"?, "ack"?}`. **The flags sit beside `invoice`, not inside it.** | 201 `{"invoice": InvoiceResponse}`. Errors 400/401/403/422. | verified S1 |
| **Import a raw file** (UBL, CII, Factur-X) | `POST /accounts/{account}/invoices/import` | The raw file is the body (OpenAPI: `application/octet-stream`). Query: `send_after_import`, `issue_after_import`, `issued`, `ack`, `transport_type_code_for_contact`, `document_type_code_for_contact`. | 201 `{"invoice": InvoiceResponse}`. Errors 401/403/406. | verified S1 (Content-Type conflict: §5, §11) |
| Bulk import (asynchronous) | `POST /accounts/{account}/invoices/imports` | multipart `files[]` (1–100 XML files), plus `from_net`, `issued`, `validate`, `keep_original`, `send_after_import`, `issue_after_import` | 202 with batch id, `status`, `status_url` | verified S1 |
| Bulk import status | `GET /accounts/{account}/invoices/imports/{id}` | — | 200 with `results[]`, each `{index, status, invoice_id, error_message}` | verified S1 |
| Send an existing invoice | `POST /invoices/send_invoice/{id}` | — | **204** no body. Errors 403/422. | verified S1 |
| Get one invoice (current state) | `GET /invoices/{id}` | `include=lines` (and other includes) | 200 `{"invoice": InvoiceResponse}`. **302 with `Location`** when the id is a received invoice. | verified S1, S17 |
| Update / delete | `PUT /invoices/{id}`, `DELETE /invoices/{id}` | — | Both return 422 once the invoice is sent; correct it with a credit note | verified S1, S14 |
| List invoices | `GET /accounts/{account}/invoices` | See §6 for paging and filters | 200 `{"invoices": [InvoiceReduced], "meta": {total_count, offset, limit}}` | verified S1 (the guide shows another shape: §11) |
| **Status history** | `GET /accounts/{account}/events` | `invoice_id`, `tax_report_id`, `date_from`, `date_to`, `offset`, `limit` | 200 `{"events": [InvoiceEvent \| ContactEvent], "meta"}`. An event is `{name, text, notes, created_at, updated_at}`; an invoice event adds `invoice{id, number, state, state_updated_at}`. | verified S1 |
| Network and tax-authority responses (CDAR, Peppol) | `GET /invoices/{id}/responses` | — (not paginated) | 200 `{"responses": [{event_name, source, received_at, attachment{download_url} \| null}]}`. Example `event_name`: `notification_c4_state_refused`. `source` is `network` or a tax-authority transport code such as `fr.dgfip`. | verified S1 |
| **Download XML / PDF** | `GET /invoices/{id}/as/{document_type_code}` | `disposition=inline` (PDF only) | The file | verified S1, S12 |
| Switch state | `POST /invoices/{id}/mark_as` | `state`, `reason`, `reason_code`, `dispute`, `amount`, `amount_code`, `commit` | 200 `{"invoice"}` per OpenAPI. The receive guide shows **204** (§11). | verified S1, S14, S17 |
| Acknowledge a received invoice | `POST /invoices/{id}/ack` | — | Acknowledged invoices drop out of `ack=false` listings | verified S1, S17 |
| Attach our PDF | `POST /invoices/{id}/add_attachment?filename=...&use_as_pdf_view=true` | raw bytes (`application/octet-stream`) | — | verified S1, S13 |
| Attach several files | `POST /invoices/{id}/add_attachments` | a ZIP | — | verified S1 |
| **Directory / SIREN lookup** | `GET /directory/{country}/{scheme}/{id}`, also `/directory/{scheme}/{id}` and `/directory/{country}/{id}` | France: `GET /directory/fr/0002/{siren}` (also 0009 = SIRET, 0225 = Peppol FR) | Asynchronous: 202 then poll, until 200 / 404 / 422 / 424 (§3.3) | verified S1, S9, S14 |
| **Webhook registration** | `GET`/`POST /web_hooks`, `GET`/`PATCH`/`DELETE /web_hooks/{id}` | `{"web_hook": {url, description, enabled, events[]}}` | `signing_secret` appears **only in the creation response** | verified S1 |
| Validate a file | `POST /documents/validate` | The file. Runs XSD and Schematron for UBL, CII, Peppol BIS, Factur-X, ZUGFeRD, XRechnung and others. | Validation report | verified S1 |
| Validate a stored invoice | `GET /invoices/{id}/validate` | — | Validation report | verified S1 |
| Code lists | `GET /document_types`, `/transport_types`, `/invoice_states`, `/schemes` | — | Lists | verified S1 |
| Accounts | `GET /accounts`, `POST /accounts` and others | `POST` works with **eDocSync only**. With eDocExchange, accounts are created in the web app. | — | verified S1, S11 |
| DGFiP setting | `/accounts/{account}/tax_report_settings` (code `dgfip`) | Turning it on publishes the company's SIREN/SIRET in the PPF Annuaire | — | verified S1, S14 |
| Record a payment | `POST /accounts/{account}/payments` | `{"payment": {"invoice_id", "amount" \| "full": true}}`, exactly one of the two; `amount` in euros. Needs API version ≥ 2026-03-02 | 201 (checked 2026-10-18) | verified S1, S18 |
| Original file | `GET /invoices/{id}/as/original` | — | The file as it was imported, byte for byte; not a billable transformation (checked 2026-10-18) | verified S1, S10 |

### 3.2 Mapping to `PdpAdapter`

All of this is [our decision], built on the verified facts above.

- **The interface has no account (tenant) parameter, but B2Brouter needs one.**
  - B2Brouter creates **one account per SIREN** [verified, S14]. Create, list, import and events
    all take `{account}` in the path.
  - Build one adapter instance per customer account, or add `accountId` to the inputs.
- **`sendInvoice({xml, format, pdf?, idempotencyKey})`** uses three calls:
  1. `POST /accounts/{account}/invoices/import` with `send_after_import=false`. This returns
     `invoice.id`, which becomes `pdpRef`.
  2. If `pdf` is set: `POST /invoices/{id}/add_attachment?use_as_pdf_view=true`.
  3. `POST /invoices/send_invoice/{id}`.

  We split the calls so that a timeout never leaves us unsure whether an invoice exists *and* was
  sent (see §6 idempotency). A Factur-X PDF/A-3 with embedded CII can instead be imported directly
  as the file.
- **`getStatus(pdpRef)`** combines three calls:
  - `GET /invoices/{id}` for the current `state`, `state_updated_at`, `error_message`,
    `refuse_reason` and `refuse_reason_code`;
  - `GET /accounts/{account}/events?invoice_id={id}` for the history;
  - `GET /invoices/{id}/responses` for CDAR documents.
- **`listInbound(since)`**:
  - Call `GET /accounts/{account}/invoices?type=ReceivedInvoice&ack=false&updated_at_from=<date>`
    and page through the results.
  - The filters take a **date**, not a date-time [verified, S1]. Round `since` down to the day and
    remove duplicates on our side.
  - After storing an invoice, call `POST /invoices/{id}/ack`. The `received_invoice.created`
    webhook is the push trigger.
- **`lookupRecipient(siren)`**: call `GET /directory/fr/0002/{siren}`, follow the 202 polling,
  then map the result:
  - `invoice.transport_type_code` → routing;
  - `information_flags` (`FR_ASSUJETTI_ACTIVE` / `INACTIVE` / `UNKNOWN`) → whether the recipient
    is subject to VAT;
  - 404 → `null`.
- **Missing from the interface:** a way to report payment (our `paid`). B2Brouter takes it as
  `mark_as` `state=paid` with `amount` and `amount_code` (§7). Add `reportPayment(pdpRef, amount)`,
  or a general `markAs`. (Done: `reportPayment`, through `POST /payments` since 2026-10-18, §3.4.)

### 3.3 Directory details

**First call:**

- OpenAPI says the first call **always** returns
  `202 {"status", "message", "polling_url"}`, and you keep calling until a final answer
  [verified, S1].
- The v2026-06-26 changelog says a **known entry returns 200 straight away** [verified, S18].
- Handle both cases.

**Final answers** [verified, S1, 2026-10-17]:

| Code | Meaning | Retry? |
|---|---|---|
| 200 | `ExternalCompany` found | — |
| 404 | Not found | — |
| 422 | Invalid identifier | No |
| 424 `upstream_unavailable` | Upstream service down; comes with `Retry-After: 900` | Yes |
| 424 `incomplete_businesscard` | — | No |
| 424 `no_exportable_doctypes` | — | No |

**Inconsistencies to code around:**

- The invalid-identifier code is `parameter_invalid` in OpenAPI but `invalid_identifier` in the
  changelog. The changelog adds that a **404 is cached for 15 minutes** [verified, S1 vs S18].
- The DGFiP guide example wraps the body in `{"external_company": {...}}`. The OpenAPI 200 body is
  not wrapped [verified, S14 vs S1]. Parse both.

**What France lookups consult and return** [verified, S9 + S14, 2026-10-17]:

- They query the **PPF Annuaire** for schemes 0002 (SIREN), 0009 (SIRET) and 0225.
- `ExternalCompany` includes `information_flags` and
  `invoice{transport_type_code, document_type_code, other_document_type_codes}`.

**Other French identifier schemes:** Suffix = 8040, Code Routage = 0224 [verified, S14].

### 3.4 What the adapter does (M4, 2026-10-18)

`packages/pdp-adapter/src/b2brouter/` — all [our decision], on the facts above.

- **One operator key** (`B2BROUTER_API_KEY`) for every company; each tenant keeps its B2Brouter
  account id in `tenants.pdp_account`, passed as `account` to every adapter call. The API refuses
  to start with a key that does not fit its host or environment: `test_…` only in `sandbox`,
  never in `prod`, and a host other than B2Brouter's (the stand-in) only in `local`.
- **`sendInvoice`**, with no idempotency key on B2Brouter's side (§6):
  1. Look the number up (`GET …/invoices?type=IssuedInvoice&number=`, exact match on our side).
  2. Found, and its original (`/as/original`) is byte-equal to our XML: it is ours from an earlier
     attempt; send it if it is still `new`, else just return its id.
  3. Found with other bytes: still `new` → our draft of an invoice corrected since, deleted and
     replaced; already sent → refused « numéro déjà utilisé » (`pdp.refused.numberTaken`).
  4. Not found: import (`send_after_import=false&issued=true`), attach the PDF, `send_invoice`.
     A 422 `parameter_taken` on import means the number appeared meanwhile: back to step 2.
     Any other 422 is a refusal, with B2Brouter's messages (`pdp.refused.platform`).
- **`getStatus`** builds the history from the events (each one carries the state it reached),
  the current state and the responses; `history()` in `adapter.ts`, state paths in `states.ts`.
- **`reportPayment`** uses `POST /payments`, not `mark_as`: `mark_as`'s `amount` is the CDV 206
  partial approval.
- **`listInbound`** lists `ReceivedInvoice` from the day before `since` (the filter takes a date)
  and reads each file from `/as/original`; the API's inbound poll drops repeats. No `ack` yet
  (docs/DEFERRED.md).
- **The stand-in** in `apps/mock-pdp/src/b2brouter.ts` speaks this protocol over the mock's engine,
  in both shapes where the docs disagree (T3–T5); the same contract suite runs against it, and
  against the real sandbox by hand (`src/b2brouter/sandbox.test.ts`, docs/RUNBOOK.md).

## 4. Webhooks

**Registration** [verified, S1, 2026-10-17]:

- Use `POST /web_hooks` with
  `{"web_hook": {"url", "description", "enabled", "events": [...]}}`.
- `url` must be public HTTPS, at most 512 characters.
- Webhooks belong to the **integration group**, not to one account. Payloads carry `account_id` so
  we can route them.
- They can also be managed in the web app under Settings → Webhooks [S14].

**Events** [verified, S1 + S2, 2026-10-17]:

- `issued_invoice.state_change`
- `received_invoice.state_change`
- `received_invoice.created`
- `tax_report.state_change`
- `ledger.state_change`
- `tin_verification.finished`
- `sii_batch.finished`
- `invoice_import.finished`

**Headers** [verified, S2, 2026-10-17]:

- `X-B2Brouter-Signature: t=<unix seconds>,s=<hex HMAC-SHA256>`. Example:
  `t=1732530076,s=9f117925ea533a2ea74b19699e03ab5de5664b4ff021d3d01eaff8868ed29e4d`.
- `X-B2Brouter-Delivery-Id`: the same value on every attempt of one delivery. Use it to drop
  duplicates. **It is not covered by the signature.**
- `X-B2Brouter-Delivery-Attempt`: `1`, `2`, `3`... A manual resend from the delivery log repeats
  the last number, or `0` if no automatic attempt was made.

**Signature check** [verified, S8 + S2, 2026-10-17]:

- The signed payload is `"{t}.{raw request body}"`.
- The signature is `HMAC-SHA256(secret, payload)` in hex. Compare it in constant time. S8's PHP
  example uses `hash_hmac('sha256', $timestamp . '.' . file_get_contents('php://input'), $secret)`
  and `hash_equals`.
- The secret is the `signing_secret` returned when the webhook is created. S8 calls it
  `signature_key`.
- **No timestamp tolerance and no source IP list are published.** We reject `t` older than 5
  minutes [our decision]. Verify against the raw bytes, before any JSON parsing.

```ts
// our sketch, not B2Brouter code
const [t, s] = parse(header);                    // "t=...,s=..."
const mac = hmacSha256Hex(secret, `${t}.${rawBody}`);
return timingSafeEqual(mac, s) && Math.abs(nowSec - Number(t)) <= 300;
```

**Delivery** [verified, S2, 2026-10-17]:

- Delivery is **at least once**. Any 2xx counts as delivered.
- On 5xx, 429, a connection error or a timeout, B2Brouter retries "with a growing delay for about
  a week". Any other status ends delivery with no retry.
- A webhook only says that something changed. **Fetch the object through the API to get its
  current state.**
- The exact retry schedule and timeout are not published.

**Payload** [verified, S2, 2026-10-17]:

- Envelope: `{"code": "<event>", "triggered_at": <unix int>, "data": {...}}`.
- `issued_invoice.state_change` and `received_invoice.state_change`:
  `data = {account_id, invoice_id, event_id, state, notes}`.
- `received_invoice.created`: `data = {invoice_id, account_id, state}`.
- `invoice_import.finished`: `data = {batch_id, status: done|failed, summary, status_url}`.
- `tax_report.state_change` and `ledger.state_change` also have a top-level `id`.
- **Caveat:** some changelog examples show payloads without the `code`/`data` envelope
  [verified, S18]. `parseWebhook` must accept both and must only trust `invoice_id` and
  `account_id`. Then call `getStatus`.

## 5. Formats

**What we can send to B2Brouter:**

- Their **JSON invoice model** is the recommended route [verified, S14 + S16].
- **Raw files are accepted** through `POST .../invoices/import` [verified, S1 + S14]:
  - Factur-X (PDF/A-3 with embedded CII);
  - standalone UBL 2.1 XML;
  - standalone CII XML.
- `.../invoices/imports` takes up to 100 XML files at once [verified, S1].
- **Content-Type conflict:**
  - S14 says to send `application/pdf` for Factur-X and `application/xml` for UBL/CII.
  - OpenAPI and S16 show `application/octet-stream`.
  - Tracked in §11.

**What B2Brouter can produce** (the `document_type_code` used by contacts and by
`/invoices/{id}/as/{code}`) [verified, S1 + S12 + S14, 2026-10-17]:

| Code | Notes |
|---|---|
| `xml.ubl.invoice.frcius.v1` | **Recommended for French contacts** with transport `peppol` [S14] |
| `xml.cii.cross_industry_invoice.frcius.v1` | — |
| `xml.cii.cross_industry_invoice.facturx.fr.all_profiles.v1` | — |
| `pdf.a.invoice.with.xml.cii.cross_industry_invoice.facturx.en16931` | Factur-X EN16931 |
| `pdf.a.invoice.with.xml.cii.cross_industry_invoice.facturx.extended` | Factur-X Extended |
| `xml.ubl.invoice.bis3` | Peppol BIS 3 |
| `pdf.invoice`, `pdf.invoice.signed` | `pdf.invoice` is **not billable** |
| `original` | **The file as received or imported**. Not billable. |
| `legal` | The legal document that was sent. Not billable. Returns 422 before sending. |

- Every other code **regenerates** the document and **is billed per call** [verified, S10 + S12].
- `download_legal_url` in the invoice body is a relative path,
  `/attachments/download/{id}/{filename}` [verified, S1].
- API responses are always JSON [verified, S1].

**Routing:**

- The format and channel used towards a customer come from the contact's `transport_type_code`
  and `document_type_code`. The import endpoint can override them per call [verified, S1].
- A customer on another PA is reached over Peppol, with B2Brouter's access point as C2 and the
  customer's PA as C3, after an Annuaire lookup. No extra configuration is needed
  [verified, S14].
- `peppol_email_fallback` defaults to `false` [verified, S1].

**JSON model gotchas** (only relevant if we ever use JSON instead of import) [verified, S1 + S14 +
S18, 2026-10-17]:

- **Taxes:** line taxes go in `invoice_lines_attributes[].taxes_attributes[]` as
  `{name, percent, category, comment}`, with `category` one of E, NS, Z, S, H, AA, AAA, AE, G, O, K.
  There is **no** line-level `tax_percent`/`tax_category` and **no** invoice-level
  `taxes_attributes`. Invoice-level `taxes` is read-only.
- **`unit`** is an internal integer id by default. It is a UN/ECE Rec20 code only if the account's
  `unit_code_format` is set.
- **Contact:** pass `contact_id` or an inline `contact`. Inline fields include `name`,
  `tin_value`, `tin_scheme` (9957 for France), `cin_scheme`, `cin_value`, `pin_scheme` (`"0225"`),
  `pin_value`, `routing_codes`, `address`, `country`, `currency`, `language`,
  `transport_type_code` and `document_type_code`. There is **no `vat_number`**.
- **Since version 2026-04-20:** an inline contact without a tin or cin returns 422, and `currency`
  and `language` are required.
- **Credit notes:** `is_credit_note` plus `invoice_references` (since 2026-04-20).

**French rules worth putting in `packages/core`** [verified, S14, 2026-10-17]:

- `remittance_information`, `payment_method_text` and `payment_terms` are required, otherwise 422.
- `bank_account_id` is also required when `payment_method` is 4.
- The invoice date cannot be in the future.
- **The invoice number is at most 20 characters**, otherwise the PPF rejects it with `REJ_SEMAN`.
- **A line in VAT category E without an exemption reason (VATEX) in `comment` is silently never
  transmitted.**
- For an FR → FR Flux 1 report, **both** the issuer and the receiver must be in the DGFiP
  Annuaire. B2Brouter does not block creation while the check is pending.

## 6. Rate limits, idempotency, pagination

**Rate limits** [verified, S5 + S7, 2026-10-17]:

- **1,000 requests/min in production** and **600/min in sandbox and staging**.
- Over the limit you get 429 with no `code`. Use exponential backoff, cache, and prefer webhooks
  to polling.
- No `X-RateLimit-*` headers are documented for the API.

**Idempotency** [verified, S1 + S7, 2026-10-17]:

- **Invoice create, import and send take no `Idempotency-Key` header.**
- The only `Idempotency-Key` in the spec is on `POST /accounts/{account}/ledgers/import`
  (e-reporting ledgers).
- A repeated invoice number returns 422 `parameter_taken`. The docs advise "GET first to avoid
  duplicates".
- **Bulk** import (`/invoices/imports`) skips any file whose **SHA-256 digest** already exists in
  the project. That file gets `error_message: duplicated_document`, and its `invoice_id` points to
  the existing invoice.
- Single-file import has **no documented** deduplication.
- Behaviour of `send_invoice` on an already-sent invoice is **not documented** (§11).

**Our strategy** [our decision]:

1. Keep `idempotencyKey → pdpRef` in our database. If an entry exists, do not call B2Brouter.
2. **Never retry a POST blindly.** On a timeout or connection error during import, search with
   `GET .../invoices?number=<our number>`. That filter is a prefix match, so compare the number
   exactly. If the invoice is found, use that id. If not, import again.
3. Treat 422 `parameter_taken` as "maybe already created" and run the same search.
4. Before retrying `send_invoice`, re-read `GET /invoices/{id}`. Only send again if `state` is
   still `new`.
5. Another option is to use the bulk endpoint with one file, which gives digest deduplication.
   It costs an asynchronous round trip.

The old prototype and the PHP SDK both retry POSTs; this strategy does not. The SDK (v1.3.0)
retries connection errors 3 times with exponential backoff starting at 1 s, including on POST.
That is the duplicate risk we avoid [inferred, S19].

**Pagination** [verified, S1, 2026-10-17]:

- Use `offset` (default 0) and `limit` (default 25, **maximum 500**) on lists, including
  invoices and events.
- `meta` holds `{total_count, offset, limit}`.
- `GET /invoices/{id}/responses` is not paginated.

**Invoice list filters** [verified, S1, 2026-10-17]:

- `type`: `IssuedInvoice` (default), `ReceivedInvoice`, `IssuedSelfInvoice`,
  `IssuedSimplifiedInvoice`, `ReceivedSelfInvoice`.
- `number`: a prefix match.
- Dates (format `date`): `date_from`/`date_to`, `due_date_from`/`due_date_to`,
  `state_updated_at_from`, `updated_at_from`.
- `ack`, `series_code`, `tin_value`, `cin_value`, `from_net`.
- One 0/1 flag per state, for example `sent=1` or `refused=1`.

## 7. Status vocabulary and mapping

**All B2Brouter invoice states** (`StateOutput`) [verified, S1, 2026-10-17]:

`new`, `sending`, `sent`, `read`, `downloaded`, `annulled`, `billed`, `expired`, `issued`,
`accepted`, `registered`, `refused`, `received`, `closed`, `paid`, `allegedly_paid`,
`performing_ocr`, `ocr_failed`, `annotated`, `payment_processed`, `error`, `invalid`.

At runtime, `GET /invoice_states` returns the authoritative list.

**Issued invoices: B2Brouter state → French lifecycle status (CDV) → ours.** The first two columns
are [verified, S14, 2026-10-17]. The last three are [our decision].

| B2Brouter `state` | French CDV status (corner) | Our internal state | Our mock-PDP event | Notes |
|---|---|---|---|---|
| `new` | — | `ready_to_send` | — | Imported, not sent |
| `sending` | — (C1) | `sending` | — | |
| `sent` | **200 Déposée** (C2) | `deposited` | `deposited` | |
| `registered` | **202 Reçue** (C3) | `delivered` | `received_by_platform` | Mock events `received_by_platform` and `delivered` both map here. B2Brouter has no separate "made available" state. |
| `read` | **204 Prise en charge** | `delivered` | (`delivered`) | Stays in `delivered`; record it as a timeline event |
| `accepted` | **205 Approuvée** / **206 Approuvée partiellement** | `accepted` | `accepted` | Tell 206 apart via `GET /invoices/{id}/responses` (TODO) |
| `annotated`, with a dispute | **207 En litige** | `disputed` | — | `mark_as` `dispute: true` with a reason gives 207 |
| `refused` | **210 Refusée**, with `refuse_reason_code` | `refused_by_customer` | `refused` | |
| `paid` | **212 Encaissée** | `paid` | `payment_received` | |
| `error` | — | `rejected_by_pdp` | — | Transmission failure after sending, e.g. `PEPPOL_NO_RECEIVER` in `error_message` |
| (synchronous 422 on create, import or send) | — | `needs_fix` | — | Schematron or validation failure; nothing was deposited |
| `annulled` | — | `cancelled` | — | |
| `allegedly_paid`, `closed`, `expired`, `downloaded`, `billed`, `issued`, `payment_processed` | **not documented** | stay in the current state, record the raw value | — | §11 |

**Our states B2Brouter never sends:** `draft`, `validated`, `overdue`, `chasing` and
`written_off`. We derive them from our own data and dates.

**Other facts on states:**

- **213 Rejetée:** the docs do not say how it shows up on the issued side. For received invoices
  it is applied automatically [verified, S14]. `REJ_SEMAN` (invoice number over 20 characters) is
  one known cause. Until checked, any 213 found in `responses` maps to `rejected_by_pdp`
  [our decision].
- **No retry endpoint:**
  - On `error`, edit the invoice with `PUT` and send it again.
  - Once sent, `PUT` and `DELETE` return 422; correct it with a credit note.
  - [verified, S14]
- **Refusal reason codes** (`mark_as` `reason_code`, shown on our refused invoices as
  `refuse_reason_code`) [verified, S1 + S14]: `ADR_ERR`, `REF_CT_ABSENT`, `CMD_ERR`, `TX_TVA_ERR`,
  `MONTANTTOTAL_ERR`, `CALCUL_ERR`, `DOUBLON`, `NON_CONFORME`, `DEST_ERR`, `TRANSAC_INC`,
  `EMMET_INC`, `CONTRAT_TERM`, `DOUBLE_FACT`.
  - They feed plain-French explanations, for example
    `DOUBLON` → « votre client signale un doublon ».
- **Payment** [verified, S1 + S14]: `mark_as` with `state=paid` plus `amount` and `amount_code`
  (`MAP`, `MAPTTC`, `MNA`, `MNATTC`) produces 212.
  - That the seller must send this for e-reporting of payment data is [inferred] and needs
    checking with the DGFiP specifications.
- **Tax reports** have their own lifecycle [verified, S14]: `new`, `sent`, `acknowledged`
  (500 Reçue), `registered` (300), `refused` (301), `error`.
  - France uses a "Y / 5-corner model, not clearance": the invoice reaches the buyer whatever
    happens to the Flux 1 report.
  - Keep the e-reporting status apart from the invoice status in our model.
- **Received invoices:**
  - Imported ones arrive as `new`; ones received through transports arrive as `received`; failed
    validation gives `invalid`.
  - We answer with `mark_as` `accepted` / `refused` / `paid`, or `annotated` for internal use.
  - [verified, S17]

## 8. Regulatory status in France

- **B2BRouter is a registered (immatriculée) Plateforme Agréée.**
  - It appears in the DGFiP list "Liste des opérateurs satisfaisant à l'ensemble des conditions,
    incluant les tests d'interopérabilité", which is the list of final registrations.
  - "Date de délivrance du numéro d'immatriculation": **12/12/2025**.
  - Registered entity: Avenida Diagonal 433, Barcelona, comercial@b2brouter.net.
  - [verified, S20, 2026-10-17]
  - The spreadsheet's file name (`liste_pa_attente_rapport_audit.xlsx`) is misleading. Its
    position on the HTML page links it to this first list.
- **Peppol:** B2Brouter runs its own Peppol access point (C2) [verified, S14].
- **ISO/IEC 27001:** B2Brouter states it is certified [verified as B2Brouter's own statement, S25].
  We have not seen the certificate.
- **French coverage:** S15 lists the 44 XP Z12-014 use cases it supports (last updated
  2026-10-13) [verified, S15].
- **E-reporting:** Flux 1 and Flux 10 go through `tax_report_settings` code `dgfip` [verified, S14].
- **Annuaire:** turning the DGFiP setting on publishes the company's SIREN/SIRET in the **real**
  PPF Annuaire. Publication runs in a **nightly batch and is live the next morning**, in both
  staging and production [verified, S14].
  - Onboarding a customer therefore takes one night before they can receive.

## 9. Pricing and the plan needed for API access

**Web-app plans** [verified, S21, 2026-10-17]:

- **Basic:** 0 €, up to 24 transactions a year (sent plus received), for VAT-exempt activities
  only.
- **Professional:** 110 € a year + TVA.
- **Business:** 300 € a year + TVA.

**Production API access needs an integrated product** [verified, S6 + S11 + S22, 2026-10-17]:

- **eDocExchange**, "for companies":
  - Monthly subscription priced by approximate volume.
  - Accounts **cannot** be created, archived or unarchived through the API; this is done in the
    web app.
  - One transaction limit for the whole group.
- **eDocSync**, "for software developers" (white label):
  - Price on request ("demandez plus d'informations").
  - `POST /accounts` works. Each added account costs a one-time fee.
  - The group limit is accounts × per-account quota.
  - A dedicated plan for 100+ companies.
  - The site also advertises "PDP marque blanche" and "PDP marque grise".
- **Startups programme:** "white-label API with a 100% discount" [verified, S22 global page].
- **Prices for eDocExchange and eDocSync are not in the static HTML.**
  - The pages may load them with JavaScript; Browserbase failed with 402, so they were not
    rendered.
  - **Unknown** (§11).
- **Sandbox:** free [verified, S3].

**What is billable** [verified, S10, 2026-10-17]:

- Billed: sending, receiving and transforming documents.
- DGFiP e-reporting is billed **per ledger**, not per invoice.
- Free: `/as/original`, `/as/legal` and `pdf.invoice`.

**Which product fits us:**

- Facture Impec serves many small companies, each with its own SIREN, so each needs its own
  B2Brouter account [verified, S14: one account per SIREN].
- Only **eDocSync** lets us create accounts through the API. So **eDocSync** (or the startups
  programme) is the fitting product, and eDocExchange would not scale for us [inferred].

## 10. Discrepancies with the old Rust prototype

The old prototype is in `crates/facture-backend/src/pdp/b2brouter.rs` and `.../config.rs`, which
now live only on the tag `archive/rust-mvp-v1`. It was described by `docs/PDP_INTEGRATION.md`,
`AGENT_PLAN.md` and `docs/DEPLOIEMENT.md` on that branch. All rows were checked
on 2026-10-17.

**Wrong or outdated:**

| # | Old assumption (location) | Reality | Source |
|---|---|---|---|
| D1 | `B2BROUTER_API_VERSION` defaults to `"2.0"` (`config.rs:41`, test) | Versions are dates (`2026-06-26`). `"2.0"` would return 400 `invalid_api_version`. | verified S1, S5, S7 |
| D2 | "Test key → sandbox automatically on `api-staging`" (`PDP_INTEGRATION.md`); default base `https://api-staging.b2brouter.net` (`config.rs:38-39`) | Sandbox = **`api.b2brouter.net` with a `test_` key**. `api-staging` is a separate environment: `stag_` key, registration on app-staging, plus a support ticket. | verified S3, S4 |
| D3 | `send_after_import` inside `invoice` (`b2brouter.rs:69`, test line 207) | It is a **top-level** field beside `invoice`. Inside `invoice` it is not that flag. | verified S1 |
| D4 | Line `tax_percent` / `tax_category` (`b2brouter.rs:44-45`) | `invoice_lines_attributes[].taxes_attributes[] {name, percent, category, comment}` | verified S1 |
| D5 | Invoice-level `taxes_attributes` (`b2brouter.rs:76`) | Does not exist. Invoice-level `taxes` is read-only. | verified S1 |
| D6 | `contact.vat_number` (`b2brouter.rs:72`) | `tin_value` + `tin_scheme` (9957 FR). France also needs `cin`/`pin` (0225), `currency`, `language`. Without tin or cin → 422. | verified S1, S14, S18 |
| D7 | `unit` sent as a string (`b2brouter.rs:43`) | An integer id by default; a Rec20 code only if `unit_code_format` is set | verified S1 |
| D8 | Status via `GET /accounts/{id}/invoices/{id}` (`b2brouter.rs:142`) | `GET /invoices/{id}` (flat path) | verified S1 |
| D9 | Reads `state` at the top level, falling back to `"submitted"` / `"unknown"` (`b2brouter.rs:126-129`, `165-168`) | Responses are wrapped in `{"invoice": {...}}`, so the old code **always** returned the fallback. `submitted` is not a B2Brouter state. | verified S1 |
| D10 | Retries every request, POST included, 3 times with a linear 200 ms backoff (`b2brouter.rs:105`, `145`) | No idempotency key exists for invoices, so retrying a POST can create **duplicate invoices**. Use the search-then-retry strategy (§6). | verified S1, S7 |
| D11 | No French mandatory payment fields | `remittance_information`, `payment_method_text`, `payment_terms` (+ `bank_account_id`) are required in France | verified S14 |
| D12 | JSON model only | Raw UBL/CII/Factur-X import exists. It fits our XML-first `sendInvoice` better. | verified S1 |
| D13 | "SHA-256 digest dedup" stated for imports in general (`PDP_INTEGRATION.md`) | True **only** for the bulk endpoint `/invoices/imports` (and as payload digest for ledger import). Single-file import: not documented. | verified S1 |

**Confirmed:**

- The header names `X-B2B-API-Key` and `X-B2B-API-Version`.
- The production host `https://api.b2brouter.net`.
- `POST /accounts/{id}/invoices`.
- The id is read at `invoice.id`.
- Create and send in one call (top-level `send_after_import`), with sending also available as its
  own call (`POST /invoices/send_invoice/{id}`).
- `GET /accounts/{id}/invoices?type=ReceivedInvoice`.
- A Directory keyed by country + scheme + identifier (asynchronous).
- Webhooks exist.
- Bulk import returns 202 and is polled through a `status_url`.
- One key serves many accounts (integration group), with a dedicated plan for 100+ companies.
- B2Brouter is itself a PA.
- White label and grey label are offered.
- The only official SDK is PHP.
- `llms.txt` is at developer.b2brouter.net.

All verified against S1, S9, S11, S14, S19, S20, S22 and S23.

**Not about B2Brouter:** `DEPLOIEMENT.md` lists `X-Account-Id` and `Idempotency-Key` headers.
These are headers of **our own** `/api/send`. B2Brouter takes the account in the path and has no
invoice idempotency key.

## 11. Open TODO(verify)

The rule for **every** item until it is closed: **implement against `apps/mock-pdp`**, keep the
fallback listed, and put a `TODO(verify)` in the code that points to the item number. Most items
close with one call using the owner's sandbox key (`test_`). Items marked "staging" need a
`stag_` key plus a ticket.

| # | Open question | Meanwhile (always against the mock PDP) | How to close it |
|---|---|---|---|
| T1 | Content-Type for `POST .../invoices/import`: `application/xml` / `application/pdf` (S14) or `application/octet-stream` (S1, S16)? | Mock accepts both. Adapter sends `application/xml` for XML and `application/pdf` for Factur-X, as in the France guide. | One sandbox import of each type |
| T2 | Is the imported XML forwarded **as is**, or rebuilt in the contact's `document_type_code`? And is that rebuild a billable "transformation"? | Mock keeps the bytes. We check `/as/legal` against our XML in tests. | Sandbox: import CII, send, download `/as/legal`, compare |
| T3 | Webhook payload: `{code, data}` envelope (S2) or flat (S18 examples)? | `parseWebhook` accepts both and only extracts `invoice_id` / `account_id`; mock sends the envelope | Sandbox webhook to a test endpoint |
| T4 | Directory: always 202 first (S1) or 200 for known entries (S18)? Body wrapped in `external_company` or not? `parameter_invalid` vs `invalid_identifier`? | Adapter handles 200 and 202, both body shapes, both codes; mock alternates them | Sandbox lookups. Staging for a real QAS SIREN. |
| T5 | List response: `meta{...}` (S1) or top-level `total_count/offset/limit` (S17)? | Accept both | One sandbox list call |
| T6 | `mark_as` returns 200 with a body (S1) or 204 (S17)? | Accept both; re-read with `GET /invoices/{id}` when the body is empty | Sandbox `mark_as` |
| T7 | How does **213 Rejetée** show on issued invoices (state? `responses` entry? `event_name`?) | Treat any rejection in `responses` as `rejected_by_pdp`; mock gets a `rejected` event | Staging (QAS) with a number over 20 characters (`REJ_SEMAN`) |
| T8 | Meaning of `allegedly_paid`, `closed`, `expired`, `downloaded`, `billed`, `payment_processed` | Keep our state unchanged, store the raw value, show it on the timeline | Ask B2Brouter support, or call `GET /invoice_states` (it may carry descriptions) |
| T9 | Full `document_type_code` list for France (needs a key: `GET /document_types`) | Use only the codes in §5 | One sandbox call |
| T10 | Response of `send_invoice` on an already-sent invoice (422? 409?) | Never re-send unless the state is `new` (§6) | Sandbox: send twice |
| T11 | Vocabulary of `events[].name` and of `responses[].event_name` (only one example is public) | Build history from `state` and `state_updated_at`; store raw names | Sandbox: run all 3 test contacts, list events and responses |
| T12 | Prices of eDocExchange / eDocSync, and the startups programme terms | Plan with the sandbox only; no production commitment | Owner asks B2Brouter sales (comercial@b2brouter.net) |
| T13 | Can a Basic-plan account create a sandbox before any company setup or identity check? | — (owner step) | Owner creates the account and the sandbox |
| T14 | Inbound invoices cannot be simulated in the sandbox | `listInbound` is tested only against the mock (and against a ReceivedInvoice made via `issued=false` import, which S17 allows) | Staging, or production with a real supplier |
| T15 | Webhook retry schedule, timeout, source IPs, timestamp tolerance | Verify the HMAC and reject `t` older than 5 minutes; answer 2xx fast and process asynchronously | Support ticket |
| T16 | Deleting an attachment: OpenAPI has `DELETE /attachments/{id}`, but S13 advises deleting and re-creating the invoice | Never attach the wrong PDF: attach only after local validation | Sandbox call |
| T17 | Does a Factur-X import plus a contact set to CII send the embedded CII unchanged? (Same issue as T2, for PDF.) | Send XML, with the PDF attached separately as `use_as_pdf_view` | Sandbox, after T2 |
| T18 | Does the seller have to send 212 (paid + amount) for e-reporting? **Partly closed 2026-10-18:** how to send it is known (`POST /payments`, §3.1); whether it is required is not. | `reportPayment` sends it through `POST /payments`; mock records it | Check DGFiP specifications (and S14 on payment data) |
| T19 | Does an import that passes the XSD but fails Schematron (or B2Brouter's own checks) answer 422 with `errors`, or import and fail at `send_invoice` (state `error`)? | Both are handled: a 422 on import or on send is a refusal with B2Brouter's messages | One sandbox import of an invoice with an empty buyer name |
| T20 | The sandbox's default path is `sent → registered` and only Peppol invoices go further (§1): does a French invoice sent to a SIREN follow it, and how fast? Must the invoice's seller be the account's own company? | The E2E and the contract accept any status after the deposit; the demo seller is used | The live contract and E2E with the owner's key (docs/RUNBOOK.md § B2Brouter sandbox) |
| T21 | `POST /payments` has no idempotency key: after a lost answer (timeout, connection cut once B2Brouter has the request), does a second call for the same invoice record a second payment, answer an error, or stay one? | One `payment_reports` row per invoice; the job retries only outages, so a lost answer can repeat the call once per retry. A refusal (4xx) is `failed`, never retried | Sandbox: post the same payment twice, then read the invoice and its payments |
| T22 | What `{account}` in `/accounts/{account}/…` is: B2Brouter's own account id, or can it be the company's SIREN? And does a company keep the same id in the sandbox and in production (keys and accounts are not shared between environments, §1)? | A company's account defaults to its SIREN; the operator sets B2Brouter's id with `PUT /admin/tenants/:id/platform` before the go-live (`docs/RUNBOOK.md` § Pilot), and the go-live call checks it answers. Mode test in prod uses the same id on the sandbox key: if the ids differ, a second column (sandbox account) is needed (`docs/DEFERRED.md`) | Owner's first sandbox and production accounts: `GET /accounts` with each key |
| T23 | What a valid key answers on an account it cannot reach (another company's id, a typo): 404, 403, or an empty list? | The probe of §12 reads 404 as « wrong account » and 401/403 as « wrong key » (§2); anything else as « not accepted », and nothing is saved either way | Owner's sandbox key: `GET /accounts/<wrong id>/invoices?type=ReceivedInvoice` once |
| T24 | An imported CII of type 381 naming its invoice (BG-3): does B2Brouter take it as a credit note linked to that invoice (`is_credit_note`, `invoice_references`), and does it go through the same statuses as an invoice? | Sent like any invoice; the original becomes « Annulée par un avoir » when the credit note is deposited (`apps/api/src/credits.ts`). The stand-in takes it as an invoice | Sandbox: import a credit note of an invoice already sent, send it, read both invoices |
| T25 | Several `POST /payments` with an `amount` on one invoice (instalments): does B2Brouter add them up and reach `paid` (212) only when they reach the total? What answers a payment above the balance, and a negative one (a correction)? | Each instalment is reported with its own amount (`apps/api/src/payments.ts`); the invoice is paid on our side when the user's payments reach the balance; the platform's `paid` is taken as it comes. The stand-in adds payments up and says paid at the total | Sandbox: an invoice of 120 €, pay 40 then 80, read its state after each |

**Closed during this research:** Annuaire publication delay = nightly batch, live the next
morning [verified, S14, 2026-10-17].

## 12. Company keys (M8)

A company that already has a B2Brouter account can connect its own key in Réglages (plan §4
`pdp_credentials_enc`, §5 « PDP connection »). Code: `apps/api/src/settings.ts` (`savePdpKey`,
`removePdpKey`), `apps/api/src/runtime.ts` (`ownPdpFromEnv`), `apps/api/src/platform.ts` (`adapterFor`);
tests `apps/api/src/own-platform.test.ts`, `runtime.test.ts` › company keys.

- **Only where the deployment seals keys.** Without `PDP_KEY_SEALING_KEY` (32 bytes, base64) the form is
  not shown and the API answers 409 `pdp_key_disabled`.
- **Environment rule** (§1, §2): outside local, a sandbox deployment accepts only `test_` keys and a
  production one refuses them; a `stag_` key is refused outside staging by the same host check as the
  deployment's key (§3.4). The refusal is 422 `pdp_key_refused` and nothing is saved.
- **Probe before saving.** The key is tried with `listInbound` on the company's account (the one typed, else
  the company's account, by default its SIREN, T22) from now, which reads and changes nothing. 401/403
  (§2) → the key is not accepted (`pdpKey.problem.key`); 404 → the key does not open that account
  (`pdpKey.problem.account`, `TODO(verify)` T23); a timeout or 5xx → B2Brouter did not answer
  (`pdpKey.problem.unavailable`). On any refusal the key, the account and the tenant stay as they were.
- **At rest.** AES-256-GCM under `PDP_KEY_SEALING_KEY` (the same sealing as the AI keys,
  `packages/agents/src/providers/seal.ts`); only `…` and the last four characters are kept in clear for
  the pane. The key is never returned, exported, logged or written to the audit (the audit has the hint
  and the account).
- **Which key serves what.** Real invoices of that company (send, status sync, received invoices,
  payment reports, go-live check) go through its key; test invoices keep the deployment's test platform,
  so « Mode test » never reaches the company's real account. A key the deployment can no longer open
  (sealing key changed) stops real sends; it never falls back to our key.
- **Webhooks.** A webhook's `signing_secret` is returned only when the webhook is created (§3.1, §4).
  We register none with a company's key and hold no secret for its account, so its invoices get their
  statuses from the sweep's polling (`docs/DEFERRED.md`).
- **Once live.** The account no longer changes and the key cannot be removed; it can be replaced by one
  that passes the probe on the same account (rotation). RGPD deletion clears it.
