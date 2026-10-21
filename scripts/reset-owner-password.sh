#!/usr/bin/env bash
# Reset the owner password of the installed "Sree Krishna Billing" WITHOUT the recovery code.
# Bills, stock and products are not touched; a safety copy of the database is saved first; a NEW recovery code is shown.
#   1. Close the application.
#   2. Run:   bash "/opt/Sree Krishna Billing/resources/tools/reset-owner-password.sh"
#      (or, from a downloaded copy: put this file, reset-owner-password.mjs and bcryptjs.cjs in one folder and run  bash reset-owner-password.sh )
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPDIR="${SKB_APP_DIR:-/opt/Sree Krishna Billing}"
# when run from <app>/resources/tools, the app folder is two levels up
[ -x "$HERE/../../sree-krishna-billing" ] && APPDIR="$(cd "$HERE/../.." && pwd)"
BIN="$APPDIR/sree-krishna-billing"
[ -x "$BIN" ] || { echo "Cannot find $BIN - is Sree Krishna Billing installed?" >&2; exit 1; }
pgrep -f "$BIN" >/dev/null 2>&1 && { echo "Please close Sree Krishna Billing first, then run this again." >&2; exit 1; }
# The app's own runtime and libraries are used, so no Node.js installation is needed.
ELECTRON_RUN_AS_NODE=1 NODE_PATH="$APPDIR/resources/app.asar/node_modules" "$BIN" "$HERE/reset-owner-password.mjs" "$@"
