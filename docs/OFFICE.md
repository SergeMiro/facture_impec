# OFFICE.md: Excel task-pane add-in, facts from Microsoft docs

Scope: the Facture Impec Excel add-in (React 18 + Vite + Office.js). Every fact below comes from
learn.microsoft.com (one exception: npm READMEs and registry data, marked as such) and was
**checked 2026-10-18**. "(ms.date …)" is the page's own last-updated date, where it matters.
Lines marked **Inference** are our conclusions from the cited facts, not Microsoft text.
**not documented** means the docs say nothing on the point. Do not fill those gaps by guessing.

## 0. Decisions at a glance

| Topic | Decision | Basis |
|---|---|---|
| Manifest | **Add-in only (classic XML) `manifest.xml`** for now | §1: unified manifest not installable on perpetual Windows; cannot use a network share; would need a second XML version anyway |
| Shared runtime | **Yes** (`SharedRuntime 1.1`, `<Runtime lifetime="long">`) | §2/§3: commands and task pane share state; required by `Office.addin.*` and `OfficeRuntime.storage` |
| "Ouvrir" | Manifest `ShowTaskpane` action, **not** `showAsTaskpane()` | §3: `showAsTaskpane` ignored for Marketplace add-ins since 2026-02-23 |
| Auth token | `OfficeRuntime.storage` (or `localStorage` keyed with `Office.context.partitionKey`); **never** `document.settings` / `workbook.settings` | §4 |
| Office.js | CDN `<script>` in `<head>`, not bundled by Vite | §8 |
| Sideload | Web: Upload My Add-in · Windows: `office-addin-debugging` / network share · Mac: `wef` folder | §6 |

---

## 1. Unified vs add-in only (XML) manifest

| Fact | Source (checked 2026-10-18) |
|---|---|
| Two manifest types. The **add-in only manifest** (XML) "can be used for production add-ins in Excel, OneNote, Outlook, PowerPoint, Project, and Word". The **unified manifest for Microsoft 365** (JSON) can combine an add-in with other Microsoft 365 app types. | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/add-in-manifests |
| Unified manifest support: **Office on the web: Yes**. **Excel on Windows Version 2501 (18407.20002)+ with a Microsoft 365 subscription: Yes**. **Excel on Mac Version 16.103 (25101427)+: Yes**. **Office on Windows (perpetual versions): No**. Office on mobile: No. | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/unified-manifest-overview (ms.date 2026-10-14) |
| The unified manifest does not yet support the **OnDocumentOpened** event in Excel, PowerPoint or Word. | same page, "Feature support" |
| To reach platforms that don't support the unified manifest, "you must create and deploy two versions of the add-in", one per manifest type. | same page |
| Exception: if a Microsoft 365 admin deploys the add-in for all users, the unified version installs on older Microsoft 365 builds and on perpetual Office. | https://learn.microsoft.com/en-us/office/dev/add-ins/concepts/duplicate-legacy-metaos-add-ins |
| Network-share sideloading does not support unified-manifest add-ins. | https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins |
| **Marketplace (ex-AppSource) / Partner Center accepts both types.** Policy 1120.1: "All Office Add-ins must use the latest released (not preview) version of the manifest schema for either the unified manifest for Microsoft 365 or for the add-in only manifest." Support URL is required for XML; website URL for unified. A high-resolution icon is mandatory. | https://learn.microsoft.com/en-us/legal/marketplace/certification-policies (ms.date 2025-08-06) |
| Policy 1120.3: task-pane add-ins that use the add-in only manifest **must support add-in commands**. They must support Office on the web and Mac for the APIs in the manifest, and the latest Edge, Chrome, Firefox and Safari (macOS). | same page |
| Is unified-manifest support for Excel **GA or preview**? The support table only says "Yes". | **not documented** |
| Manual "Upload My Add-in" on the web for a unified manifest: the web sideload page covers the add-in only manifest. Unified add-ins sideload through `office-addin-debugging` or Teams "Upload a custom app". | https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-office-add-ins-for-testing · https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-add-in-with-unified-manifest |

**Recommendation (Inference):** build with the **add-in only XML manifest**. The plan rule
"unified if supported at build time" fails on three points: no perpetual Windows support, no network-share
testing, and a second XML version would still be needed. Microsoft's docs give no single
"use X" recommendation.

---

## 2. Minimal classic manifest (VersionOverrides 1.0, Home-tab group, shared runtime)

### Facts

