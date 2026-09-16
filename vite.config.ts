import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { vendorTextures } from './scripts/build/vendor-textures';
import { shipTransfers } from './scripts/build/ship-transfers';
import { devPort } from './scripts/build/dev-port';
import { presetIds } from './scripts/ships/runtime-assets';
import { constructionFiles } from './scripts/construction/server';

// Sky Pro resolves cloud volumes dynamically beside the final JS bundle.
// Vite cannot discover that dynamic URL, so preserve its data/ directory explicitly.
const skyData = fileURLToPath(new URL('./vendor/threejs-sky-pro/build/data/', import.meta.url));
const root = fileURLToPath(new URL('./', import.meta.url));

const basePath = process.env.BASE_PATH ?? '/';
const apiPrefix = `${basePath.replace(/\/$/, '')}/api`;
export default defineConfig({
  // Serve from a sub-path with e.g. BASE_PATH=/naval/ bun run build; runtime asset URLs go through src/assetUrl.ts.
  base: basePath,
  plugins: [constructionFiles(root), devPort(root), react(), vendorTextures(), shipTransfers(`${root}public/models`), {
    name: 'exclude-retired-ship-reviews',
    // Old checkouts may still have ignored comparison pages in public/.
    async closeBundle() {
      rmSync(`${root}dist/ship-reference`, { recursive: true, force: true });
      // Full compiler/debug JSON stays in the workspace; production uses the
      // hash-checked indexed runtime assets and lightweight menu metadata.
      for (const id of await presetIds(root)) rmSync(`${root}dist/models/${id}.json`, { force: true });
    },
  }, {
    name: 'sky-pro-cloud-data',
    generateBundle() {
      for (const name of readdirSync(skyData)) {
        if (name.endsWith('.bin')) this.emitFile({ type: 'asset', fileName: `assets/data/${name}`, source: readFileSync(`${skyData}/${name}`) });
      }
    },
  }],
  resolve: { dedupe: ['three'] },
  server: { proxy: { [apiPrefix]: { target: process.env.NAVAL_SERVER ?? 'http://127.0.0.1:8787', ws: true, rewrite: path => '/api' + path.slice(apiPrefix.length) } } },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        game: fileURLToPath(new URL('./index.html', import.meta.url)),
        aircraftReview: fileURLToPath(new URL('./aircraft-review.html', import.meta.url)),
        fleetPerformance: fileURLToPath(new URL('./scripts/diagnostics/live-performance.html', import.meta.url)),
        customBattlePerformance: fileURLToPath(new URL('./scripts/diagnostics/custom-battle-performance.html', import.meta.url)),
        pveSpeed: fileURLToPath(new URL('./scripts/diagnostics/pve-speed.html', import.meta.url)),
      },
      output: { manualChunks: { 'three-engine': ['three/webgpu', 'three/tsl'], 'react': ['react', 'react-dom/client'] } },
    },
    // Engine/rendering chunks dominate; preset simulation data is demand-loaded.
    chunkSizeWarningLimit: 7000,
  },
});
