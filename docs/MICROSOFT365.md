# MICROSOFT365.md: OneDrive files read without Excel (R4)

How the OneDrive connector talks to Microsoft, where each behaviour comes from, and what only the
owner's real app registration can settle. Pages read on Microsoft Learn on 2026-10-21 unless stated.
Criteria and evidence: `docs/PROGRESS.md` R4. Setting it up: `docs/RUNBOOK.md` § OneDrive connector.

```
pane: « Connecter OneDrive » ─► MSAL nested app authentication (Office's own account) ─► token for api://<client id>
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
| Nested app authentication (NAA) | `office/dev/add-ins/develop/enable-nested-app-authentication-in-your-add-in`; `javascript/api/requirement-sets/common/nested-app-auth-requirement-sets`; sample `office-add-in-sso-naa` | `createNestablePublicClientApplication` with authority `https://login.microsoftonline.com/common`; `acquireTokenSilent`, then `acquireTokenPopup`; available where `isSetSupported('NestedAppAuth', '1.1')`; the SPA redirect URI `brk-multihub://<add-in domain>`. `apps/addin/src/microsoft/office.ts`. |
| On-behalf-of flow | `entra/identity-platform/v2-oauth2-on-behalf-of-flow` | The pane's token for our API (`api://<client id>/access_as_user`) is the `assertion`; `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, `requested_token_use=on_behalf_of`, our client secret; a tenant-specific token endpoint. `apps/api/src/microsoft.ts` › `exchange`. |
| Refresh tokens | `entra/identity-platform/refresh-tokens` | Each refresh gives a new refresh token, which replaces the stored one (sealed AES-256-GCM with `CONNECTOR_SEALING_KEY`). |
| Personal accounts' tenant | `entra/identity-platform/id-token-claims-reference` | `tid` = `9188040d-6c67-4c5b-b112-36a304b66dad` for a personal Microsoft account: the token endpoint is then `consumers` (`tokenTenant`). |
| Scopes | `graph/permissions-reference`, `graph/permissions-selected-overview` | `Files.Read`, `User.Read`, `offline_access`, delegated, no administrator consent. Not `Files.Read.All` nor `Sites.Selected`. |
| File Picker v8 | `onedrive/developer/controls/file-pickers/` | A form POST of `access_token` into a frame; options in `filePicker` (`sdk: '8.0'`, `entry.oneDrive`, `messaging.channelId`, `selection.mode: multiple`, `typesAndSources` .xlsx .xlsm .csv); `initialize` with a MessagePort → `activate`; commands `authenticate`, `pick`, `close`, each acknowledged then answered. Personal: `https://onedrive.live.com/picker` with `OneDrive.ReadOnly`; work: `<SharePoint host>/_layouts/15/FilePicker.aspx` with `<host>/.default`. |
| A file's metadata and content | `graph/api/resources/driveitem`, `graph/api/driveitem-get-content` | `cTag` changes with the content only: an unchanged cTag downloads nothing. `/content` answers 302 to a pre-authenticated URL fetched without our token; we stop at 10 MB. |
| Change notifications | `graph/change-notifications-overview`, `graph/api/resources/subscription`, `graph/api/subscription-post-subscriptions`, `onedrive/developer/rest-api/concepts/using-webhooks` | `changeType: updated` on `/me/drive/root`; up to 42 300 minutes for a driveItem (we ask 3 days, renewed a day before); the handshake POST `?validationToken=` echoed as text/plain within 10 s; a notification answered within 3 s and carrying no data, only `clientState` (its SHA-256 is stored) and the subscription id. On OneDrive for Business a subscription needs `Files.Read.All`: work accounts are polled. |
| Throttling | `graph/throttling`; `sharepoint/dev/general-development/how-to-avoid-getting-throttled-or-blocked-in-sharepoint-online` | 429 or 503 with `Retry-After`: the check waits that long (capped at an hour) and tries again; nothing is lost. |
| Inbound mail of Microsoft 365 | `exchange/security-and-compliance/how-dane-secures-email` (reached from `purview/how-smtp-dane-works`, updated 2026-07-21) | Exchange Online's MX ends in `mail.protection.outlook.com`, or `mx.microsoft` for domains with DNSSEC. Outlook.com's ends in `olc.protection.outlook.com` (MX of hotmail.com, outlook.fr, live.fr looked up with `dig` the same day). The Scout (below). |
| Consent | `entra/identity/enterprise-apps/configure-user-consent` | A company may forbid user consent: its administrator then consents once for the app, or « Connecter OneDrive » is refused (`connector_sign_in`). |

## Scout

The plan's signals, the smallest version (R4):

- **The workbook's address**: `Office.context.document.url` on `https://d.docs.live.net/…`,
  `https://onedrive.live.com/…` or `https://<name>.sharepoint.com/…` → the Tableau de bord suggests
  « Fichiers OneDrive » once. Learn does not describe these addresses: TODO(verify) on a personal, a
  work and a SharePoint account (`apps/addin/src/microsoft/port.ts` › `onMicrosoftCloud`).
- **The mail domain**: the API looks up the MX record of the signed-in person's e-mail domain (once a
  day per domain, 2 s at most) and says `mailOnMicrosoft` (`apps/api/src/connectors.ts` ›
  `servedByMicrosoft`). Only the domain leaves the server, to its own DNS resolver.
- Once answered (« Voir les fichiers OneDrive » or « Non merci ») it is not suggested again on that
  device. It never connects by itself. Formula links to other workbooks and sheet names: `docs/DEFERRED.md`.

## TODO(verify) with the owner's app registration

1. On-behalf-of for a **personal** account: Learn documents OBO for work accounts; whether the
   `consumers` endpoint exchanges an NAA token of a Microsoft account must be tried.
2. The NAA token's audience and scope `api://<client id>/access_as_user` on Excel desktop, Excel on the
   web and Excel for Mac; which builds answer `NestedAppAuth 1.1`.
3. The File Picker v8 inside the task pane's frame, personal and work: the `authenticate` command's
   `resource` for a work account, and whether the picker needs its own redirect URI.
4. The workbook address templates of the Scout (above).
5. A Graph subscription with only `Files.Read` on a personal OneDrive, its notifications reaching a
   public `API_PUBLIC_URL`, and its renewal.
6. Where a person withdraws the app's access on Microsoft's side (personal account: the account's
   privacy page; work account: My Apps or the administrator), to name it in the pane.

Until then everything runs against the stand-in in `apps/mock-pdp` (`/microsoft`), which follows the
shapes above: `pnpm verify` and `pnpm test:e2e` never reach Microsoft.
