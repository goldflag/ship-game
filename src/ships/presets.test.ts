import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import { shipPresets, shipReviewUrls } from './presets';

test('every port review link serves its evidence page through the development server', async () => {
  const { createServer } = await import('vite');
  const server = await createServer({
    configFile: false,
    root: resolve(import.meta.dir, '../..'),
    logLevel: 'silent',
    server: { port: 0, strictPort: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Missing review test server');
    for (const id of Object.keys(shipPresets)) {
      const response = await fetch(`http://localhost:${address.port}${shipReviewUrls[id]}`);
      expect(response.ok).toBe(true);
      const page = await response.text();
      expect(page).toContain('measurements.json');
      expect(page).toContain(`${id}-review.zip`);
    }
  } finally {
    await server.close();
  }
});
