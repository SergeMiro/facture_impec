# MICROSOFT365.md: OneDrive files read without Excel (R4)

How the OneDrive connector talks to Microsoft, where each behaviour comes from, and what only the
owner's real app registration can settle. Pages read on Microsoft Learn on 2026-10-21 unless stated.
Criteria and evidence: `docs/PROGRESS.md` R4. Setting it up: `docs/RUNBOOK.md` § OneDrive connector.
Tried with the owner's registration on 2026-10-22: § What a real account showed.

```
pane: « Connecter OneDrive » ─► MSAL: Office's nested sign-in (Windows, Mac) or the browser's flow through
      auth.html (on the web) ─► token for api://<client id> (asked as .default)
      ─► POST /connectors/microsoft {token} ─► on-behalf-of exchange ─► Graph token + refresh token (sealed)
      « Choisir des fichiers » ─► OneDrive's File Picker v8 in a frame ─► {driveId, itemId}… ─► POST …/files
API:  each file: metadata (cTag) ─► changed? download (302 → pre-authenticated URL) ─► readSheetFile ─► sources
      personal OneDrive: subscription on /me/drive/root ─► POST /webhooks/microsoft ─► queue the check
      work OneDrive: polled every 2 minutes (its subscriptions need Files.Read.All, not asked)
« Déconnecter » ─► unsubscribe ─► delete token, files, sources, documents ─► checks resolve the findings
```

## Sources

| Topic | Learn page | What the code takes from it |
|---|---|---|
| Nested app authentication (NAA) | `office/dev/add-ins/develop/enable-nested-app-authentication-in-your-add-in`; `javascript/api/requirement-sets/common/nested-app-auth-requirement-sets`; sample `office-add-in-sso-naa` | `createNestablePublicClientApplication` with authority `https://login.microsoftonline.com/common`; `acquireTokenSilent`, then `ssoSilent` with the login hint of `Office.auth.getAuthContext()`, then `acquireTokenPopup`; available where `isSetSupported('NestedAppAuth', '1.1')`; the SPA redirect URI `brk-multihub://<add-in domain>`. Read again 2026-10-22: « Word, Excel, and PowerPoint on the web » use the browser's standard flow instead, which needs an SPA redirect URI on the add-in's own domain. In MSAL 5 that page is a relay (`popupRelayUri` and `redirectUri` = `auth.html`; `runPopupRelay`, `broadcastResponseToMainFrame`): the pane is a frame of Office's page and cannot receive the popup's answer itself. `apps/addin/src/microsoft/office.ts`, `apps/addin/src/auth.ts`. |
| On-behalf-of flow | `entra/identity-platform/v2-oauth2-on-behalf-of-flow` (read again 2026-10-22, updated 2026-06-15) | The pane asks `api://<client id>/.default` (« .default and combined consent »): the consent then covers the Graph permissions too, which the server cannot ask for in the exchange (AADSTS70000 without it); that needs our own API's `access_as_user` listed under API permissions (else `invalid_scope`). The token's scope is still `access_as_user`; it is the `assertion`; `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, `requested_token_use=on_behalf_of`, our client secret; a tenant-specific token endpoint. `apps/api/src/microsoft.ts` › `exchange`. |
| Refresh tokens | `entra/identity-platform/refresh-tokens` | Each refresh gives a new refresh token, which replaces the stored one (sealed AES-256-GCM with `CONNECTOR_SEALING_KEY`). |
| Personal accounts' tenant | `entra/identity-platform/id-token-claims-reference` | `tid` = `9188040d-6c67-4c5b-b112-36a304b66dad` for a personal Microsoft account: the token endpoint is then `consumers` (`tokenTenant`). |
| Scopes | `graph/permissions-reference`, `graph/permissions-selected-overview` | `Files.Read`, `User.Read`, `offline_access`, delegated, no administrator consent. Not `Files.Read.All` nor `Sites.Selected`. |
| File Picker v8 | `onedrive/developer/controls/file-pickers/` | A form POST of `access_token` into a frame; options in `filePicker` (`sdk: '8.0'`, `entry.oneDrive`, `messaging.channelId`, `selection.mode: multiple`, `typesAndSources` .xlsx .xlsm .csv); `initialize` with a MessagePort → `activate`; commands `authenticate`, `pick`, `close`, each acknowledged then answered. Personal (« OneDrive Consumer Configuration », updated 2024-06-17): `https://onedrive.live.com/picker` with `OneDrive.ReadOnly` from the `consumers` authority (from `common`: AADSTS70011); its `authenticate` names `https://api.onedrive.com` and takes that same token; its command ids are numbers (strings in Learn's samples). Work: `<SharePoint host>/_layouts/15/FilePicker.aspx` with `<host>/.default`. |
| A file's metadata and content | `graph/api/resources/driveitem`, `graph/api/driveitem-get-content` | `cTag` changes with the content only: an unchanged cTag downloads nothing. `/content` answers 302 to a pre-authenticated URL fetched without our token; we stop at 10 MB. |
| Change notifications | `graph/change-notifications-overview`, `graph/api/resources/subscription`, `graph/api/subscription-post-subscriptions`, `onedrive/developer/rest-api/concepts/using-webhooks` | `changeType: updated` on `/me/drive/root`; up to 42 300 minutes for a driveItem (we ask 3 days, renewed a day before); the handshake POST `?validationToken=` echoed as text/plain within 10 s; a notification answered within 3 s and carrying no data, only `clientState` (its SHA-256 is stored) and the subscription id. On OneDrive for Business a subscription needs `Files.Read.All`: work accounts are polled. |
| Throttling | `graph/throttling`; `sharepoint/dev/general-development/how-to-avoid-getting-throttled-or-blocked-in-sharepoint-online` | 429 or 503 with `Retry-After`: the check waits that long (capped at an hour) and tries again; nothing is lost. |
| Inbound mail of Microsoft 365 | `exchange/security-and-compliance/how-dane-secures-email` (reached from `purview/how-smtp-dane-works`, updated 2026-07-21) | Exchange Online's MX ends in `mail.protection.outlook.com`, or `mx.microsoft` for domains with DNSSEC. Outlook.com's ends in `olc.protection.outlook.com` (MX of hotmail.com, outlook.fr, live.fr looked up with `dig` the same day). The Scout (below). |
| Consent | `entra/identity/enterprise-apps/configure-user-consent` | A company may forbid user consent: its administrator then consents once for the app, or « Connecter OneDrive » is refused (`connector_sign_in`). |

