import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { extname, join } from 'node:path';
import type { Plugin } from 'vite';
import { shipPresets } from '../../src/ships/presets';
import { shipClass, shipIdentity } from '../../src/game/shipModel';
import { aircraftReferences, aircraftScheme, isHullConfiguration, embeddedJson, sanitizeMaterials, texturePath, vehicleId, type ReferencePack, type Scheme } from './reference';
import { componentItems } from '../../scripts/parts/library';
import type { ShipDefinition } from '../../src/ships/blueprint';

const DATA_ROOT = 'https://gamemodels3d.com/games/worldofwarships/data/current/';
/** Bump when the cached pack shape changes so stale `.build` caches are refetched. */
const PACK_FORMAT = 3;
const inflight = new Map<string, Promise<unknown>>();
async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'ShipOverlay/1.0' } });
  if (!response.ok) throw new Error(`GameModels3D returned ${response.status}. Check access to the source page or load a local GLB.`);
  return Buffer.from(await response.arrayBuffer());
}
const inflate = (data: Buffer) => data.length ? (data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data) : data).toString('utf8') : '';
const validPath = (path: string) => /^[a-zA-Z0-9_./-]+$/.test(path) && !path.startsWith('/') && !path.split('/').includes('..');
export async function loadReference(root: string, vehicle: string): Promise<ReferencePack> {
  vehicle = vehicleId(vehicle);
  const cache = join(root, '.build/ship-overlay', vehicle);
  const file = join(cache, 'reference.json');
  try { const cached = JSON.parse(await readFile(file, 'utf8')); if (cached.format === PACK_FORMAT) return cached; } catch {}
  const isAircraft = /^p[a-z]a[a-z]\d{3}$/.test(vehicle);
  let url = isAircraft ? 'https://gamemodels3d.com/en/games/worldofwarships/misc/fighter' : `https://gamemodels3d.com/en/games/worldofwarships/vehicles/${vehicle}`;
  const page = (await download(url)).toString('utf8');
  const aircraft = isAircraft ? aircraftReferences(page).find(a => a.id === vehicle) : undefined;
  if (isAircraft && !aircraft) throw new Error('Unknown WoWS aircraft ID. Choose an aircraft from the GameModels3D aircraft library.');
  const metadata = aircraft ? { index: aircraft.id, name: aircraft.name } : embeddedJson(page, /var\s+_vehicle\s*=\s*/);
  if (metadata.index !== vehicle) throw new Error('The source page returned a different vehicle.');
  if (aircraft) url = `https://gamemodels3d.com/en/games/worldofwarships/misc/${aircraft.category}`;
  const visual = aircraft ? { default: aircraftScheme(aircraft), paints: {} } : embeddedJson(page, /scheme\s*:\s*/).visual;
  const scheme = visual?.default as Scheme;
  if (!scheme || !Object.keys(scheme).some(k => isHullConfiguration(k))) throw new Error('This source has no supported WoWS hull configuration.');
  const paints: Record<string, string> = { default: 'Plain finish' };
  for (const [id, paint] of Object.entries((visual.paints ?? {}) as Record<string, { name?: string }>)) if (id !== 'default' && /^[a-z0-9_]{1,80}$/.test(id)) paints[id] = String(paint?.name ?? id).replace(/^_/, '');
  const paths = new Set<string>();
  const walk = (node: any) => { if (!node || typeof node !== 'object') return; if (typeof node.visual === 'string') paths.add(node.visual); Object.values(node).forEach(walk); };
  walk(scheme);
  if (!paths.size || paths.size > 1000) throw new Error('Unsupported reference component list.');
  await mkdir(cache, { recursive: true });
  const pack: ReferencePack & { format: number } = { format: PACK_FORMAT, kind: isAircraft ? 'aircraft' : 'ship', vehicle, name: metadata.name, url, fetchedAt: new Date().toISOString(), scheme, paints, models: {}, omitted: [] };
  const pending = [...paths];
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (pending.length) {
      const path = pending.shift()!;
      if (!validPath(path)) throw new Error('Invalid source component path.');
      const local = join(cache, createHash('sha256').update(path).digest('hex'));
      let data: Buffer;
      try { data = await readFile(`${local}.model`); } catch { data = await download(`${DATA_ROOT}${path}.model`); }
      let decoded: string;
      try { decoded = inflate(data); }
      catch { throw new Error(`Invalid compressed reference component: ${path} (${data.length} bytes). Retry the download.`); }
      if (!decoded.trim()) { pack.omitted.push(path); continue; }
      const model = JSON.parse(decoded);
      if (model.version !== 4 || !model.geometry) throw new Error('Unsupported GameModels3D geometry version. Load an exported GLB instead.');
      pack.models[path] = { geometry: model.geometry };
      await writeFile(`${local}.model`, data);
      // Materials are optional: a model without them simply keeps the tinted fallback.
      let materialData: Buffer | undefined;
      try { materialData = await readFile(`${local}.material`); } catch { try { materialData = await download(`${DATA_ROOT}${path}.material`); } catch { materialData = undefined; } }
      if (!materialData) continue;
      try {
        const parsed = JSON.parse(inflate(materialData));
        const materials: NonNullable<ReferencePack['models'][string]['materials']> = {};
        for (const [key, byPaint] of Object.entries(parsed.materials ?? {})) { const clean = sanitizeMaterials(byPaint, Object.keys(paints)); if (clean) materials[key] = clean; }
        if (Object.keys(materials).length) pack.models[path].materials = materials;
        await writeFile(`${local}.material`, materialData);
      } catch {}
    }
  }));
  if (!Object.keys(pack.models).length) throw new Error('The source aircraft or vehicle has no available geometry. Load a local GLB instead.');
  await writeFile(file, JSON.stringify(pack));
  return pack;
}
/** Textures are shared across vehicles, so they cache once by path. */
export async function loadTexture(root: string, path: string): Promise<Buffer> {
  if (!texturePath(path)) throw new Error('Invalid texture path.');
  const dir = join(root, '.build/ship-overlay/textures');
  const local = join(dir, createHash('sha256').update(path).digest('hex') + extname(path));
  try { return await readFile(local); } catch {}
  const data = await download(DATA_ROOT + path);
  await mkdir(dir, { recursive: true });
  await writeFile(local, data);
  return data;
}
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
