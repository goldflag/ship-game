import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { shipPresets } from './presets';

const root = resolve(import.meta.dir, '../..');
// Review pages exist for specification ships whose comparison output is retained locally.
const reviewable = Object.keys(shipPresets).filter(id => existsSync(resolve(root, 'assets/ships', id, 'modeling-spec.json')));
const retained = reviewable.filter(id => existsSync(resolve(root, 'assets/ships', id, 'generated/comparison/index.html')));

test('retained port review pages are served with their evidence', async () => {
  expect(reviewable).toContain('type-viic');
  const { createServer } = await import('vite');
  // Serve the retained comparison output from an isolated directory; record hashes and freshness are checked by `bun run build`.
  const publicDir = await mkdtemp(resolve(tmpdir(), 'ship-review-test-'));
  await mkdir(resolve(publicDir, 'ship-reference'));
  for (const id of retained) await symlink(resolve(root, 'assets/ships', id, 'generated/comparison'), resolve(publicDir, 'ship-reference', id));
  const server = await createServer({
    configFile: false,
    root,
    publicDir,
    logLevel: 'silent',
    server: { port: 0, strictPort: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Missing review test server');
    for (const id of retained) {
      const response = await fetch(`http://localhost:${address.port}/ship-reference/${id}/index.html`);
      expect(response.ok).toBe(true);
      const page = await response.text();
      expect(page).toContain('measurements.json');
      expect(page).toContain(`../../models/${id}.glb`);
    }
  } finally {
    await server.close();
    await rm(publicDir, { recursive: true, force: true });
  }
});