## Scout

The plan's signals, the smallest version (R4):

- **The workbook's address**: `Office.context.document.url` on `https://d.docs.live.net/…`,
  `https://onedrive.live.com/…` or `https://<name>.sharepoint.com/…` → the Tableau de bord suggests
  « Fichiers OneDrive » once. Learn does not describe these addresses; a personal workbook on the web
  is on `d.docs.live.net` (seen 2026-10-22). TODO(verify) on a work and a SharePoint account
  (`apps/addin/src/microsoft/port.ts` › `onMicrosoftCloud`).
- **The mail domain**: the API looks up the MX record of the signed-in person's e-mail domain (once a
  day per domain, 2 s at most) and says `mailOnMicrosoft` (`apps/api/src/connectors.ts` ›
  `servedByMicrosoft`). Only the domain leaves the server, to its own DNS resolver.
- Once answered (« Voir les fichiers OneDrive » or « Non merci ») it is not suggested again on that
  device. It never connects by itself. Formula links to other workbooks and sheet names: `docs/DEFERRED.md`.

## The owner's app registration (2026-10-22)

Made in the Entra admin center by the steps of `docs/RUNBOOK.md` § OneDrive connector, in the owner's
directory, signed in with the owner's personal Microsoft account. Its values live in the owner's
environment, never in the repo. Read back from its manifest the same day:

- `signInAudience: AzureADandPersonalMicrosoftAccount`; `api.requestedAccessTokenVersion: 2` (the
  portal sets it for this audience); `identifierUris: api://<client id>`; one scope `access_as_user`,
  admins and users; Graph delegated `Files.Read`, `User.Read`, `offline_access`.
- SPA redirect URIs `brk-multihub://localhost:3000` and `https://localhost:3000/auth.html`, for the
  add-in of `pnpm dev`; the hosted add-in's two are added next to them once there is one
  (`docs/DEPLOY.md`). A new URI was refused for a few minutes, then accepted.
- API permissions: besides Graph's, our own API's `access_as_user` (added 2026-10-22 for `.default`;
  it applied after a few minutes).
- A client secret of 180 days: renew it before **2027-04-20** (Certificates & secrets → New client
  secret, then `MICROSOFT_CLIENT_SECRET`; nothing else changes).
- The portal also offers `Files.Read.Selected` (preview): « The app has access for several hours after
  the user selects a file ». The hourly and two-minute checks need lasting access, so `Files.Read` stays.

