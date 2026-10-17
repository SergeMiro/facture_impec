# Pricing research and proposed grid

Checked on **2026-10-17**. All prices are in euros, excluding VAT (HT), unless marked otherwise.

**How this was collected:** WebFetch and WebSearch only.
- browser: none. The Browserbase cloud browser answered HTTP 402, so no page was rendered with
  JavaScript.
- Some pricing pages load their amounts with JavaScript. Those are marked below.

**Evidence tags used in every row:**

- **[P]** Primary: read on the vendor's own page today.
- **[S]** Secondary: from a comparison site or a press article, not from the vendor's page.
- **[U]** Unverified: the sources conflict, or the number could not be found.

**Market context:**
- Since 1 Sept 2026, every French VAT-registered company must be able to **receive** e-invoices.
- **Emission** becomes mandatory for TPE/PME on 1 Sept 2027.
- Until then, small companies buy for reception, plus voluntary emission.

---

## 1. Benchmark: offers a French TPE/PME compares in October 2026

### 1.1 Public price lists

| # | Offer | Plans and price HT / month | Invoice quota | E-invoicing (receive / send) | Free tier | Trial | Segment | Tag, source |
|---|---|---|---|---|---|---|---|---|
| 1 | **B2Brouter web app** (our PA) | Basic 0 €; **Professional 110 €/yr** (≈ 9.17 €/mo), 2 users; **Business 300 €/yr** (25 €/mo), 10 users. Billed yearly only. | Basic: 24 transactions/yr (sent + received). Paid plans: unlimited. | Professional and Business: both included. Basic: the feature list says yes, but the compliance table says no (the page contradicts itself). | Basic, for life, but **only for VAT-exempt activities** | none | Professionals and TPE with low or medium revenue | [P] B1 |
| 2 | **Pennylane** (independents: EI, SASU, EURL, SCI) | Starter 7 € (needs a Compte Pro); Basique 14 €; Essentiel 24 €; Premium 79 € (adds the accounting module) | **Up to 1,200 invoices/yr** on every plan | Included "sans surcoût" in every plan; receive and send not listed separately | none | **15 days** | Independents. TPE and PME: on quote, not public. | [P] B2 |
| 3 | **Tiime** | Free 0 €; Initial 9.99 € (119.88 €/yr); Smart 17.99 → 49.99 €; Business 24.99 → 65.99 €, by headcount band (0–1, 2–5, 6–20 employees); 20+ employees on quote | Unlimited | **Both included in every plan**, "100 % gratuite" | Yes | **60 days** on paid plans | Micro-entrepreneurs to small companies | [P] B3. Which band each price belongs to was inferred from the order of the tabs. |
| 4 | **Qonto Facturation** | Facturation alone **0 €** (no bank account needed). Bank plans, monthly price when billed yearly: Solo 9 / 19 / 39 €; Company 49 / 109 / 199 €. Automated invoicing add-on: 12 €/mo. | Unlimited | **Send and receive, free**: Qonto is a PA | Yes | 1 month on bank plans | Freelancers to PME | [P] B4, B5 |
| 5 | **Indy** | Essentiel **0 €**; Plus 9 € (108 €/yr, or 12 € billed monthly); Autonomie 15–49 €; Sérénité 63–99 €; Exclusivité 149 € (prices depend on legal form) | Unlimited | "Facturation électronique (Plateforme agréée)" is included from the 0 € plan | Yes | not stated | Micro-entrepreneurs, EI, SCI, SAS/SARL | [P] B6. The page is partly garbled; some Plus prices were read from footnotes. |
| 6 | **Abby** | Basique 0 €; Start 9 € (8.10 € in an autumn promotion); Pro 15 € (13.50 €); Business 33 € (29.70 €) | Basique: unlimited; others not stated | Listed in every plan; receive and send not separated | Yes | **14 days** | Micro-entrepreneurs to SARL/SAS | [P] B7. Up to -20 % if paid yearly; the yearly amounts are not shown. |
| 7 | **Henrri** | Pro **0 €**; Expert 17 € yearly / 19 € monthly; Smart 25 / 29 €; VIP 49 / 59 € | Unlimited | **Send and receive, unlimited, every plan** | Yes | not mentioned | TPE/PME, micro-entrepreneurs | [P] B8. **Automatic payment chasing only in VIP** (49 €). |
| 8 | **Zervant** | Free 0 € (5 clients); Start 9 € yearly / 11 € monthly; Plus 20 / 25 € | Unlimited invoices | **Receive: included in every plan.** Send: not stated (Plus is recommended for public-sector e-invoices). | Yes | 30 days | New to established small businesses | [P] B9. The page does not say whether prices are HT or TTC [U]. |
| 9 | **Freebe** | One plan: 12.50 € **TTC**/mo (150 € TTC/yr), about **10.42 € HT**/mo, 125 € HT/yr (computed at 20 % VAT) | Unlimited | "Conformes à la facturation électronique 2026"; receive and send not detailed | none | 30 days, no card | Freelancers | [P] B10 |
| 10 | **Sellsy Facturation** | Per user per month, yearly billing: Standard 39 € (29 € promo), Evolution 59 € (49 € promo), Elite 79 €. Monthly billing: 47 / 71 / 95 €. The promotions run until **31 Oct 2026**. 12-month commitment. | not stated | "Conforme Facturation Électronique"; whether PA reception is included is not stated | none | "Essai gratuit", length not stated | TPE (Standard) to growing PME | [P] B11. The Vente + Facturation pack needs at least 2 users. |
| 11 | **Axonaut** | FAQ: **97 €/mo with 1 user, plus 30 €/mo per extra user**. Banner: "dès 38 €/mois". 1-year payment -10 %, 2 years -20 %, longer up to -30 % or more. | not stated | "Sans surcoût dans votre abonnement"; Axonaut claims PA status. **Automatic chasing included.** | none | 15 days | TPE/PME, all-in-one suite | [P] B12. The amounts are loaded by JavaScript and the banner contradicts the FAQ [U]. Secondary sources give 34.99–69.99 € by commitment length [S] B13. |
| 12 | **Sage Accès PA** | 10 € (25 invoices/mo); 18 € (50); 32 € (100); 63 € (250); 109 € (500). Above the quota: 0.42 € per invoice from 26 to 500, then 0.22 €. No commitment. | Per tier | PA access for companies without compliant software | Launch offer: 25 invoices/mo free until Dec 2026 [U] | — | Micro-entrepreneurs, TPE/PME | [S] B14. Sage's own pages return 403. |
| 13 | **Fiducial Facilia** | Achats (receiving) **4.90 €/mo**, plus a fee per received and accepted invoice (amount not given). Ventes (sending) **14.90 €/mo**, includes quotes, invoices and **reminders**. | Usage-based for received invoices | Separate products for receiving and sending | none | not stated | TPE (accounting-firm network) | [P] B15. Unlimited users. |
| 14 | **Libeo** | **On quote only**. Multi-entity pricing is "dégressive". | — | Reads Factur-X; works with the PA SÉRÈS | — | — | Finance teams in PME, groups, franchises | [P] B16 |

