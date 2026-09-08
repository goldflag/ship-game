import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { overlayApi } from './tools/ship-overlay/server';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root: `${root}tools/ship-overlay`,
  publicDir: `${root}public`,
  plugins: [react(), overlayApi(root)],
  server: { host: '127.0.0.1', port: 5180, strictPort: true, fs: { allow: [root] } },
  build: { outDir: `${root}.build/ship-overlay-app`, emptyOutDir: true, copyPublicDir: false },
});
