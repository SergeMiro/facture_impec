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
- Subprocessors: the PDP (B2Brouter from M4), the hosting (EU VPS, M7), the mail provider (M7), Stripe
  for the subscription (M7: card and billing details stay at Stripe, we never see a card), and the AI
  provider included in the subscription. A customer who brings their own AI key chooses that provider
  themselves. The company directory (DINUM) receives the SIREN typed at sign-up, a public number, and
  from M8 what a user types in Clients « Chercher dans l'annuaire » (a company name or SIREN, a post
  code); « Trouver ce client » fills that search with the buyer's name from the sheet, on the user's
  click only. The platform's directory receives the SIREN of each company found, to say whether it can
  be reached. A company that connects its own B2Brouter account (M8) makes B2Brouter its own processor
  for its invoices, under that account's terms.

## Register of processing (art. 30)

| Processing | Data | Purpose and legal basis | Kept | Where in the code |
|---|---|---|---|---|
| Accounts and sign-in | E-mail and role of each person; sign-in links (hash only); sessions (hash only) | Signing in to the add-in. Contract. | Links: 15 min, single use, deleted a day later. Sessions: 30 days, deleted a day after they expire or end. People: until the account is deleted. | `users`, `magic_links`, `sessions`; `apps/api/src/login.ts`; purge `purgeExpired` in `apps/api/src/rgpd.ts` (daily) |
| Sign-up requests (M7) | E-mail, SIREN, the company as prefilled or typed (name, address, VAT number), terms version, hashes of the link and of the pane's secret | Creating the account the person asked for. Pre-contractual steps. | 60 minutes to confirm; deleted a day after they expire, whether or not they became an account (`docs/ONBOARDING.md`). | `signup_requests`; `apps/api/src/onboarding.ts` |
| Terms accepted (M7) | Version of the CGU and date of acceptance | Proving the contract. Contract. | With the company row. | `tenants.terms_version`, `terms_accepted_at` |
| Subscription (M7) | Stripe customer and subscription ids, plan, status, period end; one row per invoice sent for real (invoice id, month, beyond the quota or not) | Billing the plan and the invoices beyond it. Contract; our own accounting duty. | Ids and usage kept after deletion (10 years, accounting documents of our own sales); card and billing details only at Stripe, under its terms. | `tenants` (billing columns), `billing_usage`, `stripe_events` (event ids only); `apps/api/src/billing.ts`, `docs/BILLING.md` |
| Customer directory (M8) | Each customer the user confirmed: legal name, SIREN, VAT number DGFiP lists, head-office address, the names the sheets use for it, its e-mail for chasing (which may name a person), whether the platform can reach it, « Envoi automatique » | Completing the sheet's invoices and sending to that customer automatically if the user opts it in. Contract. | Until the user forgets the customer or the account is deleted; the invoices keep their buyer as built. | `parties`; `apps/api/src/parties.ts`, `packages/agents/src/party.ts` |
| Ten-year archive (M8) | Every invoice sent for real as the platform got it (XML) with its PDF, every real supplier invoice as received (XML), number, date, SHA-256 and hash chain | Keeping the invoices unchanged for their legal period (plan §10). Legal duty. | **10 years** from archiving (`keep_until`); a database trigger refuses any change and any deletion before that date, account deletion included. Test invoices and drafts are never archived. | `invoice_archive`; `apps/api/src/archive.ts`, `packages/db/drizzle/0007_gaps.sql` |
| Company's own platform key (M8) | The B2Brouter key a company connects in Réglages, sealed (AES-256-GCM under `PDP_KEY_SEALING_KEY`), and its last four characters | Sending the company's invoices through its own account. Contract. | Until the owner removes it (not possible once live: it can be replaced) or the account is deleted. Never exported, logged or shown in full. | `tenants.pdp_key_sealed`, `pdp_key_hint`; `apps/api/src/settings.ts` |
| Company access keys | Hash of each key, label, revocation date | Signing in a workbook without e-mail. Contract. | Until revoked; revoked at deletion. | `api_keys` |
| Invoices issued | The invoice as built from the sheet (buyer and seller names, addresses, SIREN, VAT number, amounts), its XML and PDF, the platform's answers | Validating, converting, transmitting and following the invoice. Contract, and the customer's legal duty to issue e-invoices. | **Transmitted invoices: 10 years** (Code de commerce art. L123-22, accounting documents), kept after deletion. Never transmitted or test invoices: until deletion. | `invoices`, `invoice_events`, `pdp_submissions`, `validation_results` |
| Invoices received | The supplier's invoice as the platform delivers it (supplier name, address, SIREN, VAT number, IBAN, amounts), its XML, the facts read from it, the triage, the user's decision (« Bon pour paiement » or « Contester » with its reason, by whom) | Receiving the customer's purchase invoices: polled from M4, read, triaged and decided from M6. Contract, and the customer's legal duty to receive e-invoices. | **10 years** like issued ones (accounting documents), kept after deletion with the person's e-mail removed from the decision. Mode test invoices: until deletion. | `inbound_queue`; `runInboundPoll` in `apps/api/src/workers.ts`, `apps/api/src/inbound.ts` |
| Accountant exports | The FEC and CSV files of each export (supplier names, SIREN, VAT number, IBAN, amounts), who made it | Handing the purchase invoices to the customer's accountant. Contract. | 10 years with the invoices they list, kept after deletion with the person's e-mail removed. Test exports: until deletion. | `inbound_exports`; `apps/api/src/inbound.ts` |
| Sheet mappings and invoice defaults | Column choices, SIRET, IBAN, BIC, payment terms | Reading the sheet the same way each time. Contract. | Until deletion. | `sheet_mappings`, `tenants.invoice_defaults` |
| AI assistance | Sheet headers and a sample of rows, **pseudonymized** before they leave (names, SIREN / SIRET / VAT numbers, IBAN, e-mails, phones and street lines replaced by tokens) | Proposing columns, explaining errors in plain French. Legitimate interest of the customer, who can switch AI off in Réglages. | The provider's own terms; Facture Impec keeps only a run log: agent, provider, model, prompt hash, tokens, outcome. No prompt text, no answer text. | `agent_runs`; `packages/agents` |
| Audit log | Who did what, when, on which object: ids and hashes, never names or e-mails | Proving every action (plan §0). Legal duty for invoices, legitimate interest otherwise. | As long as the invoices it describes: 10 years. Append-only. | `audit_events` |
| Trial requests (marketing site) | First and last name, e-mail, company, SIREN, profile, volume, Excel version, plan, message | Answering the request. Consent (the form). | **Not decided** — see below. | `apps/site/sql/001_trial_requests.sql` |

