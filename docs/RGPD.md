# RGPD

Plan §10: what personal data Facture Impec holds, why, for how long, and how a customer takes it away
or deletes it. The code is `apps/api/src/rgpd.ts` (export, deletion) and `packages/agents/src/pseudonymize.ts`
(nothing identifying reaches a model).

> ⚠️ **Legal exposure, for the owner.** The retention periods and roles below are the product's
> working assumptions, written down so they can be checked. They must be confirmed by the owner (and
> a lawyer or accountant if needed) before the first paying customer (M7). Until then nothing here is a
> promise to customers, and the marketing site makes none.

## Roles

- For the **accounts** of its customers (the people who sign in), Facture Impec decides why and how the
  data is used: it is the controller (*responsable de traitement*).
- For the **invoices** (buyer names, addresses, SIREN, amounts), Facture Impec works on behalf of the
  customer who issues them: it is a processor (*sous-traitant*, art. 28). This needs a processing
  agreement in the terms of service (M7).
- Subprocessors: the PDP (B2Brouter from M4), the hosting (EU VPS, M7), and the AI provider included
  in the subscription. A customer who brings their own AI key chooses that provider themselves.

## Register of processing (art. 30)

| Processing | Data | Purpose and legal basis | Kept | Where in the code |
|---|---|---|---|---|
| Accounts and sign-in | E-mail and role of each person; sign-in links (hash only); sessions (hash only) | Signing in to the add-in. Contract. | Links: 15 min, single use. Sessions: 30 days. People: until the account is deleted. | `users`, `magic_links`, `sessions`; `apps/api/src/login.ts` |
| Company access keys | Hash of each key, label, revocation date | Signing in a workbook without e-mail. Contract. | Until revoked; revoked at deletion. | `api_keys` |
| Invoices issued | The invoice as built from the sheet (buyer and seller names, addresses, SIREN, VAT number, amounts), its XML and PDF, the platform's answers | Validating, converting, transmitting and following the invoice. Contract, and the customer's legal duty to issue e-invoices. | **Transmitted invoices: 10 years** (Code de commerce art. L123-22, accounting documents), kept after deletion. Never transmitted or test invoices: until deletion. | `invoices`, `invoice_events`, `pdp_submissions`, `validation_results` |
| Sheet mappings and invoice defaults | Column choices, SIRET, IBAN, BIC, payment terms | Reading the sheet the same way each time. Contract. | Until deletion. | `sheet_mappings`, `tenants.invoice_defaults` |
| AI assistance | Sheet headers and a sample of rows, **pseudonymized** before they leave (names, SIREN / SIRET / VAT numbers, IBAN, e-mails, phones and street lines replaced by tokens) | Proposing columns, explaining errors in plain French. Legitimate interest of the customer, who can switch AI off in Réglages. | The provider's own terms; Facture Impec keeps only a run log: agent, provider, model, prompt hash, tokens, outcome. No prompt text, no answer text. | `agent_runs`; `packages/agents` |
| Audit log | Who did what, when, on which object: ids and hashes, never names or e-mails | Proving every action (plan §0). Legal duty for invoices, legitimate interest otherwise. | As long as the invoices it describes: 10 years. Append-only. | `audit_events` |
| Trial requests (marketing site) | First and last name, e-mail, company, SIREN, profile, volume, Excel version, plan, message | Answering the request. Consent (the form). | **Not decided** — see below. | `apps/site/sql/001_trial_requests.sql` |

## Rights

| Right | How | Who |
|---|---|---|
| Access and portability (art. 15, 20) | `GET /tenant/export`: one JSON file with the company, its people, settings, invoices, events, agent runs and audit log. In the add-in: Réglages → « Exporter mes données ». | Any signed-in person of the company. |
| Erasure (art. 17) | `DELETE /tenant` with `{ "confirmSiren": "<SIREN>" }`: deletes the people, sessions, links, mappings, settings, AI keys, agent runs and every invoice that never left (drafts, test invoices); revokes the keys; keeps the transmitted invoices and the audit log for the legal period, the company row marked deleted. | The owner only. No button in the add-in yet (`docs/DEFERRED.md`): on request, the operator runs it. |
| Rectification (art. 16) | The sheet is the source: the customer corrects it and checks again. A transmitted invoice is never edited; it is corrected by a credit note (M5). | The customer. |

Tests: `apps/api/src/settings.test.ts` › RGPD (export without secrets, what deletion keeps, owner only).

## Open decisions (owner)

1. **10 years for transmitted invoices.** L123-22 sets 10 years for accounting documents; tax law
   (LPF art. L102 B) asks for 6. The product keeps 10. Confirm, and say it in the terms of service.
2. **Trial requests.** No retention period yet. Proposal: delete 12 months after the last contact.
3. **Processing agreement and subprocessor list** in the terms of service before M7.
4. **AI provider included in the subscription**: which one, in which region, and whether its terms
   allow training on inputs (pseudonymized or not, the answer must be no).
