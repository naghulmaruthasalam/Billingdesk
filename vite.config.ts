import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('./src/renderer'),
  base: './',
  publicDir: r('./public'),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': r('./src/renderer'),
      '@shared': r('./src/shared'),
    },
  },
  build: {
    outDir: r('./dist/renderer'),
    emptyOutDir: true,
    sourcemap: false,
    target: 'chrome140',
  },
  server: { port: 5173, strictPort: true },
});
