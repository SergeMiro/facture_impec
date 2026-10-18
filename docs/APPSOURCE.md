# Microsoft Marketplace (AppSource) submission (plan §11 M7)

What Partner Center asks for an Excel task-pane add-in with the add-in only XML manifest, what
`pnpm appsource:package` builds, and what only the owner can do. Code: `apps/addin/scripts/release.ts`
(store manifest, listing checks, reviewers' sample; tests `release.test.ts`), `apps/addin/scripts/appsource.ts`
(the command), `apps/addin/src/pages.ts` + `redirect.html` (Stripe from the pane, §4),
`docs/appsource/listing-fr.md` and `docs/appsource/certification-notes.md` (the texts).

**Sources.** Read on **2026-10-18** on learn.microsoft.com (curl). Microsoft often leaves a page's
`ms.date` stale; the dates below are the page's own. The certification policies page
(https://learn.microsoft.com/en-us/legal/marketplace/certification-policies, **[POL]**) still displays
« version 1.67, August 26, 2024 », but its `Last-Modified` is 2026-09-18 and the
[change history](https://learn.microsoft.com/en-us/legal/marketplace/offer-policies-change-history) lists
v1.96 of 2026-09-13: what is quoted is the live text of 2026-10-18. **NOT CONFIRMED** = no page states it.

---

## 1. The manifest

| Fact | Source |
|---|---|
| `SupportUrl` is required for Marketplace; a public page with no sign-in, not a GitHub repository, a social page or a shared document. The production validator fetches it (HEAD and GET must work, observed). | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/xml-manifest-overview (2025-11-06); https://learn.microsoft.com/en-us/partner-center/marketplace-offers/appsource-submission-faq (2025-05-30, shown 2026-10-01) |
| `IconUrl` 32×32 and `HighResolutionIconUrl` 64×64 are required for a task pane. | https://learn.microsoft.com/en-us/javascript/api/manifest/iconurl (2025-09-08); …/highresolutioniconurl |
| Version `a.b.c.d`, a in 1–9999, b, c, d in 0–9999; the submission form's version must equal the manifest's; every update a higher version and **the same `Id`**. | appsource-submission-faq |
| `ProviderName` must match the publisher in Partner Center (« identical or very similar »); the publisher cannot change after the offer is created. | https://learn.microsoft.com/en-us/partner-center/marketplace-offers/checklist (2025-03-17); …/add-in-submission-guide (2025-03-17, shown 2025-09-02) |
| `DisplayName` must equal the name reserved in Partner Center. | https://learn.microsoft.com/en-us/partner-center/marketplace-offers/create-effective-office-store-listings (2025-01-30) |
| `DefaultLocale` fr-FR declares the language (policy 1100.7); with fr-FR as default, no fr-FR `Override`. | [POL] §1100.7; https://learn.microsoft.com/en-us/javascript/api/manifest/override (2026-10-13) |
| `AppDomains` is not required, and is not needed for the task pane's own domain, for Office on the web or for a dialog opened with the Dialog API; it « can't be empty ». | https://learn.microsoft.com/en-us/javascript/api/manifest/appdomain (2025-03-11) |
| Every URL https (policy 1100.5); `validate -p` refuses localhost anywhere and runs « the same package validation service we use in our review process ». | appsource-submission-faq; https://learn.microsoft.com/en-us/office/dev/add-ins/testing/troubleshoot-manifest (2026-06-09); checklist |
| Task-pane add-ins with the add-in only manifest must have add-in commands (1120.3); image URLs must allow caching. | [POL] §1120.3; `docs/OFFICE.md` |
| A rule forcing the unified (JSON) manifest on new submissions: **NOT CONFIRMED** (no policy, Partner Center page or announcement Jan 2025 – Oct 2026 says so). | announcements, e.g. https://learn.microsoft.com/en-us/partner-center/announcements/2026-october (2026-10-15) |

`productionManifest` keeps the development manifest's `Id`, sets the version, puts every
`https://localhost:3000` URL on the public add-in URL, sets `SupportUrl` and the ribbon's « En savoir
plus » link, removes `<AppDomains>` (Stripe never opens in the task pane itself, §4) and refuses any
localhost or example.* URL left. Checked by Microsoft's service on 2026-10-18 with public test URLs:
« The manifest is valid ».

## 2. The listing

| Fact | Source |
|---|---|
| Flow: Partner Center → Marketplace offers → **Microsoft 365 and Copilot** → New offer → name → publisher → Product setup → Packages (manifest) → Properties (categories, legal) → Marketplace listings → Availability → Notes for certification → Review and publish. | add-in-submission-guide |
| Name ≤ **50** characters (30 recommended), no « free », « sale », « ! » or Microsoft product name. Summary ≤ **100**. Description ≤ **4 000** (the same page also says 10 000; 4 000 is the safe one). Keywords optional, no competitor names. | create-effective-office-store-listings; [POL] §100.1.2 |
| A French-only listing is allowed if the description begins or ends with « This application is available in French. » | [POL] §100.1.4 |
| Store logo PNG, square, **216–350 px**. | [POL] §100.3 |
| **At least one screenshot**: policy says 1280×720 PNG; the tips page says 1366×768, ≤ 1 024 KB (conflict; 1366×768 PNG under 1 MB satisfies the tips page, 1280×720 the policy: send 1280×720). | [POL] §100.3; https://learn.microsoft.com/en-us/partner-center/marketplace-offers/craft-effective-appsource-store-images (2025-01-30) |
| Categories: at most two (policy) or up to three (guide): choose ≤ 2. | [POL] §100.2.1; add-in-submission-guide |
| **Privacy policy URL** required (https, names the add-in, covers the whole service; terms of use are not a privacy policy). **Terms of use / EULA** required: Microsoft's Standard Contract (irreversible after publishing) or our own https link. Support URL https, not an e-mail. | checklist; [POL] §100.6 |
| An offer that needs a paid external service ticks « My product requires purchase of a service… » and says the charges in the description (price and currency, 100.4). | checklist; [POL] §100.4 |
| The five most common rejection causes (80 %): terms of use link, privacy link, testing instructions, service/account disclosures, the purchase flag and its disclosure. | add-in-submission-guide, step 10 |

`docs/appsource/listing-fr.md` is the listing (name « Facture Impec », summary, description with the
trial, the plans and the platforms, keywords). `listingProblems` checks the limits, the English
sentence, the words the name may not contain, and the blanks marked `⟨…⟩` that the owner must fill
(the prices, until confirmed: `docs/BILLING.md`).

## 3. Platforms

The manifest requires SharedRuntime 1.1, which Excel on iPad does not offer, so the add-in runs in
Excel on Windows, Mac and the web, **not on iPad**
(https://learn.microsoft.com/en-us/office/dev/add-ins/overview/office-add-in-availability, 2026-08-13).
Consequences:

- Answer **no** to « Will your app be listed in the Apple Store? »; then the iOS rules of policy 1120.2
  (no purchase, trial or upsell UI on iOS) do not apply. The pane still hides « Choisir une formule »
  when `Office.context.commerceAllowed` is false, should Microsoft ever load it on an iPad.
- 1120.3 asks that it work on Windows, Mac and the web, in the latest Edge, Chrome, Firefox and Safari,
  and with touch only. Only the web harness and Chrome were tried (`docs/RUNBOOK.md` § Add-in);
  Windows, Mac and Safari are part of the owner's run before submitting (§6).

## 4. Purchases: Stripe from the task pane

| Fact | Source |
|---|---|
| `Office.context.ui.openBrowserWindow(url)` opens the system browser (OpenBrowserWindowApi 1.1): Windows, Mac, iPad; **not Excel on the web**. | https://learn.microsoft.com/en-us/javascript/api/requirement-sets/common/open-browser-window-api-requirement-sets |
| A dialog (`displayDialogAsync`) opens on a page of the add-in's own domain and may then navigate elsewhere; `displayInIframe` defaults to false (a separate window). | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/dialog-api-in-office-add-ins |
| An add-in « must not launch functionality outside of the app or add-in experience without the explicit permission of the user » (1100.4). | [POL] §1100.4 |
| Stripe advises against putting Checkout in an iframe. | https://docs.stripe.com/payments/accept-a-payment?payment-ui=checkout&ui=embedded-page |

So (`apps/addin/src/pages.ts`): only after a click, and only to `https://checkout.stripe.com` or
`https://billing.stripe.com`, the pane uses `openBrowserWindow` where it exists, and in Excel on the web
a dialog on our `redirect.html?to=…`, which forwards to Stripe only an allowed page. No AppDomain is
needed for either. Back in the pane, « Actualiser » reads the subscription the webhook recorded.

## 5. The reviewers

| Fact | Source |
|---|---|
| Notes for certification must give everything the reviewer needs (test accounts, keys); no employee e-mail to ask; unclear notes « will automatically fail ». | add-in-submission-guide, step 9 |
| « we request that you do not configure test accounts that require developer interaction before we can test » (several time zones). | https://learn.microsoft.com/en-us/partner-center/marketplace-offers/submit-to-appsource-via-partner-center |

So the reviewers sign in with an **access key**, not an e-mailed link, on a company created for them in
pilot status (never billed). The operator never switches it live, so in prod a real send is refused
(`not_live`) and the notes have them use « Mode test », which goes to B2Brouter's sandbox:

```bash
# On the deployed API (docs/DEPLOY.md). Prints the key once: paste it into Partner Center, nowhere else.
ADMIN_TOKEN=… pnpm seed:demo --api https://api.<domain> --provider b2brouter <review mailbox>
```

`docs/appsource/certification-notes.md` walks them through it with the pane's real labels; the package
fills in the URLs and a tab-separated sample (`sample-invoices.tsv`, ISO dates and plain numbers, so it
pastes the same in any Excel language). The key goes in by hand in Partner Center's box
(`{REVIEW_ACCESS_KEY}`), never in the repo, `dist/` or a message.

## 6. Building the package

```bash
pnpm appsource:package --addin https://app.<domain>/ --support https://<domain>/aide \
  [--help https://<domain>/aide#excel] --version 1.0.0.0 [--validate] [--draft]
```

It writes `dist/appsource/`: `manifest.xml`, `icon-32.png`, `icon-64.png` (also served by the add-in
from `assets/`), `store-logo-300.png`, `listing-fr.txt` (to paste), `certification-notes.txt`,
`sample-invoices.tsv`, and with `--validate` Microsoft's verdict in `validation.txt` (it sends the
manifest, public URLs only, to `validationgateway.omex.office.net`). It exits 1 while Partner Center
would refuse something (a limit, a blank `⟨…⟩`); `--draft` writes the files anyway. Screenshots are not
generated: they must show the add-in in Excel (§2, 1280×720 PNG).

## 7. What only the owner can do

1. A Partner Center account and its publisher name; set `ProviderName` in `apps/addin/manifest.xml` to
   that exact name if it is not « Facture Impec ».
2. Host the add-in and the API on public https (`docs/DEPLOY.md`) and publish the support, privacy and
   terms pages. The marketing site has `/confidentialite` (its « à compléter » markers to fill, and it
   must cover the add-in, not only the site); there is no support page and no CGU page yet.
3. Fill the prices in `docs/appsource/listing-fr.md` once confirmed with Stripe's.
4. Create the reviewers' company and paste its key in the notes (§5); take one or more 1280×720
   screenshots in Excel; try the add-in on Windows, Mac and the web (§3).
5. Decide the two open questions below.

### Open questions (owner)

- **The name and the brand (1100.7).** « The title may not include your brand or service unless your
  offer targets a larger organization or enterprise. » The listings page meanwhile suggests
  « function + for + brand ». « Facture Impec » is the brand. Options: keep it and see whether review
  objects, or a descriptive title such as « Facture électronique depuis Excel » (allowed by
  `listingProblems`; the manifest's `DisplayName` must then say the same).
- **Purchases outside Marketplace (100.4).** « If your in-offer purchases are not possible with
  Microsoft's APIs, you may use any third-party payment system », but also « All purchase transactions
  associated with your offer must begin by using a starting point in Microsoft Marketplace listing »
  and no redirecting « to software or services outside Marketplace ». How this applies to a free
  add-in paid through Stripe: **NOT CONFIRMED** (no page addresses it). The product discloses the
  charges in the listing and ticks the purchase flag; whether review also wants a Marketplace SaaS
  offer as the starting point would only show at review.