## Rights

| Right | How | Who |
|---|---|---|
| Access and portability (art. 15, 20) | `GET /tenant/export`: one JSON file with the company, its people, settings, invoices, received invoices with their decisions, accountant exports with their files, billing usage, customers (M8), the register of the ten-year archive (M8: number, date, hashes, keep-until; the documents are the invoices already in the file), events, agent runs and audit log. Never the sealed keys. In the add-in: Réglages → « Exporter mes données ». | The owner only. |
| Erasure (art. 17) | `DELETE /tenant` with `{ "confirmSiren": "<SIREN>" }`, in the add-in Réglages → « Supprimer le compte » with the SIREN typed again (M7). First ends the Stripe subscription (usage not billed yet is invoiced; if Stripe fails, nothing is erased and the message says so). Then deletes the people, sessions, links, sign-up requests, mappings, settings, AI keys, the company's own platform key and the customer directory (M8), brand, agent runs and every invoice that never left (drafts, test invoices) and the Mode test supplier invoices and exports; revokes the keys; keeps the transmitted invoices, the received invoices, the accountant exports (the person's e-mail removed), the billing ids and usage, the ten-year archive (M8) and the audit log for the legal period, the company row marked deleted. | The owner only. |
| Rectification (art. 16) | The sheet is the source: the customer corrects it and checks again. A transmitted invoice is never edited; it is corrected by a credit note (M5). | The customer. |

Tests: `apps/api/src/settings.test.ts` › RGPD (export without secrets, what deletion keeps, owner only); `apps/api/src/inbound.test.ts` › RGPD (received invoices and exports in the export, test ones deleted); `apps/api/src/billing.test.ts` › the customer portal and deletion (the subscription ends first); `apps/api/src/operator.test.ts` › purge; `apps/addin/src/controller.test.ts` › the subscription, then leaving (deletion from Réglages); `apps/api/src/archive.test.ts` › RGPD (the register in the export, deletion leaves the archive whole); `apps/api/src/own-platform.test.ts` › deletion forgets the key; `packages/db/src/db.test.ts` › invoice_archive (no change, no early deletion).

## Open decisions (owner)

1. **10 years for transmitted invoices.** L123-22 sets 10 years for accounting documents; tax law
   (LPF art. L102 B) asks for 6. The product keeps 10. Confirm, and say it in the terms of service.
2. **Trial requests.** No retention period yet. Proposal: delete 12 months after the last contact.
3. **Processing agreement and subprocessor list** in the terms of service before M7.
4. **AI provider included in the subscription**: which one, in which region, and whether its terms
   allow training on inputs (pseudonymized or not, the answer must be no).
5. **Stripe and the mail provider** in the subprocessor list, and the 10 years for billing ids and usage
   after deletion (our own accounting documents; Stripe keeps its own records under its terms).
6. **Anyone can request an account for a SIREN** (`docs/ONBOARDING.md` §3): the e-mail is proven, the
   right to act for the company is not. The CGU should say that the person who accepts them declares
   they may engage the company.
