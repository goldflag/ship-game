import type { ConstructionEquipment, ConstructionSource, ConstructionPrimitive, ConstructionSurface, ConstructionSurfaceAssignment, Vec3 } from './blueprint';
import { normalizedBearing } from '../ui/shipbuilding/editorNumbers';
import { CONSTRUCTION_SHAPES, shapeMirror } from './constructionShapes';
import { ConstructionStoreError, readConstructionSource, type ConstructionRevision, type ConstructionStore } from './constructionStore';
import { loadConstructionCatalog } from './constructionEquipment';

export const CONSTRUCTION_FACES = ['port', 'starboard', 'bottom', 'top', 'bow', 'stern', 'slope'] as const;
export type ConstructionFace = ConstructionSurfaceAssignment['face'];
export const newConstructionId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
export const surfaceKey = (primitiveId: string, face: string) => `${primitiveId}:${face}`;
/** Source bounds, mirrored from the native compiler (crates/naval-sim/src/construction.rs). */
export const CONSTRUCTION_LIMITS = { primitives: 10_000, surfaces: 65_536, equipment: 128, boundaries: 24 } as const;

/** Native equipment supports stay visible but are not editable hull source assignments. */
export function editableConstructionSurfaces(source: ConstructionSource, surfaces: readonly ConstructionSurface[]): ConstructionSurface[] {
  const primitiveIds = new Set(source.construction.primitives.map(primitive => primitive.id));
  return surfaces.filter(surface => primitiveIds.has(surface.primitiveId) && CONSTRUCTION_FACES.includes(surface.face as ConstructionFace));
}

/** Syntax check for safe editing only. Rust retains all geometry, fit, loading and launch validation. */
export function decodeConstructionSource(value: unknown): ConstructionSource {
  const object = (value: unknown, path: string): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`);
    return value as Record<string, unknown>;
  };
  const string = (value: unknown, path: string) => { if (typeof value !== 'string') throw new Error(`${path} must be text`); };
  const number = (value: unknown, path: string) => { if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be finite`); };
  const vector = (value: unknown, path: string) => { if (!Array.isArray(value) || value.length !== 3) throw new Error(`${path} needs three coordinates`); value.forEach(v => number(v, path)); };
  const rows = (value: unknown, path: string) => { if (!Array.isArray(value)) throw new Error(`${path} must be an array`); return value.map(v => object(v, path)); };
  const source = object(value, 'Source');
  if (source.schemaVersion !== 1 || source.coordinates !== 'meters-y-up-bow-negative-z') throw new Error('Unsupported source version or coordinates');
  for (const key of ['id', 'name', 'revision']) string(source[key], key);
  const data = object(source.construction, 'Construction');
  if (data.version !== 1) throw new Error('Unsupported construction source version');
  string(data.catalogRevision, 'Catalog'); number(data.defaultThicknessMm, 'Skin thickness');
  for (const p of rows(data.primitives, 'Primitives')) {
    string(p.id, 'Primitive ID'); vector(p.size, 'Primitive size'); vector(p.position, 'Primitive position'); number(p.rotationDeg, 'Primitive rotation');
    if (typeof p.kind !== 'string' || (p.kind !== 'vertex' && !Object.hasOwn(CONSTRUCTION_SHAPES, p.kind))) throw new Error('Unsupported primitive kind');
    if (p.vertices !== undefined) {
      if (p.kind !== 'vertex' || !Array.isArray(p.vertices) || p.vertices.length !== 8) throw new Error('Vertex hulls require eight local corners');
      p.vertices.forEach(v => vector(v, 'Hull corner'));
    }
  }
  for (const surface of rows(data.surfaces, 'Surfaces')) {
    string(surface.primitiveId, 'Surface primitive'); string(surface.paint, 'Paint'); number(surface.thicknessMm, 'Armor thickness');
    if (!CONSTRUCTION_FACES.includes(surface.face as ConstructionFace) || !['steel', 'armor-steel'].includes(surface.material as string)) throw new Error('Unsupported surface face or material');
    if (surface.open !== undefined && typeof surface.open !== 'boolean') throw new Error('Opening must be true or false');
  }
  for (const part of rows(data.equipment, 'Equipment')) {
    string(part.id, 'Equipment ID'); string(part.partId, 'Equipment variant'); vector(part.position, 'Equipment position'); number(part.bearingDeg, 'Equipment bearing');
    if (part.path !== undefined) {
      const path = object(part.path, 'Equipment path');
      if (!Array.isArray(path.points) || path.points.length < 2 || path.points.length > 64) throw new Error('Equipment paths require 2–64 points');
      path.points.forEach(point => vector(point, 'Path point'));
      if (path.slackM !== undefined) number(path.slackM, 'Rope slack');
    }
    for (const link of ['magazineId', 'powerSourceId']) if (part[link] !== undefined) string(part[link], link);
  }
  for (const wall of rows(data.boundaries, 'Boundaries')) {
    string(wall.id, 'Boundary ID'); number(wall.offset, 'Boundary offset'); number(wall.thicknessMm, 'Boundary thickness');
    if (!['x', 'y', 'z'].includes(wall.axis as string)) throw new Error('Unsupported boundary axis');
  }
  for (const load of rows(data.loads, 'Loads')) {
    string(load.id, 'Load ID'); string(load.name, 'Load name'); vector(load.center, 'Load center'); vector(load.size, 'Load size'); number(load.massKg, 'Load mass');
  }
  return structuredClone(value) as ConstructionSource;
}

