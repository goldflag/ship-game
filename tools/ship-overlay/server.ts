import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { shipPresets } from '../../src/ships/presets';
import { embeddedJson, vehicleId, type ReferencePack, type Scheme } from './reference';
import { componentItems } from '../../scripts/parts/library';
import type { ShipDefinition } from '../../src/ships/blueprint';

const inflight = new Map<string, Promise<ReferencePack>>();
async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'ShipOverlay/1.0' } });
  if (!response.ok) throw new Error(`GameModels3D returned ${response.status}. Check access to the source page or load a local GLB.`);
  return Buffer.from(await response.arrayBuffer());
}
export async function loadReference(root: string, vehicle: string): Promise<ReferencePack> {
  vehicle = vehicleId(vehicle);
  const cache = join(root, '.build/ship-overlay', vehicle);
  const file = join(cache, 'reference.json');
  try { return JSON.parse(await readFile(file, 'utf8')); } catch {}
  const url = `https://gamemodels3d.com/en/games/worldofwarships/vehicles/${vehicle}`;
  const page = (await download(url)).toString('utf8');
  const metadata = embeddedJson(page, /var\s+_vehicle\s*=\s*/);
  if (metadata.index !== vehicle) throw new Error('The source page returned a different vehicle.');
  const scheme = embeddedJson(page, /scheme\s*:\s*/).visual?.default as Scheme;
  if (!scheme || !Object.keys(scheme).some(k => k.endsWith('_Hull'))) throw new Error('This source has no supported WoWS hull configuration.');
  const paths = new Set<string>();
  const walk = (node: any) => { if (!node || typeof node !== 'object') return; if (typeof node.visual === 'string') paths.add(node.visual); Object.values(node).forEach(walk); };
  walk(scheme);
  if (!paths.size || paths.size > 1000) throw new Error('Unsupported reference component list.');
  await mkdir(cache, { recursive: true });
  const pack: ReferencePack = { vehicle, name: metadata.name, url, fetchedAt: new Date().toISOString(), scheme, models: {}, omitted: [] };
  const pending = [...paths];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (pending.length) {
      const path = pending.shift()!;
      if (!/^[a-zA-Z0-9_./-]+$/.test(path) || path.startsWith('/') || path.split('/').includes('..')) throw new Error('Invalid source component path.');
      const local = join(cache, createHash('sha256').update(path).digest('hex') + '.model');
      let data: Buffer;
      try { data = await readFile(local); } catch { data = await download(`https://gamemodels3d.com/games/worldofwarships/data/current/${path}.model`); }
      let decoded: string;
      try { decoded = data.length ? (data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data) : data).toString('utf8') : ''; }
      catch { throw new Error(`Invalid compressed reference component: ${path} (${data.length} bytes). Retry the download.`); }
      if (!decoded.trim()) { pack.omitted.push(path); continue; }
      const model = JSON.parse(decoded);
      if (model.version !== 4 || !model.geometry) throw new Error('Unsupported GameModels3D geometry version. Load an exported GLB instead.');
      pack.models[path] = { geometry: model.geometry };
      await writeFile(local, data);
    }
  }));
  await writeFile(file, JSON.stringify(pack));
  return pack;
}
export function overlayApi(root: string): Plugin {
  return { name: 'local-ship-overlay', configureServer(server) {
    server.middlewares.use('/api', async (req, res, next) => {
      if (req.method !== 'GET') { res.statusCode = 405; res.end('GET required'); return; }
      const url = new URL(req.url ?? '/', 'http://localhost');
      res.setHeader('Content-Type', 'application/json');
      try {
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
          res.end(JSON.stringify(Object.values(shipPresets).map(s => ({ id: s.id, name: s.name, modelUrl: s.modelUrl, length: s.hull.length, configuration: s.configuration })))); return;
        }
        const match = url.pathname.match(/^\/reference\/([a-z0-9]{3,40})$/);
        if (!match) { next(); return; }
        const id = match[1];
        let task = inflight.get(id);
        if (!task) { task = loadReference(root, id); inflight.set(id, task); task.finally(() => inflight.delete(id)).catch(() => {}); }
        res.end(JSON.stringify(await task));
      } catch (error) { res.statusCode = 502; res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
    });
  } };
}