| Fact | Source (checked 2026-10-18) |
|---|---|
| Element order is enforced by the XSD. Base `OfficeApp` order: `Id, AlternateID, Version, ProviderName, DefaultLocale, DisplayName, Description, IconUrl, HighResolutionIconUrl, SupportUrl, AppDomains, Hosts, Requirements, DefaultSettings, Permissions, …, VersionOverrides`. | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/manifest-element-ordering |
| Inside `VersionOverrides` → `Host`: **`Runtimes` first**, then `AllFormFactors`, then `DesktopFormFactor` (`GetStarted` → `FunctionFile` → `ExtensionPoint`), then `Resources` (`Images, Urls, ShortStrings, LongStrings`). | same page |
| Control order: `Label, Supertip(Title, Description), Icon, Action`. Group order: `Label, Icon, Control…`. | same page |
| `CustomTab`: `Group`/`OfficeGroup` elements "must be above the `<Label>` element". The tab `Label` is required. `InsertAfter`/`InsertBefore` are PowerPoint only. | https://learn.microsoft.com/en-us/javascript/api/manifest/customtab |
| ⚠️ The sample on the create-addin-commands page puts the tab `<Label>` **before** `<Group>`. We tested that order and `office-addin-manifest validate` rejects it ("invalid child element 'Label' … expected: 'Group, OfficeGroup'"). Follow the CustomTab reference. | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/create-addin-commands (ms.date 2026-03-20) |
| Ribbon `Icon`: three sizes **required: 16, 32, 80 px**. Supported: 20, 24, 40, 48, 64. All `Image` URLs must use SSL. | https://learn.microsoft.com/en-us/javascript/api/manifest/icon · https://learn.microsoft.com/en-us/javascript/api/manifest/image |
| Design guidance lists sizes 16/20/24/32/40/48/64/80/96 px and calls 16, 20 and 32 px "absolutely required". Format: PNG, transparent background, 32-bit. | https://learn.microsoft.com/en-us/office/dev/add-ins/design/add-in-icons |
| `IconUrl`: task pane 32×32. `HighResolutionIconUrl`: task pane 64×64. | https://learn.microsoft.com/en-us/javascript/api/manifest/iconurl · https://learn.microsoft.com/en-us/javascript/api/manifest/highresolutioniconurl |
| Image URIs must support caching in production. Do not send `Cache-Control: no-cache/no-store`. | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/add-in-manifests |
| `SupportUrl` is required only for Marketplace distribution. | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/xml-manifest-overview |
| Shared runtime set-up: add `<Set Name="SharedRuntime" MinVersion="1.1"/>` to the base `Requirements`. Add `<Runtimes><Runtime resid="Taskpane.Url" lifetime="long"/></Runtimes>` (default lifetime is `short`). Set `<FunctionFile resid="Taskpane.Url"/>`. "The shared runtime won't load if the resid of the runtime isn't consistent in the manifest." | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/configure-your-add-in-to-use-a-shared-runtime (ms.date 2026-07-30) |
| A shared runtime supports **one task pane**: no `<Action>` under that `Host` may have a `<TaskpaneId>`. | same page |
| `SharedRuntime 1.1` support: **Excel on the web**. **Windows Microsoft 365 Version 2002 (Build 12527.20092)**. Excel 2021 volume-licensed Version 2108. **Mac 16.35 (20030802)**. iOS: not supported. `SharedRuntime 1.2` (Excel only) adds `BeforeDocumentCloseNotification`. | https://learn.microsoft.com/en-us/javascript/api/requirement-sets/common/shared-runtime-requirement-sets |
| The `Action` element belongs to **AddinCommands 1.1** under Taskpane 1.0. AddinCommands 1.1 support: web supported, Windows Version 1705, Office 2021 Version 1809, Mac 15.34. | https://learn.microsoft.com/en-us/javascript/api/manifest/action · https://learn.microsoft.com/en-us/javascript/api/requirement-sets/common/add-in-commands-requirement-sets |
| "You should always specify in the manifest the minimum version of each requirement set that your add-in requires." Be careful with `Requirements` inside `VersionOverrides`: if a requirement is unsupported, **none** of the add-in commands install. For optional APIs, check `isSetSupported` at runtime. | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/specify-office-hosts-and-api-requirements |
| `ExcelApi 1.7` (needed for `Worksheet.onChanged`): web supported, Windows Version 1801, Office 2019, Mac 16.9. | https://learn.microsoft.com/en-us/javascript/api/requirement-sets/excel/excel-api-requirement-sets |
| `ExecuteFunction`: the `<FunctionName>` value must equal the `actionId` passed to `Office.actions.associate`. The add-in times out after **5 minutes** if the function hasn't completed. | https://learn.microsoft.com/en-us/javascript/api/manifest/action |
| `Permissions` values: `Restricted | ReadDocument | ReadAllDocument | WriteDocument | ReadWriteDocument`. | https://learn.microsoft.com/en-us/javascript/api/manifest/permissions |

**Requirement sets to declare (Inference from the above):** `SharedRuntime 1.1` (required by the shared runtime
page) and `ExcelApi 1.7` (`onChanged` is core). Both go in the base `Requirements`, not in `VersionOverrides`.
Everything else used here is ExcelApi ≤ 1.4.

### Validated manifest

`npx office-addin-manifest@3.0.1 validate manifest.xml` (run in a scratch dir, 2026-10-18) reported
**"The manifest is valid."** and these target platforms: Excel on the web, Excel on Windows (Microsoft 365),
Excel on Mac (Microsoft 365), Excel 2019 or later on Mac. Replace `https://localhost:3000` and the
example.com URLs before release.

