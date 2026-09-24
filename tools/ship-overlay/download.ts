import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { extname, join } from 'node:path';
import { aircraftReferences, aircraftScheme, isHullConfiguration, embeddedJson, sanitizeMaterials, texturePath, vehicleId, type ReferencePack, type Scheme } from './reference';

/** The public GameModels3D fetcher and its `.build` cache. Viewing references only: nothing here is copied into
 * `assets/`, `public/models` or version control. The model viewer and the construction reference cache share it. */
export const DATA_ROOT = 'https://gamemodels3d.com/games/worldofwarships/data/current/';
/** Bump when the cached pack shape changes so stale `.build` caches are refetched. */
export const PACK_FORMAT = 3;
export async function download(url: string): Promise<Buffer> {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'ShipOverlay/1.0' } });
  if (!response.ok) throw new Error(`GameModels3D returned ${response.status}. Check access to the source page or load a local GLB.`);
  return Buffer.from(await response.arrayBuffer());
}
const inflate = (data: Buffer) => (data.length ? (data[0] === 0x1f && data[1] === 0x8b ? gunzipSync(data) : data).toString('utf8') : '');
export const validPath = (path: string) => /^[a-zA-Z0-9_./-]+$/.test(path) && !path.startsWith('/') && !path.split('/').includes('..');
export async function loadReference(root: string, vehicle: string): Promise<ReferencePack> {
  vehicle = vehicleId(vehicle);
  const cache = join(root, '.build/ship-overlay', vehicle);
  const file = join(cache, 'reference.json');
  try {
    const cached = JSON.parse(await readFile(file, 'utf8'));
    if (cached.format === PACK_FORMAT) return cached;
  } catch {}
  const isAircraft = /^p[a-z]a[a-z]\d{3}$/.test(vehicle);
  let url = isAircraft ? 'https://gamemodels3d.com/en/games/worldofwarships/misc/fighter' : `https://gamemodels3d.com/en/games/worldofwarships/vehicles/${vehicle}`;
  let page = (await download(url)).toString('utf8');
  let dataRoot = DATA_ROOT;
  // Some vehicle pages (Iowa since 2026-09) drop the model scheme; the Russian-server mirror and its data still carry it.
  if (!isAircraft && !/scheme\s*:\s*/.test(page)) {
    url = `https://gamemodels3d.com/en/games/worldofwarships/russia/vehicles/${vehicle}`;
    page = (await download(url)).toString('utf8');
    dataRoot = DATA_ROOT.replace('/data/current/', '/data/russia/');
  }
  const aircraft = isAircraft ? aircraftReferences(page).find((a) => a.id === vehicle) : undefined;
  if (isAircraft && !aircraft) throw new Error('Unknown WoWS aircraft ID. Choose an aircraft from the GameModels3D aircraft library.');
  const metadata = aircraft ? { index: aircraft.id, name: aircraft.name } : embeddedJson(page, /var\s+_vehicle\s*=\s*/);
  if (metadata.index !== vehicle) throw new Error('The source page returned a different vehicle.');
  if (aircraft) url = `https://gamemodels3d.com/en/games/worldofwarships/misc/${aircraft.category}`;
  const visual = aircraft ? { default: aircraftScheme(aircraft), paints: {} } : embeddedJson(page, /scheme\s*:\s*/).visual;
  const scheme = visual?.default as Scheme;
  if (!scheme || !Object.keys(scheme).some((k) => isHullConfiguration(k))) throw new Error('This source has no supported WoWS hull configuration.');
  const paints: Record<string, string> = { default: 'Plain finish' };
  for (const [id, paint] of Object.entries((visual.paints ?? {}) as Record<string, { name?: string }>))
    if (id !== 'default' && /^[a-z0-9_]{1,80}$/.test(id)) paints[id] = String(paint?.name ?? id).replace(/^_/, '');
  const paths = new Set<string>();
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (typeof node.visual === 'string') paths.add(node.visual);
    Object.values(node).forEach(walk);
  };
  walk(scheme);
  if (!paths.size || paths.size > 1000) throw new Error('Unsupported reference component list.');
  await mkdir(cache, { recursive: true });
  const pack: ReferencePack & { format: number } = {
    format: PACK_FORMAT, kind: isAircraft ? 'aircraft' : 'ship', vehicle, name: metadata.name, url, fetchedAt: new Date().toISOString(), scheme, paints, models: {}, omitted: [],
  };
  const pending = [...paths];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (pending.length) {
        const path = pending.shift()!;
        if (!validPath(path)) throw new Error('Invalid source component path.');
        const local = join(cache, createHash('sha256').update(path).digest('hex'));
        let data: Buffer;
        try {
          data = await readFile(`${local}.model`);
        } catch {
          data = await download(`${dataRoot}${path}.model`);
        }
        let decoded: string;
        try {
          decoded = inflate(data);
        } catch {
          throw new Error(`Invalid compressed reference component: ${path} (${data.length} bytes). Retry the download.`);
        }
        if (!decoded.trim()) {
          pack.omitted.push(path);
          continue;
        }
        const model = JSON.parse(decoded);
        if (model.version !== 4 || !model.geometry) throw new Error('Unsupported GameModels3D geometry version. Load an exported GLB instead.');
        pack.models[path] = { geometry: model.geometry };
        await writeFile(`${local}.model`, data);
        // Materials are optional: a model without them simply keeps the tinted fallback.
        let materialData: Buffer | undefined;
        try {
          materialData = await readFile(`${local}.material`);
        } catch {
          try {
            materialData = await download(`${dataRoot}${path}.material`);
          } catch {
            materialData = undefined;
          }
        }
        if (!materialData) continue;
        try {
          const parsed = JSON.parse(inflate(materialData));
          const materials: NonNullable<ReferencePack['models'][string]['materials']> = {};
          for (const [key, byPaint] of Object.entries(parsed.materials ?? {})) {
            const clean = sanitizeMaterials(byPaint, Object.keys(paints));
            if (clean) materials[key] = clean;
          }
          if (Object.keys(materials).length) pack.models[path].materials = materials;
          await writeFile(`${local}.material`, materialData);
        } catch {}
      }
    }),
  );
  if (!Object.keys(pack.models).length) throw new Error('The source aircraft or vehicle has no available geometry. Load a local GLB instead.');
  await writeFile(file, JSON.stringify(pack));
  return pack;
}
/** The data root a pack's models came from: the Russian-server mirror when its page was the fallback. */
export const packDataRoot = (pack: Pick<ReferencePack, 'url'>) => (pack.url.includes('/russia/') ? DATA_ROOT.replace('/data/current/', '/data/russia/') : DATA_ROOT);
/** Textures are shared across vehicles, so they cache once by path. */
export async function loadTexture(root: string, path: string, dataRoot = DATA_ROOT): Promise<Buffer> {
  if (!texturePath(path)) throw new Error('Invalid texture path.');
  const dir = join(root, '.build/ship-overlay/textures');
  const local = join(dir, createHash('sha256').update(path).digest('hex') + extname(path));
  try {
    return await readFile(local);
  } catch {}
  const data = await download(dataRoot + path);
  await mkdir(dir, { recursive: true });
  await writeFile(local, data);
  return data;
}
