#!/usr/bin/env bash
# Sideloads the development add-in (apps/addin/manifest.xml, served by `pnpm dev:addin`).
# The three paths are in docs/RUNBOOK.md § Add-in; the sources in docs/OFFICE.md §6.
#   scripts/sideload.sh mac      Excel on Mac: copy the manifest into Excel's wef folder
#   scripts/sideload.sh remove   Excel on Mac: take it out again
#   scripts/sideload.sh web      Excel on the web: print the steps (the manifest lives in the browser)
# Excel on Windows: scripts/sideload.ps1.
set -euo pipefail

manifest="$(cd "$(dirname "$0")/.." && pwd)/apps/addin/manifest.xml"
wef="$HOME/Library/Containers/com.microsoft.Excel/Data/Documents/wef"

case "${1:-}" in
  mac)
    mkdir -p "$wef"
    cp "$manifest" "$wef/facture-impec.xml"
    echo "Copied to $wef. Restart Excel, then Home > Add-ins > Facture Impec."
    ;;
  remove)
    rm -f "$wef/facture-impec.xml"
    echo "Removed. Restart Excel; clear the Office cache if the ribbon group stays."
    ;;
  web)
    cat <<STEPS
1. pnpm dev   (the task pane must answer on https://localhost:3000; accept the certificate once
   by opening https://localhost:3000/taskpane.html in the same browser)
2. Open a workbook in Excel on the web.
3. Home > Add-ins > More Settings > Upload My Add-in > Browse: $manifest > Upload.
The manifest stays in this browser's storage: clearing the cache means uploading it again.
STEPS
    ;;
  *)
    sed -n '3,7p' "$0"
    exit 2
    ;;
esac
