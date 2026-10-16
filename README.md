# Sri Krishna Billing

Offline-first desktop billing, inventory and reporting for **Shree Krishna Crackers Shop** (ஸ்ரீ கிருஷ்ணா பட்டாசு கடை), Coimbatore.

**Bills, receipts and labels are printed in English only.** Tamil names stay in the catalogue for searching and can be switched back on under *Settings → Invoices* ("Also print Tamil names") and in the label options.

One codebase, one SQLite schema, two installers:

| Platform | Package | Command |
|---|---|---|
| Windows x64 | NSIS installer `.exe` | `npm run dist:win` |
| Fedora x86_64 | `.rpm` | `npm run dist:rpm` |

Stack: Electron · React · TypeScript · Vite · Tailwind CSS (shadcn-style components on Radix) · SQLite (`better-sqlite3`) · Zod · Recharts · electron-builder. Fonts: Inter + Noto Sans Tamil (bundled, OFL).

## Contents
- [Quick start (development)](#quick-start-development)
- [Scripts](#scripts)
- [Architecture](#architecture)
- [First run: what the owner must do before billing](#first-run-what-the-owner-must-do-before-billing)
- [The product catalogue](#the-product-catalogue)
- [Business rules](#business-rules)
- [Data, backups and restore](#data-backups-and-restore)
- [Building packages](#building-packages)
- [Testing](#testing)
- [Security model](#security-model)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [Limitations](#limitations)

## Quick start (development)

Requirements: Node.js 22+, npm 10+. On Linux you also need the usual Electron runtime libraries (GTK 3, NSS, ALSA).

```bash
npm install
npm run dev          # Vite dev server + Electron, with hot reload
```

On Linux as `root` (containers/CI) the dev script adds `--no-sandbox` automatically. Headless: `xvfb-run -a npm run dev`.

`better-sqlite3` 13 ships N-API prebuilt binaries for Windows and Linux (x64/arm64), the same binary works under Node (tests) and Electron, so there is **no native rebuild step** and cross-platform packaging does not need a compiler.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Development mode (Vite HMR + Electron) |
| `npm run build` | Production build into `dist/renderer` and `dist-electron/` |
| `npm start` | Build, then run the built app |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` for app and tool configs |
| `npm test` | Vitest unit/integration tests (real SQLite, no mocks of the database) |
| `npm run test:e2e` | Build, then drive the real Electron app with Playwright (needs a display; on Linux use `xvfb-run -a npm run test:e2e`; `poppler-utils` enables PDF text/font checks and `zbar-tools` the barcode-decode checks) |
| `npm run pack` | Unpacked app in `release/<platform>-unpacked` (quick packaging check) |
| `npm run dist:win` | Windows NSIS installer → `release/SriKrishnaBilling-Setup-<version>-win-x64.exe` |
| `npm run dist:rpm` | Fedora RPM → `release/sri-krishna-billing-<version>.x86_64.rpm` |
| `npm run fonts` | Re-copy the bundled fonts from `node_modules` into `public/fonts` |

`E2E_EXECUTABLE=<path>` points the e2e run at a packaged/installed application instead of the source tree; `E2E_OUT=<dir>` sets where screenshots and the generated PDF go.

## Architecture

```
src/
  shared/    Pure code used by both sides: money (integer paise), pricing (discount/tax/rounding/payments),
             permissions, the printed catalogue transcription, invoice HTML template, IPC channel allow-list
  core/      All business logic and database access. No Electron imports, so it is tested directly.
             db/ (connection, migrations)  api.ts (the ONLY entry point from the UI: authenticate → authorise → Zod-validate → run)
             billing, returns, inventory, purchases, products, catalogue-io, reports, backup, auth, settings, audit, ...
  main/      Electron glue: window, session lock-down, IPC, native dialogs, printing, logging
  preload/   contextBridge: forwards only allow-listed channels
  renderer/  React UI (pages/, components/, hooks/)
tests/       Vitest suites
scripts/     build, dev, e2e, font and icon helpers
```

Key decisions:

* **Money is integer paise** everywhere (`src/shared/money.ts`); discounts and tax use integer arithmetic with explicit half-up rounding. There is no floating point in any money path.
* **Completed bills are immutable.** SQLite triggers reject UPDATE/DELETE on invoice amounts, lines, payments, returns, stock movements and the audit log. Corrections are recorded as returns, cancellations, adjustments or voids.
* **Stock changes only through `recordMovement`**, which writes the immutable movement (reason, user, time, balance) and the cached stock together.
* **Billing is one transaction**: invoice number allocation, invoice, lines, payments, stock movements. A failure rolls everything back, including the counter (tested with an injected failure). Each bill carries an idempotency key, so a repeated click or retry returns the original invoice instead of billing twice.
* **Permissions are enforced in the main process** from the roles stored in the database and re-read on every call (a role change takes effect immediately). The UI only hides what the backend would refuse anyway.
* **Supervisor approval**: when a cashier lacks a permission (discount override, selling beyond stock, cancel, refund), the UI asks for an owner/manager's credentials for that single action; the audit log records both people.
* **Time**: timestamps are stored in UTC; business dates use Asia/Kolkata. Currency is INR.

## First run: what the owner must do before billing

Real billing is deliberately locked until the owner has checked the transcribed data.

1. **Create the owner account.** There is no default password. A one-time **recovery code** is shown; keep it safe. It resets the owner password without touching any data (*Sign in → Forgot the owner password?*). If the recovery code is lost too, `node scripts/reset-owner-password.mjs` resets the owner password offline without touching any data (see TROUBLESHOOTING.md). To wipe everything and start as a new installation, `node scripts/start-fresh.mjs --yes` moves the data folder aside (nothing is deleted).
2. **Settings → Shop details.** The address was transcribed from a photograph of the brochure (check the spelling, e.g. "Kurunthachalam Nagar"). Correct it, save, and press *I have checked these details*. **Printing is disabled until you confirm**, and editing the name/address/phones withdraws the confirmation.
3. **Products → Catalogue review.** Entries whose print was unclear are flagged with the reason. Compare with the paper list, correct, mark verified, then **Approve catalogue for billing**. Printed rates are stored separately and shown whenever a rate is changed.
4. **Inventory → Opening stock.** Enter counted quantities (or import `sku,qty` CSV). Nothing is invented: every product starts at 0, and with stock enforcement on a bill cannot exceed recorded stock without an authorised override.
5. Optional: purchase costs (via Stock purchases or product edit), tax settings (off by default), additional users.

## The product catalogue

`src/shared/catalogue.ts` is a transcription of the four photographed pages: **114 printed rows** in print order (printed S.No 1–113 plus the row printed as **114** "Flower Pot Small", which sits between 18 and 19), 14 categories, English and Tamil names, printed units and rates.

* **Where this transcription differs from the prompt's summary list**: row 34 is printed `3½ Lakshmi` (not 3¾) and row 70 is `Cit Poot` (not "Cit Pool"). The photographs were taken as the source of truth.
* The brochure line about *Chinese* crackers is a statement that none are sold ("சீன பட்டாசுகள் விற்பனைக்கு இல்லை"); it is **not** a discount exclusion. The only discount exclusion printed in the price list is the **"GIFT BOXES - NO DISCOUNT"** heading, so Gift Boxes (110–113) are seeded as non-discountable (flagged for you to confirm). Everything else follows the shop default (10%), configurable per product and per category.
* 27 entries are seeded flagged *needs review* (blank unit cells, 114 numbering, an odd rate of 66.00 on the 30 cm Green sparkler, spelling as printed such as "Gaint", "Try Colour", "Cit Poot", and Tamil text read from photographs). Spelling is **never silently corrected**.
* Stock, purchase cost and GST are not seeded.
* Import/export: *Products → Import / export*. Preview shows new/changed/unchanged rows, duplicates (SKU/barcode/name), missing prices, invalid values and uncertain names; nothing is saved until you import. *Reset to printed list* restores printed names/units/rates without touching stock or sales history.

## Business rules

* **Discount**: shop default (10%), category rule, product rule (`inherit` / `eligible` / `never`). A line has exactly one discount - a manual override *replaces* the policy discount, never stacks. Overrides need a reason, confirmation, permission (or supervisor approval) and are audited.
* **Rounding**: *per line* or *on the whole bill*, to the nearest paisa or rupee (Settings → Discount & tax). Whole-bill rounding stores a visible rounding adjustment.
* **Tax**: off by default; optional single rate, exclusive or inclusive. No GST number is invented.
* **Payments**: cash (with change), UPI, card, split; optional pending balances (off by default).
* **Invoice numbers**: `<prefix>-<zero-padded sequence>` (default `SKP-000001`), allocated inside the billing transaction.
* **Returns**: partial/full, per-line restock or damaged, refund = amount actually paid (discount, tax and rounding handled), reason required. **Cancellation**: whole bill, only if it has no returns; restores stock and reverses payments.
* **Reports** keep revenue, collections, discounts, tax, refunds and profit separate. Net sales is never labelled profit; gross profit uses only bill lines that carried a valid purchase cost, and reports the coverage.

## Data, backups and restore

User data is **never** stored in the install directory:

| OS | Location |
|---|---|
| Windows | `%APPDATA%\Sri Krishna Billing\` |
| Linux | `~/.config/Sri Krishna Billing/` |

Inside: `data/skbilling.sqlite` (WAL mode, `synchronous=FULL`), `backups/`, `logs/main.log`. Uninstalling does not delete it.

* **Backups use SQLite's online backup API**, so committed data still sitting in the `-wal` file is included and the app can keep billing meanwhile. The snapshot is converted to a single self-contained file and verified with `integrity_check` + `foreign_key_check`.
* Automatic daily backup (when the app is open), configurable retention (applies to automatic backups only), manual backup to any folder, and a backup before every schema migration.
* **Restore** validates the file first (tables, integrity, schema version, counts, latest bill), shows a preview and a warning, requires your password, takes a *pre-restore* safety copy, swaps the file, runs migrations and an integrity check, and automatically puts the old data back if anything fails.
* Settings → Backup & restore also offers an on-demand integrity check, catalogue CSV export and business settings export.
* Copy backups to a USB drive regularly; a backup on the same disk does not protect against disk failure.

## Barcodes, scanners and label printers

* **Every product has a barcode.** A unique, shop-internal **EAN-13** (digits only, prefix `2` = the retail "in-store" range, correct check digit) is created automatically for all 114 catalogue products, for every product you add or import later, and - on start-up - for any product in an older database that lacks one. A barcode is **never changed** by editing a product, so printed labels stay valid forever. If a carton already carries a manufacturer EAN-13 you can type it into the product instead (the check digit is verified; scanning works with any code, but only EAN-13 can be drawn on a label).
* **Barcode scanner (the "reader")**: any USB or Bluetooth scanner in its default *HID keyboard* mode works - no driver, no setup. Make sure it adds **Enter** after each scan (the factory default). At **New Bill**, a scan adds the product (a second scan adds one more) **whatever field has the cursor**: the app recognises scanner-speed typing, removes the stray digits from the field, and beeps (high = added, low = unknown/inactive/no price; mute with the speaker button). A scan after a completed sale starts the next bill. Slow human typing is never mistaken for a scan. Scanning a code into the search box on Products, Inventory or Purchases finds the product too.
* **Label printing**: *Products → Barcode labels*. Pick products and copies (or *Copies = stock* after receiving goods), choose a label type, preview, then **Print** or **Save as PDF**.
  * Roll labels 50×30, 40×30, 60×40 mm or any custom size - one label per page at the exact size.
  * A4 sticker sheets (3×8, 4×10, 3×7 or custom columns/rows/margins) with **Start at label no.** to re-use a part-used sheet.
  * Each label: shop name, English name (Tamil optional), price per unit, bars and digits. The preview shows the printed bar width and warns when it is too thin for reliable scanning (below 0.25 mm).
  * *Save as shop default* stores the layout for everyone.
  * A single label can also be printed from the product's edit dialog.
* **Printers**: labels go through the operating system's print system, like receipts. Install the label printer's driver, set its paper to the same size as the label (margins zero) and choose the printer in the print window. Direct raw printer languages (ZPL/TSPL/ESC-POS) are not used.
* **Verified**: unit tests check the EAN-13 encoder against published codes; the end-to-end run prints labels to PDF (roll and A4) and **decodes the bars with the independent `zbar` decoder**, requiring the decoded numbers to equal the products' barcodes; and it types a barcode at scanner speed into the customer-name field of the real app.

## Printers

*Settings → Printers* lists the printers installed on the computer (with their status) and lets the owner choose:

* the **receipt / invoice printer** and the **barcode label printer** - each can be a different device, or "Ask me which printer each time" - the app then shows its own **Choose printer** window when you press Print (the operating system's print dialog is never used: it has to be opened from a hidden window, which is unreliable on Linux);
* **Don't ask - always use the printer chosen here** - receipts and labels go straight to it (the system default printer if none is chosen);
* **Receipt copies** (1-5) and **Print the receipt automatically after each sale** (the sale-complete screen prints it for you, once, then you press *New bill*);
* **Print test receipt** and **Print test label** buttons that send a clearly marked SAMPLE page / a real product label to the selected printer.

If a saved printer is unplugged or uninstalled, billing is never blocked: the app uses the system default printer and tells the cashier which printer was missing; if no printer is installed at all it says so and offers Save as PDF. Paper size comes from *Invoices & printing* (58 mm / 80 mm / A4) and the label layout; in the printer driver choose the same size with zero margins. Printing uses the operating system's drivers (Windows spooler, CUPS on Linux) - thermal receipt printers need a driver or a CUPS queue; raw ESC/POS and cash-drawer kick are not sent. Save-as-PDF is always available.

On Linux add the printer first in *Settings → Printers* or at `http://localhost:631` (CUPS); check with `lpstat -p`. The end-to-end run sets up a real CUPS queue (`CUPS-PDF`) and verifies a receipt printed through the Choose-printer window (and that the app stays open), silent test receipt, silent test label (barcode decoded) and auto-print after a sale (`E2E_PRINTER=CUPS-PDF`).

### Thermal receipt printers (Rongta RP-3200, Epson TM, Xprinter, ...) on Linux

Many receipt printers get a CUPS queue with a **text-only driver** (the options list shows *PrinterEncoding*, *NumLines*, *NumColumns*). Such a queue cannot print a page, so nothing comes out in the normal "Printer driver" mode. The default mode is now **Automatic**: thermal-looking queues (name like RP-3200 / TM-T20 / XP-58, or a text-only/raw driver) are sent as ESC/POS by themselves, other printers use their driver. After every print the app also asks CUPS whether the queue is stopped/disabled and says so instead of showing a plain success. Choose **Settings → Printers → How receipts are sent → Thermal receipt printer - ESC/POS** instead:

* the receipt is drawn as a 1-bit picture at the printer's native width (80 mm paper = 576 dots, 58 mm = 384 dots) - so Tamil, bold text, ₹ and barcodes all print - and sent as ESC/POS raster commands through a raw print job (`lp -o raw`), which bypasses the queue's driver;
* the paper is cut after each receipt (switch off with *Cut the paper after each receipt*); copies and auto-print work as before;
* the app suggests this mode automatically when the selected queue looks like a thermal printer;
* A4 invoices always use the driver; Windows uses the driver (install the printer's Windows driver).

The end-to-end run checks this against a fake network printer (`scripts/fake-thermal-printer.mjs`) behind a real raw CUPS queue and decodes the captured bytes back to the receipt image.

## Building packages

Build each package on (or for) its platform. The commands below were run in this repository's development environment (Ubuntu 24.04, with `rpm` and `wine` installed for cross-building); see [Limitations](#limitations) for what was and was not verified on real Windows/Fedora.

```bash
npm ci
bash scripts/build-fedora.sh   # one command on Fedora: installs prerequisites, builds and (optionally) installs the RPM
npm run dist:rpm      # needs rpmbuild (dnf install rpm-build libxcrypt-compat / apt install rpm); fpm is downloaded by electron-builder
npm run dist:win      # on Windows: no extras. On Linux: needs wine (+ wine32) for the NSIS step
```

`.github/workflows/build.yml` builds and tests on `ubuntu-latest`, builds the RPM and installs it with `dnf` inside a `fedora` container, and builds the NSIS installer on `windows-latest`, silently installing it - each followed by the end-to-end run against the **installed** application.

Install on Fedora: `sudo dnf install ./sri-krishna-billing-1.0.0.x86_64.rpm` (installs to `/opt/Sri Krishna Billing/`, adds a desktop entry). Windows: run the setup `.exe` (per-user, choose folder, desktop shortcut). The installers are **unsigned**, so Windows SmartScreen will warn; code signing needs a certificate that the shop must purchase.

## Testing

`npm test` runs ~120 tests against real in-memory/on-disk SQLite databases: pricing and rounding, discount eligibility, cash change, split payments, invoice numbering, stock deduction, insufficient stock, transaction rollback, idempotency, returns/refunds, cancellation audit trail, search (English, Tamil, SKU, serial, wildcards), CSV import preview, backup (including WAL-only data, corruption, restore + rollback), migrations (v1 → latest with data, failure rollback, newer-schema refusal), role permissions (every channel signed-out, cashier/inventory/owner, supervisor approval), invoice HTML/Tamil/paper sizes, print gating.

`npm run test:e2e` drives the built app like a user: setup → catalogue review/approval → address confirmation → opening stock → multi-item bill with discounts and cash change → **Save as PDF with Tamil verified in the PDF text and embedded Noto Sans Tamil fonts** → UPI sale → history/return/cancellation → stock correctness → dashboard/reports → backup → restore → offline check (a `fetch` to the internet is blocked) → restart persistence.

## Security model

* `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; the database exists only in the main process.
* The preload exposes one function that forwards an allow-list of channel names; the main process rejects IPC from any frame that is not the app's own page, then authenticates, authorises, validates input with Zod, and runs the handler. No shell execution from the UI; the only OS interactions are native file dialogs, printing, and opening the data folder.
* A strict CSP; navigation and `window.open` are blocked; all permission requests are denied; **every non-local network request is cancelled**, so the app cannot go online even by mistake.
* Passwords: bcrypt (cost 10), lockout after 5 failures for 5 minutes, password re-entry for destructive operations (restore, catalogue reset, user/role changes).
* CSV export neutralises spreadsheet formula injection.

## Keyboard shortcuts

Defaults (customisable per computer in Settings → Appearance & shortcuts; OS-reserved combinations are refused):

| Key | Action |
|---|---|
| `F2` | Focus product search (type `3*hydrogen` to add 3; scanners work: barcode/SKU + Enter) |
| `F4` | Edit quantity of the selected line |
| `F6` | Open payment / select method |
| `F8` | Open payment; inside the dialog, complete the sale |
| `F9` | New bill (after a completed sale) |
| `Ctrl+P` | Print the current eligible document (sale-complete screen, print preview) |
| `Esc` | Close a dialog / clear the search |
| `↑ ↓ Enter` | Navigate and add search results |

## Limitations

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for operational problems. Known limits:

* Real printers could not be exercised in the development container: printing was verified through the identical PDF code path (page size, fonts, Tamil), not on a physical 58 mm/80 mm thermal printer. Thermal margins and the printer's driver paper size may need adjusting on first use (use *Settings → Print test page*).
* **Verification status**: GitHub Actions run [37902953209](https://github.com/naghulmaruthasalam/Billingdesk/actions/runs/37902953209) built the Fedora RPM (installed it with `dnf` in a `fedora:latest` container) and the Windows NSIS installer (silently installed on `windows-latest`), and ran the full end-to-end script against each *installed* application - all green. That is real Windows Server and Fedora, but headless CI machines: a physical thermal printer, a desktop session on the shop's own PC, and OS-specific permissions (antivirus, SELinux policy) are not covered.
* Installers are unsigned. Auto-update is not included (the app makes no network requests by design).
* Single computer: there is no multi-terminal sync. Two cashier PCs would need separate databases.
* Stock is whole-number units (Box/Pkt/Pc); fractional quantities are not supported.
* Tax is a single invoice-level rate; per-item tax slabs, HSN codes and GST-format invoices are not implemented. Confirm the shop's actual requirements with its accountant.
* Customer-facing display, loyalty and parked bills are not implemented. There is no camera or OCR input: scanning needs a hardware barcode scanner. Invoice numbers are not printed as barcodes yet (the Returns page accepts a typed or scanned invoice number as text).
* Dark theme is provided; the print output is always light.

## Licences

Application code: all rights reserved by the shop. Bundled fonts: Inter and Noto Sans Tamil, SIL Open Font License 1.1 (licence texts in `public/fonts/`). Other dependencies keep their own licences.