```xml
<?xml version="1.0" encoding="UTF-8"?>
<OfficeApp xmlns="http://schemas.microsoft.com/office/appforoffice/1.1"
           xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
           xmlns:bt="http://schemas.microsoft.com/office/officeappbasictypes/1.0"
           xmlns:ov="http://schemas.microsoft.com/office/taskpaneappversionoverrides"
           xsi:type="TaskPaneApp">
  <!-- Base manifest: order is fixed by the XSD (Id, Version, ProviderName, DefaultLocale, ...). -->
  <Id>65013856-1f36-4b17-9800-671932bb5e36</Id>
  <Version>1.0.0.0</Version>
  <ProviderName>Facture Impec</ProviderName>
  <DefaultLocale>fr-FR</DefaultLocale>
  <DisplayName DefaultValue="Facture Impec"/>
  <Description DefaultValue="Vérifier et envoyer des factures électroniques depuis Excel."/>
  <IconUrl DefaultValue="https://localhost:3000/assets/icon-32.png"/>
  <HighResolutionIconUrl DefaultValue="https://localhost:3000/assets/icon-64.png"/>
  <SupportUrl DefaultValue="https://www.example.com/support"/>
  <AppDomains>
    <AppDomain>https://localhost:3000</AppDomain>
  </AppDomains>
  <Hosts>
    <Host Name="Workbook"/>
  </Hosts>
  <Requirements>
    <Sets DefaultMinVersion="1.1">
      <Set Name="SharedRuntime" MinVersion="1.1"/>
      <Set Name="ExcelApi" MinVersion="1.7"/>
    </Sets>
  </Requirements>
  <DefaultSettings>
    <SourceLocation DefaultValue="https://localhost:3000/taskpane.html"/>
  </DefaultSettings>
  <Permissions>ReadWriteDocument</Permissions>
  <VersionOverrides xmlns="http://schemas.microsoft.com/office/taskpaneappversionoverrides" xsi:type="VersionOverridesV1_0">
    <Hosts>
      <Host xsi:type="Workbook">
        <!-- Runtimes must come right after <Host>, before <DesktopFormFactor>. -->
        <Runtimes>
          <Runtime resid="Taskpane.Url" lifetime="long"/>
        </Runtimes>
        <DesktopFormFactor>
          <GetStarted>
            <Title resid="GetStarted.Title"/>
            <Description resid="GetStarted.Description"/>
            <LearnMoreUrl resid="GetStarted.LearnMoreUrl"/>
          </GetStarted>
          <!-- Same resid as <Runtime>: function commands run in the task pane's runtime. -->
          <FunctionFile resid="Taskpane.Url"/>
          <ExtensionPoint xsi:type="PrimaryCommandSurface">
            <OfficeTab id="TabHome">
              <Group id="FactureImpec.Group">
                <Label resid="Group.Label"/>
                <Icon>
                  <bt:Image size="16" resid="Icon.16x16"/>
                  <bt:Image size="32" resid="Icon.32x32"/>
                  <bt:Image size="80" resid="Icon.80x80"/>
                </Icon>
                <Control xsi:type="Button" id="FactureImpec.Ouvrir">
                  <Label resid="Ouvrir.Label"/>
                  <Supertip>
                    <Title resid="Ouvrir.Label"/>
                    <Description resid="Ouvrir.Tooltip"/>
                  </Supertip>
                  <Icon>
                    <bt:Image size="16" resid="Icon.16x16"/>
                    <bt:Image size="32" resid="Icon.32x32"/>
                    <bt:Image size="80" resid="Icon.80x80"/>
                  </Icon>
                  <!-- No <TaskpaneId>: a shared runtime supports one task pane. -->
                  <Action xsi:type="ShowTaskpane">
                    <SourceLocation resid="Taskpane.Url"/>
                  </Action>
                </Control>
                <Control xsi:type="Button" id="FactureImpec.Verifier">
                  <Label resid="Verifier.Label"/>
                  <Supertip>
                    <Title resid="Verifier.Label"/>
                    <Description resid="Verifier.Tooltip"/>
                  </Supertip>
                  <Icon>
                    <bt:Image size="16" resid="Icon.16x16"/>
                    <bt:Image size="32" resid="Icon.32x32"/>
                    <bt:Image size="80" resid="Icon.80x80"/>
                  </Icon>
                  <Action xsi:type="ExecuteFunction">
                    <FunctionName>verifier</FunctionName>
                  </Action>
                </Control>
                <Control xsi:type="Button" id="FactureImpec.Envoyer">
                  <Label resid="Envoyer.Label"/>
                  <Supertip>
                    <Title resid="Envoyer.Label"/>
                    <Description resid="Envoyer.Tooltip"/>
                  </Supertip>
                  <Icon>
                    <bt:Image size="16" resid="Icon.16x16"/>
                    <bt:Image size="32" resid="Icon.32x32"/>
                    <bt:Image size="80" resid="Icon.80x80"/>
                  </Icon>
                  <Action xsi:type="ExecuteFunction">
                    <FunctionName>envoyer</FunctionName>
                  </Action>
                </Control>
                <Control xsi:type="Button" id="FactureImpec.ModeTest">
                  <Label resid="ModeTest.Label"/>
                  <Supertip>
                    <Title resid="ModeTest.Label"/>
                    <Description resid="ModeTest.Tooltip"/>
                  </Supertip>
                  <Icon>
                    <bt:Image size="16" resid="Icon.16x16"/>
                    <bt:Image size="32" resid="Icon.32x32"/>
                    <bt:Image size="80" resid="Icon.80x80"/>
                  </Icon>
                  <Action xsi:type="ExecuteFunction">
                    <FunctionName>modeTest</FunctionName>
                  </Action>
                </Control>
              </Group>
            </OfficeTab>
          </ExtensionPoint>
        </DesktopFormFactor>
      </Host>
    </Hosts>
    <Resources>
      <bt:Images>
        <bt:Image id="Icon.16x16" DefaultValue="https://localhost:3000/assets/icon-16.png"/>
        <bt:Image id="Icon.32x32" DefaultValue="https://localhost:3000/assets/icon-32.png"/>
        <bt:Image id="Icon.80x80" DefaultValue="https://localhost:3000/assets/icon-80.png"/>
      </bt:Images>
      <bt:Urls>
        <bt:Url id="Taskpane.Url" DefaultValue="https://localhost:3000/taskpane.html"/>
        <bt:Url id="GetStarted.LearnMoreUrl" DefaultValue="https://www.example.com/aide"/>
      </bt:Urls>
      <bt:ShortStrings>
        <bt:String id="GetStarted.Title" DefaultValue="Facture Impec est prêt"/>
        <bt:String id="Group.Label" DefaultValue="Facture Impec"/>
        <bt:String id="Ouvrir.Label" DefaultValue="Ouvrir"/>
        <bt:String id="Verifier.Label" DefaultValue="Vérifier"/>
        <bt:String id="Envoyer.Label" DefaultValue="Envoyer"/>
        <bt:String id="ModeTest.Label" DefaultValue="Mode test"/>
      </bt:ShortStrings>
      <bt:LongStrings>
        <bt:String id="GetStarted.Description" DefaultValue="Ouvrez le volet depuis l'onglet Accueil."/>
        <bt:String id="Ouvrir.Tooltip" DefaultValue="Ouvrir le volet Facture Impec."/>
        <bt:String id="Verifier.Tooltip" DefaultValue="Vérifier la facture de la feuille active."/>
        <bt:String id="Envoyer.Tooltip" DefaultValue="Envoyer la facture vérifiée."/>
        <bt:String id="ModeTest.Tooltip" DefaultValue="Activer ou désactiver le mode test."/>
      </bt:LongStrings>
    </Resources>
  </VersionOverrides>
</OfficeApp>
```

