# Sideloads the development add-in into Excel on Windows (docs/RUNBOOK.md, Add-in; docs/OFFICE.md 6).
#   scripts\sideload.ps1         registers apps\addin\manifest.xml and opens Excel
#   scripts\sideload.ps1 -Stop   unregisters it (always do this when you are done)
# Run `pnpm dev:addin` first: the task pane must answer on https://localhost:3000.
# Other way, without this tool: a shared-folder catalog (docs/RUNBOOK.md).
param([switch]$Stop)
$ErrorActionPreference = 'Stop'
$manifest = Join-Path $PSScriptRoot '..\apps\addin\manifest.xml'
$tool = 'office-addin-debugging@7.0.1'

if ($Stop) {
  npx --yes $tool stop $manifest
} else {
  npx --yes $tool start $manifest desktop --app excel
}
exit $LASTEXITCODE
