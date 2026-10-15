# How to run Shree Krishna Billing from this source

Needs: **Node.js 22+** (npm 10+), internet for the first `npm ci`. After that the app itself is fully offline.

## Fedora / Linux

**A. Run it straight from the source (quickest test)**
```bash
sudo dnf install -y nodejs npm gtk3 nss alsa-lib libXScrnSaver libXtst at-spi2-core libnotify xdg-utils
unzip sri-krishna-billing-source.zip && cd sri-krishna-billing
npm ci --ignore-scripts
node node_modules/electron/install.js
npm start            # builds, then opens the app
```
(Check `node -v` prints v22 or newer; if not: `sudo dnf module install nodejs:22`.)

**B. Build and install the RPM (one command)**
```bash
bash scripts/build-fedora.sh --install
```
Builds `release/sri-krishna-billing-1.0.0.x86_64.rpm`, installs it with dnf; start **Sri Krishna Billing** from the application menu.
Build only (no install): `bash scripts/build-fedora.sh`, then `sudo dnf install ./release/sri-krishna-billing-*.rpm`.

## Windows

```bat
:: install Node.js 22 LTS from https://nodejs.org first
npm ci
npm start            :: run from source
npm run dist:win     :: builds release\SriKrishnaBilling-Setup-1.0.0-win-x64.exe
```
The installer is unsigned: SmartScreen shows "Windows protected your PC" -> More info -> Run anyway.

## First launch
1. Create the owner account (there is no default password) and write down the recovery code.
2. Settings -> Shop details: check the address, then confirm it. Products -> Review: verify the catalogue, then approve it. Billing stays locked until both are done.
3. Inventory: enter opening stock (nothing is pre-filled).
4. Printers (Settings -> Printers): pick your printer. Thermal roll printers without a proper driver (e.g. RP-3200-LITE): set "How receipts are sent" to **ESC/POS**.

## Start from a brand-new state
Close the app, then `node scripts/start-fresh.mjs` (preview) and `node scripts/start-fresh.mjs --yes`. It moves the data folder (`~/.config/Sri Krishna Billing/`, Windows `%APPDATA%\Sri Krishna Billing\`) aside to `...old-<time>`; nothing is deleted.

## Forgot the owner password and recovery code
`node scripts/reset-owner-password.mjs` (app closed). See TROUBLESHOOTING.md.

## Checks
`npm run lint && npm run typecheck && npm test` (137 tests); `xvfb-run -a npm run test:e2e` runs the real app end to end on Linux.