**Custom-tab variant** (also validated): replace `<OfficeTab id="TabHome"> … </OfficeTab>` with
`<CustomTab id="FactureImpec.Tab"> <Group …>…</Group> <Label resid="Group.Label"/> </CustomTab>`.
Keep the Label **after** the Group.

### Command handlers (pattern from Microsoft docs)

Loaded by `taskpane.html`, because `FunctionFile` = `Taskpane.Url` in the shared runtime:

```js
Office.onReady(() => { /* ... */ });

async function verifier(event) {
  try {
    await Excel.run(async (context) => { /* queue commands */ await context.sync(); });
  } catch (e) { console.error(e); }
  event.completed(); // required, otherwise later clicks never run
}
Office.actions.associate("verifier", verifier); // must equal <FunctionName>
// same for "envoyer" and "modeTest"
```

Sources (checked 2026-10-18): https://learn.microsoft.com/en-us/office/dev/add-ins/develop/create-addin-commands ·
https://learn.microsoft.com/en-us/javascript/api/manifest/functionfile. Both say every function command needs an
`Office.actions.associate` call, and that `event.completed` is required: clicks are queued, and the next one runs only after `completed`.

---

## 3. `Office.actions.associate` and `Office.addin.showAsTaskpane`

| Fact | Source (checked 2026-10-18) |
|---|---|
| `Office.actions.associate(actionId: string, actionFunction: (arg?) => void): void`. Associates a manifest action ID with a function. | https://learn.microsoft.com/en-us/javascript/api/office/office.actions |
| **Requirement set of `associate`:** the reference page lists sets for other `Office.actions` methods (KeyboardShortcuts 1.1, SharedRuntime 1.1) but gives none for `associate`. | **not documented** |
| On the new CDN endpoint, "If your add-in uses ExecuteFunction commands, register every command handler by using `Office.actions.associate(...)`". | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/referencing-the-javascript-api-for-office-library-from-its-cdn |
| `Office.addin.showAsTaskpane(): Promise<void>`. Requirement set **SharedRuntime 1.1**. Same for `hide()`, `onVisibilityModeChanged`, `get/setStartupBehavior`. `beforeDocumentCloseNotification` needs SharedRuntime 1.2. | https://learn.microsoft.com/en-us/javascript/api/office/office.addin |
| ⚠️ "As of February 23rd, 2026, the showAsTaskpane method no longer applies to add-ins published in the Microsoft Marketplace. Calls to showAsTaskpane are ignored and won't open the task pane. The showAsTaskpane method only applies to add-ins that are centrally deployed or sideloaded." | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/show-hide-add-in (ms.date 2026-03-23) |
| `showAsTaskpane()`/`hide()` need the shared runtime. They change visibility only; they don't reload the pane or reset its state. They fire `VisibilityModeChanged`. | same page |
| Platforms are the SharedRuntime 1.1 matrix (§2): Excel web, Windows 2002+, Mac 16.35+, Excel 2021 perpetual, no iOS. | https://learn.microsoft.com/en-us/javascript/api/requirement-sets/common/shared-runtime-requirement-sets |
| A function command's runtime closes when the function completes or after 5 minutes. Function commands can call `displayDialogAsync`. | https://learn.microsoft.com/en-us/office/dev/add-ins/design/add-in-commands |

