# Google Sheets host (R9)

R9 opens the same application as Excel inside a bound Google Sheets sidebar. It uses the existing
invoice controller and API. R5 remains the separate Google Drive connector for files read while the
spreadsheet is closed.

## Contracts checked on 2026-10-24

| Google contract | Implementation |
|---|---|
| [Editor sidebars](https://developers.google.com/workspace/add-ons/concepts/dialogs) use HTML Service and have a fixed width of 300 pixels. | The sidebar embeds the hosted `google-sheets.html`; the shared screens wrap at that width. |
| [HTML Service restrictions](https://developers.google.com/apps-script/guides/html/restrictions) require HTTPS for active content and allow sandboxed frames and popup windows. | The package requires an HTTPS app address. Its frame permits scripts, forms, downloads and popups. Office.js is absent. |
| [Client/server communication](https://developers.google.com/apps-script/guides/html/communication) uses asynchronous `google.script.run`. Calls can complete out of order, and `Date` values cannot cross that boundary. | The sidebar serializes requests. The host converts dates to ISO calendar dates in the spreadsheet's timezone. |
| [Range values](https://developers.google.com/apps-script/reference/spreadsheet/range) retain native values, displayed text, formats and formulas. Strings beginning with `=` can become formulas when written. | The host reads all four representations. Status strings use the shared formula-escaping function and plain-text formats. Corrections write finite numbers only. |
| [Simple triggers](https://developers.google.com/apps-script/guides/triggers) run `onEdit` after user edits. Script and API writes do not trigger it. | `onEdit` records a revision per sheet. The pane polls revisions every five seconds and reconciles every minute while a listener remains. |
| [Document properties](https://developers.google.com/apps-script/guides/properties) are shared by users of that script in the document. | Only mappings, test mode and edit revisions are stored there. Login tokens remain in the hosted app's browser storage. |
| [Document locks](https://developers.google.com/apps-script/reference/lock/lock-service) serialize script executions for one document. | Writes use a document lock and flush before releasing it. Locks do not exclude human edits. A correction checks the current value and formula immediately before writing. |

## Package and install

1. Publish the add-in build and API at public HTTPS addresses. Set `ADDIN_API_URL` before the add-in
   build, as for Excel (`DEPLOY.md`). The hosted page must allow framing by Google's HTML-service
   origins. Its API requests originate from the app's own origin, which must be in `ADDIN_ORIGINS`.
2. Run `pnpm sheets:package --addin https://YOUR-ADDIN/google-sheets.html`.
3. Open the target spreadsheet. Select **Extensions → Apps Script**.
4. Copy `apps/addin/dist/sheets/Code.gs` and `Sidebar.html` into the corresponding script files.
5. Enable the manifest in the project settings. Replace it with the generated `appsscript.json`.
6. Save the project. Run `fiOpen` and accept access to the current spreadsheet and the sidebar.
7. Reload the spreadsheet. Select **Facture Impec → Ouvrir Facture Impec** and sign in to Facture Impec.

The package contains no credentials and requests no Gmail or whole-Drive permission. A bound-script
installation needs no Drive connector client secret. Connecting additional Google Drive files still
needs the R5 OAuth registration (`GOOGLE.md`). Marketplace distribution remains a separate release.

A package created with `--allow-local` is for the local browser harness only. Google's servers and
browser sessions cannot access this VPS through its `localhost` address.

## Behaviour and limits

The toolbar checks the active sheet, opens the selected invoice for confirmation and toggles test
mode. The remaining screens and actions use the existing controller. Sending remains explicit in
Review mode. Status writes use only `FI_Statut` and `FI_Détail`. A changed or formula cell refuses a
correction. A column that acquired user data since the read refuses a status write.

The host reads at most 5,000 used rows and 250,000 cells per sheet, including the header. It refuses
larger ranges before downloading them to the pane. Dates retain the calendar day in the spreadsheet's
timezone. The spreadsheet id determines workbook identity, so a copied spreadsheet gets a new one.

Only the sidebar's exact child window, origin and random channel can call its bridge. The host
validates an allowlist of operations on the current spreadsheet. No request can choose a different
spreadsheet, run arbitrary code or fetch a URL. RPC timeouts do not retry writes automatically.

OneDrive sign-in uses MSAL's standard browser client and the existing `auth.html` popup relay.
Excel keeps its nested-authentication client. The account scopes, backend exchange and picker stay
shared. The public `auth.html` address must be registered as an SPA redirect URI in Microsoft Entra.
Microsoft's [initialization guide](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/initialization)
and [iframe guidance](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/iframe-usage)
were checked on 2026-10-24. Interactive sign-in uses popup windows, never a frame redirect.

## Verification still requiring a real Google account

- TODO(verify) G1: install the generated package in a personal account and a Workspace account.
- TODO(verify) G2: verify the nested frame, storage, popup fallback and file chooser in Google's sidebar.
- TODO(verify) G3: verify `onEdit` revisions with two people editing the same spreadsheet.
- TODO(verify) G4: repeat mapping, test send, returned statuses, a source edit and correction/undo in
  the real spreadsheet. Local native-service and browser stand-ins are separate evidence.

- TODO(verify) G5: connect personal and work OneDrive accounts through the real Google Sheets sidebar.
  Verify popup consent, relay return, picker handshake and one selected file. Unit tests script MSAL;
  they do not prove browser consent against Microsoft.
