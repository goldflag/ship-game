import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { vendorTextures } from './scripts/build/vendor-textures';
import { shipTransfers } from './scripts/build/ship-transfers';

// Sky Pro resolves cloud volumes dynamically beside the final JS bundle.
// Vite cannot discover that dynamic URL, so preserve its data/ directory explicitly.
const skyData = fileURLToPath(new URL('./vendor/threejs-sky-pro/build/data/', import.meta.url));
const root = fileURLToPath(new URL('./', import.meta.url));
// Review pages exist only where comparison output was retained locally and published by ship:check or ship:compare.
const reviewRoot = `${root}public/ship-reference`;
// SHIP_REVIEW_PAGES=0 leaves them out of a build entirely (public deployments): no port links, nothing copied to dist.
const publishReviewPages = process.env.SHIP_REVIEW_PAGES !== '0';
const shipReviewIds = publishReviewPages && existsSync(reviewRoot)
  ? readdirSync(reviewRoot).filter(id => existsSync(`${root}assets/ships/${id}/modeling-spec.json`) && existsSync(`${reviewRoot}/${id}/index.html`)).sort()
  : [];

const basePath = process.env.BASE_PATH ?? '/';
const apiPrefix = `${basePath.replace(/\/$/, '')}/api`;
export default defineConfig({
  // Serve from a sub-path with e.g. BASE_PATH=/naval/ bun run build; runtime asset URLs go through src/assetUrl.ts.
  base: basePath,
  define: { __SHIP_REVIEW_IDS__: JSON.stringify(shipReviewIds) },
  plugins: [react(), vendorTextures(), shipTransfers(`${root}public/models`), {
    name: 'ship-review-pages',
    // Vite copies all of public/ verbatim; drop the served review copy when it is excluded from this build.
    closeBundle() { if (!publishReviewPages) rmSync(`${root}dist/ship-reference`, { recursive: true, force: true }); },
  }, {
    name: 'sky-pro-cloud-data',
    generateBundle() {
      for (const name of readdirSync(skyData)) {
        if (name.endsWith('.bin')) this.emitFile({ type: 'asset', fileName: `assets/data/${name}`, source: readFileSync(`${skyData}/${name}`) });
      }
    },
  }],
  resolve: { dedupe: ['three'] },
  server: { port: 5173, strictPort: true, proxy: { [apiPrefix]: { target: process.env.NAVAL_SERVER ?? 'http://127.0.0.1:8787', ws: true, rewrite: path => '/api' + path.slice(apiPrefix.length) } } },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        game: fileURLToPath(new URL('./index.html', import.meta.url)),
        aircraftReview: fileURLToPath(new URL('./aircraft-review.html', import.meta.url)),
        fleetPerformance: fileURLToPath(new URL('./scripts/diagnostics/live-performance.html', import.meta.url)),
      },
      output: { manualChunks: { 'three-engine': ['three/webgpu', 'three/tsl'], 'react': ['react', 'react-dom/client'] } },
    },
    // Compiled ship definitions remain bundled for synchronous simulation access.
    chunkSizeWarningLimit: 7000,
  },
});