**Inference:** a Marketplace build cannot open the pane from code. "Ouvrir" must be the manifest
`ShowTaskpane` action. "Vérifier/Envoyer/Mode test" must report results without opening the pane (shared state shown the next time the
pane is visible, or a dialog).

---

## 4. Storage: `OfficeRuntime.storage`, browser storage, settings, auth token

| Fact | Source (checked 2026-10-18) |
|---|---|
| `OfficeRuntime.storage` is asynchronous, global, persistent key-value storage. API set **SharedRuntime 1.1** for Excel, PowerPoint and Word. | https://learn.microsoft.com/en-us/javascript/api/office-runtime/officeruntime.storage |
| **"Storage limit is 10 MB per domain, which may be shared by multiple add-ins."** Values are strings: `setItem(key: string, value: string): Promise<void>`, `getItem(key): Promise<string \| null>`. Also `getItems`, `setItems`, `removeItem(s)`, `getKeys`. | same page |
| Per-item size limit. | **not documented** |
| `OfficeRuntime.storage` methods can't be called in a dialog. | https://learn.microsoft.com/en-us/office/dev/add-ins/excel/custom-functions-authentication |
| Browser runtime (task pane) supports localStorage and cookies. The JavaScript-only runtime doesn't. | https://learn.microsoft.com/en-us/office/dev/add-ins/testing/runtimes |
| "Store any private data in partitioned localStorage. Use `Office.context.partitionKey` as a key for local storage." `partitionKey` is `undefined` where there is no partitioning, "such as the browser controls for Windows applications". | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/persisting-add-in-state-and-settings · https://learn.microsoft.com/en-us/javascript/api/office/office.context |
| Don't use cookies or localStorage to share state across Office applications. | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/persisting-add-in-state-and-settings |
| `Office.context.document.settings` (`Office.Settings`): stored **in the host document**, per add-in and per document. `get/set/remove` touch only the in-memory copy; call `saveAsync` to persist. `get/set/remove` are in requirement set "Settings". | https://learn.microsoft.com/en-us/javascript/api/office/office.settings · https://learn.microsoft.com/en-us/office/dev/add-ins/develop/persisting-add-in-state-and-settings |
| Docs say to prefer the application-specific settings API in Excel: `Excel.SettingCollection` (`context.workbook.settings`, **ExcelApi 1.4**), scope per file + add-in, "part of the workbook". | same persisting page · https://learn.microsoft.com/en-us/javascript/api/excel/excel.settingcollection |
| Size limit of `Office.Settings` / `Excel.SettingCollection`. | **not documented** |
| "Don't store passwords and other sensitive PII in the Settings object. The data … is stored as part of the document's file format which is readily accessible." | https://learn.microsoft.com/en-us/office/dev/add-ins/concepts/privacy-and-security |
| Dialog-based auth: store the token "someplace where the task pane's browser instance can retrieve it, such as local storage or a server-side database", or pass it with `messageParent`. In Safari on the web, dialog and task pane don't share localStorage. Chromium 115+ partitions storage. Microsoft recommends `messageParent`/`messageChild` between dialog and pane. | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/auth-with-office-dialog-api |
| A general recommended token store for non-Microsoft (own-backend) auth in Excel add-ins. | **not documented** |

**Token decision (Inference):** keep the Facture Impec session token in `OfficeRuntime.storage`. It is available because
we require SharedRuntime 1.1, and 10 MB per domain is ample. Fall back to `localStorage` with the `partitionKey` prefix. Never put it in
`document.settings` / `workbook.settings`, because those travel inside the .xlsx file. Use workbook settings only for
non-secret per-workbook state, such as the "Mode test" flag.

---

## 5. Excel JavaScript APIs used

