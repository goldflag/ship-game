import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { GunPart, PartCatalog, ShipDefinition } from '../../src/ships/blueprint';

export interface LibraryEntry {
  partId: string; nation: string; family: string; builder?: string;
  review: 'unreviewed' | 'accepted'; limitations: string;
}
export interface Library {
  schemaVersion: 1;
  builders: Record<string, { path: string; function: string; inputs: string[] }>;
  components: LibraryEntry[];
}
export interface Installation {
  shipId: string; shipName: string; modelUrl: string; mountId: string;
  position: [number, number, number]; bearingDeg: number;
}
export interface ComponentItem extends LibraryEntry {
  name: string; weapon: GunPart; installations: Installation[];
  modelUrl?: string; previewStatus: 'current' | 'missing' | 'stale' | 'installation-only';
}
const originalPath = (p: string) => /^(assets\/parts|scripts\/ships)\/[a-zA-Z0-9_./-]+\.py$/.test(p) && !p.split('/').includes('..');
export function validateLibrary(library: Library, catalog: PartCatalog) {
  if (library.schemaVersion !== 1 || !Array.isArray(library.components) || !library.builders) throw new Error('Unsupported component library');
  const ids = new Set<string>();
  for (const entry of library.components) {
    if (ids.has(entry.partId) || !catalog.parts.some(p => p.id === entry.partId)) throw new Error(`Duplicate or unknown component: ${entry.partId}`);
    ids.add(entry.partId);
    if (!entry.nation || !entry.family || !entry.limitations || !['unreviewed', 'accepted'].includes(entry.review)) throw new Error(`Incomplete component metadata: ${entry.partId}`);
    if (entry.builder && !library.builders[entry.builder]) throw new Error(`Unknown builder: ${entry.builder}`);
  }
  for (const builder of Object.values(library.builders)) {
    if (!originalPath(builder.path) || !Array.isArray(builder.inputs) || builder.inputs.some(p => !originalPath(p)) || !/^[a-z_]+$/.test(builder.function)) throw new Error('Invalid original component builder');
  }
  // A new catalog gun must be consciously classified; no silent generic model.
  for (const part of catalog.parts) if (!ids.has(part.id)) throw new Error(`Register ${part.id} in assets/parts/library.json`);
}
export async function readLibrary(root: string) {
  const [library, catalog] = await Promise.all(['assets/parts/library.json', 'assets/parts/guns.json'].map(async p => JSON.parse(await readFile(join(root, p), 'utf8'))));
  validateLibrary(library, catalog);
  return { library: library as Library, catalog: catalog as PartCatalog };
}
export function recipeInputs(library: Library, entry: LibraryEntry) {
  if (!entry.builder) throw new Error(`${entry.partId} has no reusable builder`);
  const builder = library.builders[entry.builder];
  // scripts/ships/*.py are already hashed by the ship pipeline; its optional
  // recipe register accepts assets/ inputs only.
  return ['assets/parts/library.py', 'assets/parts/library.json', ...[builder.path, ...builder.inputs].filter(p => p.startsWith('assets/'))];
}
export async function componentHash(root: string, library: Library, entry: LibraryEntry, part: GunPart) {
  const builder = library.builders[entry.builder!];
  const inputs = ['assets/parts/library.py', builder.path, ...builder.inputs, 'scripts/parts/build.py', 'scripts/ships/export.py'];
  const source = await Promise.all(inputs.map(p => readFile(join(root, p), 'utf8')));
  return createHash('sha256').update(JSON.stringify([1, entry, builder, part, ...source])).digest('hex');
}
export function installationsFor(partId: string, ships: ShipDefinition[]): Installation[] {
  return ships.flatMap(ship => ship.mounts.filter(m => m.partId === partId).map(m => ({ shipId: ship.id, shipName: ship.name, modelUrl: ship.modelUrl, mountId: m.id, position: m.position, bearingDeg: m.bearingDeg })));
}
export async function componentItems(root: string, ships: ShipDefinition[]): Promise<ComponentItem[]> {
  const { library, catalog } = await readLibrary(root);
  return Promise.all(library.components.map(async entry => {
    const weapon = catalog.parts.find(p => p.id === entry.partId)!;
    const item: ComponentItem = { ...entry, name: weapon.name, weapon, installations: installationsFor(entry.partId, ships), previewStatus: entry.builder ? 'missing' : 'installation-only' };
    if (entry.builder) {
      const hash = await componentHash(root, library, entry, weapon);
      try {
        const bytes = await readFile(join(root, '.build/parts', entry.partId, 'model.glb'));
        const doc = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
        item.previewStatus = doc.scenes[doc.scene ?? 0].extras?.definitionHash === hash ? 'current' : 'stale';
        if (item.previewStatus === 'current') item.modelUrl = `/api/components/${entry.partId}/model.glb?v=${hash}`;
      } catch { /* Missing/invalid previews can be rebuilt; never present them as current. */ }
    }
    return item;
  }));
}
