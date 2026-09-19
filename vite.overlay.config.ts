import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { overlayApi } from './tools/ship-overlay/server';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root: `${root}tools/ship-overlay`,
  // The game and reference viewer run together during articulation review.
  cacheDir: `${root}node_modules/.vite-overlay`,
  publicDir: `${root}public`,
  plugins: [react(), overlayApi(root)],
  server: { host: '127.0.0.1', port: 5180, strictPort: true, fs: { allow: [root] } },
  build: { target: 'es2022', outDir: `${root}.build/ship-overlay-app`, emptyOutDir: true, copyPublicDir: false,
    rollupOptions: { input: { viewer: `${root}tools/ship-overlay/index.html`, comparisons: `${root}tools/ship-overlay/component-comparison.html` } },
  },
});
