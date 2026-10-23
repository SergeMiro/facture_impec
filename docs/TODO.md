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

## Owner decisions

- [ ] **Which plans get the connector.** Now every plan (`docs/DEFERRED.md` › The connector gated by
      plan). The architecture document proposed external connectors from « Croissance »; the review of
      2026-10-22 proposed every plan until the pilot shows how it is used (Graph costs nothing per call,
      20 files per connection). Gating it is a small change plus a test.
- [ ] **The CGU.** A draft of the connectors' articles (OneDrive; Google Drive since R5):
      `docs/CGU_ONEDRIVE.md` (French). A lawyer reviews it with the rest of the CGU; then `TERMS_URL`
      and a new `TERMS_VERSION`.