| API | Facts | Source (checked 2026-10-18) |
|---|---|---|
| `Range.values` | `any[][]`, ExcelApi 1.1. Raw string/number/boolean values. Error cells return the error string. ⚠️ "Locale-shaped strings (such as the date "19-8-2025" in nl-NL or **fr-FR** …) are stored as text instead of as dates." Use `formulasLocal`, ISO or a serial number. | https://learn.microsoft.com/en-us/javascript/api/excel/excel.range |
| `Range.text` | `readonly string[][]`, ExcelApi 1.1. Doesn't depend on cell width; no `#` substitution. | same |
| `Range.numberFormat` | `any[][]`, ExcelApi 1.1, the Excel number-format code. | same |
| `load()` | Always name the properties, e.g. `range.load("values, text, numberFormat")`. "Calling load without parameters (not recommended)" loads all scalars, slows the add-in and can exceed service size limits. | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/application-specific-api-model |
| `Worksheet.getUsedRange(valuesOnly?)` | ExcelApi 1.1; `valuesOnly` ExcelApi 1.2 (ignores formatting). A blank sheet returns the top-left cell and does not throw. `getUsedRangeOrNullObject(valuesOnly?)` (ExcelApi 1.4) returns a null object on a blank sheet. `Range.getUsedRange` **throws ItemNotFound** if there are no used cells. | https://learn.microsoft.com/en-us/javascript/api/excel/excel.worksheet · https://learn.microsoft.com/en-us/javascript/api/excel/excel.range |
| `Range.select()` | ExcelApi 1.1, "Selects the specified range in the Excel UI". A web-specific caveat is **not documented**. | https://learn.microsoft.com/en-us/javascript/api/excel/excel.range |
| `Worksheet.activate()` | ExcelApi 1.1, "Activate the worksheet in the Excel UI." | https://learn.microsoft.com/en-us/javascript/api/excel/excel.worksheet |
| `WorksheetCollection.items`, `Worksheet.name`, `Worksheet.visibility` | ExcelApi 1.1 (setting `visibility` is 1.2). `visibility`: `"Visible"`, `"Hidden"` or `"VeryHidden"`. Docs example: `worksheets.load('items')`, then `items[i].name`. Checked 2026-10-19; the « Registre » proposes the visible sheets (`sheetNames()` in `excel/office.ts`). | https://learn.microsoft.com/en-us/javascript/api/excel/excel.worksheetcollection · https://learn.microsoft.com/en-us/javascript/api/excel/excel.worksheet |
| `WorksheetCollection.onNameChanged`, `onMoved`, `onVisibilityChanged` | ExcelApi 1.17 each (`onAdded`, `onDeleted`, `onActivated` are 1.7). Checked 2026-10-19 on the preview reference; not used: an included sheet is followed by its name (`docs/DEFERRED.md`). | https://learn.microsoft.com/en-us/javascript/api/excel/excel.worksheetcollection |
| `range.format.fill.color` | `string`, ExcelApi 1.1: `#RRGGBB` or a named HTML colour (e.g. "orange"). | https://learn.microsoft.com/en-us/javascript/api/excel/excel.rangefill |
| `Worksheet.onChanged` | ExcelApi 1.7, "Occurs when data changes in a specific worksheet". | https://learn.microsoft.com/en-us/javascript/api/excel/excel.worksheet |
| `WorksheetChangedEventArgs` | 1.7: `address`, `changeType` (`RangeEdited, RowInserted, RowDeleted, ColumnInserted, ColumnDeleted, CellInserted, CellDeleted, Unknown`), `source` (`Local`/`Remote`), `type` (`"WorksheetChanged"`), `worksheetId`. 1.8: `getRange(ctx)`, `getRangeOrNullObject(ctx)`. 1.9: `details` (single-cell changes only). 1.14: `triggerSource` (`ThisLocalAddin`/`Unknown`), `changeDirectionState`. | https://learn.microsoft.com/en-us/javascript/api/excel/excel.worksheetchangedeventargs |
| Events behaviour | Add-in code that changes the workbook also triggers events. Handlers are destroyed when the add-in refreshes, reloads or closes, and don't persist. `context.runtime.enableEvents` turns events off at runtime level during batch writes. Coauthoring is shown in `source`. | https://learn.microsoft.com/en-us/office/dev/add-ins/excel/excel-add-ins-events |
| Batching / `sync` | Objects are proxies: commands queue until `context.sync()`. Minimise `sync` calls; group loads, then one sync; no `Excel.run`/`sync` inside loops. Excel on the web payload limit is **5 MB** per request/response (`RichAPI.Error`). Reads are limited to **5,000,000 cells**; split into chunks and sync each. Call `untrack()` only when you hold thousands of proxies. `suspendApiCalculationUntilNextSync()` helps for large writes. | https://learn.microsoft.com/en-us/office/dev/add-ins/excel/performance · https://learn.microsoft.com/en-us/office/dev/add-ins/concepts/resource-limits-and-performance-optimization · https://learn.microsoft.com/en-us/office/dev/add-ins/develop/application-specific-api-model |

**Inference:** our own highlight writes (`format.fill.color`) also fire `onChanged`. Filter them with
`triggerSource` (ExcelApi 1.14) or switch off `enableEvents` around the write.

**Implemented (M3):** the add-in ignores a change whose address lies entirely inside its two own columns
(`FI_Statut` / `FI_Détail`, `apps/addin/src/controller.ts`), which works on every ExcelApi 1.7 host;
`triggerSource` would need 1.14. Checked by `controller.test.ts`: one edit by the user, exactly one sync.

---

## 6. Sideloading and HTTPS

