import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { shipPresets, shipReviewUrls } from './presets';

test('every available port review link serves evidence without inventing packs for other presets', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root: resolve(import.meta.dir, '../..'),
    logLevel: 'silent',
    server: { port: 0, strictPort: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    // public/ship-reference is an ignored served copy; refresh it from the retained comparison output first.
    for (const id of Object.keys(shipReviewUrls)) {
      const check = spawnSync('bun', [resolve(import.meta.dir, '../../scripts/reference/pipeline.ts'), 'check', id], { encoding: 'utf8' });
      if (check.status !== 0) throw new Error(`ship:check ${id} failed:\n${check.stdout}${check.stderr}`);
    }
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Missing review test server');
    expect(shipReviewUrls['type-viic']).toBe('/ship-reference/type-viic/index.html');
    for (const id of Object.keys(shipReviewUrls)) {
      expect(Object.hasOwn(shipPresets, id)).toBe(true);
      const response = await fetch(`http://localhost:${address.port}${shipReviewUrls[id]}`);
      expect(response.ok).toBe(true);
      const page = await response.text();
      expect(page).toContain('measurements.json');
      expect(page).toContain(`/models/${id}.glb`);
    }
  } finally {
    await server.close();
  }
});
