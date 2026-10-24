# GOOGLE.md: the Google Drive connector (R5)

What the connector relies on at Google, where it was read, and what is left to verify on a real
account. Read on developers.google.com on 2026-10-22. The connector's code: `apps/api/src/google.ts`
(the HTTP client), `apps/api/src/connectors.ts` (the connector, shared with OneDrive), the stand-in
`apps/mock-pdp/src/google.ts`. R4's equivalent is `docs/MICROSOFT365.md`.

## 1. One window: sign-in, consent and picker

Source: « Integrate the Google Picker into desktop and mobile apps »
(`/workspace/drive/picker/guides/desktop-mobile-picker`) and « Using OAuth 2.0 for Web Server
Applications » (`/identity/protocols/oauth2/web-server`).

- The authorization request `https://accounts.google.com/o/oauth2/v2/auth` with `prompt=consent` and
  `trigger_onepick=true` (both required) shows Google's picker after consent. Scope: only
  `https://www.googleapis.com/auth/drive.file`, which « can't be combined with other scopes ».
  Optional: `allow_multiple=true`, `mimetypes=` (comma-separated). The sample also carries
  `access_type=offline` and `response_type=code`; the page says the URL « accepts all standard OAuth
  query parameters ».
- Google redirects to `redirect_uri` with `picked_file_ids` (comma-separated, only when files were
  picked), `code` and `scope`; `error` when the person cancels (web-server guide: `access_denied`).
- « To let users grant access to more files », repeat the request with `trigger_onepick=true`: the
  pane's « Ajouter des fichiers » is the same window every time.
- Code exchange: `POST https://oauth2.googleapis.com/token` (form) `code`, `client_id`,
  `client_secret`, `redirect_uri`, `grant_type=authorization_code` → `access_token`, `expires_in`,
  `refresh_token` (with `access_type=offline`), `scope`, `token_type`. Refresh:
  `grant_type=refresh_token`; the documented answer carries no new refresh token, so the stored one
  stays. A revoked or expired grant answers `invalid_grant`.
- Revoke: `POST https://oauth2.googleapis.com/revoke` with `token` (form); 200 on success; revoking
  removes every scope granted to the project.

Why not the JavaScript picker: it runs in our page with an access token in the browser and needs an
API key; the one-window flow keeps every token on the server, needs no script in the pane, and works
from Excel desktop through the system browser.

## 2. What `drive.file` allows

Source: « Choose Google Drive API scopes » (`/workspace/drive/api/guides/api-specific-auth`).
`drive.file` is **non-sensitive** and recommended: files the person « opens with the app or shares
with the app through the Google Picker ». Non-sensitive scopes need only basic OAuth app verification
(no security assessment). `about.get`, `files.get`, `files.export`, `changes.getStartPageToken` and
`changes.watch` all list `drive.file` among their scopes (their reference pages).

A folder picked in the Google Picker (`setSelectFolderEnabled`, updated 2025-06-20) and its files:
neither that page nor « Choose Google Drive API scopes » and « Limited and expansive access »
(both updated 2026-09-03, read 2026-10-24) say whether `drive.file` then reaches the files inside
it. TODO(verify) on a real account before a Google folder is watched (BTP stage 1D watches OneDrive
folders only).

## 3. The account and the files

