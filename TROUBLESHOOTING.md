# Troubleshooting

Logs: `<data folder>/logs/main.log` (Settings → About & system shows the folder; *Open data folder* opens it).

| Problem | What to do |
|---|---|
| **Billing is locked** ("catalogue has not been approved") | Owner: Products → Catalogue review → verify flagged entries → Approve. See README "First run". |
| **Printing is disabled / "confirm the shop details"** | Owner: Settings → Shop details → correct the address → Save → *I have checked these details*. |
| **Receipt printer is installed but nothing prints (RP-3200, TM-T20, XP-80 ...)** | Run `lpoptions -p <printer> -l`. If you see *PrinterEncoding*, *NumLines*, *NumColumns*, the queue has a text-only driver and cannot print pages. In the app: Settings → Printers → choose the printer → **How receipts are sent → Thermal receipt printer (ESC/POS)** → Print test receipt. Check the printer is on, has paper, the cover is closed, and `lpstat -p` says idle. |
| **"No printer is installed" when pressing Print** | The system has no printer queue. Add it first (see next row), or use Save as PDF. |
| **Settings → Printers shows no printers** | The operating system has none installed. Windows: Settings → Bluetooth & devices → Printers & scanners → Add. Linux: Settings → Printers, or open `http://localhost:631` → Administration → Add Printer (and make sure the `cups` service is running: `systemctl status cups`). Plug in / power on the printer, then press **Refresh**. |
| **A chosen printer says "not found"** | The saved printer is not connected or was renamed. The system default printer is used instead and a message names the missing one. Reconnect it, or choose another in Settings → Printers. |
| **Print started, nothing printed, and the application closed (older versions)** | Fixed in v1.3: printing no longer uses the operating-system print dialog (the cause on Linux). If it ever happens again, send `logs/main.log` from the data folder (`~/.config/Sri Krishna Billing/logs/` on Linux) - it records the reason. |
| **Silent printing does nothing / printer shows "stopped"** | The queue is paused or offline (the status badge says "stopped - check printer"). Resume it in the system printer settings (`cupsenable <name>` on Linux) and press Refresh. |
| **Receipt prints twice** | Check *Receipt copies* (Settings → Printers) and that the printer driver itself is not set to print 2 copies. |
| **No printer found / print fails** | The message comes from the operating system. Check the printer is installed, online and set up in Windows/CUPS. Use *Save as PDF* as a workaround. For thermal printers choose the matching size (58/80 mm) in the print preview; if the receipt is cut off, set the printer driver's paper to "Roll 80 mm" and margins to zero. |
| **Tamil shows as boxes** | The bundled fonts load from the app itself; if you see boxes, the app files are damaged - reinstall (data is kept). |
| **Scanner types digits but nothing is added** | Set the scanner to *USB HID keyboard* mode and to send **Enter** (or Tab) after each code - scan the "Enter suffix" / "factory default" code in its manual. Test by scanning into Notepad: you should see digits then a new line. The app needs the whole code to arrive within ~50 ms per character, which all wedge scanners do; some Bluetooth scanners in "batch" mode do not. |
| **"Unknown barcode ..."** | The label was not printed by this shop, or belongs to a product from another database (e.g. a restored older backup). Search the product by name and check its barcode on the Products page. |
| **Scanned digits are wrong or letters appear** | The scanner's keyboard layout setting does not match the computer's. Barcodes are digits only; choose the US layout in the scanner or the scanner's "keyboard language" option. |
| **Labels will not scan / look too thin** | The preview reports the bar width: use 0.25 mm or more (larger label, hide the shop name/Tamil line, or print at 100% - not "fit to page"). Use a clean label stock, print density medium-high, and keep the printer paper size equal to the label size. |
| **Label printed on the wrong size / shifted** | In the printer driver set the paper to the label size with zero margins and "actual size". For A4 sticker sheets use the matching preset and adjust top/left margin in 0.5 mm steps. |
| **Cannot sign in** | After 5 wrong attempts the account locks for 5 minutes. Owner password lost: *Forgot the owner password?* with the recovery code. Other users: the owner resets them in Staff & Permissions. |
| **Password AND recovery code both lost** | Close the app, open a terminal in the project folder (the one containing `package.json`) and run `node scripts/reset-owner-password.mjs`. It asks for a new password (hidden), saves a safety copy of the database, resets only the owner's password, unlocks the account, prints a **new recovery code** (write it down) and records the reset in the audit log. All bills, stock and products are kept. Several owners: add `--user <name>`. Different data folder: add `--data-dir "<folder>"`. Anyone with access to the computer's files can do this, so keep the computer itself secure. If the app has no real data yet, deleting the data folder (`~/.config/Sri Krishna Billing` on Linux, `%APPDATA%\Sri Krishna Billing` on Windows) with the app closed gives a fresh first-run setup - but that erases everything in it. |
| **Start again from scratch (no accounts, no data)** | Close the app, then run `node scripts/start-fresh.mjs` (preview) and `node scripts/start-fresh.mjs --yes`. It MOVES `~/.config/Sri Krishna Billing/` (Windows: `%APPDATA%\Sri Krishna Billing\`) to a `.old-<time>` folder - nothing is deleted - and the next launch shows first-time setup with the shop name Shree Krishna Pattasu Kadai. Without a terminal: close the app and rename that folder yourself. |
| **"Not enough stock"** | Stock on record is lower than the bill. Correct the stock (Inventory → Adjust / Opening stock), or have a manager approve the override. Stock enforcement can be changed to *warn only* in Settings → Billing rules. |
| **Dashboard shows no low stock** | Low stock means a minimum is set and reached, or an item went to 0 after being stocked. Set minimums per product. |
| **Application will not start: "database could not be opened"** | Your data was not modified. Check free disk space and that the data folder is writable. Restore the newest backup from `backups/` using another installation or contact support. If the message says the database is from a newer version, install the newer application version. |
| **"Database is busy"** | Another copy of the app (or a backup tool) holds the file. Close other instances; the app allows only one window per user. |
| **Linux: app does not start from the RPM** | Install the runtime libraries: `sudo dnf install gtk3 nss alsa-lib libXScrnSaver at-spi2-core`. From a terminal run `"/opt/Sri Krishna Billing/sri-krishna-billing"` to see errors. In containers/as root add `--no-sandbox`. |
| **Windows: SmartScreen warning** | The installer is not code-signed. "More info → Run anyway". |
| **Windows: antivirus quarantines the app** | Add the install folder and `%APPDATA%\Sri Krishna Billing` to the exclusions; AV scanning of the SQLite files slows or blocks billing. |
| **Backup failed** | The message names the cause: folder missing/read-only/full, or a network drive that is offline. Choose another folder in Backup & Restore. |
| **Restore says the file is invalid** | Pick a `skbilling-*.sqlite` file made by this application. The preview lists the reason (corrupt, wrong file, made by a newer version). |
| **Wrong time on bills** | Bills use Asia/Kolkata regardless of the computer's time zone, but the computer clock itself must be correct. |
| **Integrity check reports problems** | Stop billing, make a copy of the data folder, then restore the latest good backup. |

## Developer notes

* `npm run dev` on Linux needs a display. In a container use `xvfb-run -a npm run dev`.
* `better-sqlite3` is loaded from `app.asar.unpacked`; if packaging is changed, keep `asarUnpack` for `better-sqlite3`.
* If `npm install` tries to compile `better-sqlite3` ("node-gyp rebuild" / "not found: make") on a machine without a C++ toolchain, run `npm ci --ignore-scripts && node node_modules/electron/install.js`: the module ships prebuilt binaries and never needs compiling.
* If Electron's binary is missing after `npm install` (blocked download), run `node node_modules/electron/install.js`.
* Cross-building the Windows installer on Linux requires `wine` and `wine32` (`dpkg --add-architecture i386`); on Windows it needs nothing extra.
* Tests that touch the filesystem create temporary directories and clean up after themselves.