### 1.2 Relevant offers with no verifiable public price

| Offer | What could be found | Tag |
|---|---|---|
| B2Brouter integrated products (eDocExchange, eDocSync, eAccounting) | Price on request. eDocSync charges a one-time fee per added account. The startups programme gives a "100 % discount" on the white-label API. | [P] B17, plus `docs/B2BROUTER.md` §9 |
| Cegid (PA-0005) | No public price for TPE. A comparison site says Cegid's TPE offer moves to Shine after Cegid bought Shine. | [U] B18 |
| Evoliz | Not a PA itself; uses Chaintrust (Visma's PA). Plans of 16 / 32 / 44 € a month when paid yearly, from an undated page. | [S][U] B19 |
| Jefacture (ECMA) | "Gratuit, puis dès 5 € HT/mois", according to comparison sites. Whether a full price list is published is disputed. | [S][U] B20 |
| Super PDP | Free account under 1,000 invoices a month, then per-invoice API pricing. Its "free" label is disputed. | [S][U] B21 |
| Facture.net | Free, with a pledge to stay free after the reform. Its own pricing URL returns 404. | [S][U] B22 |
| Docoon Invoice | Price on quote: a yearly subscription plus usage. Capterra shows "from 1 €". Aimed at software vendors and ETI. | [S] B23 |
| Esker, Generix | Enterprise PA (ETI and large companies), sold on quote. Not checked; out of our segment. | [U] |

### 1.3 What the benchmark says

1. **Compliance alone is free.** These charge 0 € to send and receive:
   - Qonto Facturation, Tiime Free, Indy Essentiel, Abby Basique and Henrri Pro;
   - probably also Facture.net, Jefacture and Super PDP [S].

   Those vendors make their money on a bank account, accounting or an ERP suite. Facture Impec
   cannot charge for "being compliant". It must charge for:
   - staying in Excel;
   - never sending an invoice that gets rejected;
   - getting paid faster.
2. **Paid entry plans cluster at 9–19 €/month:**
   - Tiime Initial 9.99 €
   - Indy Plus 9 € (12 € monthly)
   - Abby Start 9 €
   - Zervant Start 9 € (11 € monthly)
   - Freebe ≈ 10.40 €
   - Sage 10 € for 25 invoices, 18 € for 50
   - Pennylane Basique 14 €
   - Henrri Expert 17 € (19 € monthly)
   - Fiducial: 19.80 € for receiving + sending
3. **Mid plans sit at 24–49 €/month:**
   - Pennylane Essentiel 24 €
   - Tiime Business 24.99–39.99 €
   - Abby Business 33 €
   - Sellsy Facturation 29–59 € per user
   - Henrri VIP 49 €
4. **Automatic payment chasing is what vendors charge more for:**
   - Henrri: VIP only, 49–59 €.
   - Qonto: automation add-on, 12 €.
   - Zervant: Plus is the plan pitched for "frequent reminders".
   - Fiducial: reminders bundled in the 14.90 € sending product.
   - Axonaut: included at 97 €.
5. **Trial lengths:** 14 days (Abby), 15 (Pennylane, Axonaut), 30 (Qonto, Zervant, Freebe),
   60 (Tiime).
6. **Discount for paying yearly:**

   | Vendor | Discount |
   |---|---|
   | Henrri | -10.5 % |
   | Sellsy | -17 % |
   | Zervant | -18 % |
   | Abby | up to -20 % |
   | Indy | -25 % |
   | Axonaut | -10 % for 1 year, -20 % for 2 years |

   The middle of the range is about -17 %, which is "2 months free".
7. **Bring-your-own AI key:** no French competitor checked offers it [U: not searched
   exhaustively]. It would set us apart.

---

## 2. Offers for accounting firms (multi-company, white label)

| Offer | Price and terms | Tag, source |
|---|---|---|
| **Pennylane "cabinet créateur"** | Production tool free for the **first 50 dossiers**: the page says both "6 months" and "one year". Internal management tool and Compte Pro free for the firm. No price after the free period. | [P] B24 |
| **Chaintrust** (Visma PA, used by Evoliz) | **5 € HT per dossier** (cash-basis bookkeeping) or **20 € HT per dossier** (accrual bookkeeping), from the vendor's blog as quoted by a comparison site. Its 2022 terms say 20 € HT per dossier per month. | [S] B25; terms [P] but dated 2022 |
| **Jefacture** | Free for the firm's own invoices. For clients the firm invites, the firm pays by usage and resells "tout compris". No amounts found. | [S] B20 |
| **Henrri** | Multi-company "centre multi-compte" in every plan. Expert (17 €) and Smart (25 €) link **5 companies**, VIP (49 €) links **10**. | [P] B8 |
| **Tiime** | Full accountant collaboration in Smart and Business; "3,000 partner firms". No price per firm. | [P] B3 |
| **Qonto (accountants)** | The PA is included "sans surcoût" in the client's plan. The firm tracks client registrations and invoice life cycles from one space. No price per firm on the page. | [P] B26 |
| **Libeo** | Section for accounting firms with a "Demander les tarifs" button. No price. | [P] B16 |
| **B2Brouter eAccounting / eDocSync white label** | On request. eDocSync has a dedicated plan for 100+ companies. | [P] B17 |
| **Super PDP** | Publishers resell the API under their own brand at wholesale per-invoice rates. No amounts. | [S] B21 |

**What this means:** firms are being offered free periods (Pennylane) or about 5–20 € per
dossier (Chaintrust). Full white label has **no public price** anywhere.

---

## 3. Proposed grid for Facture Impec

### 3.1 Cost assumption (B2Brouter price unknown)

**What is unknown:** B2Brouter's eDocSync price is "on request" (see `docs/B2BROUTER.md` §9,
T12). That covers the one-time fee per account, the price per transaction and the quota per
account. B2Brouter bills both **sending and receiving** [P, B2BROUTER.md §9].