export function decodeSavedConstruction(revision: ConstructionRevision, catalogRevision = revision.catalogRevision): ConstructionSource {
  const source = readConstructionSource(revision, { schemaVersion: 1, catalogRevision, decode: decodeConstructionSource }).source;
  if (source.id !== revision.designId) throw new ConstructionStoreError('corrupt', 'The source and saved design identities disagree. Recover an earlier revision; the original is preserved.');
  if (source.construction.catalogRevision !== revision.catalogRevision) throw new ConstructionStoreError('catalog', 'The source and saved catalog identities disagree. Recover an earlier revision; the original is preserved.');
  return source;
}

export async function loadSavedConstruction(store: ConstructionStore, designId: string, catalogRevision?: string) {
  const saved = await store.load(designId);
  return { ...saved, source: decodeSavedConstruction(saved.revision, catalogRevision) };
}

/** Resolve the saved immutable catalog before showing any of its equipment dimensions. */
export async function loadSavedConstructionWithCatalog(store: ConstructionStore, designId: string, resolveCatalog = loadConstructionCatalog) {
  const saved = await loadSavedConstruction(store, designId);
  try { return { ...saved, catalog: await resolveCatalog(saved.revision.catalogRevision) }; }
  catch (cause) { throw new ConstructionStoreError('catalog', `The saved equipment revision could not be loaded. ${cause instanceof Error ? cause.message : String(cause)}. Download the original or recover a compatible revision; no equipment was substituted.`, { cause }); }
}

export function removeConstructionSelection(source: ConstructionSource, selected: ReadonlySet<string>): void {
  // Bulk deletion leaves the oldest hull block and its face assignments intact.
  const keep = source.construction.primitives.every(part => selected.has(part.id)) ? source.construction.primitives[0]?.id : undefined;
  source.construction.primitives = source.construction.primitives.filter(part => !selected.has(part.id) || part.id === keep);
  source.construction.surfaces = source.construction.surfaces.filter(surface => !selected.has(surface.primitiveId) || surface.primitiveId === keep);
  source.construction.equipment = source.construction.equipment.filter(part => !selected.has(part.id));
  source.construction.boundaries = source.construction.boundaries.filter(wall => !selected.has(wall.id));
  source.construction.loads = source.construction.loads.filter(load => !selected.has(load.id));
  // Keep references in other equipment as editable fit errors rather than silently reconnecting systems.
}

export function moveConstructionSelection(source: ConstructionSource, selected: ReadonlySet<string>, delta: Vec3): void {
  for (const item of [...source.construction.primitives, ...source.construction.equipment]) if (selected.has(item.id)) item.position = item.position.map((v, axis) => v + delta[axis]) as Vec3;
  for (const load of source.construction.loads) if (selected.has(load.id)) load.center = load.center.map((v, axis) => v + delta[axis]) as Vec3;
}

export function rotateConstructionSelection(source: ConstructionSource, selected: ReadonlySet<string>, angle = 90): void {
  for (const part of source.construction.primitives) if (selected.has(part.id)) part.rotationDeg = normalizedBearing(part.rotationDeg + angle);
  for (const part of source.construction.equipment) if (selected.has(part.id)) part.bearingDeg = normalizedBearing(part.bearingDeg + angle);
}

