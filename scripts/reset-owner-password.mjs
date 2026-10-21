#!/usr/bin/env node
// Offline owner-password reset for when BOTH the password and the recovery code are lost.
//
//   node scripts/reset-owner-password.mjs                 (asks for the new password)
//   node scripts/reset-owner-password.mjs --user owner    (when there is more than one owner)
//   node scripts/reset-owner-password.mjs --data-dir "/path/to/Sree Krishna Billing"
//
// Requires access to the computer's data folder (the same trust the whole database already relies on). Nothing but the
// owner's password and the recovery code changes: bills, stock and products are untouched. A copy of the database is
// saved first, the reset is written to the audit log, and a NEW recovery code is printed - write it down.
// Close Sree Krishna Billing before running this.
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import readline from 'node:readline';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
// bcryptjs comes from node_modules in a source checkout; on an installed computer a vendored copy sits next to this script.
let bcrypt;
for (const id of ['bcryptjs', './bcryptjs.cjs', './vendor/bcryptjs.cjs']) {
  try {
    bcrypt = require(id);
    break;
  } catch {
    /* try the next location */
  }
}
if (!bcrypt) throw new Error('bcryptjs was not found (expected next to this script as bcryptjs.cjs)');

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

function askHidden(question) {
  return new Promise((resolveAnswer) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = rl._writeToOutput;
    rl._writeToOutput = (s) => (rl.stdoutMuted && s !== question && !s.includes('\n') ? undefined : write.call(rl, s));
    rl.stdoutMuted = false;
    rl.question(question, (a) => {
      rl.close();
      process.stdout.write('\n');
      resolveAnswer(a);
    });
    rl.stdoutMuted = true;
  });
}

const fail = (m) => {
  console.error(`\nERROR: ${m}`);
  process.exit(1);
};

const dataDir = resolve(opt('data-dir') ?? defaultDataDir());
const dbPath = join(dataDir, 'data', 'skbilling.sqlite');
if (!existsSync(dbPath)) fail(`No database found at ${dbPath}\nUse --data-dir to point at the folder that contains data/skbilling.sqlite.`);

let password = opt('password-env') ? process.env[opt('password-env')] : undefined;
if (!password) {
  password = await askHidden('New owner password (at least 6 characters): ');
  const again = await askHidden('Repeat the new password: ');
  if (password !== again) fail('The two passwords are not the same.');
}
if (!password || password.length < 6) fail('The password must be at least 6 characters.');

const db = new Database(dbPath);
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

const owners = db.prepare("SELECT u.id, u.username FROM users u JOIN roles r ON r.id = u.role_id WHERE r.name = 'owner' ORDER BY u.id").all();
if (owners.length === 0) fail('This database has no owner account.');
const wanted = opt('user');
const owner = wanted ? owners.find((o) => o.username.toLowerCase() === wanted.toLowerCase()) : owners.length === 1 ? owners[0] : undefined;
if (!owner) fail(`There are several owner accounts (${owners.map((o) => o.username).join(', ')}). Re-run with --user <name>.`);

// 1. Safety copy (consistent snapshot, works while the database is in WAL mode).
const backups = join(dataDir, 'backups');
mkdirSync(backups, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const copy = join(backups, `skbilling-${stamp}-pre-restore.sqlite`);
try {
  db.prepare('VACUUM INTO ?').run(copy);
} catch (e) {
  fail(`Could not save a safety copy first (${e.message}). Is the disk full or the app still running? Nothing was changed.`);
}

// 2. Reset the password, unlock the account and rotate the recovery code.
const raw = randomBytes(10).toString('hex').toUpperCase();
const recoveryCode = raw.match(/.{4}/g).join('-');
const now = new Date().toISOString();
db.transaction(() => {
  db.prepare('UPDATE users SET password_hash = ?, active = 1, failed_attempts = 0, locked_until = NULL, updated_at = ? WHERE id = ?').run(bcrypt.hashSync(password, 10), now, owner.id);
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES ('auth.recovery_hash', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(JSON.stringify(bcrypt.hashSync(recoveryCode, 10)), now);
  db.prepare("INSERT INTO audit_logs (ts, user_id, username, action, entity, details) VALUES (?, NULL, ?, 'auth.owner_reset_offline', 'users', ?)").run(now, owner.username, JSON.stringify({ via: 'scripts/reset-owner-password.mjs', safetyCopy: copy }));
})();
db.close();

console.log(`
Owner password reset for "${owner.username}".

  Safety copy of your data: ${copy}

  NEW RECOVERY CODE (write it down and keep it safe - it is shown only now):

      ${recoveryCode}

Start Sree Krishna Billing and sign in as "${owner.username}" with the new password.
`);