**Public anchors:**

- B2Brouter's own retail Professional plan costs 110 €/yr for **unlimited** transactions, about
  9.17 € a month per company. Treat this as a ceiling: the cost of one account should not exceed
  what the customer could pay B2Brouter directly.
- Sage's retail price above quota is 0.42 € per invoice, falling to 0.22 € [S].
- One aggregator gives a market range of 0.0025–0.50 € per invoice, attributed to no named
  vendor [S] B27.

**Working assumption:**

| Cost item | Assumed value |
|---|---|
| PA cost per billable transaction (sent or received) | **≤ 0.05 €** |
| Fixed cost per company account (one-time fee spread over time, plus e-reporting ledgers) | **1 €/month** |
| Model cost per AI action, when we pay for the AI | **≤ 0.02 €** (a budget cap to be measured from real token counts, not a vendor quote) |

Card processing (about 3 %) and VAT are left out.

**Usage of a typical customer (assumption):**

| Plan | Sent / month | Received / month | AI actions / month |
|---|---|---|---|
| Essentiel | 15 | 30 | 50 |
| Croissance | 50 | 80 | 150 |
| One dossier on the Cabinet plan | 15 | 30 | 15 |

**Gross margin at typical usage, by PA cost scenario:**

| Plan (yearly price) | 0.02 €/tx | **0.05 €/tx** | 0.10 €/tx | 0.25 €/tx | Flat 9.17 €/account |
|---|---|---|---|---|---|
| Essentiel, 15 € | 81 % | **72 %** | 57 % | 12 % | 32 % |
| Croissance, 39 € | 83 % | **73 %** | 56 % | 6 % | 69 % |
| Cabinet, 9 € per dossier | 76 % | **61 %** | 36 % | -39 % | -5 % |

