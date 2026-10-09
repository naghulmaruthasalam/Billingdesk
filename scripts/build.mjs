// Production build: renderer (Vite) + main/preload (esbuild). Output: dist/renderer, dist-electron/{main,preload}.cjs
import { build as viteBuild } from 'vite';
import { build as esbuild } from 'esbuild';
import { rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

if (!existsSync(join(root, 'public', 'fonts', 'fonts.css'))) {
  execFileSync(process.execPath, [join(root, 'scripts', 'copy-fonts.mjs')], { stdio: 'inherit' });
}

rmSync(join(root, 'dist-electron'), { recursive: true, force: true });

console.log('> building renderer');
await viteBuild({ configFile: join(root, 'vite.config.ts'), logLevel: 'warn' });

console.log('> building main process and preload');
const common = { bundle: true, platform: 'node', target: 'node22', format: 'cjs', sourcemap: 'linked', logLevel: 'warning', external: ['electron', 'better-sqlite3'], legalComments: 'none' };
await esbuild({ ...common, entryPoints: [join(root, 'src/main/index.ts')], outfile: join(root, 'dist-electron/main.cjs') });
await esbuild({ ...common, entryPoints: [join(root, 'src/preload/index.ts')], outfile: join(root, 'dist-electron/preload.cjs') });
console.log('> build complete');
