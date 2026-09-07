import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { shipPresets, shipReviewUrls } from './presets';

test('every available port review link serves evidence without inventing packs for other presets', async () => {
  const { createServer } = await import('vite');
  // Exercise the real retained review pages in an isolated served directory.
  // Content hashes and build freshness are checked by `bun run build`.
  const publicDir = await mkdtemp(resolve(tmpdir(), 'ship-review-test-'));
  await mkdir(resolve(publicDir, 'ship-reference'));
  for (const id of Object.keys(shipReviewUrls)) {
    await symlink(resolve(import.meta.dir, '../../assets/ships', id, 'generated/comparison'), resolve(publicDir, 'ship-reference', id));
  }
  const server = await createServer({
    configFile: false,
    root: resolve(import.meta.dir, '../..'),
    publicDir,
    logLevel: 'silent',
    server: { port: 0, strictPort: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
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
    await rm(publicDir, { recursive: true, force: true });
  }
});
