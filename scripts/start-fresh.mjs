#!/usr/bin/env node
// Start from a brand-new, empty state: no accounts, no passwords, no recovery code, no bills.
//
//   node scripts/start-fresh.mjs            (shows what it would do)
//   node scripts/start-fresh.mjs --yes      (does it)
//   node scripts/start-fresh.mjs --yes --data-dir "/path/to/Sree Krishna Billing"
//
// Nothing is deleted: the whole data folder (database, backups, logs) is MOVED to "<folder>.old-<timestamp>" so it can be
// moved back if this was a mistake. The next launch shows the first-time setup screen (create the owner account, confirm the
// address, approve the catalogue) and seeds the shop name "Sree Krishna Crackers Shop".
// Close Sree Krishna Billing before running this. No dependencies: plain Node.js 18+.
import { existsSync, renameSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

function defaultDataDir() {
  if (process.env.SKB_DATA_DIR) return process.env.SKB_DATA_DIR;
  const base =
    platform() === 'win32' ? (process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')) : platform() === 'darwin' ? join(homedir(), 'Library', 'Application Support') : (process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'));
  const current = join(base, 'Sree Krishna Billing');
  const legacy = join(base, 'Sri Krishna Billing'); // folder name used before the product was renamed
  return !existsSync(current) && existsSync(legacy) ? legacy : current;
}

const dataDir = resolve(opt('data-dir') ?? defaultDataDir());
if (!existsSync(dataDir)) {
  console.log(`Nothing to do: ${dataDir} does not exist, so the app will already start as new.`);
  process.exit(0);
}
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
const target = `${dataDir}.old-${stamp}`;
if (!args.includes('--yes')) {
  console.log(`This would move\n  ${dataDir}\nto\n  ${target}\n(all accounts, products, bills, stock and backups in it), so the app starts as new.\nRun again with --yes to do it. Close the app first.`);
  process.exit(0);
}
try {
  renameSync(dataDir, target);
} catch (e) {
  console.error(`ERROR: could not move the data folder (${e.message}). Is the app still running?`);
  process.exit(1);
}
console.log(`Done. The old data was kept at:\n  ${target}\nStart the app: it will ask you to create the owner account.\nTo undo: close the app, delete the new "${dataDir}" folder and move the .old folder back to its name.`);
