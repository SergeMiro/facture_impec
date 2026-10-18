# Onboarding: « Créer un compte » (plan §11 M7)

A person with Excel and a SIREN gets a company account without the operator. Code:
`apps/api/src/onboarding.ts` (routes), `apps/api/src/sirene.ts` (directory client), stand-in
`apps/mock-pdp/src/sirene.ts` (`/sirene`), pane `apps/addin/src/ui/Signup.tsx`; tests
`apps/api/src/onboarding.test.ts`, `apps/addin/src/controller.test.ts` › creating an account,
`apps/api/src/pilot.test.ts`.

**Sources.** Every external fact below was read on **2026-10-18**, by plain HTTP (`browser: none`).
`annuaire-entreprises.data.gouv.fr` sits behind a bot wall and Browserbase answered 402 (quota), so
where its pages were unreachable the DINUM's own source code on GitHub is the source, named as such.
Live calls went only to large companies (EDF 552081317, TotalEnergies 542051180, DINUM 130025265).
**NOT CONFIRMED** = no fetched page states it.

---

## 1. The directory: API Recherche d'entreprises (DINUM)

### 1.1 Endpoint

| Fact | Source |
|---|---|
| `GET https://recherche-entreprises.api.gouv.fr/search?q=<SIREN>`: a `q` of exactly 9 digits (spaces removed) is a direct lookup that ignores every other filter. | https://recherche-entreprises.api.gouv.fr/openapi.json (`/search`); `app/elastic/parsers/siren.py` in github.com/annuaire-entreprises-data-gouv-fr/search-api |
| `minimal=true&include=siege,tva` returns the head office and the VAT numbers only; `include` without `minimal=true` is a 400. We also send `per_page=1`. | openapi.json; live calls |
| An unknown SIREN is **HTTP 200** with `results: []`, not a 404. | live call `q=000000000` |
| No key, no sign-up (« L'API étant totalement ouverte d'accès »). | openapi.json `info.description`; https://www.data.gouv.fr/dataservices/api-recherche-dentreprises |
| At most **7 requests/s per IP** and 30/s per ASN, a ceiling, not a promise; beyond it **429 with `Retry-After`**. A descriptive `User-Agent` is asked for. | openapi.json `info.description` |
| Data rebuilt **daily** from Sirene (INSEE) and RNE (INPI). No SLA. DINUM may change or suspend the service « sans préavis ». Contents under Licence Ouverte. | search-api and search-infra READMEs on GitHub; `modalites-utilisation.tsx` in github.com/annuaire-entreprises-data-gouv-fr/site |

What we do: one call per lookup, 8 s timeout, `User-Agent: FactureImpec/1.0 (inscription; +site)`.
A 429, a timeout or a 5xx is `DirectoryUnavailable` (the pane then offers to type the company in);
a 200 without result is « aucune entreprise ne porte ce SIREN ».

### 1.2 Fields used

| Field | Use | Source |
|---|---|---|
| `nom_raison_sociale`, else `nom_complet` | Legal name, prefilled | openapi.json `result` |
| `etat_administratif` `C` (cessée) | Refused: `company_closed` | openapi.json |
| `siren_conserve` not null (duplicate SIREN) | Refused, the kept SIREN shown: `company_duplicate` | openapi.json |
| `siege.numero_voie`, `indice_repetition`, `type_voie`, `libelle_voie`, `complement_adresse`, `distribution_speciale`, `code_postal`, `libelle_commune`, `cedex`, `libelle_cedex`, `libelle_commune_etranger` | Head-office address, prefilled (a foreign country comes as an INSEE code, so the person picks it) | openapi.json `siege`; spec quirk: `complement_adresse` is described as the commune code but holds the complement (live data) |
| `tva[]` | « Liste des numéros de TVA intracommunautaire français actifs (source : DGFiP) » → `vatSource: 'dgfip'` | openapi.json; `workflows/data_pipelines/tva/` in search-infra |
| `statut_diffusion` `P` | `masked: true`, the pane says some fields were withheld at the company's request | openapi.json |

What `tva` holds for a company without an active number (`[]`, `null`, absent): **NOT CONFIRMED**; all
three are read as « none ».

### 1.3 Partial diffusion

| Fact | Source |
|---|---|
| The published docs say non-diffusible companies are not in the API. | openapi.json `info.description` |
| The code returns them on a direct SIREN lookup with fields replaced by the literal **`[NON-DIFFUSIBLE]`**: for a legal person only `sigle`; for an individual also the names; for the head office every street-level field. `libelle_commune` and `commune` stay. | `app/service/formatters/non_diffusible.py` and `app/elastic/text_search.py` in search-api (main @ 17af23c, 2026-10-08) |
| Whether the deployed API matches GitHub `main`: **NOT CONFIRMED** (observing one would mean querying a private individual). | — |

What we do: any field equal to `[NON-DIFFUSIBLE]` is empty, for the person to type. An individual
entrepreneur in partial diffusion therefore types their own name and street.

### 1.4 Search by name (Clients, M8)

The same endpoint serves the PartyAgent's « Chercher dans l'annuaire » (`apps/api/src/sirene.ts`
`search`, `packages/agents/src/party.ts`). Read 2026-10-18 from openapi.json and live calls (EDF).

| Fact | Source |
|---|---|
| A `q` that is not 9 digits is a text search; we send the name the user typed. | openapi.json `/search` `q` |
| `q` needs **at least 3 characters**, else 400 `{"erreur":"3 caractères minimum pour les termes de la requête (ou utilisez au moins un filtre)"}`. No parameter at all is 400 « Veuillez indiquer au moins un paramètre de recherche. » | live calls |
| `per_page` is **at most 25**, with `page` for the next ones; the answer carries `total_results`, `page`, `per_page`, `total_pages`. | openapi.json; live call |
| `etat_administratif=A` keeps active companies; `code_postal` filters on the post code of any establishment, not only the head office. | openapi.json |
| `include` still needs `minimal=true` (400 « Veuillez indiquer si vous souhaitez une réponse minimale avec le filtre `minimal=True`… » otherwise). | live call |
| `q=electricite de france` returns EDF (552081317, VAT FR03552081317 in `tva`) first. | live call |