| Platform | Procedure | Source (checked 2026-10-18) |
|---|---|---|
| **Web, Microsoft account (personal)** | Open a workbook → **Home > Add-ins → More Settings → Upload My Add-in** → browse to the manifest → Upload. | https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-office-add-ins-for-testing |
| **Web, Microsoft 365 tenant (work/school)** | Sign in → App Launcher → Excel → new workbook → then the same steps 2–5. | same |
| Web, notes | The manifest is stored in the browser's local storage. Clearing the cache or switching browser means sideloading again. With a Yeoman-style project: `npm run start -- web --document {url}` (enable Developer Mode on first run). The page applies to the add-in only manifest. | same |
| **Windows (dev)** | `npm run start` or `npx office-addin-debugging start <manifest> desktop`. The tool "registers the add-in in the Windows registry or a special folder on a Mac". Always finish with `npm run stop` / `office-addin-debugging stop`. | https://learn.microsoft.com/en-us/office/dev/add-ins/testing/test-debug-non-local-server |
| **Windows (network share)** | Share a folder → **File > Options > Trust Center > Trust Center Settings > Trusted Add-in Catalogs** → Catalog Url = `\\server\share` → Add catalog → tick **Show in Menu**. Or run a `.reg` that creates `HKEY_CURRENT_USER\Software\Microsoft\Office\16.0\WEF\TrustedCatalogs\{GUID}` with `"Id"="{GUID}"`, `"Url"="\\\\server\\share"`, `"Flags"=dword:00000001`. Then **Home > Add-ins → Advanced → SHARED FOLDER** → Add. Limits: not for production, Windows only, no unified manifest, ribbon changes need reinstall. | https://learn.microsoft.com/en-us/office/dev/add-ins/testing/create-a-network-shared-folder-catalog-for-task-pane-and-content-add-ins |
| Windows, manual `Wef\Developer` registry sideload of an XML manifest | The only `Wef\Developer` key on Learn is the unified-manifest CLI's `…\16.0\Wef\Developer\OutlookSideloadManifestPath\TitleId` record. | **not documented** for XML · https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-add-in-with-unified-manifest |
| **Mac** | Copy the manifest to **`/Users/<username>/Library/Containers/com.microsoft.Excel/Data/Documents/wef`** (create `wef` if missing) → restart Excel → Home > Add-ins → pick the add-in. Requires Excel on Mac 15.19+. | https://learn.microsoft.com/en-us/office/dev/add-ins/testing/sideload-an-office-add-in-on-mac |
| Remove | Clear the Office cache (or `npm run stop`). | https://learn.microsoft.com/en-us/office/dev/add-ins/testing/clear-cache |

| HTTPS fact | Source (checked 2026-10-18) |
|---|---|
| HTTPS is "strongly recommended". It **must** be used for Office on the web and for Marketplace. Without it you get "unsecure content warnings and errors". | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/add-in-manifests · https://learn.microsoft.com/en-us/office/dev/add-ins/concepts/requirements-for-running-office-add-ins |
| Office on the web: "The browser might show an invalid certificate error that you'll need to bypass." | https://learn.microsoft.com/en-us/office/dev/add-ins/testing/debug-add-ins-in-office-online |
| Learn's sample flow for a local self-signed cert is `npx office-addin-dev-certs install`. | https://learn.microsoft.com/en-us/samples/officedev/office-add-in-samples/excel-add-in-hello-world |
| README (npm, not Learn): `install` creates a `localhost` cert signed by a developer CA and installs the CA "so that the certificates are trusted". Files live in `~/.office-addin-dev-certs`. Valid **30 days** by default (`--days`). `--machine` installs for all users (admin). | npm README `office-addin-dev-certs` |
| Whether each platform's webview (Windows, Mac, web) accepts a self-signed cert without installing the CA. | **not documented** |
| In this repo (M3): `vite.config.ts` calls the package's `generateCertificates(caPath, certPath, keyPath, days)` into `~/.office-addin-dev-certs`, which does **not** install the CA, so no sudo; the browser asks once. Its `getHttpsServerOptions()` would run `install`, which needs sudo on Linux. Version 3.0.1 sends no telemetry (the class is a no-op). | read in `node_modules/office-addin-dev-certs` 3.0.1, 2026-10-18 |

---

## 7. npm tooling (queried 2026-10-18 from `/tmp/claude-1004/office-research/npm`, outside the repo)

| Package | `npm view … version` | `time.modified` | What it does |
|---|---|---|---|
| `office-addin-dev-certs` | **3.0.1** | 2026-09-24T19:01:57Z | `install` / `verify` / `uninstall` the localhost dev certificate + dev CA (see §6). |
| `office-addin-manifest` | **3.0.1** | 2026-09-24T19:02:19Z | `info`, `modify` (`--guid`, `--displayName`), **`validate <manifest>`** (`-p` = production-level store validation, per Learn), `export` (zips a JSON manifest + icons). |
| `office-addin-debugging` | **7.0.1** | 2026-09-24T19:02:44Z | `start <manifest> [desktop\|web] [--app excel] [--document <path\|url>] [--dev-server <cmd>] [--dev-server-port <n>] [--no-sideload]…` starts the dev server, configures dev settings, registers and sideloads. `stop <manifest>` unregisters and shuts down. |
| `@types/office-js` | **1.0.612** | 2026-10-13T17:08:29Z | TypeScript definitions (DefinitelyTyped); Learn: `npm install --save-dev @types/office-js`. Preview APIs: `@types/office-js-preview`. |
| `@types/office-runtime` | 1.0.40 | 2026-10-04T08:53:32Z | Types for `OfficeRuntime.*` (DefinitelyTyped). |
| `office-addin-mock` | 4.0.1 | 2026-09-24T19:00:42Z | Mocks Office JS APIs for unit tests in Node (§9). |
| `office-addin-test-server` / `-test-helpers` | 3.0.1 / 3.0.1 | 2026-09-24T19:02:11Z / 19:02:10Z | Test server the add-in posts results to (default port 4201) + helpers (§9). |