**Work accounts of other companies.** The portal says on this registration: « End users cannot grant
consent to newly registered multitenant apps without verified publishers ». Learn
(`entra/identity-platform/publisher-verification-overview`, updated 2026-06-15): verification needs a
Microsoft AI Cloud Partner Program account, an app registered **with a work or school account** (« Apps
that are registered by using a Microsoft account can't be publisher verified »), and a publisher domain
that is not `*.onmicrosoft.com`; it is free. So with this registration a personal account consents by
itself, and a work account needs its company's administrator to consent once. Lifting that means
registering the app again in the company's own Entra tenant, with its own domain, and verifying it:
an owner decision (`docs/DEFERRED.md`).

## What a real account showed (2026-10-22)

Excel on the web, French interface, the owner's personal Microsoft account, its own OneDrive; the pane
from `pnpm dev`, the API reached from Microsoft through a temporary public tunnel. browser: local
(BrowserOS on the VPS).

- **Connect.** « Connecter OneDrive » opens `auth.html` (« Continuer avec Microsoft »), then Microsoft's
  window: « Are you trying to sign in to Facture Impec? », then the consent (Maintain access, Open
  OneDrive files, Read your profile, « Accéder à Facture Impec en votre nom »), marked unverified. The pane
  then shows the account and « OneDrive personnel ».
- **Pick.** The first « Choisir des fichiers » asks once more (« Open OneDrive files »: the picker's own
  `OneDrive.ReadOnly`), then OneDrive's picker opens over the pane in French, filtered to .xlsx .xlsm
  .csv. A picked workbook was read by the API: its sheet proposed, its columns recognised from the
  headers, then « Commandes de vos clients », one order.
- **A change.** One cell edited in Excel at 12:40:52 UTC; Graph's notification reached
  `/webhooks/microsoft` at 12:41:26; the next look at « Registre » showed the order at 1 200 € instead of
  900 €, the file still closed for our side.
- **Mistakes found and fixed that day**: the scope (`.default`), the picker's authority and command ids
  (above); a failed exchange answered 401 made the pane sign the person out of Facture Impec — it is now
  409 `connector_sign_in`, with Microsoft's AADSTS number in `details` (the rest of Microsoft's text may
  name the person and is dropped).
- **A window left open.** If a previous sign-in window of ours is still open, MSAL reuses it and answers
  `interaction_in_progress`; closing it is enough (`docs/DEFERRED.md`).

## TODO(verify) with the owner's app registration

1. ✅ 2026-10-22: on-behalf-of for a **personal** account, through `consumers`, once the consent covers
   the Graph permissions (`.default`, above).
2. The NAA token on Excel desktop and Excel for Mac, and which builds answer `NestedAppAuth 1.1`. Excel
   on the web answered `true` on 2026-10-22 (platform `OfficeOnline`) and signs in through `auth.html`.
3. ✅ personal, 2026-10-22: the File Picker v8 inside the pane's frame, no redirect URI of its own.
   Open for a work account: the `authenticate` command's `resource`.
4. The workbook address templates of the Scout: ✅ personal on the web, 2026-10-22,
   `https://d.docs.live.net/<cid>/<name>.xlsx`. Open: work and SharePoint.
5. ✅ 2026-10-22: a Graph subscription with only `Files.Read` on a personal OneDrive, its handshake and a
   notification reaching a public `API_PUBLIC_URL`. Open: its renewal against Microsoft (the stand-in
   covers it).
6. ✅ personal, 2026-10-22: `https://account.live.com/consent/Manage` lists « Facture Impec » under
   « Apps and services you've given access »; « Remove these permissions » withdraws it at once,
   without asking again. Open: a work account (My Apps or the administrator).

A work account needs a Microsoft 365 tenant and its administrator's consent (§ The owner's app
registration): not tried.

`pnpm verify` and `pnpm test:e2e` never reach Microsoft: they run against the stand-in in
`apps/mock-pdp` (`/microsoft`), which follows the shapes above.

## Google Sheets host (R9, 2026-10-24)

Google Sheets calls the shared Microsoft adapter in browser mode. It uses
`createStandardPublicClientApplication`; Excel continues to use
`createNestablePublicClientApplication` and its Office account hint. Both factories initialize their
client before use. The picker, scopes and backend exchange remain the same.

The browser client uses the existing `auth.html` as both redirect and popup relay. Its public address
must be registered as an SPA redirect URI, as for Excel on the web. The relay pins
`https://login.microsoftonline.com`. Picker initialization checks the source window, exact picker
origin and channel id before accepting a message port.

Sources: Microsoft's [MSAL initialization guide](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/initialization)
and [iframe guidance](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/iframe-usage),
checked on 2026-10-24; installed `@azure/msal-browser` 5.25.0 source. Focused tests script the SDK
without reaching Microsoft. Actual consent and selection from Google's sidebar remain G5 in
`GOOGLE_SHEETS.md`.