**Highest PA cost that keeps a 70 % gross margin at typical usage:**

| Plan | Highest cost per transaction |
|---|---|
| Essentiel | 0.056 € |
| Croissance | 0.059 € |
| Cabinet | 0.031 € |

**Decision rule once B2Brouter quotes:**

- Ask B2Brouter for an effective cost of **≤ 0.05 € per transaction** and the startups discount.
- If the quote works out above **0.10 € per transaction**, or close to the flat retail price:
  - raise Essentiel to 19 € (yearly) / 23 € (monthly) and Cabinet to 12 € per dossier;
  - or count received invoices against the quota.
- Croissance holds up to about 0.10 € per transaction.
- **Do not publish prices before that quote.**

### 3.2 The three plans

The annual price gives **2 months free** (about -17 %), the middle of the benchmark.

| | **Essentiel** (TPE, solo) | **Croissance** (growing business) | **Cabinet** (accounting firm) |
|---|---|---|---|
| **Monthly billing, HT** | **18 €/mo** | **47 €/mo** | **11 € per dossier per month** |
| **Yearly billing, HT** | **15 €/mo** (180 €/yr) | **39 €/mo** (468 €/yr) | **9 € per dossier per month**; 7.50 € from 50 dossiers; 6 € from 200 |
| **Minimum** | 1 company (SIREN) | 1 company | 10 dossiers (90 €/mo yearly) |
| **Users** | 1, plus free read-only access for the accountant | 3 | Unlimited firm staff, plus 1 client user per dossier |
| **Invoices sent / month** | 30, then 0.30 € each | 100, then 0.20 € each | 30 per dossier, pooled across the firm |
| **Invoices received / month** | Fair use, 60 | Fair use, 200 | Fair use, 60 per dossier, pooled |
| **AI included (fair use)** | 100 AI actions | 500 AI actions | 30 per dossier, pooled |

**Every plan includes:**

- the Excel add-in;
- deterministic validation before sending (EN 16931 and French checks);
- Factur-X conversion;
- sending through the PA, with status tracking until the invoice is paid;
- a supplier-invoice inbox inside Excel;
- explanations in plain French;
- "Mode test";
- an audit log.

**Added by each plan:**

- **Essentiel:** a ready-to-send payment reminder in one click (manual chasing).
- **Croissance:** everything in Essentiel, plus:
  - automatic chasing sequences (for example day 1, day 7 and day 15 after the due date, then a
    formal-notice draft);
  - calculation of late-payment interest and the 40 € fixed recovery fee;
  - a **weekly report** by email (money received, overdue invoices, days to get paid);
  - approval of supplier invoices;
  - priority support.
