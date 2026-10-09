// Development: Vite dev server (HMR) + esbuild-watched main process + Electron.
import { createServer } from 'vite';
import { context } from 'esbuild';
import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const require = createRequire(import.meta.url);
const electronPath = require('electron');

const server = await createServer({ configFile: join(root, 'vite.config.ts') });
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? 'http://localhost:5173/';

let child = null;
let restartTimer = null;
const start = () => {
  const args = [root];
  // Running as root (containers/CI) requires --no-sandbox; never used otherwise.
  if (process.platform === 'linux' && process.getuid?.() === 0) args.unshift('--no-sandbox');
  child = spawn(electronPath, args, { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
  child.on('exit', (code) => {
    if (child && !restarting) {
      server.close().finally(() => process.exit(code ?? 0));
    }
  });
};
let restarting = false;
const restart = () => {
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (!child) return start();
    restarting = true;
    child.once('exit', () => {
      restarting = false;
      start();
    });
    child.kill();
  }, 300);
};

const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', sourcemap: 'inline', logLevel: 'info', external: ['electron', 'better-sqlite3'] };
const restartOnRebuild = { name: 'restart', setup: (b) => b.onEnd(() => { if (child) restart(); }) };
const main = await context({ ...common, entryPoints: ['src/main/index.ts'], outfile: 'dist-electron/main.cjs', plugins: [restartOnRebuild] });
const preload = await context({ ...common, entryPoints: ['src/preload/index.ts'], outfile: 'dist-electron/preload.cjs', plugins: [restartOnRebuild] });
await main.rebuild();
await preload.rebuild();
await main.watch();
await preload.watch();
start();
process.on('SIGINT', () => process.exit(0));