- `GET https://www.googleapis.com/drive/v3/about?fields=user(...)` (`fields` required): `user` is
  « the authenticated user », with `displayName`, `emailAddress` (« may not be present »),
  `permissionId` (« the user's ID as visible in Permission resources »). `permissionId` is the
  account's id in `connections.account_id`.
- `GET …/drive/v3/files/{id}?fields=…`: `version` (« a monotonically increasing version number…
  reflects every change made to the file on the server »), `mimeType`, `name`, `size` (blobs and
  Google Workspace editor files), `trashed`, `md5Checksum` (binary files only). The connector's
  content tag is `version`: it moves with any change, so a rename downloads the file again, and the
  same snapshot then writes nothing (R1).
- Content: `?alt=media` for a file stored in Drive (.xlsx, .xlsm, .csv); a Google Sheets spreadsheet
  (`application/vnd.google-apps.spreadsheet`) is exported: `GET …/files/{id}/export?mimeType=
  application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` (« Exported content is capped at
  10 MB »; CSV export would give the first sheet only). The xlsx goes through the same reader as R4's
  files (`readSheetFile`), so a Google Sheets file is read exactly like an Excel one.

## 4. Change notifications

Source: « Notifications for resource changes » (`/workspace/drive/api/guides/push`), `changes.watch`,
`changes.getStartPageToken`, the Channel resource.

- `GET …/drive/v3/changes/startPageToken` → `startPageToken`; `POST …/drive/v3/changes/watch?
  pageToken=…` with `{id, type: "web_hook", address, token, expiration}` → a Channel (`id`,
  `resourceId`, `expiration` as a string of milliseconds). For `changes`, at most 604 800 s (a week);
  default an hour. The address is https with a valid certificate; the page asks no domain
  verification.
- A notification is a POST with an empty body and headers `X-Goog-Channel-ID`,
  `X-Goog-Channel-Token` (our secret), `X-Goog-Resource-State` (`sync` right after creation, then
  `change` for `changes`; unknown values must be ignored), `X-Goog-Resource-ID`,
  `X-Goog-Message-Number`. Answer 200–204 or 102; 500/502/503/504 are retried with backoff.
- « Push notifications don't contain resource metadata, content, or directory paths. » A notification
  only queues the connection's check, which asks each file's version.
- Stop: `POST …/drive/v3/channels/stop` with `{id, resourceId}`; only the same user through the same
  OAuth client can stop it.

## 5. Errors

Source: « Resolve errors » (`/workspace/drive/api/guides/handle-errors`). Body
`{error: {code, message, errors: [{reason, …}]}}`.

| Answer | The connector |
|---|---|
| 401 `authError` | refresh once; a refused refresh (`invalid_grant`) → reconnect |
| 403 `rateLimitExceeded`, `userRateLimitExceeded`, `dailyLimitExceeded`; 429 | wait (`Retry-After` if any, else 30 s) |
| 403 `appNotAuthorizedToFile`, `insufficientFilePermissions`, `domainPolicy` and other 403 | the file is out of reach |
| 404 `notFound` | the file is gone (or no longer shared with the account) |
| 5xx, network | try again at the next check |

## 6. TODO(verify) on a real account

1. `state` comes back on the redirect of the one-window flow (it is a standard OAuth parameter; the
   picker guide does not name it). The connector also binds the window with a cookie, so a missing
   `state` is refused calmly rather than accepted.
2. The one-window flow works with a **Web application** OAuth client (the guide says « choose the
   recommended application type »; ours needs a client secret and an https redirect on the API).
3. `mimetypes=` filters the picker to spreadsheets and CSV with the values we send.
4. `trashed: true` on a picked file that was trashed (the connector treats it as missing).
5. Notifications arrive for a picked file under `drive.file` within minutes (personal Gmail account
   and a Workspace one).
6. A refresh token survives when the OAuth consent screen is « In production » (in « Testing »,
   Google expires them after 7 days: the person would reconnect weekly).

## 7. What the owner registers (Google Cloud console)

1. A project « Facture Impec »; enable the **Google Drive API**.
2. OAuth consent screen: External, app name « Facture Impec », support e-mail, the privacy policy and
   terms URLs, the scope `…/auth/drive.file` only. Publish it (« In production »); basic verification
   for a non-sensitive scope.
3. Credentials → OAuth client ID, type **Web application**, authorized redirect URI
   `<API_PUBLIC_URL>/connectors/google/callback`.
4. Into the API's environment: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (with
   `CONNECTOR_SEALING_KEY`, shared with OneDrive). `docs/RUNBOOK.md` › Google Drive connector.