- **Cabinet:** everything in Essentiel for each dossier, plus:
  - a multi-company dashboard;
  - bulk validation and alerts across clients;
  - the firm's name and logo on reminders and reports;
  - inviting clients and managing their PA mandate.
  - Croissance features on a dossier: **+10 € per dossier per month**.
  - Full white label (own sender domain, no Facture Impec mention): on quote, **from 150 €/mo**.
    No public benchmark exists, so validate this in customer interviews [U].

**Free trial:**
- **Essentiel and Croissance:** 30 days with all Croissance features. "Mode test" is unlimited;
  real sends to the PA are capped at 10 to limit our PA cost.
- **Cabinet:** 60 days, up to 5 dossiers in production.

**Free tier:** none at launch. Every received invoice costs us at B2Brouter. The 0 € competitors
are funded by bank, accounting or ERP upsells, which we do not have. Revisit once the PA cost is
known; a free "receive only" tier could become an acquisition channel.

**Launch offer (optional):** yearly subscriptions signed **before 1 Sept 2027** keep their price
until 31 Aug 2028. This rewards adopting before emission becomes mandatory.

### 3.3 Why these numbers

- **Essentiel, 15 € yearly / 18 € monthly.**
  - It sits at the top of the 9–19 € entry cluster: Pennylane Basique 14 €, Henrri Expert
    17–19 €, Sage 18 € for 50 invoices, Fiducial 19.80 € for receiving + sending.
  - It is above the free compliance tools on purpose. What the customer pays for is "keep
    invoicing from your Excel file, and nothing rejected leaves it". That workflow is not offered
    by any tool in the benchmark.
  - The 30 invoices sent are more than Sage's 25-invoice tier (10 €). The overage of 0.30 € is
    below Sage's 0.42 €.
  - At the working assumption, the gross margin is 72 %.
- **Croissance, 39 € yearly / 47 € monthly.**
  - This is the plan that makes money, because chasing brings cash in.
  - It is cheaper than Henrri VIP (49 € yearly / 59 € monthly), the first Henrri plan with
    automatic chasing. It is far cheaper than Axonaut (97 €, chasing included).
  - It costs more than plans without chasing: Pennylane Essentiel 24 €, Tiime Business
    24.99–39.99 €, Abby Business 33 €.
  - Qonto plus its automation add-on costs 19 € + 12 € = 31 € and has no weekly report.
  - Sellsy Facturation is 49–59 € **per user**; ours includes 3 users.
  - Gross margin: 73 % at the working assumption, and about 69 % even at the flat retail
    ceiling.
- **Cabinet, 9 € per dossier.**
  - It is between Chaintrust's 5 € (cash basis) and 20 € (accrual) per dossier.
  - It costs about 60 % of Essentiel. The firm handles first-line support, and one sale brings
    many dossiers.
  - Volume discounts follow eDocSync's dedicated plan for 100+ companies, which should cut our
    cost.
  - Pennylane's free 50 dossiers are the real threat. The 60-day trial and the +10 € Croissance
    option for each dossier are the answer. Do not match a free offer that is subsidised.
  - **This plan is the most sensitive to the PA price:** it needs ≤ 0.03 € per transaction for a
    70 % margin. Negotiate firm volumes with B2Brouter before launching it.

### 3.4 AI included vs bring your own key (BYOK)

| | **AI included** (default) | **BYOK** (OpenAI, Anthropic, Mistral or any OpenAI-compatible endpoint) |
|---|---|---|
| Price | Plan price | **Essentiel -1 €/mo · Croissance -3 €/mo · Cabinet -0.30 € per dossier per month**, on monthly and yearly billing alike |
| AI quota | Fair use, as in §3.2 | No cap: the customer pays their own tokens |
| Models | Ours, tested against `packages/agents` evals; data pseudonymised by default | The customer's choice. Explanation quality is guaranteed only on the models we test. |
| Data | Our model provider's terms | The customer's own contract (for example an EU-hosted Mistral key) |
| If the AI fails | We handle it | Clear error ("your AI key was refused"); validation, sending and tracking keep working |

**Why the discount is small:**