What we do: `per_page` = min(limit, 25), `etat_administratif=A`, `code_postal` only when it is 5 digits,
`minimal=true&include=siege,tva`, and the results in the directory's order. The PartyAgent asks for three
letters before calling, asks again without the post code when the post code narrows to nothing, keeps
five candidates with the exact name first, and asks the platform's directory (`lookupRecipient`) whether
each one can be reached. « C'est ce client » looks the SIREN up again (§1.1) and saves only an active
company that is not a duplicate. The directory receives the words the user typed in the search and
nothing else; no customer name from a sheet is sent unless the user clicks « Trouver ce client », which
fills the search with it.

## 2. The VAT number

| Fact | Source |
|---|---|
| Structure: « FR + 2 chiffres (clé informatique) + N° SIREN ». Not every company has one (franchise en base, operations outside VAT). | https://bofip.impots.gouv.fr/bofip/1149-PGP.html/identifiant=BOI-TVA-DECLA-20-10-20-20220216 §110–130; https://entreprendre.service-public.gouv.fr/vosdroits/F23570 |
| The usual key `(12 + 3 × (SIREN mod 97)) mod 97` is published by **no official source**. It gives the issued key for EDF (03), TotalEnergies (59) and DINUM (07); BOFiP's own example `FR 31 734820078` does not satisfy it (illustrative?). | BOFiP and F23570 (absence); DGFiP dataset; local computation |
| DGFiP: computed numbers « ne correspondai[en]t pas au numéro TVA effectivement fourni », hence its open list of active numbers (Licence Ouverte 2.0, updated on working days). | https://data.economie.gouv.fr/api/v2/catalog/datasets/numeros-de-tva-intracommunautaires-francais/attachments/description_fichier_tvaintrapdf (dated 2026-06-11) |

What we do (`computedVatId`): the directory's DGFiP number when there is one (« Numéro de TVA
publié »); otherwise the computed number marked « à confirmer », which the person keeps, corrects or
clears. The API only checks that a VAT number given ends with the SIREN (`vat_mismatch`). An invoice
always carries the number the company confirmed, never one we guessed silently.

## 3. The flow and the decisions taken

1. `GET /onboarding/company/:siren`: SIREN check digit, no account for it yet, directory lookup.
2. `POST /onboarding/signup { siren, email, company, acceptTerms: true, termsVersion }`: the directory is
   asked again (the person may have typed the company while it was down); at most **3 requests per
   e-mail and 3 per SIREN per hour** (`too_many_signups`); a link valid **60 minutes** is e-mailed.
3. The link opens a page with a button (`GET` shows, `POST` acts, so a mail scanner that follows links
   creates nothing). The button creates the company and its owner in one transaction: trial of
   30 days, « Mode test » on, the deployment's platform (`b2brouter` outside local) with the SIREN as
   account, terms version and date recorded, audit `tenant.create` by `signup`.
4. The pane, polling `POST /onboarding/poll` with its own secret as for a sign-in link, gets the session.

Decisions:

- **« Un compte existe déjà pour cette entreprise »** (`company_exists`) tells anyone that a SIREN is a
  customer. Accepted: the alternative (accept every request and say it by e-mail) blocks the honest
  second person of a company with no hint of whom to ask, and a SIREN's customer status is a weak
  secret. The answer names no person and no e-mail. Revisit if a customer objects.
- **Terms first.** Outside local, « Créer un compte » is offered only when `TERMS_URL` is set (the
  published CGU) and a mail provider is configured (`signup_disabled` otherwise; the pane hides the
  button). `TERMS_VERSION` in `packages/shared/src/account.ts` is the version accepted; bump it when
  the CGU change, and a pane still showing the old text gets `terms_changed`.
- **The e-mail proves the address only.** Nothing proves the person may act for the company: as with
  any SaaS, anyone can open an account for a SIREN. What protects the company is that nothing leaves
  for real before the operator switches the account live (`PUT /admin/tenants/:id/live`, prod only,
  after B2Brouter's own checks on the account, docs/RUNBOOK.md § Pilot).
- Expired sign-up requests are deleted by the daily purge (docs/RGPD.md).

## 4. Not used (and when they would be)

| Source | Why not now | Bring in when |
|---|---|---|
| **VIES** (`POST https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number`, keyless) | Busy answers come back as HTTP 200 with `isValid: false` and `userError: MS_MAX_CONCURRENT_REQ` (observed), no published rate limit, and its terms forbid retransmitting its data beyond the user's own invoicing. The DGFiP list already gives active French numbers. | A customer invoices other EU companies and wants their numbers checked (`docs/DEFERRED.md`). Source: https://ec.europa.eu/taxation_customs/vies/#/technical-information, read 2026-10-18. |
| **INSEE API Sirene 3.11** (`https://api.insee.fr/api-sirene/3.11`, free key in `X-INSEE-Api-Key-Integration`, 30 req/min, 2 000 req/h, masked values `[ND]`; v4 in beta since 2026-10-13, v3.11 kept until mid-2028) | Needs an account and a key; the DINUM API answers the same question without. | The DINUM API is unavailable too often, or its terms change. |
| DGFiP dataset queried directly (`data.economie.gouv.fr` Explore v2.1) | Already in the directory's `tva`. | The directory drops `tva`. |
