#!/usr/bin/env node
// Test helper: a fake network thermal printer (JetDirect/raw TCP, port 9100). Every print job sent to a CUPS queue created with
//   lpadmin -p RP-RAW -E -v socket://127.0.0.1:9100 -m raw
// is saved as <dir>/job-<n>.bin so the end-to-end test can check the ESC/POS bytes. Usage: node scripts/fake-thermal-printer.mjs <dir> [port]
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
const port = Number(process.argv[3] ?? 9100);
if (!dir) {
  console.error('usage: fake-thermal-printer.mjs <output-dir> [port]');
  process.exit(2);
}
mkdirSync(dir, { recursive: true });
let n = 0;
createServer((sock) => {
  const chunks = [];
  sock.on('data', (c) => chunks.push(c));
  sock.on('close', () => {
    if (chunks.length) writeFileSync(join(dir, `job-${++n}.bin`), Buffer.concat(chunks));
  });
  sock.on('error', () => undefined);
}).listen(port, '127.0.0.1', () => console.log(`fake thermal printer listening on 127.0.0.1:${port}, saving to ${dir}`));
