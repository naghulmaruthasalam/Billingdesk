# Troubleshooting

Logs: `<data folder>/logs/main.log` (Settings → About & system shows the folder; *Open data folder* opens it).

| Problem | What to do |
|---|---|
| **Billing is locked** ("catalogue has not been approved") | Owner: Products → Catalogue review → verify flagged entries → Approve. See README "First run". |
| **Printing is disabled / "confirm the shop details"** | Owner: Settings → Shop details → correct the address → Save → *I have checked these details*. |
| **No printer found / print fails** | The message comes from the operating system. Check the printer is installed, online and set up in Windows/CUPS. Use *Save as PDF* as a workaround. For thermal printers choose the matching size (58/80 mm) in the print preview; if the receipt is cut off, set the printer driver's paper to "Roll 80 mm" and margins to zero. |
| **Tamil shows as boxes** | The bundled fonts load from the app itself; if you see boxes, the app files are damaged - reinstall (data is kept). |
| **Cannot sign in** | After 5 wrong attempts the account locks for 5 minutes. Owner password lost: *Forgot the owner password?* with the recovery code. Other users: the owner resets them in Staff & Permissions. |
| **Recovery code lost** | While signed in as owner, nothing can regenerate it without a password reset. Make a backup, then ask the developer for a supervised reset; business data is never deleted by recovery. |
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
