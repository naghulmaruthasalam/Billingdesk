# Sri Krishna Billing

Offline-first desktop billing, inventory and reporting for **Sri Krishna Pattasu Kadai** (ஸ்ரீ கிருஷ்ணா பட்டாசு கடை), Kovaipudur, Coimbatore.

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
| `npm run test:e2e` | Build, then drive the real Electron app with Playwright (needs a display; on Linux use `xvfb-run -a npm run test:e2e`; `poppler-utils` enables PDF text/font checks) |
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

1. **Create the owner account.** There is no default password. A one-time **recovery code** is shown; keep it safe. It resets the owner password without touching any data (*Sign in → Forgot the owner password?*).
2. **Settings → Shop details.** The address was transcribed from a photograph of the brochure ("Gurunthasala Nagar" in particular may be mis-spelt). Correct it, save, and press *I have checked these details*. **Printing is disabled until you confirm**, and editing the name/address/phones withdraws the confirmation.
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

## Building packages

Build each package on (or for) its platform. The commands below were run in this repository's development environment (Ubuntu 24.04, with `rpm` and `wine` installed for cross-building); see [Limitations](#limitations) for what was and was not verified on real Windows/Fedora.

```bash
npm ci
npm run dist:rpm      # needs rpmbuild (dnf install rpm-build libxcrypt-compat / apt install rpm); fpm is downloaded by electron-builder
npm run dist:win      # on Windows: no extras. On Linux: needs wine (+ wine32) for the NSIS step
```

`.github/workflows/build.yml` builds and tests on `ubuntu-latest`, builds the RPM and installs it with `dnf` inside a `fedora` container, and builds the NSIS installer on `windows-latest`, silently installing it - each followed by the end-to-end run against the **installed** application.

Install on Fedora: `sudo dnf install ./sri-krishna-billing-1.0.0.x86_64.rpm` (installs to `/opt/Sri Krishna Billing/`, adds a desktop entry). Windows: run the setup `.exe` (per-user, choose folder, desktop shortcut). The installers are **unsigned**, so Windows SmartScreen will warn; code signing needs a certificate that the shop must purchase.

## Testing

`npm test` runs ~110 tests against real in-memory/on-disk SQLite databases: pricing and rounding, discount eligibility, cash change, split payments, invoice numbering, stock deduction, insufficient stock, transaction rollback, idempotency, returns/refunds, cancellation audit trail, search (English, Tamil, SKU, serial, wildcards), CSV import preview, backup (including WAL-only data, corruption, restore + rollback), migrations (v1 → latest with data, failure rollback, newer-schema refusal), role permissions (every channel signed-out, cashier/inventory/owner, supervisor approval), invoice HTML/Tamil/paper sizes, print gating.

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
* The Windows and Fedora packages are built, but installation and launch on real Windows/Fedora hardware are only verified by the CI workflow in this repository when it has run (see the implementation report for the exact status). Windows was additionally smoke-launched under Wine.
* Installers are unsigned. Auto-update is not included (the app makes no network requests by design).
* Single computer: there is no multi-terminal sync. Two cashier PCs would need separate databases.
* Stock is whole-number units (Box/Pkt/Pc); fractional quantities are not supported.
* Tax is a single invoice-level rate; per-item tax slabs, HSN codes and GST-format invoices are not implemented. Confirm the shop's actual requirements with its accountant.
* Customer-facing display, loyalty, parked bills and barcode label printing are not implemented.
* Dark theme is provided; the print output is always light.

## Licences

Application code: all rights reserved by the shop. Bundled fonts: Inter and Noto Sans Tamil, SIL Open Font License 1.1 (licence texts in `public/fonts/`). Other dependencies keep their own licences.
