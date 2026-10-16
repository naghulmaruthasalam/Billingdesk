#!/usr/bin/env bash
# One command on Fedora: install prerequisites, build the RPM and optionally install it.
#   bash scripts/build-fedora.sh            # build only
#   bash scripts/build-fedora.sh --install  # build, then install with dnf
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v dnf >/dev/null 2>&1; then
  echo "This script is for Fedora/RHEL-family systems (dnf not found)." >&2
  exit 1
fi

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

echo "==> Installing build prerequisites (Node.js, rpm-build, runtime libraries)"
$SUDO dnf install -y nodejs npm git rpm-build libxcrypt-compat gtk3 nss alsa-lib libXScrnSaver libXtst at-spi2-core libnotify xdg-utils

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js 22 or newer is required (found $(node -v)). Install it with: sudo dnf module install nodejs:22   or use https://nodejs.org" >&2
  exit 1
fi

echo "==> Installing npm dependencies (no native compile needed: better-sqlite3 ships prebuilt binaries)"
npm ci --ignore-scripts
node node_modules/electron/install.js

echo "==> Building the RPM"
npm run dist:rpm

RPM="$(ls -1 release/sree-krishna-billing-*.x86_64.rpm | head -n1)"
echo
echo "Built: $RPM"
if [ "${1:-}" = "--install" ]; then
  $SUDO dnf install -y "./$RPM"
  echo "Installed. Start it from the application menu (Sree Krishna Billing) or run: \"/opt/Sree Krishna Billing/sree-krishna-billing\""
else
  echo "Install with: sudo dnf install ./$RPM"
fi
