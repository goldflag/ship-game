import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { shipPresets } from '../../src/ships/presets';
import { shipClass, shipIdentity } from '../../src/game/shipModel';
import { texturePath } from './reference';
import { loadReference, loadTexture, validPath } from './download';
import { componentItems } from '../../scripts/parts/library';
import type { ShipDefinition } from '../../src/ships/blueprint';
import { catalogComparison, loadComponentReference } from './catalog-reference';

export { loadReference, loadTexture } from './download';
const inflight = new Map<string, Promise<unknown>>();
function shared<T>(key: string, task: () => Promise<T>): Promise<T> {
  let running = inflight.get(key) as Promise<T> | undefined;
  if (!running) { running = task(); inflight.set(key, running); running.finally(() => inflight.delete(key)).catch(() => {}); }
  return running;
}
export function overlayApi(root: string): Plugin {
  return { name: 'local-ship-overlay', configureServer(server) {
    server.middlewares.use('/api', async (req, res, next) => {
      if (req.method !== 'GET') { res.statusCode = 405; res.end('GET required'); return; }
      const url = new URL(req.url ?? '/', 'http://localhost');
      res.setHeader('Content-Type', 'application/json');
      try {
        if (url.pathname === '/component-comparison') {
          res.end(JSON.stringify(await catalogComparison(root))); return;
        }
        const comparison = url.pathname.match(/^\/component-comparison\/([a-z0-9-]+)\/(reference|model\.glb)$/);
        if (comparison) {
          if (comparison[2] === 'reference') {
            res.end(JSON.stringify(await shared(`component-reference:${comparison[1]}`, () => loadComponentReference(root, comparison[1])))); return;
          }
          const item = (await catalogComparison(root)).items.find(item => item.id === comparison[1]);
          const path = item?.reference?.referenceGlb;
          if (!path || !path.startsWith('.build/component-comparison/') || !validPath(path) || !path.endsWith('.glb')) {
            res.statusCode = 404; res.end(JSON.stringify({ error: 'No extracted reference is registered for this component.' })); return;
          }
          let data: Buffer;
          try { data = await readFile(join(root, path)); }
          catch { throw new Error('Reference extraction is missing. Run the component reference preparation described in the model viewer README.'); }
          res.setHeader('Content-Type', 'model/gltf-binary'); res.setHeader('Cache-Control', 'no-store'); res.end(data); return;
        }
        if (url.pathname === '/components') {
          res.end(JSON.stringify(await componentItems(root, Object.values(shipPresets) as unknown as ShipDefinition[]))); return;
        }
        const component = url.pathname.match(/^\/components\/([a-z0-9-]+)\/model\.glb$/);
        if (component) {
          const items = await componentItems(root, []);
          const item = items.find(p => p.partId === component[1]);
          if (!item?.modelUrl) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Preview missing or stale. Run part:build for this component.' })); return; }
          res.setHeader('Content-Type', 'model/gltf-binary'); res.setHeader('Cache-Control', 'no-store');
          res.end(await readFile(join(root, '.build/parts', item.partId, 'model.glb'))); return;
        }
        if (url.pathname === '/ships') {
          res.end(JSON.stringify(Object.values(shipPresets).map(s => ({
            id: s.id, name: s.name, modelUrl: s.modelUrl, length: s.hull.length, configuration: s.configuration,
            nation: shipIdentity(s.id).nation, type: shipIdentity(s.id).type, shipClass: shipClass(s.id), thumbnailUrl: `/models/${s.id}-thumbnail.png`,
          })))); return;
        }
        const texture = url.pathname.match(/^\/texture\/(.+)$/);
        if (texture) {
          const path = decodeURIComponent(texture[1]);
          if (!texturePath(path)) { res.statusCode = 404; res.end(JSON.stringify({ error: 'Unknown texture.' })); return; }
          const data = await shared(`texture:${path}`, () => loadTexture(root, path));
          res.setHeader('Content-Type', path.endsWith('.png') ? 'image/png' : 'image/jpeg'); res.setHeader('Cache-Control', 'max-age=86400');
          res.end(data); return;
        }
        const match = url.pathname.match(/^\/reference\/([a-z0-9]{3,40})$/);
        if (!match) { next(); return; }
        res.end(JSON.stringify(await shared(`reference:${match[1]}`, () => loadReference(root, match[1]))));
      } catch (error) { res.statusCode = 502; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
    });
  } };
}