- **It matches the money we save.** The discount equals the AI cost we would have paid at
  typical usage under the ≤ 0.02 € per action budget:
  - Essentiel: 50 actions ≈ 1 €
  - Croissance: 150 actions ≈ 3 €
  - One Cabinet dossier: 15 actions ≈ 0.30 €

  So the discount leaves our margin unchanged.
- **AI is not the main cost.** The cost that matters is the PA.
- **A larger discount would push customers to BYOK.** That would bring support tickets we cannot
  fix: invalid keys, rate limits, and models we have not tested.
- **BYOK is mainly a trust feature.** It suits firms and PME with a data policy, so sell it that
  way rather than as a saving.
- **"AI off" costs the same as BYOK.** The deterministic core does not need AI to validate or send
  (plan §0), so a customer can turn AI off at the same price.

---

## 4. Open points

1. **The B2Brouter eDocSync quote** sets every margin above. Ask for: the one-time fee per
   account, the price per transaction, the quota per account, the 100+ company plan, and the
   startups programme terms. Owner action, see `docs/B2BROUTER.md` T12.
2. Measure the real AI cost per action once the prompts exist, then re-check the BYOK discounts.
3. Test willingness to pay with 5–10 TPE that invoice in Excel, and 2–3 accounting firms,
   especially for the white-label floor of 150 €/mo.
4. Re-check Sellsy (promotion ends 31 Oct 2026), Sage Accès PA (launch offer ends Dec 2026) and
   Axonaut (amounts loaded by JavaScript) in a real browser.

---

## Sources (all checked 2026-10-17)

- B1 https://www.b2brouter.net/fr/tarifs/ [P]
- B2 https://www.pennylane.com/fr/tarifs [P]
- B3 https://www.tiime.fr/tarifs [P] (only the first 100k characters were read)
- B4 https://qonto.com/fr/pricing [P]
- B5 https://qonto.com/fr/invoicing/free-tool [P]
- B6 https://www.indy.fr/tarifs/ [P] (garbled in places)
- B7 https://abby.fr/tarifs/ [P]
- B8 https://www.henrri.com/nos-formules/ [P]
- B9 https://www.zervant.com/fr/tarifs/ [P]
- B10 https://www.freebe.me/tarifs [P]
- B11 https://go.sellsy.com/tarifs [P]
- B12 https://axonaut.com/content/prix [P] (amounts partly missing from the static HTML)
- B13 https://independant.io/avis/axonaut/ and https://www.codeur.com/comparatif/logiciel-facturation-conseil-expert-comptable/axonaut-expert-comptable [S]
- B14 https://www.blogdumoderateur.com/tools/sage-acces-pa/ [S]; https://www.sage.com/fr-fr/produits/sage-acces-pa/ returned 403
- B15 https://www.fiducial.fr/facturation-electronique/faq/quel-prix-plateforme-agree [P]
- B16 https://libeo.io/tarifs [P]
- B17 https://www.b2brouter.net/fr/tarification-des-produits-integres/ and https://www.b2brouter.net/be/prix-produits-integres/ [P]
- B18 https://www.comparatif-facture-electronique.fr/cegid-facturation-electronique-avis/ [S]
- B19 https://independant.io/avis/evoliz/ and https://comparepdp.com/articles/evoliz-avis [S]
- B20 https://les-experts-comptables.fr/avis-jefacture and https://comparateur-efacturation.fr/plateforme/jefacture [S]
- B21 https://digitiz.fr/superpdp/ and https://comparateur-efacturation.fr/plateforme/superpdp [S]
- B22 https://comparateur-efacturation.fr/plateforme/facture-net [S]; https://www.facture.net/tarifs returned 404
- B23 https://www.comparatif-facture-electronique.fr/docoon-facturation-electronique-avis/ and https://www.capterra.fr/software/1086050/Docoon-invoice [S]
- B24 https://www.pennylane.com/fr/cabinet-createur [P]
- B25 https://www.blogdumoderateur.com/tools/chaintrust/ [S]; https://cdn.chaintrust.io/wp-content/uploads/2022/01/12130257/CGV.pdf [P, 2022]
- B26 https://qonto.com/fr/accountants/e-invoicing [P]
- B27 https://ma-facture-electronique.org/plateforme-agreee/prix-tarifs/ [S] (updated 2026-10-06)
