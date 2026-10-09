// Copies the OFL-licensed Inter and Noto Sans Tamil web fonts out of node_modules
// into public/fonts so they are bundled with the app (offline-first).
import { copyFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'fonts');
mkdirSync(out, { recursive: true });
const weights = [400, 500, 600, 700];
const jobs = [];
for (const w of weights) {
  for (const s of ['latin', 'latin-ext']) jobs.push(['@fontsource/inter', `inter-${s}-${w}-normal.woff2`]);
  for (const s of ['latin', 'tamil']) jobs.push(['@fontsource/noto-sans-tamil', `noto-sans-tamil-${s}-${w}-normal.woff2`]);
}
for (const [pkg, file] of jobs) {
  const src = join(root, 'node_modules', pkg, 'files', file);
  if (!existsSync(src)) throw new Error(`Missing font file ${src} - run npm install first`);
  copyFileSync(src, join(out, file));
}
for (const pkg of ['inter', 'noto-sans-tamil']) {
  const lic = join(root, 'node_modules', '@fontsource', pkg, 'LICENSE');
  if (existsSync(lic)) copyFileSync(lic, join(out, `LICENSE-${pkg}.txt`));
}
console.log(`Copied ${jobs.length} font files to public/fonts`);
