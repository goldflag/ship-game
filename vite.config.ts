import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Sky Pro resolves cloud volumes dynamically beside the final JS bundle.
// Vite cannot discover that dynamic URL, so preserve its data/ directory explicitly.
const skyData = fileURLToPath(new URL('./vendor/threejs-sky-pro/build/data/', import.meta.url));
const root = fileURLToPath(new URL('./', import.meta.url));
// Review pages exist only where comparison output was retained locally and published by ship:check or ship:compare.
const reviewRoot = `${root}public/ship-reference`;
const shipReviewIds = existsSync(reviewRoot)
  ? readdirSync(reviewRoot).filter(id => existsSync(`${root}assets/ships/${id}/modeling-spec.json`) && existsSync(`${reviewRoot}/${id}/index.html`)).sort()
  : [];

export default defineConfig({
  // Serve from a sub-path with e.g. BASE_PATH=/naval/ bun run build; runtime asset URLs go through src/assetUrl.ts.
  base: process.env.BASE_PATH ?? '/',
  define: { __SHIP_REVIEW_IDS__: JSON.stringify(shipReviewIds) },
  plugins: [react(), {
    name: 'sky-pro-cloud-data',
    generateBundle() {
      for (const name of readdirSync(skyData)) {
        if (name.endsWith('.bin')) this.emitFile({ type: 'asset', fileName: `assets/data/${name}`, source: readFileSync(`${skyData}/${name}`) });
      }
    },
  }],
  resolve: { dedupe: ['three'] },
  server: { port: 5173, strictPort: true },
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
    // The supplied Water Pro bundle embeds its foam and spray textures.
    chunkSizeWarningLimit: 7000,
  },
});
