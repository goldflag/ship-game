import { build } from 'vite';
import { cp, mkdir, writeFile, copyFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { shipTransfers } from '../build/ship-transfers';

/** Builds the real composer/local-worker diagnostic with normal compressed GLB transport.
 * Run multiplayer:prepare first, then serve the output under /naval/ on a static HTTP server.
 * In the browser: reviewModule.constructionModelReview() / constructionRuntimeReview().
 * Diagnostics and evidence are temporary; the production product gets no review route. */
const root = resolve(import.meta.dir, '../..'), scratch = resolve(root, '.build/shipbuilding');
const publicRoot = resolve(scratch, 'review-public'), output = resolve(scratch, 'production-review');
await rm(publicRoot, { recursive: true, force: true });
await mkdir(resolve(publicRoot, 'models'), { recursive: true });
await cp(resolve(root, 'public/models/components'), resolve(publicRoot, 'models/components'), { recursive: true });
const entry = resolve(scratch, 'production.html');
await writeFile(entry, '<!doctype html><html><head><meta charset="utf-8"><title>Production construction equipment review</title></head><body><p>Production equipment review ready.</p><script type="module">import * as review from "/scripts/tests/construction-model-browser.ts"; window.reviewModule=review; window.reviewReady=true;</script></body></html>');
await build({ configFile: false, root, base: '/naval/', publicDir: publicRoot,
  resolve: { dedupe: ['three'] }, worker: { format: 'es' }, plugins: [shipTransfers(resolve(publicRoot, 'models'))],
  build: { target: 'es2022', outDir: output, emptyOutDir: true, chunkSizeWarningLimit: 7000, rollupOptions: { input: entry } } });
await copyFile(resolve(output, '.build/shipbuilding/production.html'), resolve(output, 'index.html'));
console.log(`Static review: ${output}; serve this directory at /naval/ (component GLBs are compressed exactly as in the game build).`);