/** Source transform, not physical derivation. Corner profiles require an X/Z swap when reflected. */
export function mirroredPrimitive(primitive: ConstructionPrimitive): ConstructionPrimitive {
  if (primitive.kind === 'vertex' && primitive.vertices) return { ...structuredClone(primitive), position: [-primitive.position[0], primitive.position[1], primitive.position[2]], rotationDeg: normalizedBearing(-primitive.rotationDeg), vertices: [1,0,3,2,5,4,7,6].map(i => [-primitive.vertices![i][0], primitive.vertices![i][1], primitive.vertices![i][2]]) };
  const mirror = shapeMirror(primitive.kind);
  return { ...primitive, position: [-primitive.position[0], primitive.position[1], primitive.position[2]],
    size: mirror.swap ? [primitive.size[2], primitive.size[1], primitive.size[0]] : [...primitive.size],
    rotationDeg: normalizedBearing(-primitive.rotationDeg + mirror.yaw) };
}

export function mirroredFace(face: ConstructionFace, kind: ConstructionPrimitive['kind']): ConstructionFace {
  const { yaw } = shapeMirror(kind);
  if (yaw === -90) return ({ port: 'bow', bow: 'port', starboard: 'stern', stern: 'starboard' } as Partial<Record<ConstructionFace, ConstructionFace>>)[face] ?? face;
  if (yaw === 90) return ({ port: 'stern', stern: 'port', starboard: 'bow', bow: 'starboard' } as Partial<Record<ConstructionFace, ConstructionFace>>)[face] ?? face;
  if (yaw === 180) return face === 'bow' ? 'stern' : face === 'stern' ? 'bow' : face;
  return face === 'port' ? 'starboard' : face === 'starboard' ? 'port' : face;
}

export function mirroredEquipment(part: ConstructionEquipment): ConstructionEquipment {
  return { ...structuredClone(part), position: [-part.position[0], part.position[1], part.position[2]], bearingDeg: normalizedBearing(-part.bearingDeg),
    ...(part.path ? { path: { ...part.path, points: part.path.points.map(point => [-point[0], point[1], point[2]] as Vec3) } } : {}) };
}

export function copyConstructionSelection(source: ConstructionSource, selected: ReadonlySet<string>, options: { mirror?: boolean; offset?: Vec3 } = {}): string[] {
  const data = source.construction;
  const ids = new Map<string, string>();
  for (const item of [...data.primitives, ...data.equipment, ...data.loads]) if (selected.has(item.id)) ids.set(item.id, newConstructionId('part'));
  const position = (v: Vec3): Vec3 => options.mirror ? [-v[0], v[1], v[2]] : v.map((n, i) => n + (options.offset ?? [1, 0, 0])[i]) as Vec3;
  const originals = data.primitives.filter(p => selected.has(p.id));
  const kinds = new Map(originals.map(p => [p.id, p.kind]));
  data.primitives.push(...originals.map(part => ({ ...(options.mirror ? mirroredPrimitive(part) : structuredClone(part)), id: ids.get(part.id)!, position: position(part.position) })));
  data.surfaces.push(...data.surfaces.filter(surface => kinds.has(surface.primitiveId)).map(surface => ({ ...surface, primitiveId: ids.get(surface.primitiveId)!, face: options.mirror ? mirroredFace(surface.face, kinds.get(surface.primitiveId)!) : surface.face })));
  data.equipment.push(...data.equipment.filter(part => selected.has(part.id)).map(part => ({ ...(options.mirror ? mirroredEquipment(part) : structuredClone(part)), id: ids.get(part.id)!, position: position(part.position),
    ...(part.magazineId ? { magazineId: ids.get(part.magazineId) ?? part.magazineId } : {}), ...(part.powerSourceId ? { powerSourceId: ids.get(part.powerSourceId) ?? part.powerSourceId } : {}) })));
  data.loads.push(...data.loads.filter(load => selected.has(load.id)).map(load => ({ ...structuredClone(load), id: ids.get(load.id)!, center: position(load.center) })));
  return [...ids.values()];
}

export function assignConstructionSurfaces(source: ConstructionSource, keys: ReadonlySet<string>, values: Partial<Pick<ConstructionSurfaceAssignment, 'thicknessMm' | 'material' | 'paint' | 'open'>>): void {
  for (const primitive of source.construction.primitives) for (const face of CONSTRUCTION_FACES) {
    if (!keys.has(surfaceKey(primitive.id, face))) continue;
    let assignment = source.construction.surfaces.find(surface => surface.primitiveId === primitive.id && surface.face === face);
    if (!assignment) {
      assignment = { primitiveId: primitive.id, face, thicknessMm: source.construction.defaultThicknessMm, material: 'steel', paint: 'naval-gray' };
      source.construction.surfaces.push(assignment);
    }
    Object.assign(assignment, values);
  }
}