Sources: https://learn.microsoft.com/en-us/office/dev/add-ins/testing/troubleshoot-manifest (validate, `-p`) ·
https://learn.microsoft.com/en-us/office/dev/add-ins/testing/test-debug-non-local-server (office-addin-debugging) ·
https://learn.microsoft.com/en-us/office/dev/add-ins/develop/referencing-the-javascript-api-for-office-library-from-its-cdn (@types/office-js);
the other descriptions are from the npm READMEs (repo `OfficeDev/Office-Addin-Scripts`).
Observed (not documented on Learn): `validate` prints "Acceptance test service has finished checking provided add-in",
which means it calls a Microsoft online service and needs network access.

---

## 8. Office.js CDN and `Office.onReady`

| Fact | Source (checked 2026-10-18) |
|---|---|
| Official CDN: `<script src="https://officeapis.public.onecdn.static.microsoft/1/office.js" type="text/javascript"></script>`. It must go **inside `<head>`**. `/1/` = latest release of v1. Preview APIs: `https://officeapis.public.onecdn.static.microsoft/beta/office.js`. | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/referencing-the-javascript-api-for-office-library-from-its-cdn (ms.date 2026-09-23) |
| "If you plan to publish your Office Add-in to the Microsoft Marketplace, you **must use this CDN reference**. Use local references only for internal, development, and debugging scenarios." | same |
| Legacy endpoint `https://appsforoffice.microsoft.com/lib/1/hosted/office.js`: the new one "serves the same current Office.js release, but it enables additional secure defaults". These are: no auto-loaded Microsoft Ajax globals; `ExecuteFunction` handlers must be registered with `Office.actions.associate`; CSP and Trusted Types must allow the endpoint; `*.static.microsoft` must be allow-listed. | same |
| ⚠️ **Conflict:** certification policy 1120.1 still says add-ins "must use the latest version of the Microsoft-hosted Office.js file at (https://appsforoffice.microsoft.com/lib/1/hosted/office.js)". | https://learn.microsoft.com/en-us/legal/marketplace/certification-policies (ms.date 2025-08-06) |
| ⚠️ Office.js sets `window.history.replaceState` and `pushState` to **null**. Documented workaround: cache both before the Office.js `<script>` and restore them after it. | CDN page above |
| `Office.onReady()` is recommended over `Office.initialize`. It returns a Promise resolving to `{ host, platform }` and can be called in several places. Framework initialisation should usually run inside it. Outside Office it resolves with `null` host and platform. If office.js is blocked by network filters, firewalls or extensions, it **never resolves**. | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/initialize-add-in |

**Inference:**
- Use the new `officeapis.public.onecdn.static.microsoft` URL. The CDN page is newer than the policy page, and both are Microsoft-hosted. Re-check policy 1120.1 before submitting.
- Keep the `<script>` tag in Vite's `index.html` `<head>` and do not bundle office.js.
- Office.js nulls `pushState`/`replaceState`, so use a router that doesn't depend on them (memory or hash routing) or apply the documented workaround.
- Render React after `await Office.onReady()`, with a timeout fallback in case office.js never loads.

---

## 9. Automated / UI testing

| Fact | Source (checked 2026-10-18) |
|---|---|
| Unit tests: **`office-addin-mock`** mocks Office JS APIs inside the Node test process. It works with any framework (Jest, Mocha); the article's examples use Jest. It also lets tests check `load`/`sync` usage. | https://learn.microsoft.com/en-us/office/dev/add-ins/testing/unit-testing |
| Office.js loaded in a plain browser outside Office resolves `onReady` with `null` host/platform. This is documented for debugging UI with browser tools. | https://learn.microsoft.com/en-us/office/dev/add-ins/develop/initialize-add-in |
| `office-addin-test-server` + `office-addin-test-helpers`: a "framework for testing Office task pane add-ins by allowing add-ins to send results to a test server". Described on the npm READMEs only, not on Learn. | npm READMEs |
| Official guidance for **Playwright** (or Selenium, Puppeteer) or other UI automation of an add-in running inside Excel. No Learn page mentions these tools; a web search found only generic Microsoft Playwright Testing pages. | **not documented** |

---

## Not documented (consolidated)

1. Whether unified-manifest support for Excel is GA or preview (the table only says "Yes").
2. Manual web "Upload My Add-in" for a unified manifest.
3. Requirement set for `Office.actions.associate`.
4. Per-item size limit of `OfficeRuntime.storage` (only the total, 10 MB per domain shared, is documented).
5. Size limit of `Office.Settings` / `Excel.SettingCollection`.
6. A general recommended auth-token store for non-Microsoft auth.
7. Any Excel-on-the-web caveat for `Range.select()`.
8. Manual `Wef\Developer` registry sideload of an XML manifest on Windows.
9. Per-platform acceptance of self-signed certificates, beyond "trusted" via dev-certs and "bypass" in the browser.
10. Playwright or other UI-automation guidance for add-ins.
11. Which Office.js URL Marketplace validation enforces today: the CDN page and policy 1120.1 disagree.
