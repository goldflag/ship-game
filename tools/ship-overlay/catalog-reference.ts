import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { ConstructionEquipmentPart } from '../../src/ships/blueprint';
import type { ReferenceModel, ReferencePack } from './reference';

export interface ComponentReference {
  partId: string;
  category: 'gun' | 'torpedo' | 'torpedo-launcher' | 'mast' | 'funnel';
  sourceUrl?: string;
  sourceVehicle?: string;
  resource?: string;
  sourceName?: string;
  match: 'exact' | 'close' | 'family' | 'missing';
  notes: string;
  evidence?: string[];
  dataRoot?: string;
  referenceGlb?: string;
  scale?: number;
  yaw?: number;
  extraction?: unknown;
}
export interface ComparisonCatalog {
  schemaVersion: 1;
  items: (ConstructionEquipmentPart & { reference: ComponentReference | null })[];
}
const DEFAULT_DATA_ROOT = 'https://gamemodels3d.com/games/worldofwarships/data/current/';
const KINDS = new Set(['gun', 'torpedo-launcher', 'mast', 'funnel']);

/** Only public WoWS geometry resources may be fetched, never arbitrary URLs or textures. */
export function referenceModelUrl(reference: ComponentReference): string {
  const root = reference.dataRoot ?? DEFAULT_DATA_ROOT;
  if (!/^https:\/\/gamemodels3d\.com\/games\/worldofwarships\/(?:russia\/)?data\/current\/$/.test(root)) throw new Error('Unsupported reference data root.');
  if (!reference.resource || !/^common\/visual\/[a-zA-Z0-9_/-]+$/.test(reference.resource) || reference.resource.includes('//')) throw new Error('Invalid reference resource path.');
  return `${root}${reference.resource}.model`;
}
export function referenceCachePath(root: string, reference: ComponentReference): string {
  return join(root, '.build/component-comparison/raw', `${createHash('sha256').update(referenceModelUrl(reference)).digest('hex')}.model`);
}

/** Preserve every source vertex and triangle; discard materials/UVs rather than fetching textures. */
export function decodeReferenceModel(data: Uint8Array): ReferenceModel {
  const buffer = Buffer.from(data);
  const source = JSON.parse((buffer[0] === 0x1f && buffer[1] === 0x8b ? gunzipSync(buffer) : buffer).toString('utf8'));
  if (source.version !== 4 || !source.geometry || typeof source.geometry !== 'object' || Array.isArray(source.geometry)) throw new Error('Unsupported reference geometry version.');
  // A hierarchy would require its transforms; silently flattening one would corrupt the comparison.
  if (source.nodes || source.objects || source.skeleton || source.scene) throw new Error('Unsupported reference hierarchy.');
  const geometry: ReferenceModel['geometry'] = {};
  let triangles = 0;
  for (const [key, raw] of Object.entries(source.geometry)) {
    const item = raw as { position?: unknown; index?: unknown };
    if (!Array.isArray(item.position) || !Array.isArray(item.index) || item.position.length % 3 || item.index.length % 3 || item.position.some(v => typeof v !== 'number' || !Number.isFinite(v)) || item.index.some(i => !Number.isInteger(i) || i < 0 || i >= (item.position as number[]).length / 3)) throw new Error('Invalid reference geometry.');
    geometry[key] = { position: item.position, index: item.index };
    triangles += item.index.length / 3;
  }
  if (!triangles) throw new Error('Reference resource contains no triangles.');
  return { geometry };
}
export async function catalogComparison(root: string): Promise<ComparisonCatalog> {
  const [catalog, references] = await Promise.all([
    readFile(join(root, 'public/models/components/catalog.json'), 'utf8').then(JSON.parse),
    readFile(join(root, 'tools/ship-overlay/component-references.json'), 'utf8').then(JSON.parse),
  ]);
  const byId = new Map<string, ComponentReference>();
  for (const ref of references as ComponentReference[]) {
    if (byId.has(ref.partId)) throw new Error(`Duplicate reference: ${ref.partId}`);
    byId.set(ref.partId, ref);
  }
  return { schemaVersion: 1, items: (catalog.equipment as ConstructionEquipmentPart[]).filter(item => KINDS.has(item.kind)).map(item => ({ ...item, reference: byId.get(item.id) ?? null })) };
}

export async function loadComponentReference(root: string, id: string): Promise<ReferencePack> {
  const item = (await catalogComparison(root)).items.find(item => item.id === id);
  if (!item) throw new Error('Unknown published comparison component.');
  const reference = item.reference;
  if (!reference || reference.match === 'missing' || !reference.resource) throw new Error(reference?.notes ?? 'No source reference is registered for this component.');
  const url = referenceModelUrl(reference);
  const cache = referenceCachePath(root, reference);
  let data: Buffer | undefined;
  try { data = await readFile(cache); } catch {}
  if (!data) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000), redirect: 'error', headers: { 'User-Agent': 'ShipOverlay/1.0' } });
    if (!response.ok) throw new Error(`Reference download failed (${response.status}).`);
    data = Buffer.from(await response.arrayBuffer());
    decodeReferenceModel(data);
    await mkdir(join(root, '.build/component-comparison/raw'), { recursive: true });
    await writeFile(cache, data);
  }
  const model = decodeReferenceModel(data);
  return {
    vehicle: id, name: reference.sourceName ?? item.name, url: reference.sourceUrl ?? url,
    fetchedAt: new Date().toISOString(), paints: { default: 'Geometry only' }, omitted: [],
    // Source .model vertices are already component-local. Source +Z is the muzzle/bow;
    // Viewer.loadGame reflects Z and its caller applies 15 metres per source unit.
    scheme: { HullDefault: { component: { visual: reference.resource } } },
    models: { [reference.resource]: model },
  };
}
