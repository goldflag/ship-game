import type { ConstructionCatalog, ConstructionEquipment, ConstructionEquipmentPart, ConstructionPrimitive, ConstructionSource, Vec3 } from './blueprint';
import { HULL_PRESETS, type HullPresetChoice } from './constructionHullPresets';
import { makeHull, customHullPrimitive } from './customHullModel';

export type ConstructionStarter = 'patrol' | 'catamaran' | HullPresetChoice;
export const startingHullBlock = (): ConstructionPrimitive => ({ id: 'hull', kind: 'box', size: [1, 1, 1], position: [0, 0, 0], rotationDeg: 0 });
/** Generic editable source, not a precompiled ship or historical reconstruction.
 * Every placement remains visible and is checked by the same native compiler. */
/** `paint` is the ship paint the player chose for every face and fitting without a colour of its own. */
export function createStarterSource(catalog: ConstructionCatalog, kind: ConstructionStarter = 'patrol', paint?: string): ConstructionSource {
  const source: ConstructionSource = {
    schemaVersion: 1, id: `design-${crypto.randomUUID()}`, name: kind === 'catamaran' ? 'Twin-hull experiment' : kind === 'blank' ? 'Untitled design' : 'Patrol experiment',
    revision: crypto.randomUUID(), coordinates: 'meters-y-up-bow-negative-z',
    construction: { version: 2, catalogRevision: catalog.revision, defaultThicknessMm: 16, primitives: [], surfaces: [], equipment: [], boundaries: [], loads: [] },
  };
  if (paint) source.construction.paint = paint;
  if (kind === 'blank') { source.construction.primitives.push(startingHullBlock()); return source; }
  const preset = HULL_PRESETS.findIndex(p => p.id === kind);
  if (preset >= 0) {
    source.name = `${HULL_PRESETS[preset].name} design`;
    const hull = customHullPrimitive(makeHull(preset)); hull.id = 'hull';
    source.construction.primitives.push(hull);
    source.construction.surfaces.push(
      { primitiveId: hull.id, face: 'top', thicknessMm: 0, material: 'steel', paint: 'deck-gray' },
    );
    return source;
  }
  const primitives = source.construction.primitives;
  const box = (id: string, size: Vec3, position: Vec3, shape: ConstructionPrimitive['kind'] = 'box', rotationDeg = 0) => primitives.push({ id, kind: shape, size, position, rotationDeg });
  if (kind === 'catamaran') {
    for (const x of [-6, 6]) {
      const side = x < 0 ? 'port' : 'starboard';
      box(`hull-${side}`, [4, 5, 48], [x, 0, 0]);
      box(`bow-${side}`, [4, 5, 8], [x, 0, -28], 'wedge', 180);
    }
    box('bridge-deck', [8, 1, 24], [0, 2, 0]);
    box('gun-well-support', [4, 2, 4], [0, 1.5, -8]);
  } else {
    box('hull', [8, 5, 48], [0, 0, 0]);
    box('bow', [8, 5, 8], [0, 0, -28], 'wedge', 180);
  }
  for (const primitive of primitives) {
    source.construction.surfaces.push({ primitiveId: primitive.id, face: 'top', thicknessMm: 0, material: 'steel', paint: 'deck-gray' });
    source.construction.surfaces.push({ primitiveId: primitive.id, face: 'bottom', thicknessMm: 0, material: 'steel', paint: 'red-oxide' });
  }
  source.construction.boundaries.push({ id: 'forward-bulkhead', axis: 'z', offset: -6, thicknessMm: 8 }, { id: 'aft-bulkhead', axis: 'z', offset: 12, thicknessMm: 8 });
  source.construction.equipment = suggestStarterEquipment(catalog, kind);
  return source;
}

/** Explicit starter layout; applying it is a single undoable editor command.
 * No scaling, silent ballast, or relocation of existing user modules. */
export function suggestStarterEquipment(catalog: ConstructionCatalog, kind: Exclude<ConstructionStarter, 'blank'>): ConstructionEquipment[] {
  const parts = catalog.equipment, result: ConstructionEquipment[] = [];
  const find = (family: ConstructionEquipmentPart['kind']) => parts.filter(p => p.kind === family).sort((a, b) => a.size[0] * a.size[1] * a.size[2] - b.size[0] * b.size[1] * b.size[2])[0];
  const fit = (id: string, part: ConstructionEquipmentPart | undefined, position: Vec3, links: Partial<ConstructionEquipment> = {}) => {
    if (part) result.push({ id, partId: part.id, position, bearingDeg: 0, ...links });
  };
  const twin = kind === 'catamaran', floor = -2.484;
  fit('engine', find('engine'), [twin ? 6 : 0, floor, 5]);
  const gun = parts.find(p => p.id === 'us-5in38-mk30-mod0-single') ?? find('gun');
  const supportY = (part: ConstructionEquipmentPart | undefined) => part?.sockets?.find(s => s.id === 'attachment')?.position[1] ?? 0;
  fit('gun-forward', gun, [0, 2.5 - supportY(gun), twin ? -8 : -14]);
  // Keep the starter's established exhaust allowance when smaller historical
  // funnels enter the catalog. Older catalogs can still use their smallest fit.
  const funnel = parts.find(p => p.id === 'rn-corvette-funnel') ?? find('funnel');
  fit('funnel', funnel, [twin ? 6 : 0, 2.5 - supportY(funnel), 5]);
  const propeller = find('propeller'), rudder = find('rudder');
  const shaftZ = propeller?.sockets?.find(s => s.id === 'attachment')?.position[2] ?? 0;
  fit('screw', propeller, [twin ? 6 : 0, -2.25, 24 - shaftZ]);
  fit('rudder', rudder, [twin ? 6 : 0, -2.5 - supportY(rudder), 21]);
  const mast = find('mast'); fit('mast', mast, [0, 2.5 - supportY(mast), twin ? 10 : 12]);
  return result;
}
