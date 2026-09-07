import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { shipPresets } from './presets';

const root = resolve(import.meta.dir, '../..');
// Review pages exist for specification ships whose comparison output is retained locally.
const reviewable = Object.keys(shipPresets).filter(id => existsSync(resolve(root, 'assets/ships', id, 'modeling-spec.json')));
const retained = reviewable.filter(id => existsSync(resolve(root, 'assets/ships', id, 'generated/comparison/index.html')));

test('retained port review pages are served with their evidence', async () => {
  expect(reviewable).toContain('type-viic');
  // public/ship-reference is an ignored served copy; refresh it from the retained comparison output first.
  for (const id of retained) {
    const check = spawnSync('bun', [resolve(root, 'scripts/reference/pipeline.ts'), 'check', id], { encoding: 'utf8' });
    if (check.status !== 0) throw new Error(`ship:check ${id} failed:\n${check.stdout}${check.stderr}`);
  }
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root,
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
  }
});
