import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: r('./src/renderer'),
  base: './',
  publicDir: r('./public'),
  plugins: [
    react(),
    tailwindcss(),
    {
      // The dev server needs inline scripts (React refresh) and a websocket; production keeps the strict policy from index.html.
      name: 'dev-csp',
      apply: 'serve',
      transformIndexHtml: (html: string) =>
        html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws://localhost:5173; frame-src 'self' about:" />`),
    },
  ],
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
